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
import { planN } from './adaptive-verify.mjs';
import { scheduleDAG } from './dag-schedule.mjs';
import { replan as replanLedger } from './replan-ledger.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));

// post-wave frontier evals the memory phase runs: outcome benchmark, trajectory score, judge calibration
const POST_WAVE_EVAL = ['agent-benchmark', 'trajectory-score', 'judge-calibration'];

// the superpowers process-skill each phase MUST load (all installed; skill-coverage keeps it honest).
// This bakes the discipline into the phase — brainstorm before discovery, find root cause before
// debug-fixes, verify before the gate calls it done.
const PHASE_SKILLS = {
  discovery: ['brainstorming'], spec: ['writing-plans'], tests: ['test-driven-development'],
  build: ['test-driven-development'], gate: ['verification-before-completion'],
  debug: ['systematic-debugging'], memory: ['finishing-a-development-branch'],
};
// the gates/checks each phase runs — the graph itself is now the per-phase coverage map, not CI/prose.
// Every gate maps to a real scripts/<name>.mjs (the self-test enforces 0 ghosts in this map).
const PHASE_GATES = {
  // 'map-ac-coverage' (rank-3 quick win): surface requirements/ACs with NO covering task/test
  // at SPEC time — before coding — reusing the existing (previously unwired, its own D6) AC
  // coverage auditor instead of a duplicate orphan-requirement checker. Informational.
  spec: ['spec-size-check', 'plan-check', 'map-ac-coverage'],
  build: ['resource-guard', 'precision-guard', 'cross-layer-dup'],
  gate: ['contract-check', 'dead-code', 'type-coverage', 'mutation-test', 'property-test', 'dependency-audit', 'coverage-gate', 'load-test-gate', 'e2e-run-gate'],
  debug: ['verify-goal-backward'],
  launch: ['canary-gate'],
  memory: ['req-trace', 'prod-harvest'],
};
// Canonical gate basenames the planner may reference — maintained INDEPENDENTLY of PHASE_GATES so a
// fat-fingered entry there (e.g. 'resource-gaurd') fails the typo check. The framework ships a real
// scripts/<name>.mjs for each; install-into's standard+full profiles copy them into a product's
// .jidoka/scripts/. A 'core' (kernel-only) install ships the planner-brain but defers this battery to
// the standard profile — so the anti-ghost self-test is profile-honest (see selfTest below): the typo
// check is hard everywhere; physical presence is hard only in the framework and informational in a
// partial install (the upgrade hint).
export const KNOWN_GATES = [
  'spec-size-check', 'plan-check', 'resource-guard', 'precision-guard', 'cross-layer-dup',
  'contract-check', 'dead-code', 'type-coverage', 'mutation-test', 'property-test',
  'dependency-audit', 'coverage-gate', 'load-test-gate', 'e2e-run-gate', 'verify-goal-backward',
  'canary-gate', 'req-trace', 'prod-harvest', 'map-ac-coverage',
];
const enrichPhases = (phases) => phases.map((p) => ({ ...p, skills: PHASE_SKILLS[p.phase] || [], gates: PHASE_GATES[p.phase] || [] }));

// buildDag — derive the build phase's sub-task DAG from the task surfaces. The edges encode
// the real ordering constraints the flat agent list hides: the DB schema precedes the API,
// the API contract precedes the UI, the data pipeline follows the schema. Independent leaves
// (e.g. UI when there is no backend) fall out as parallel. Every node.agent is one of the
// build-phase agents, so the DAG can never name an agent the phase does not dispatch.
export function buildDag(task = {}) {
  const has = (s) => (task.surfaces || []).includes(s);
  const nodes = [{ id: 'lead', agent: 'engineering-lead', dependsOn: [] }];
  if (has('data')) {
    nodes.push({ id: 'data-schema', agent: 'data-engineer', dependsOn: ['lead'] });
    nodes.push({ id: 'data-pipeline', agent: 'data-lead', dependsOn: ['data-schema'] });
  }
  if (has('backend')) {
    nodes.push({ id: 'api', agent: 'backend-agent', dependsOn: [has('data') ? 'data-schema' : 'lead'] });
  }
  if (has('frontend')) {
    nodes.push({ id: 'ui', agent: 'frontend-agent', dependsOn: [has('backend') ? 'api' : 'lead'] });
  }
  return nodes;
}

