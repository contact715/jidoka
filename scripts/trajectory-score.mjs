#!/usr/bin/env node
// trajectory-score — score the agent's PATH, not only its outcome (frontier: "trajectory vs outcome"
// metrics, Anthropic's agent-evals guide). agent-trace records what an agent DID; this scores it:
// steps, error calls, out-of-scope calls, wasted work, budget adherence. A correct outcome reached
// via a bloated, out-of-scope, error-strewn path is a WORSE agent than one that gets there cleanly —
// outcome-only scoring hides that. Pairs with agent-benchmark (outcome) for the full picture.
//
// HONEST boundary: it scores a trace SHAPE ({steps:[{tool, ok, inScope}]}) that agent-trace emits or
// the orchestrator records; it does not re-derive intent. Heuristic efficiency, not a ground-truth ideal.
//
// FULL & self-tested. Usage:
//   node scripts/trajectory-score.mjs --self-test
//   node scripts/trajectory-score.mjs --trace <trace.json> [--max-steps N]

import { readFileSync, existsSync } from 'node:fs';

// pure: score one trajectory. trace = { steps: [{ tool, ok, inScope }], ... }
export function scoreTrajectory(trace = {}, { maxSteps } = {}) {
  const steps = Array.isArray(trace.steps) ? trace.steps : [];
  const total = steps.length;
  const errors = steps.filter((s) => s.ok === false).length;
  const outOfScope = steps.filter((s) => s.inScope === false).length;
  const wasted = errors + outOfScope; // a step can be both; union would need ids — kept simple, stated
  const efficiency = total ? +(1 - Math.min(wasted, total) / total).toFixed(2) : 1;
  const overBudget = typeof maxSteps === 'number' ? total > maxSteps : false;
  const score = +Math.max(0, efficiency - (overBudget ? 0.2 : 0)).toFixed(2);
  return { steps: total, errors, outOfScope, wasted, efficiency, overBudget, score };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const clean = { steps: [{ tool: 'Read', ok: true, inScope: true }, { tool: 'Edit', ok: true, inScope: true }] };
  const errs = { steps: [{ tool: 'Bash', ok: false, inScope: true }, { tool: 'Edit', ok: true, inScope: true }] };
  const oos = { steps: [{ tool: 'Edit', ok: true, inScope: false }, { tool: 'Edit', ok: true, inScope: true }] };

  ok('clean trajectory → efficiency 1, score 1', (() => { const r = scoreTrajectory(clean); return r.efficiency === 1 && r.score === 1; })());
  ok('an error step lowers efficiency', scoreTrajectory(errs).efficiency === 0.5 && scoreTrajectory(errs).errors === 1);
  ok('an out-of-scope step lowers efficiency', scoreTrajectory(oos).efficiency === 0.5 && scoreTrajectory(oos).outOfScope === 1);
  ok('over-budget applies a penalty', scoreTrajectory(clean, { maxSteps: 1 }).overBudget === true && scoreTrajectory(clean, { maxSteps: 1 }).score < scoreTrajectory(clean).score);
  ok('within budget → no penalty', scoreTrajectory(clean, { maxSteps: 5 }).overBudget === false);
  ok('empty trajectory → score 1 (vacuous, no false penalty)', scoreTrajectory({}).score === 1 && scoreTrajectory({ steps: [] }).steps === 0);
  ok('score never negative', scoreTrajectory({ steps: [{ ok: false, inScope: false }] }, { maxSteps: 0 }).score >= 0);
  ok('clean beats messy (discriminates)', scoreTrajectory(clean).score > scoreTrajectory(errs).score);

  if (fails.length) { console.log(`\n\x1b[31mtrajectory-score self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ trajectory-score: path scoring correct\x1b[0m');
  process.exit(0);
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : d; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const tp = arg('--trace');
  if (!tp || !existsSync(tp)) { console.error('usage: --trace <trace.json> [--max-steps N]  (or --self-test)'); process.exit(2); }
  const maxSteps = arg('--max-steps') ? parseInt(arg('--max-steps'), 10) : undefined;
  const r = scoreTrajectory(JSON.parse(readFileSync(tp, 'utf8')), { maxSteps });
  console.log(`trajectory-score: ${r.steps} steps · ${r.errors} errors · ${r.outOfScope} out-of-scope · efficiency ${r.efficiency} · score ${r.score}${r.overBudget ? ' (OVER BUDGET)' : ''}`);
  process.exit(0);
}
