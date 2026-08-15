#!/usr/bin/env node
/**
 * judge-calibration-state — emit the machine-readable calibration marker the memory pipeline reads.
 *
 * The gap (2026-W27 rank 1B): reasoning-distill gates strategy INJECTION behind "judges are
 * calibrated", and memory-guard's shared path assumes measured judges — but nothing wrote the
 * signal they read (docs/metrics/judge-calibration-state.json). This derives that signal from
 * REAL on-disk evidence and writes it, so the gate is driven by truth, not an absent file.
 *
 * Honest definition (no overclaiming):
 *   - calibratable  = the judge has docs/evals/<slug>/golden-cases.jsonl (a dataset exists).
 *   - CALIBRATED    = a per-judge calibration record docs/evals/<slug>/calibration.json exists
 *                     (agreement + accuracy recorded by an actual judge-calibration run).
 * measuredJudges = count CALIBRATED. Today that is 0 — the datasets are seeded but the per-judge
 * calibration runs (which require the LLM swap-and-compare judge) have NOT been recorded. That is
 * the correct, load-bearing state: it keeps reasoning-distill's injection GATED (strategies stay
 * private) until real calibration lands. The moment a judge's calibration.json is written, the
 * marker recomputes and the gate opens for it automatically.
 *
 * FINISHING calibration (running each dormant judge over its golden cases and recording
 * agreement/drift via judge-calibration.mjs) is a live-LLM task — this script does NOT fabricate
 * it; it reports what is provably measured.
 *
 * Usage:
 *   node scripts/judge-calibration-state.mjs           # write docs/metrics/judge-calibration-state.json
 *   node scripts/judge-calibration-state.mjs --dry     # print, write nothing
 *   node scripts/judge-calibration-state.mjs --self-test
 */

import fs from 'node:fs';
import { goldenFingerprint } from './agent-eval-dashboard.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// The LLM judges whose verdicts the pipeline trusts (render a verdict a downstream step relies on).
export const JUDGE_SLUGS = [
  'constitutional-reviewer', 'debate-judge', 'debate-prosecutor', 'debate-defender',
  'best-of-N-judge', 'reflexion-critic', 'self-improvement-reviewer',
];

/**
 * Compute the calibration state from disk evidence. Pure over an injected fs probe (for tests).
 * @param {(relPath:string)=>boolean} exists  probe: does ROOT-relative path exist?
 * @returns {{generated:string, measuredJudges:number, total:number, judges:Array}}
 */
// A calibration record is only worth its name while it still describes the CURRENT golden set.
// Existence alone was the whole test until 2026-08-15, and existence-as-capability is the defect
// this engine keeps closing everywhere else. `read` is optional so old callers keep working: with
// no reader the state falls back to existence and SAYS the freshness was not checked.
export function computeState(exists, read = null) {
  const judges = JUDGE_SLUGS.map((slug) => {
    const calibratable = exists(`docs/evals/${slug}/golden-cases.jsonl`);
    const calibrated = exists(`docs/evals/${slug}/calibration.json`);
    if (!calibrated) return { slug, calibratable, status: calibratable ? 'dormant' : 'no-dataset' };
    if (!read) return { slug, calibratable, status: 'measured', freshnessChecked: false };
    // stale = the golden cases moved under a record that was computed against the old ones
    let rec = null, golden = null;
    try { rec = JSON.parse(read(`docs/evals/${slug}/calibration.json`) || 'null'); } catch { rec = null; }
    try { golden = read(`docs/evals/${slug}/golden-cases.jsonl`); } catch { golden = null; }
    if (!rec) return { slug, calibratable, status: 'dormant', freshnessChecked: true, why: 'запись калибровки не читается' };
    if (!rec.goldenFingerprint || golden == null) {
      return { slug, calibratable, status: 'measured', freshnessChecked: false, why: 'в записи нет отпечатка эталонов — свежесть не проверить' };
    }
    const rows = golden.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const now = goldenFingerprint(rows);
    return now === rec.goldenFingerprint
      ? { slug, calibratable, status: 'measured', freshnessChecked: true, accuracy: rec.accuracy, meetsThreshold: rec.meetsThreshold, runDate: rec.runDate ?? null }
      : { slug, calibratable, status: 'stale', freshnessChecked: true, why: `эталоны изменились после калибровки (${rec.goldenFingerprint} → ${now})`, runDate: rec.runDate ?? null };
  });
  // measured != good. debate-defender is measured at 50% accuracy, and a capability gate that
  // counts it as support opens on the strength of a judge that is wrong half the time. So the
  // GATE counts `reliable` (measured AND at or above its recorded threshold) while `measured`
  // stays published, because hiding the weak judge would be the opposite mistake.
  const measured = judges.filter((j) => j.status === 'measured');
  return {
    generated: 'derived from docs/evals/<slug>/{golden-cases,calibration}.json',
    measuredJudges: measured.length,
    reliableJudges: measured.filter((j) => j.meetsThreshold === true).length,
    total: judges.length,
    judges,
  };
}