export function plan(task = {}) {
  const { risk = 'normal', surfaces = [] } = task;
  const has = (s) => surfaces.includes(s);
  const phases = [];
  phases.push({ phase: 'discovery', parallel: true, agents: ['user-researcher', 'product-strategist'] });

  if (risk === 'trivial') {
    phases.push({ phase: 'build', agents: [has('backend') ? 'backend-agent' : 'frontend-agent'] });
    phases.push({ phase: 'gate', agents: ['reflexion-critic', 'budget-gate', 'policy-sandbox'], verifyN: planN(task) });
    phases.push({ phase: 'memory', agents: ['skill-extractor'] });
    return { task, phases: enrichPhases(phases), postWaveEval: POST_WAVE_EVAL, note: 'trivial → minimal graph (architects skipped)' };
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
  // Attach the dependency-aware sub-task DAG: independent leaves parallelise, the API waits
  // for the schema, the UI for the API contract, and the longest chain is emitted first so it
  // bounds — not tails — the build's wall-clock. The flat agents[] stays for back-compat.
  const dagNodes = buildDag(task);
  phases.push({ phase: 'build', agents: build, dag: { nodes: dagNodes, schedule: scheduleDAG(dagNodes) } });

  const gates = ['reflexion-critic', 'constitutional-reviewer', 'coverage-auditor', 'budget-gate', 'policy-sandbox'];
  if (has('backend')) gates.push('security-scanner');
  if (has('frontend')) gates.push('a11y-auditor', 'perf-profiler', 'visual-qa');
  // adversarial debate fires whenever the task warrants it (critical risk OR an analytical/comparison/
  // decision task), not only on critical code — debate-trigger is the single router.
  const dbt = shouldDebate(task);
  if (dbt.debate && dbt.mode === 'full') gates.push('debate-prosecutor', 'debate-defender', 'debate-judge');
  if (risk === 'critical') gates.push('judge-panel', 'best-of-N-judge');
  phases.push({ phase: 'gate', parallel: true, agents: gates, verifyN: planN(task) });
  phases.push({ phase: 'debug', agents: ['debug-agent'] });

  if (has('deploy') || task.deploy) phases.push({ phase: 'launch', agents: ['devops-lead', 'release-engineer'] });
  phases.push({ phase: 'memory', agents: ['skill-extractor', 'data-analyst', 'kaizen-officer'] });
  return { task, phases: enrichPhases(phases), postWaveEval: POST_WAVE_EVAL };
}

// replanPhase (W29-R3) — the runtime recovery step the static plan() cannot express. When a build
// stalls (stuck-detector.detect trips) or the wave's core property shows scaffold-substitution, feed
// the wave ledger + diagnosis here: the two-registry controller (replan-ledger) decides halt vs
// re-plan, and on 'replan' the new step list is re-scheduled through the SAME scheduleDAG the static
// plan uses — so recovery inherits critical-path ordering for free. This is the live caller that
// keeps replan-ledger wired (never an orphan gate).
export function replanPhase(ledger, diagnosis = {}, evidenceText = '') {
  const decision = replanLedger(ledger, diagnosis, evidenceText);
  if (decision.action === 'replan') {
    const nodes = decision.plan.map((step, i) => ({ id: step, dependsOn: i === 0 ? [] : [decision.plan[i - 1]] }));
    return { ...decision, schedule: scheduleDAG(nodes) };
  }
  return decision;
}

const agentsIn = (g) => new Set(g.phases.flatMap(p => p.agents));

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
if (process.argv.includes('--self-test')) {
  const trivial = plan({ risk: 'trivial', surfaces: ['frontend'] });
  const critical = plan({ risk: 'critical', surfaces: ['backend', 'frontend'] });
  const ta = agentsIn(trivial), ca = agentsIn(critical);
  // framework-detector: install-into.mjs sits beside the planner ONLY in the framework repo, never in a
  // copied .jidoka/ — so physical-presence rigor stays hard at home, profile-honest in an install.
  const IS_FRAMEWORK = existsSync(join(HERE, 'install-into.mjs'));
  const missingHere = KNOWN_GATES.filter(g => !existsSync(join(HERE, `${g}.mjs`)));
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
    ['gate carries adaptive verifyN (critical ≥ 3)', (critical.phases.find(p => p.phase === 'gate')?.verifyN ?? 0) >= 3],
    ['trivial gate verifyN === 1 (no wasted verification compute)', trivial.phases.find(p => p.phase === 'gate')?.verifyN === 1],
    ['plan lists post-wave frontier evals (benchmark/trajectory/calibration)', Array.isArray(critical.postWaveEval) && critical.postWaveEval.includes('agent-benchmark')],
    ['debug phase mandates the systematic-debugging superpower', critical.phases.find(p => p.phase === 'debug')?.skills?.includes('systematic-debugging')],
    ['spec phase mandates writing-plans', critical.phases.find(p => p.phase === 'spec')?.skills?.includes('writing-plans')],
    ['gate phase mandates verification-before-completion', critical.phases.find(p => p.phase === 'gate')?.skills?.includes('verification-before-completion')],
    ['build phase carries static gates (resource-guard/precision/cross-layer)', critical.phases.find(p => p.phase === 'build')?.gates?.includes('resource-guard')],
    ['gate phase carries the verification battery (load-test + e2e)', (() => { const g = critical.phases.find(p => p.phase === 'gate')?.gates || []; return g.includes('load-test-gate') && g.includes('e2e-run-gate'); })()],
    ['launch phase carries canary-gate', plan({ risk: 'critical', surfaces: ['backend'], deploy: true }).phases.find(p => p.phase === 'launch')?.gates?.includes('canary-gate')],
    ['memory phase carries req-trace + prod-harvest', (() => { const g = critical.phases.find(p => p.phase === 'memory')?.gates || []; return g.includes('req-trace') && g.includes('prod-harvest'); })()],
    ['ANTI-GHOST (typo): every phase-gate is a canonical KNOWN_GATES name', Object.values(PHASE_GATES).flat().every(g => KNOWN_GATES.includes(g))],
    ['ANTI-GHOST (framework): every known gate has a real script here', !IS_FRAMEWORK || missingHere.length === 0],
    // ── DAG task-scheduler (rank 5) ──
    ['build phase carries a dependency DAG', (() => { const b = critical.phases.find(p => p.phase === 'build'); return !!b?.dag?.schedule?.ok; })()],
    ['DAG ANTI-GHOST: every dag node resolves to a real build-phase agent', (() => { const b = critical.phases.find(p => p.phase === 'build'); const agents = new Set(b.agents); return b.dag.nodes.every(n => agents.has(n.agent)); })()],
    ['DAG orders schema→api→ui by dependency (backend+frontend+data)', (() => { const dag = plan({ risk: 'critical', surfaces: ['backend', 'frontend', 'data'] }).phases.find(p => p.phase === 'build').dag; const o = dag.schedule.order; return o.indexOf('data-schema') < o.indexOf('api') && o.indexOf('api') < o.indexOf('ui'); })()],
    ['DAG critical path is the longest chain (data→schema→api→ui, len 4)', (() => { const dag = plan({ risk: 'critical', surfaces: ['backend', 'frontend', 'data'] }).phases.find(p => p.phase === 'build').dag; return dag.schedule.criticalPath.length === 4; })()],
    ['DAG: independent UI leaf (frontend-only) is not blocked by a backend it lacks', (() => { const dag = plan({ risk: 'normal', surfaces: ['frontend'] }).phases.find(p => p.phase === 'build').dag; const ui = dag.nodes.find(n => n.id === 'ui'); return ui && ui.dependsOn.includes('lead') && !ui.dependsOn.includes('api'); })()],
    // ── AC-coverage wired into the spec phase (rank-3 quick win) ──
    ['spec phase surfaces AC coverage BEFORE coding (map-ac-coverage wired, not duplicated)', critical.phases.find(p => p.phase === 'spec')?.gates?.includes('map-ac-coverage')],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  // profile-honest: in a partial (core) install some gates are deferred to the standard profile — that
  // is the upgrade hint, not a failure. In the framework missingHere is empty so this never prints.
  if (!IS_FRAMEWORK && missingHere.length) console.log(`  \x1b[33mℹ\x1b[0m ${missingHere.length} gate(s) deferred to a higher profile (install --profile=standard to add): ${missingHere.join(', ')}`);
  if (fails) { console.log('\n\x1b[31morchestration-planner self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ orchestration-planner composes correct graphs per task\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const task = JSON.parse(arg('--task') || '{"type":"feature","risk":"normal","surfaces":["frontend"]}');
const g = plan(task);
if (process.argv.includes('--json')) { console.log(JSON.stringify(g)); process.exit(0); }
console.log(`orchestration plan for ${JSON.stringify(task)}:`);
g.phases.forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.phase}${p.parallel ? ' (parallel)' : ''}${p.verifyN ? ` [verifyN=${p.verifyN}]` : ''}: ${p.agents.join(', ')}${p.skills?.length ? `  ·  skill: ${p.skills.join(', ')}` : ''}`);
  if (p.gates?.length) console.log(`       gates: ${p.gates.join(', ')}`);
});
if (g.postWaveEval) console.log(`  post-wave eval: ${g.postWaveEval.join(', ')}`);
if (g.note) console.log(`  note: ${g.note}`);
console.log(`  total: ${g.phases.length} phases, ${agentsIn(g).size} distinct agents`);
process.exit(0);
}
