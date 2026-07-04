#!/usr/bin/env node
// kaizen-scorecard — the analytics of the weekly Kaizen engine (Phase 1c).
//
// Turns the outcome ledger into the process's KPIs: how many recommendations, what fraction
// actually shipped (adoption rate — the process's own hit-rate), how long they took, how many
// regressed, and (from meta-trend) how much of the recurring-mistake surface is gated. With a
// previous scorecard it also reports the week-over-week trend, so it is a direction, not a
// one-off number. Pure, zero-dep.
//
// Usage:
//   node scripts/kaizen-scorecard.mjs [--file <ledger>] [--json]
//   node scripts/kaizen-scorecard.mjs --self-test

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLedger, DEFAULT_LEDGER } from './kaizen-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse "2026-W27" → {year, week}. */
export function parseWeek(w) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(w || ''));
  return m ? { year: Number(m[1]), week: Number(m[2]) } : null;
}

/** Whole-week distance a→b (b later). Approximate (52 weeks/year) — fine for small deltas. */
export function weekDiff(a, b) {
  const pa = parseWeek(a), pb = parseWeek(b);
  if (!pa || !pb) return null;
  return (pb.year - pa.year) * 52 + (pb.week - pa.week);
}

/** Pull "gate coverage X% (n/m recurring classes gated)" out of meta-trend's text. */
export function parseClassClosure(metaTrendText = '') {
  const m = /gate coverage[^\d]*(\d+)%\s*\((\d+)\/(\d+)/i.exec(metaTrendText);
  if (!m) return null;
  return { pct: Number(m[1]), gated: Number(m[2]), total: Number(m[3]) };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Compute the scorecard from ledger entries. Pure.
 * @param {Array} entries
 * @param {{metaTrendText?:string, prev?:object}} opts  prev = a prior scorecard for trend
 */
export function scorecard(entries = [], opts = {}) {
  const rejected = entries.filter((e) => e.status === 'rejected');
  const actionable = entries.filter((e) => e.status !== 'rejected');
  const shipped = actionable.filter((e) => e.status === 'shipped');
  const open = actionable.filter((e) => e.status === 'open' || e.status === 'proposed');
  const regressed = actionable.filter((e) => e.status === 'regressed');

  const adoptionRate = actionable.length ? round2(shipped.length / actionable.length) : 0;
  // regression rate = regressed / (things that ever shipped) — shipped-now + regressed-from-shipped
  const everShipped = shipped.length + regressed.length;
  const regressionRate = everShipped ? round2(regressed.length / everShipped) : 0;

  const ttis = shipped.map((e) => weekDiff(e.week, e.shippedWeek)).filter((n) => n != null && n >= 0);
  const meanTimeToImplementWeeks = ttis.length ? round2(ttis.reduce((a, b) => a + b, 0) / ttis.length) : null;

  const classClosure = parseClassClosure(opts.metaTrendText || '');

  const card = {
    recs: entries.length,
    actionable: actionable.length,
    shippedCount: shipped.length,
    openCount: open.length,
    regressedCount: regressed.length,
    rejectedCount: rejected.length,
    adoptionRate,
    regressionRate,
    meanTimeToImplementWeeks,
    classClosure,
  };

  if (opts.prev) {
    const d = (a, b) => (typeof a === 'number' && typeof b === 'number' ? round2(a - b) : null);
    card.trend = {
      adoptionRate: d(card.adoptionRate, opts.prev.adoptionRate),
      regressionRate: d(card.regressionRate, opts.prev.regressionRate),
      shippedCount: d(card.shippedCount, opts.prev.shippedCount),
    };
  }
  return card;
}

/** One-line human summary (used by the dashboard + the weekly notice). */
export function summarize(card) {
  const pct = Math.round((card.adoptionRate || 0) * 100);
  const trend = card.trend && card.trend.adoptionRate != null
    ? ` (${card.trend.adoptionRate >= 0 ? '+' : ''}${Math.round(card.trend.adoptionRate * 100)}pp vs last week)` : '';
  const cc = card.classClosure ? `, class-closure ${card.classClosure.pct}%` : '';
  const tti = card.meanTimeToImplementWeeks != null ? `, ~${card.meanTimeToImplementWeeks}w to ship` : '';
  return `adoption ${pct}%${trend} · shipped ${card.shippedCount}/${card.actionable}, open ${card.openCount}, regressed ${card.regressedCount}${tti}${cc}`;
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  ok('parseWeek reads ISO week', (() => { const p = parseWeek('2026-W27'); return p.year === 2026 && p.week === 27; })());
  ok('weekDiff same-year', weekDiff('2026-W27', '2026-W30') === 3);
  ok('weekDiff across year', weekDiff('2025-W51', '2026-W02') === 3);
  ok('parseClassClosure reads meta-trend line', (() => { const c = parseClassClosure('gate coverage ......... 60% (3/5 recurring classes gated)'); return c.pct === 60 && c.gated === 3 && c.total === 5; })());
  ok('parseClassClosure null when absent', parseClassClosure('no coverage line here') === null);

  const entries = [
    { id: 'a', week: '2026-W25', title: 't', status: 'shipped', shippedWeek: '2026-W27' }, // 2w
    { id: 'b', week: '2026-W26', title: 't', status: 'shipped', shippedWeek: '2026-W27' }, // 1w
    { id: 'c', week: '2026-W27', title: 't', status: 'open' },
    { id: 'd', week: '2026-W20', title: 't', status: 'regressed' },
    { id: 'e', week: '2026-W27', title: 't', status: 'rejected' },
  ];
  const card = scorecard(entries, { metaTrendText: 'gate coverage 60% (3/5 recurring classes gated)' });
  ok('recs counts all entries', card.recs === 5);
  ok('actionable excludes rejected', card.actionable === 4);
  ok('shipped/open/regressed/rejected counts', card.shippedCount === 2 && card.openCount === 1 && card.regressedCount === 1 && card.rejectedCount === 1);
  ok('adoption rate = shipped / actionable (2/4 = 0.5)', card.adoptionRate === 0.5);
  ok('regression rate = regressed / everShipped (1/3 ≈ 0.33)', card.regressionRate === 0.33);
  ok('mean time-to-implement = (2+1)/2 = 1.5 weeks', card.meanTimeToImplementWeeks === 1.5);
  ok('classClosure parsed from meta-trend', card.classClosure && card.classClosure.pct === 60);
  ok('no trend without a prev card', card.trend === undefined);

  const card2 = scorecard(entries, { prev: { adoptionRate: 0.3, regressionRate: 0.5, shippedCount: 1 } });
  ok('trend computes deltas vs prev', card2.trend.adoptionRate === 0.2 && card2.trend.shippedCount === 1);

  ok('empty ledger → zero adoption, no crash', (() => { const c = scorecard([]); return c.adoptionRate === 0 && c.recs === 0 && c.meanTimeToImplementWeeks === null; })());
  ok('summarize renders a one-liner', /adoption 50%/.test(summarize(card)));

  if (fails) { console.log('\n\x1b[31mkaizen-scorecard self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-scorecard: analytics (adoption/regression/TTI/closure/trend) correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const file = arg('--file') || DEFAULT_LEDGER;
  let metaTrendText = '';
  try { metaTrendText = execFileSync('node', [path.join(ROOT, 'scripts', 'meta-trend.mjs')], { cwd: ROOT, encoding: 'utf8' }); } catch { /* best-effort */ }
  const card = scorecard(readLedger(file), { metaTrendText });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(card, null, 2)); process.exit(0); }
  console.log('[kaizen-scorecard] ' + summarize(card));
  process.exit(0);
}
