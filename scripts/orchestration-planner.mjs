#!/usr/bin/env node
// Dynamic orchestration planner — the TASK composes the agent graph, not a fixed pipeline.
//
// The frontier gap: a static dev-pipeline runs the same flow every time; a trivial fix pays for
// architects, a critical backend change might under-run gates. This planner reads a task
// descriptor (type / risk / surfaces) and emits the ORDERED agent graph to dispatch — which
// teams, which gates, parallel vs serial.
//
// HONEST PROXY (AC-5.4): this composes from a FIXED agent set by declarative rules. It does NOT
// generate novel agents at runtime — that is Anthropic Dynamic Workflows (Claude writes the
// orchestration script live). This is the rules-driven step toward it, with a fitness path:
// the eval suite tells us which phases earn their cost so the rules improve over time.
//
// FULL & self-tested. Usage:
//   node scripts/orchestration-planner.mjs --self-test
//   node scripts/orchestration-planner.mjs --task '{"type":"feature","risk":"critical","surfaces":["backend","frontend"]}'

import { shouldDebate } from './debate-trigger.mjs';

export function plan(task = {}) {
  const { risk = 'normal', surfaces = [] } = task;
  const has = (s) => surfaces.includes(s);
  const phases = [];
  phases.push({ phase: 'discovery', parallel: true, agents: ['user-researcher', 'product-strategist'] });

  if (risk === 'trivial') {
    phases.push({ phase: 'build', agents: [has('backend') ? 'backend-agent' : 'frontend-agent'] });
    phases.push({ phase: 'gate', agents: ['reflexion-critic', 'budget-gate', 'policy-sandbox'] });
    phases.push({ phase: 'memory', agents: ['skill-extractor'] });
    return { task, phases, note: 'trivial → minimal graph (architects skipped)' };
  }

  const spec = ['chief-architect', 'micro-architect', 'macro-architect', 'surface-cartographer',
    'chief-product-officer', 'business-process-architect', 'kaizen-officer'];
  if (has('frontend')) spec.push('design-system-architect', 'ux-designer', 'ux-writer');
  phases.push({ phase: 'spec', parallel: true, agents: spec });
  phases.push({ phase: 'tests', agents: ['test-engineer'] });

  const build = ['engineering-lead'];
  if (has('backend')) build.push('backend-agent');
  if (has('frontend')) build.push('frontend-agent');
  if (has('data')) build.push('data-engineer', 'data-lead');
  phases.push({ phase: 'build', agents: build });

  const gates = ['reflexion-critic', 'constitutional-reviewer', 'coverage-auditor', 'budget-gate', 'policy-sandbox'];
  if (has('backend')) gates.push('security-scanner');
  if (has('frontend')) gates.push('a11y-auditor', 'perf-profiler', 'visual-qa');
  // adversarial debate fires whenever the task warrants it (critical risk OR an analytical/comparison/
  // decision task), not only on critical code — debate-trigger is the single router.
  const dbt = shouldDebate(task);
  if (dbt.debate && dbt.mode === 'full') gates.push('debate-prosecutor', 'debate-defender', 'debate-judge');
  if (risk === 'critical') gates.push('judge-panel', 'best-of-N-judge');
  phases.push({ phase: 'gate', parallel: true, agents: gates });
  phases.push({ phase: 'debug', agents: ['debug-agent'] });

  if (has('deploy') || task.deploy) phases.push({ phase: 'launch', agents: ['devops-lead', 'release-engineer'] });
  phases.push({ phase: 'memory', agents: ['skill-extractor', 'data-analyst', 'kaizen-officer'] });
  return { task, phases };
}

const agentsIn = (g) => new Set(g.phases.flatMap(p => p.agents));

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
if (process.argv.includes('--self-test')) {
  const trivial = plan({ risk: 'trivial', surfaces: ['frontend'] });
  const critical = plan({ risk: 'critical', surfaces: ['backend', 'frontend'] });
  const ta = agentsIn(trivial), ca = agentsIn(critical);
  const T = [
    ['trivial skips architects', !ta.has('chief-architect')],
    ['trivial skips the spec phase', !trivial.phases.some(p => p.phase === 'spec')],
    ['critical runs full spec', ca.has('chief-architect') && ca.has('chief-product-officer')],
    ['critical backend → security-scanner', ca.has('security-scanner')],
    ['critical → debate + judge-panel', ca.has('debate-judge') && ca.has('judge-panel')],
    ['frontend → ux-designer + a11y', ca.has('ux-designer') && ca.has('a11y-auditor')],
    ['always: budget + policy gate', ca.has('budget-gate') && ca.has('policy-sandbox')],
    ['always: kaizen in memory', ca.has('kaizen-officer')],
    ['backend-only skips frontend gates', !agentsIn(plan({ risk: 'normal', surfaces: ['backend'] })).has('visual-qa')],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31morchestration-planner self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ orchestration-planner composes correct graphs per task\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const task = JSON.parse(arg('--task') || '{"type":"feature","risk":"normal","surfaces":["frontend"]}');
const g = plan(task);
if (process.argv.includes('--json')) { console.log(JSON.stringify(g)); process.exit(0); }
console.log(`orchestration plan for ${JSON.stringify(task)}:`);
g.phases.forEach((p, i) => console.log(`  ${i + 1}. ${p.phase}${p.parallel ? ' (parallel)' : ''}: ${p.agents.join(', ')}`));
if (g.note) console.log(`  note: ${g.note}`);
console.log(`  total: ${g.phases.length} phases, ${agentsIn(g).size} distinct agents`);
process.exit(0);
}
