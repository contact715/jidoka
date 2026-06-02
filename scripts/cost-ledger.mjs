#!/usr/bin/env node
// cost-ledger — a running token-cost ledger with a daily limit + alert, and the batch-retry guard.
// (Validation wave: driven end-to-end through the jidoka pipeline; grounded in a real incident where
// batch re-scoring re-billed already-succeeded items and triple-spent a daily budget, caught only by
// alerts.) budget-gate caps per WAVE; compute-cost computes a cost; neither keeps a running DAILY
// ledger with a hard limit, an alert level, and the amplification guard. This does.
//
// Money is INTEGER CENTS end-to-end — no float arithmetic on money (the precision-guard rule this very
// wave dogfoods). entry: { date: 'YYYY-MM-DD', tokens, cents, op }
//
// FULL & self-tested. Usage:
//   node scripts/cost-ledger.mjs --self-test
//   node scripts/cost-ledger.mjs --assess <ledger.jsonl> --limit-cents 2000 --date 2026-06-02

import { readFileSync, existsSync } from 'node:fs';

// AC-1: append without mutating the input
export function record(ledger, entry) {
  return [...(ledger || []), entry];
}

// AC-2: sum cents for one date only
export function dailySpendCents(ledger, date) {
  return (ledger || []).filter((e) => e.date === date).reduce((sum, e) => sum + (e.cents | 0), 0);
}

// AC-3 + AC-4: integer-cents daily-limit assessment, level ok/warn/block
export function assess(ledger, { dailyLimitCents, date }) {
  const spentCents = dailySpendCents(ledger, date);
  const limit = dailyLimitCents | 0;
  const pctUsed = limit > 0 ? Math.round((100 * spentCents) / limit) : 100;
  const level = pctUsed >= 100 ? 'block' : pctUsed >= 80 ? 'warn' : 'ok';
  return { spentCents, limitCents: limit, pctUsed, level };
}

// AC-5: the triple-spend trap — retrying a WHOLE batch re-bills the items that already succeeded
export function wouldAmplify({ batchSize, succeeded = 0, failed = 0, retryWhole = true } = {}) {
  if (!retryWhole) return false; // retrying only the failed items is safe
  return succeeded > 0 && failed > 0 && succeeded + failed <= batchSize + 0; // whole-batch retry re-charges the succeeded
}

const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const base = [{ date: '2026-06-01', tokens: 1000, cents: 50, op: 'score' }];
  const after = record(base, { date: '2026-06-02', tokens: 2000, cents: 90, op: 'plan' });
  ok('AC-1: record appends without mutating input', after.length === 2 && base.length === 1);
  ok('AC-2: dailySpendCents sums only the given date', dailySpendCents(after, '2026-06-02') === 90 && dailySpendCents(after, '2026-06-01') === 50);

  const day = [{ date: 'd', cents: 700 }, { date: 'd', cents: 100 }]; // 800 of 1000 = 80%
  ok('AC-3: 80% → warn', assess(day, { dailyLimitCents: 1000, date: 'd' }).level === 'warn');
  ok('AC-3: 50% → ok', assess([{ date: 'd', cents: 500 }], { dailyLimitCents: 1000, date: 'd' }).level === 'ok');
  ok('AC-3: 100%+ → block', assess([{ date: 'd', cents: 1200 }], { dailyLimitCents: 1000, date: 'd' }).level === 'block');
  ok('AC-3: exactly 79% is still ok, 80% warns (boundary)', assess([{ date: 'd', cents: 790 }], { dailyLimitCents: 1000, date: 'd' }).level === 'ok' && assess([{ date: 'd', cents: 800 }], { dailyLimitCents: 1000, date: 'd' }).level === 'warn');
  ok('AC-4: pctUsed is integer (no float money)', Number.isInteger(assess([{ date: 'd', cents: 333 }], { dailyLimitCents: 1000, date: 'd' }).pctUsed));
  ok('zero limit → block (no divide-by-zero, fail safe)', assess([{ date: 'd', cents: 1 }], { dailyLimitCents: 0, date: 'd' }).level === 'block');

  ok('AC-5: whole-batch retry with succeeded>0 → amplifies (the triple-spend trap)', wouldAmplify({ batchSize: 50, succeeded: 20, failed: 30 }) === true);
  ok('AC-5: retrying only failed items → safe', wouldAmplify({ batchSize: 50, succeeded: 20, failed: 30, retryWhole: false }) === false);
  ok('AC-5: all-succeeded (no failure) → no retry, no amplify', wouldAmplify({ batchSize: 50, succeeded: 50, failed: 0 }) === false);

  if (fails.length) { console.log(`\n\x1b[31mcost-ledger self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ cost-ledger: daily-limit ledger + amplification guard correct (integer cents)\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const lp = arg('--assess');
  if (!lp || !existsSync(lp)) { console.error("usage: --assess <ledger.jsonl> --limit-cents <N> --date <YYYY-MM-DD>  (or --self-test)"); process.exit(2); }
  const r = assess(readJsonl(lp), { dailyLimitCents: parseInt(arg('--limit-cents') || '0', 10), date: arg('--date') });
  console.log(`cost-ledger — ${arg('--date')}: ${r.spentCents}¢ / ${r.limitCents}¢ = ${r.pctUsed}% → ${r.level.toUpperCase()}`);
  process.exit(r.level === 'block' ? 1 : 0);
}
