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
export function computeState(exists) {
  const judges = JUDGE_SLUGS.map((slug) => {
    const calibratable = exists(`docs/evals/${slug}/golden-cases.jsonl`);
    const calibrated = exists(`docs/evals/${slug}/calibration.json`);
    return { slug, calibratable, status: calibrated ? 'measured' : (calibratable ? 'dormant' : 'no-dataset') };
  });
  return {
    generated: 'derived from docs/evals/<slug>/{golden-cases,calibration}.json',
    measuredJudges: judges.filter((j) => j.status === 'measured').length,
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

  if (fails) { console.log('\n\x1b[31mjudge-calibration-state self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ judge-calibration-state: honest per-judge calibration marker correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  const state = computeState(existsRel);
  console.log(`[judge-calibration-state] ${state.measuredJudges}/${state.total} judges calibrated (measured):`);
  for (const j of state.judges) console.log(`  ${j.status === 'measured' ? '🟢' : j.status === 'dormant' ? '🟡' : '⚪'} ${j.slug}: ${j.status}`);
  console.log(state.measuredJudges >= 2
    ? '  → >=2 measured: reasoning-distill may inject distilled strategies (shared).'
    : '  → <2 measured: reasoning-distill keeps strategies private (injection gated) — honest, safe.');

  if (process.argv.includes('--dry')) { console.log('[judge-calibration-state] --dry: nothing written'); process.exit(0); }
  const outDir = path.join(ROOT, 'docs', 'metrics');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'judge-calibration-state.json');
  fs.writeFileSync(out, JSON.stringify(state, null, 2) + '\n', 'utf8');
  console.log(`[judge-calibration-state] wrote ${path.relative(ROOT, out)}`);
  process.exit(0);
}
