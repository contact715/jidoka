#!/usr/bin/env node
// frontier-eval — run the post-wave frontier evals the planner schedules in the MEMORY phase, so the
// outcome-based mechanisms (agent-benchmark, trajectory-score, judge-calibration) actually RUN every
// wave instead of just existing. This is the integration that turns "we built the frontier evals" into
// "the frontier evals are in the loop".
//
// What runs when (honest, data-gated — no fabrication):
//   agent-benchmark   — ALWAYS (resolution rate over the held-out task set; it has its own seed)
//   trajectory-score  — only if a wave trajectory was recorded (else honestly skipped)
//   judge-calibration — only if judge verdicts were recorded this wave (else honestly skipped)
//
// FULL & self-tested (the planning logic) / the per-eval data is produced by the wave.
// Usage:
//   node scripts/frontier-eval.mjs --self-test
//   node scripts/frontier-eval.mjs [--trace <trace.json>] [--verdicts <rows.json>]

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// pure: which post-wave evals run, given what data the wave produced
export function planPostWaveEval({ hasTrace = false, hasVerdicts = false } = {}) {
  const evals = ['agent-benchmark']; // always — the outcome resolution rate
  if (hasTrace) evals.push('trajectory-score');
  if (hasVerdicts) evals.push('judge-calibration');
  return evals;
}

function run(label, cmd) {
  process.stdout.write(`\n── ${label} ──\n`);
  try { execSync(cmd, { cwd: join(HERE, '..'), stdio: 'inherit', timeout: 180000 }); return true; }
  catch { return false; }
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('benchmark always runs (no data)', JSON.stringify(planPostWaveEval({})) === JSON.stringify(['agent-benchmark']));
  ok('trace present → trajectory added', planPostWaveEval({ hasTrace: true }).includes('trajectory-score'));
  ok('verdicts present → calibration added', planPostWaveEval({ hasVerdicts: true }).includes('judge-calibration'));
  ok('all data → all three, benchmark first', JSON.stringify(planPostWaveEval({ hasTrace: true, hasVerdicts: true })) === JSON.stringify(['agent-benchmark', 'trajectory-score', 'judge-calibration']));
  ok('no data does NOT run trajectory/calibration (honest skip, no fabrication)', !planPostWaveEval({}).includes('trajectory-score') && !planPostWaveEval({}).includes('judge-calibration'));

  if (fails.length) { console.log(`\n\x1b[31mfrontier-eval self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ frontier-eval: post-wave eval planning correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const trace = arg('--trace');
  const verdicts = arg('--verdicts');
  const plan = planPostWaveEval({ hasTrace: !!(trace && existsSync(trace)), hasVerdicts: !!(verdicts && existsSync(verdicts)) });
  console.log(`frontier-eval — post-wave evals: ${plan.join(', ')}`);

  let allOk = true;
  allOk = run('agent-benchmark (outcome resolution rate)', 'node scripts/agent-benchmark.mjs --verify') && allOk;
  if (plan.includes('trajectory-score')) allOk = run('trajectory-score', `node scripts/trajectory-score.mjs --trace ${trace}`) && allOk;
  else console.log('\n── trajectory-score ──\n  ○ skipped: no wave trajectory recorded (pass --trace <file> to score one).');
  if (plan.includes('judge-calibration')) allOk = run('judge-calibration', `node scripts/judge-calibration.mjs --verdicts ${verdicts}`) && allOk;
  else console.log('\n── judge-calibration ──\n  ○ skipped: no judge verdicts recorded this wave (pass --verdicts <file>).');

  console.log(`\n${allOk ? '\x1b[32m✓ frontier-eval: post-wave evals passed.\x1b[0m' : '\x1b[31m✗ frontier-eval: a post-wave eval failed.\x1b[0m'}`);
  process.exit(allOk ? 0 : 1);
}
