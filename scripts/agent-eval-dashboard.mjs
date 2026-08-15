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

// ── judge calibration record (2026-W27-R1b, 2026-W28-R1) ────────────────────
// Two P0 entries sat open from late June asking for a calibration record per judge. The evidence
// they need has existed since 2026-05-31 — golden cases plus recorded runs — and nothing ever
// wrote it down, so `judge-calibration-state` reported 0 of 7 calibrated while THIS tool reported
// 10 of 11 measured. Same judges, same day, opposite answers, because one asked "was it run?" and
// the other "is the accuracy written down?". The record is produced HERE, by the same `score()`
// this dashboard already uses, so the two can never drift into two bars for one word again.
//
// The record carries its provenance on purpose: the run it came from, that run's date, and a
// fingerprint of the golden cases. A calibration whose golden set has changed since is STALE, not
// valid — otherwise "the file exists" becomes the capability, which is the defect this engine
// keeps legislating against.
export function goldenFingerprint(goldenRows = []) {
  const ids = goldenRows.map((g) => `${g.case_id}:${String(g.expected_output ?? g.expected ?? '').slice(0, 40)}`).sort().join('|');
  let h = 2166136261;
  for (let i = 0; i < ids.length; i++) { h ^= ids.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** Build the calibration record for one judge. Pure. Returns null when there is nothing to record. */
export function calibrationRecord({ slug, golden = [], run = [], runFile = null, runDate = null } = {}) {
  if (!golden.length || !run.length) return null;
  const s = score(golden, run);
  return {
    slug,
    accuracy: s.accuracy,
    matches: s.matches,
    total: s.total,
    // the bar a caller may rely on. Named here rather than assumed by each reader.
    passThreshold: 0.8,
    meetsThreshold: s.accuracy >= 0.8,
    goldenFingerprint: goldenFingerprint(golden),
    runFile,
    runDate,
    note: 'Снимок: точность посчитана по записанному прогону, а не заново. Если эталонные случаи изменятся, отпечаток разойдётся и запись считается устаревшей.',
  };
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
    // the run FILE is carried out, not just its rows: a calibration record without its provenance
    // reads as a fresh measurement, and these runs are snapshots from a fixed date
    const runFile = runs.length ? runs.at(-1) : null;
    return {
      slug,
      golden: existsSync(gp) ? readJsonl(gp) : [],
      run: runFile ? readJsonl(join(dir, runFile)) : [],
      runFile,
      runDate: runFile ? (runFile.match(/run-(\d{4}-\d{2}-\d{2})/) || [])[1] ?? null : null,
    };
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

    // ── calibration record (2026-W27-R1b / 2026-W28-R1) ────────────────────
    ['a judge with golden + run gets a record with its accuracy',
      calibrationRecord({ slug: 'j', golden: [{ case_id: 'a', expected_output: 'PASS' }], run: [{ case_id: 'a', verdict: 'PASS' }] }).accuracy === 1],
    ['the record names the bar it was judged against, instead of leaving it to the reader',
      calibrationRecord({ slug: 'j', golden: [{ case_id: 'a', expected_output: 'PASS' }], run: [{ case_id: 'a', verdict: 'PASS' }] }).passThreshold === 0.8],
    ['a judge below the bar is recorded as NOT meeting it (never rounded up)', (() => {
      const r = calibrationRecord({ slug: 'j', golden: [{ case_id: 'a', expected_output: 'BLOCK' }], run: [{ case_id: 'a', verdict: 'PASS' }] });
      return r.accuracy === 0 && r.meetsThreshold === false;
    })()],
    ['a judge that was never run gets NO record (silence beats a fabricated number)',
      calibrationRecord({ slug: 'j', golden: [{ case_id: 'a', expected_output: 'PASS' }], run: [] }) === null],
    ['the record carries the run it came from, so a snapshot is not mistaken for a fresh measurement',
      calibrationRecord({ slug: 'j', golden: [{ case_id: 'a', expected_output: 'PASS' }], run: [{ case_id: 'a', verdict: 'PASS' }], runFile: 'run-2026-05-31.jsonl', runDate: '2026-05-31' }).runDate === '2026-05-31'],
    ['the golden fingerprint is stable for the same cases in any order', (() => {
      const a = [{ case_id: 'a', expected_output: 'PASS' }, { case_id: 'b', expected_output: 'BLOCK' }];
      return goldenFingerprint(a) === goldenFingerprint([...a].reverse());
    })()],
    ['CHANGING a golden expectation changes the fingerprint (so the record can go stale)',
      goldenFingerprint([{ case_id: 'a', expected_output: 'PASS' }]) !== goldenFingerprint([{ case_id: 'a', expected_output: 'BLOCK' }])],
    ['ADDING a golden case changes the fingerprint too',
      goldenFingerprint([{ case_id: 'a', expected_output: 'PASS' }]) !== goldenFingerprint([{ case_id: 'a', expected_output: 'PASS' }, { case_id: 'b', expected_output: 'PASS' }])],
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

  // --write-calibration: turn the runs that already exist into the record two P0 entries have been
  // waiting for since June. Written by THIS tool, with THIS tool's scorer, so the calibration and
  // the dashboard cannot disagree about the same judge.
  if (process.argv.includes('--write-calibration')) {
    const { writeFileSync } = await import('node:fs');
    let written = 0, skipped = 0;
    for (const e of scanFs()) {
      const rec = calibrationRecord({ slug: e.slug, golden: e.golden, run: e.run, runFile: e.runFile ?? null, runDate: e.runDate ?? null });
      if (!rec) { skipped++; console.log(`  ⚪ ${e.slug.padEnd(26)} прогона нет — записи не будет (молчание честнее выдуманного числа)`); continue; }
      writeFileSync(join(EVALS, e.slug, 'calibration.json'), JSON.stringify(rec, null, 2) + '\n', 'utf8');
      written++;
      console.log(`  ${rec.meetsThreshold ? '🟢' : '🟡'} ${e.slug.padEnd(26)} точность ${(rec.accuracy * 100).toFixed(0)}% (${rec.matches}/${rec.total})${rec.meetsThreshold ? '' : ' — НИЖЕ порога 80%, записано как есть'}`);
    }
    console.log(`\n  записано ${written}, пропущено ${skipped} (нет прогона)`);
    console.log('  \x1b[2mЭто снимок по прогонам от их даты, а не свежий замер. Отпечаток эталонов хранится в записи: если эталоны изменятся, запись станет устаревшей.\x1b[0m');
    process.exit(0);
  }

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
