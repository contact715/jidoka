#!/usr/bin/env node
// plan-check — validate an orchestration plan BEFORE execution (GSD borrow #2: gsd-plan-checker).
//
// jidoka verifies AFTER the build (reflexion-critic = spec compliance) and checks graph STRUCTURE
// (pipeline-contract = every phase has an artifact contract). What it lacked is GSD's pre-execution
// plan check: "is this plan good enough to build, before we spend the build on it?". This runs a set
// of verification dimensions over the planner's output and blocks a plan that would under-deliver
// (no gate phase = quality skipped; a phase with no agents; critical risk with no adversarial debate;
// learning/memory dropped). Complements goal-backward (which runs AFTER) — this is the front gate.
//
// HONEST boundary: structural dimensions (phase shape, agent presence, risk-appropriate gates). It
// does not judge whether the plan's APPROACH is wise — that is the chief-architect's / spec's job.
//
// FULL & self-tested. Usage:
//   node scripts/plan-check.mjs --self-test
//   node scripts/plan-check.mjs --task '{"risk":"critical","surfaces":["backend"]}'
//   node scripts/plan-check.mjs --plan '<planner-json>' [--goal '<goal-json>']

import { plan as composePlan } from './orchestration-planner.mjs';

export function checkPlan(plan, { goal } = {}) {
  const phases = plan?.phases || [];
  const names = new Set(phases.map((p) => p.phase));
  const gate = phases.find((p) => p.phase === 'gate');
  const risk = plan?.task?.risk || 'normal';

  const D = [
    ['plan has phases', phases.length > 0],
    ['every phase has at least one agent', phases.length > 0 && phases.every((p) => Array.isArray(p.agents) && p.agents.length > 0)],
    ['build phase present', names.has('build')],
    ['gate phase present (quality not skipped)', names.has('gate')],
    ['memory/learning phase present (kaizen not dropped)', names.has('memory')],
    ['critical risk → adversarial debate in gate', risk !== 'critical' || (!!gate && gate.agents.some((a) => /debate/.test(a)))],
  ];
  if (goal && Array.isArray(goal.objectives) && goal.objectives.length) {
    D.push(['goal has objectives → plan can deliver (build) and verify (gate)', names.has('build') && names.has('gate')]);
  }
  const dimensions = D.map(([name, ok]) => ({ name, ok }));
  const fails = dimensions.filter((d) => !d.ok).map((d) => d.name);
  return { dimensions, ok: fails.length === 0, fails };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m' } ${n}`); };

  ok('a normal plan passes all dimensions', checkPlan(composePlan({ risk: 'normal', surfaces: ['backend'] })).ok === true);
  ok('a trivial plan still passes (build+gate+memory present)', checkPlan(composePlan({ risk: 'trivial', surfaces: ['frontend'] })).ok === true);
  ok('a critical plan has debate in gate (dimension holds)', checkPlan(composePlan({ risk: 'critical', surfaces: ['backend'] })).ok === true);

  const noGate = { task: { risk: 'normal' }, phases: [{ phase: 'build', agents: ['x'] }, { phase: 'memory', agents: ['y'] }] };
  ok('a plan with no gate phase FAILS', checkPlan(noGate).fails.includes('gate phase present (quality not skipped)'));

  const emptyAgents = { task: { risk: 'normal' }, phases: [{ phase: 'build', agents: [] }, { phase: 'gate', agents: ['g'] }, { phase: 'memory', agents: ['m'] }] };
  ok('a phase with no agents FAILS', emptyAgents && checkPlan(emptyAgents).fails.includes('every phase has at least one agent'));

  const criticalNoDebate = { task: { risk: 'critical' }, phases: [{ phase: 'build', agents: ['x'] }, { phase: 'gate', agents: ['reflexion-critic'] }, { phase: 'memory', agents: ['m'] }] };
  ok('critical plan WITHOUT debate in gate FAILS', checkPlan(criticalNoDebate).fails.some((f) => /debate/.test(f)));

  const empty = { task: {}, phases: [] };
  ok('an empty plan FAILS (no phases)', checkPlan(empty).fails.includes('plan has phases'));

  ok('goal dimension added when a goal is given', checkPlan(composePlan({ risk: 'normal', surfaces: ['backend'] }), { goal: { objectives: [{ id: 'A' }] } }).dimensions.some((d) => /goal has objectives/.test(d.name)));

  // mutation-hardening: the goal dimension is `build && gate` — pin it with a plan that has build but
  // NO gate, so the && cannot silently become || (which would pass a goal plan that can't be verified).
  const buildNoGate = { task: { risk: 'normal' }, phases: [{ phase: 'build', agents: ['x'] }, { phase: 'memory', agents: ['m'] }] };
  const goalDim = checkPlan(buildNoGate, { goal: { objectives: [{ id: 'A' }] } }).dimensions.find((d) => /goal has objectives/.test(d.name));
  ok('goal dimension FAILS when plan has build but no gate (&& not ||)', !!goalDim && goalDim.ok === false);

  if (fails.length) { console.log(`\n\x1b[31mplan-check self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ plan-check: pre-execution plan dimensions correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const planJson = arg('--plan');
  const taskJson = arg('--task');
  const goal = arg('--goal') ? JSON.parse(arg('--goal')) : undefined;
  if (!planJson && !taskJson) { console.error("usage: plan-check.mjs --task '<json>' | --plan '<planner-json>' [--goal '<json>']  (or --self-test)"); process.exit(2); }
  const planObj = planJson ? JSON.parse(planJson) : composePlan(JSON.parse(taskJson));
  const r = checkPlan(planObj, { goal });
  console.log(`plan-check — ${planObj.phases?.length || 0} phases, risk=${planObj.task?.risk || 'normal'}\n`);
  for (const d of r.dimensions) console.log(`  ${d.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${d.name}`);
  if (!r.ok) { console.error(`\n\x1b[31m✗ plan not ready: ${r.fails.length} dimension(s) failed — fix the plan before building.\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ plan is ready to execute (all pre-execution dimensions pass).\x1b[0m');
  process.exit(0);
}
