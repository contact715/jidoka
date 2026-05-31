#!/usr/bin/env node
// agent-eval-dashboard — one honest view of which LLM agents are MEASURED vs DORMANT.
//
// Reads docs/evals/<agent>/{golden-cases.jsonl, run-<date>.jsonl}: golden+run → MEASURED (with the
// scored accuracy); golden but no run → DORMANT (scaffolded, never actually run). Surfaces the
// "N of M measured" headline so the framework never quietly treats untested judges as trustworthy.
//
// FULL & self-tested. Usage: node scripts/agent-eval-dashboard.mjs [--self-test]

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { score } from './llm-eval-score.mjs';

const EVALS = 'docs/evals';
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// pure: classify each entry {slug, golden[], run[]}
export function summarize(entries) {
  return entries.map(e => {
    if (!e.golden || !e.golden.length) return { slug: e.slug, status: 'no-golden', accuracy: null, total: 0 };
    if (!e.run || !e.run.length) return { slug: e.slug, status: 'DORMANT', accuracy: null, total: e.golden.length };
    const s = score(e.golden, e.run);
    return { slug: e.slug, status: 'MEASURED', accuracy: s.accuracy, matches: s.matches, total: s.total };
  });
}

export function headline(rows) {
  const withGolden = rows.filter(r => r.status !== 'no-golden');
  const measured = withGolden.filter(r => r.status === 'MEASURED');
  return { measured: measured.length, withGolden: withGolden.length };
}

function scanFs() {
  if (!existsSync(EVALS)) return [];
  const dirs = readdirSync(EVALS).filter(d => { try { return statSync(join(EVALS, d)).isDirectory(); } catch { return false; } });
  return dirs.map(slug => {
    const dir = join(EVALS, slug);
    const gp = join(dir, 'golden-cases.jsonl');
    const runs = readdirSync(dir).filter(f => f.startsWith('run-') && f.endsWith('.jsonl')).sort();
    return { slug, golden: existsSync(gp) ? readJsonl(gp) : [], run: runs.length ? readJsonl(join(dir, runs.at(-1))) : [] };
  });
}

function selfTest() {
  const entries = [
    { slug: 'measured-perfect', golden: [{ case_id: 'a', expected_output: 'PASS' }], run: [{ case_id: 'a', verdict: 'PASS' }] },
    { slug: 'measured-partial', golden: [{ case_id: 'a', expected_output: 'BLOCK' }], run: [{ case_id: 'a', verdict: 'REVISE' }] },
    { slug: 'dormant', golden: [{ case_id: 'a', expected_output: 'PASS' }], run: [] },
    { slug: 'empty', golden: [], run: [] },
  ];
  const rows = summarize(entries);
  const by = Object.fromEntries(rows.map(r => [r.slug, r]));
  const h = headline(rows);
  const T = [
    ['golden+run → MEASURED', by['measured-perfect'].status === 'MEASURED'],
    ['perfect run scores 100%', by['measured-perfect'].accuracy === 1],
    ['a wrong verdict shows <100%', by['measured-partial'].accuracy === 0],
    ['golden but no run → DORMANT', by['dormant'].status === 'DORMANT'],
    ['no golden → not counted', by['empty'].status === 'no-golden'],
    ['headline: 2 measured of 3 with golden', h.measured === 2 && h.withGolden === 3],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31magent-eval-dashboard self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ agent-eval-dashboard: classification correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const rows = summarize(scanFs());
  const h = headline(rows);
  console.log('Agent eval dashboard — LLM judge measurement status\n');
  for (const r of rows.filter(x => x.status !== 'no-golden')) {
    const icon = r.status === 'MEASURED' ? (r.accuracy === 1 ? '🟢' : '🟡') : '⚪';
    const acc = r.status === 'MEASURED' ? `${r.matches}/${r.total} (${(r.accuracy * 100).toFixed(0)}%)` : 'not run yet';
    console.log(`  ${icon} ${r.slug.padEnd(26)} ${r.status.padEnd(9)} ${acc}`);
  }
  console.log(`\n  \x1b[1m${h.measured} of ${h.withGolden} agents with golden cases are MEASURED.\x1b[0m`);
  console.log('  \x1b[2mMEASURED = run against known-correct golden verdicts (snapshot, non-deterministic). DORMANT = golden cases exist but never run.\x1b[0m');
  process.exit(0);
}
