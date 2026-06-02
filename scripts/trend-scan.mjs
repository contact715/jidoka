#!/usr/bin/env node
// trend-scan — feed an EXTERNAL signal into the self-improvement loop. jidoka's self-improvement-reviewer
// looks INWARD (retros); a high-volume practitioner also scans OUTWARD weekly (trending repos, AI news,
// market pain) and borrows the best — exactly how the GSD borrow happened here, but by hand. This keeps
// a ranked ledger of candidates to evaluate, so "what's worth borrowing this week" is a managed queue,
// not a one-off.
//
// HONEST split (FULL ranking / DORMANT scan): the dedup + recency ranking is FULL & self-tested. The
// actual web scan (which repos/news exist) is the orchestrator's job (it has web tools); this aggregates
// what was scanned. No fabrication — an empty ledger ranks to nothing.
//
// candidate: { key (repo or title), kind: 'repo'|'news'|'pain', date: 'YYYY-MM-DD', stars?, note }
//
// FULL & self-tested. Usage:
//   node scripts/trend-scan.mjs --self-test
//   node scripts/trend-scan.mjs --add '{"key":"open-gsd/gsd-core","kind":"repo","date":"2026-06-01","stars":40000,"note":"spec-driven harness"}'
//   node scripts/trend-scan.mjs --top 10

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LEDGER = 'docs/trends/_candidates.jsonl';

// pure: dedup by key (keep the most recent), rank by recency then stars
export function rankCandidates(entries = []) {
  const byKey = {};
  for (const e of entries) {
    const k = (e.key || '').toLowerCase();
    if (!k) continue;
    if (!byKey[k] || String(e.date || '') > String(byKey[k].date || '')) byKey[k] = e;
  }
  return Object.values(byKey).sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) || ((b.stars || 0) - (a.stars || 0)));
}

const readLedger = () => (existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const entries = [
    { key: 'a/x', kind: 'repo', date: '2026-05-01', stars: 100 },
    { key: 'a/x', kind: 'repo', date: '2026-06-01', stars: 120 }, // newer dup → wins
    { key: 'b/y', kind: 'repo', date: '2026-06-01', stars: 500 },
    { key: 'c/z', kind: 'news', date: '2026-04-01' },
  ];
  const r = rankCandidates(entries);
  ok('dedups by key, keeping the most recent', r.filter((e) => e.key === 'a/x').length === 1 && r.find((e) => e.key === 'a/x').stars === 120);
  ok('most recent ranks first (tie broken by stars: b/y before a/x)', r[0].key === 'b/y' && r[1].key === 'a/x');
  ok('older entry ranks last', r[r.length - 1].key === 'c/z');
  ok('empty ledger → empty ranking (no fabrication)', rankCandidates([]).length === 0);
  ok('entries without a key are dropped', rankCandidates([{ date: '2026-06-01' }, { key: 'k', date: '2026-06-01' }]).length === 1);

  if (fails.length) { console.log(`\n\x1b[31mtrend-scan self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ trend-scan: candidate dedup + recency ranking correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  if (arg('--add')) {
    const entry = JSON.parse(arg('--add'));
    if (!existsSync(dirname(LEDGER))) mkdirSync(dirname(LEDGER), { recursive: true });
    writeFileSync(LEDGER, (existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : '') + JSON.stringify(entry) + '\n');
    console.log(`trend-scan: recorded candidate ${entry.key}`);
    process.exit(0);
  }
  const n = parseInt(arg('--top') || '10', 10);
  const ranked = rankCandidates(readLedger());
  if (!ranked.length) { console.log('trend-scan: no candidates yet. The orchestrator scans trending repos/news weekly and records them via --add; this ranks them for architect review.'); process.exit(0); }
  console.log(`trend-scan — top ${Math.min(n, ranked.length)} candidates to evaluate for borrowing:\n`);
  ranked.slice(0, n).forEach((e, i) => console.log(`  ${i + 1}. [${e.kind}] ${e.key}${e.stars ? ` (${e.stars}★)` : ''} — ${e.note || ''} (${e.date})`));
  process.exit(0);
}