const existsRel = (rel) => fs.existsSync(path.join(ROOT, rel));

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  // Injected probe: only reflexion-critic is fully calibrated; best-of-N-judge has a dataset only.
  const probe = (rel) =>
    rel === 'docs/evals/reflexion-critic/golden-cases.jsonl' ||
    rel === 'docs/evals/reflexion-critic/calibration.json' ||
    rel === 'docs/evals/best-of-N-judge/golden-cases.jsonl';
  const s = computeState(probe);
  const bySlug = Object.fromEntries(s.judges.map((j) => [j.slug, j]));
  ok('reflexion-critic with dataset+calibration → measured', bySlug['reflexion-critic'].status === 'measured');
  ok('best-of-N-judge with dataset only → dormant', bySlug['best-of-N-judge'].status === 'dormant');
  ok('a judge with no dataset → no-dataset', bySlug['debate-prosecutor'].status === 'no-dataset');
  ok('measuredJudges counts only the calibrated', s.measuredJudges === 1);
  ok('total covers every judge slug', s.total === JUDGE_SLUGS.length);

  // None calibrated → measuredJudges 0 (the honest gate-closed state).
  const none = computeState(() => false);
  ok('no evidence → 0 measured (injection stays gated)', none.measuredJudges === 0);
  // The real on-disk state is honest and does not throw.
  const real = computeState(existsRel);
  ok('real state computes without error and is a number', Number.isInteger(real.measuredJudges));

  // ── freshness, not just existence (2026-W27-R1b / 2026-W28-R1) ──────────
  // Until a record could go STALE, "the file exists" was the whole capability test — the same
  // shape as an anchor sitting in a comment. A calibration computed against golden cases that have
  // since changed describes a judge that no longer exists.
  const goldenLine = JSON.stringify({ case_id: 'a', expected_output: 'PASS' });
  const freshFp = goldenFingerprint([{ case_id: 'a', expected_output: 'PASS' }]);
  const mkRead = (fp) => (rel) => rel.endsWith('golden-cases.jsonl') ? goldenLine + '\n'
    : rel.endsWith('calibration.json') ? JSON.stringify({ accuracy: 1, meetsThreshold: true, goldenFingerprint: fp, runDate: '2026-05-31' })
    : null;
  const fresh = computeState(probe, mkRead(freshFp));
  const freshJ = Object.fromEntries(fresh.judges.map((j) => [j.slug, j]));
  ok('a record matching the CURRENT golden set stays measured', freshJ['reflexion-critic'].status === 'measured');
  ok('a fresh record carries its accuracy and run date forward', freshJ['reflexion-critic'].accuracy === 1 && freshJ['reflexion-critic'].runDate === '2026-05-31');
  const stale = computeState(probe, mkRead('deadbeef'));
  const staleJ = Object.fromEntries(stale.judges.map((j) => [j.slug, j]));
  ok('a record whose golden set MOVED is stale, not measured', staleJ['reflexion-critic'].status === 'stale');
  ok('a stale record does NOT count toward measuredJudges (the gate stays shut)', stale.measuredJudges === 0);
  ok('a stale record says why, with both fingerprints', /эталоны изменились/.test(staleJ['reflexion-critic'].why));
  // measured != reliable: a judge below its own threshold must not help open a capability gate
  const weakRead = (rel) => rel.endsWith('golden-cases.jsonl') ? goldenLine + '\n'
    : rel.endsWith('calibration.json') ? JSON.stringify({ accuracy: 0.5, meetsThreshold: false, goldenFingerprint: freshFp, runDate: '2026-05-31' })
    : null;
  const weak = computeState(probe, weakRead);
  ok('a judge BELOW its threshold is still counted as measured (not hidden)', weak.measuredJudges === 1);
  ok('but it does NOT count as reliable, so the capability gate stays shut', weak.reliableJudges === 0);
  ok('a judge at or above its threshold counts as reliable', computeState(probe, mkRead(freshFp)).reliableJudges === 1);
  ok('with no reader the state still works but ADMITS freshness was not checked',
    Object.fromEntries(computeState(probe).judges.map((j) => [j.slug, j]))['reflexion-critic'].freshnessChecked === false);

  if (fails) { console.log('\n\x1b[31mjudge-calibration-state self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ judge-calibration-state: honest per-judge calibration marker correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  // the reader is passed so freshness is really checked, not assumed
  const readRel = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
  const state = computeState(existsRel, readRel);
  console.log(`[judge-calibration-state] ${state.measuredJudges}/${state.total} judges calibrated (measured):`);
  const ICON = { measured: '🟢', stale: '🟠', dormant: '🟡', 'no-dataset': '⚪' };
  for (const j of state.judges) {
    const extra = j.status === 'measured' && j.accuracy != null
      ? ` — точность ${(j.accuracy * 100).toFixed(0)}%${j.meetsThreshold ? '' : ' (НИЖЕ порога)'}, прогон ${j.runDate ?? '?'}`
      : j.why ? ` — ${j.why}` : '';
    console.log(`  ${ICON[j.status] || '⚪'} ${j.slug}: ${j.status}${extra}`);
  }
  const weak = state.measuredJudges - state.reliableJudges;
  if (weak > 0) console.log(`  \x1b[33m${weak} судья(-и) измерены, но НИЖЕ своего порога — в счёт ворот не идут\x1b[0m`);
  console.log(state.reliableJudges >= 2
    ? `  → надёжных судей ${state.reliableJudges} (>=2): reasoning-distill может раздавать выжимки стратегий.`
    : `  → надёжных судей ${state.reliableJudges} (<2): reasoning-distill держит стратегии закрытыми — честно и безопасно.`);

  if (process.argv.includes('--dry')) { console.log('[judge-calibration-state] --dry: nothing written'); process.exit(0); }
  const outDir = path.join(ROOT, 'docs', 'metrics');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'judge-calibration-state.json');
  fs.writeFileSync(out, JSON.stringify(state, null, 2) + '\n', 'utf8');
  console.log(`[judge-calibration-state] wrote ${path.relative(ROOT, out)}`);
  process.exit(0);
}
