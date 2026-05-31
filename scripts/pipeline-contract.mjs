#!/usr/bin/env node
// pipeline-contract — proves the orchestrator's graph is WELL-FORMED: every node the planner can
// emit resolves to a REAL agent (.claude/agents/*.md) or engine script (scripts/*.mjs), and every
// phase has a defined output artifact. This is instantiation-audit for the PIPELINE GRAPH — it
// closes the risk that dev-pipeline dispatches a ghost agent or runs an under-defined phase.
//
// HONEST SCOPE: this proves the pipeline is well-formed (parts are real, phases have contracts).
// It does NOT prove a live run actually produces those artifacts with a model — that is the
// LLM-eval track. Well-formed is necessary, not sufficient; labelled as such.
//
// FULL & self-tested. Usage:
//   node scripts/pipeline-contract.mjs --self-test
//   node scripts/pipeline-contract.mjs            # audit the real planner graphs

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { plan } from './orchestration-planner.mjs';

// every phase the planner emits must declare what artifact it is responsible for producing
export const PHASE_ARTIFACTS = {
  discovery: 'product/JTBD brief + North Star alignment verdict',
  spec: 'master spec the build is derived from',
  tests: 'test stubs from acceptance criteria',
  build: 'implementation code against the spec',
  gate: 'pass/fail verdict per gate',
  debug: 'auto-fix or escalation on failure',
  launch: 'release with a rollback path',
  memory: 'retro + extracted skill + consolidated digest',
};

const MATRIX = [
  { risk: 'trivial', surfaces: ['frontend'] },
  { risk: 'trivial', surfaces: ['backend'] },
  { risk: 'normal', surfaces: ['frontend'] },
  { risk: 'normal', surfaces: ['backend', 'data'] },
  { risk: 'critical', surfaces: ['backend', 'frontend', 'data', 'deploy'] },
];

// resolve a graph node to a real agent file or engine script (or null = ghost)
export function resolveNode(name, root = process.cwd()) {
  if (existsSync(join(root, '.claude', 'agents', `${name}.md`))) return 'agent';
  if (existsSync(join(root, 'scripts', `${name}.mjs`))) return 'script';
  return null;
}

// audit one graph: ghost nodes + phases missing an artifact contract
export function auditGraph(graph, root = process.cwd()) {
  const ghosts = [], phasesWithoutArtifact = [];
  for (const ph of graph.phases) {
    if (!PHASE_ARTIFACTS[ph.phase]) phasesWithoutArtifact.push(ph.phase);
    for (const a of ph.agents) if (!resolveNode(a, root)) ghosts.push(a);
  }
  return { ghosts: [...new Set(ghosts)], phasesWithoutArtifact: [...new Set(phasesWithoutArtifact)] };
}

export function auditMatrix(matrix = MATRIX, root = process.cwd()) {
  const ghosts = new Set(), missing = new Set(), nodes = new Set();
  for (const t of matrix) {
    const g = plan(t);
    const r = auditGraph(g, root);
    r.ghosts.forEach(x => ghosts.add(x));
    r.phasesWithoutArtifact.forEach(x => missing.add(x));
    for (const ph of g.phases) for (const a of ph.agents) nodes.add(a);
  }
  return { ghosts: [...ghosts], missing: [...missing], nodeCount: nodes.size };
}

function selfTest() {
  const root = process.cwd();
  const real = auditMatrix(MATRIX, root);
  const fake = auditGraph({ phases: [{ phase: 'build', agents: ['definitely-not-an-agent-xyz'] }] }, root);
  const badPhase = auditGraph({ phases: [{ phase: 'mystery-phase', agents: [] }] }, root);
  const T = [
    ['real matrix has 0 ghost nodes', real.ghosts.length === 0],
    ['real matrix has 0 phases without an artifact contract', real.missing.length === 0],
    ['matrix actually covered the graph (>20 nodes)', real.nodeCount > 20],
    ['a fake agent is caught as a ghost', fake.ghosts.includes('definitely-not-an-agent-xyz')],
    ['an undefined phase is caught', badPhase.phasesWithoutArtifact.includes('mystery-phase')],
    ['resolveNode finds an agent (.md)', resolveNode('reflexion-critic', root) === 'agent'],
    ['resolveNode finds a script (.mjs)', resolveNode('budget-gate', root) === 'script'],
    ['resolveNode returns null for nonexistent', resolveNode('nope-nope', root) === null],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mpipeline-contract self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ pipeline-contract: the orchestrator graph is well-formed\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const r = auditMatrix();
  console.log(`pipeline-contract: audited ${MATRIX.length} task graphs, ${r.nodeCount} distinct nodes`);
  if (r.ghosts.length) { console.error(`\x1b[31m✗ ghost nodes (no agent/script):\x1b[0m ${r.ghosts.join(', ')}`); process.exit(1); }
  if (r.missing.length) { console.error(`\x1b[31m✗ phases with no artifact contract:\x1b[0m ${r.missing.join(', ')}`); process.exit(1); }
  console.log('\x1b[32m✓ every node resolves to a real agent/script; every phase has an artifact contract.\x1b[0m');
  process.exit(0);
}
