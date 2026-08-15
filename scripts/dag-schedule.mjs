#!/usr/bin/env node
// dag-schedule.mjs — pure dependency-aware DAG scheduler for the orchestration planner.
//
// The gap (2026-W27 rank 5): orchestration-planner emits phases as a FLAT block of agents.
// In the build phase that means "design DB schema", "write API", "scaffold UI" all start as
// one block, even though API must follow the schema and the UI must follow the API contract,
// while independent leaves could run in parallel. This module adds the one missing thing —
// dependency edges between sub-tasks — and derives, for free:
//   • levels        — independent nodes that may run in parallel (a barrier per level),
//   • critical path  — the longest dependency chain (its length bounds wall-clock lead-time),
//   • order          — ready nodes emitted longest-critical-path-first (latency-aware: the
//                      longest chain starts first so it never becomes the tail bottleneck).
//
// Pure, zero-dependency, deterministic. NOT a second orchestrator — a utility the planner
// calls, exactly like debate-trigger.mjs / adaptive-verify.mjs. The planner keeps owning the
// phase graph; this only orders the sub-tasks WITHIN a phase.
//
// Node shape: { id: string, agent: string, dependsOn?: string[] }
//
// Usage:
//   import { scheduleDAG } from './dag-schedule.mjs';
//   const s = scheduleDAG(nodes);   // → { ok, order, levels, criticalPath, cpw }
//   node scripts/dag-schedule.mjs --self-test

// ── cohesionPartition: edges from REAL imports, not from a hand-written list (2026-W28-R4) ────
// scheduleDAG below takes `dependsOn` as given. That list is a DECLARATION: somebody typed what
// they believed the dependencies were. When the belief is wrong the scheduler is confidently
// wrong too — it will happily run two tasks in parallel that import each other, and the parallel
// build corrupts itself in a way that looks like a flaky test.
//
// The import graph is EVIDENCE and it is already on disk. Files that reach each other (in either
// direction) form one cohesive unit: they must go to ONE agent, or be serialised. Files in
// different components share nothing and are genuinely safe to run at the same time.
//
// Composes with parallel-guard: this answers "may these run together at all?", parallel-guard
// answers "did the agent stay inside the boundary it was given?".
const IMPORT_RE = /(?:^|\n)\s*(?:import[^'"]*|export[^'"]*)from\s*['"](\.[^'"]+)['"]/g;

/** Relative imports of each file. Input: {path: sourceText}. Pure. */
export function importEdges(files = {}) {
  const names = new Set(Object.keys(files));
  const resolve = (from, spec) => {
    const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    const flat = (base + spec.replace(/^\.\//, '')).replace(/[^/]+\/\.\.\//g, '');
    return names.has(flat) ? flat : null;
  };
  const out = {};
  for (const [path, text] of Object.entries(files)) {
    const deps = new Set();
    for (const m of String(text ?? '').matchAll(IMPORT_RE)) {
      const target = resolve(path, m[1]);
      if (target && target !== path) deps.add(target);
    }
    out[path] = [...deps].sort();
  }
  return out;
}

/**
 * Partition files into cohesive groups from their import edges. Pure.
 * A group is a weakly-connected component: whether A imports B or B imports A, they move together.
 * `parallelSafe` is true only when there is more than one group — one component means everything
 * is entangled and running it in parallel is the lost-update this exists to prevent.
 */
export function cohesionPartition(files = {}) {
  const edges = importEdges(files);
  const nodes = Object.keys(edges).sort();
  const adj = new Map(nodes.map((n) => [n, new Set()]));
  for (const [from, deps] of Object.entries(edges)) {
    for (const to of deps) { adj.get(from)?.add(to); adj.get(to)?.add(from); } // undirected: cohesion has no direction
  }
  const seen = new Set();
  const groups = [];
  for (const n of nodes) {
    if (seen.has(n)) continue;
    const stack = [n]; const group = [];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur); group.push(cur);
      for (const nb of adj.get(cur) || []) if (!seen.has(nb)) stack.push(nb);
    }
    groups.push(group.sort());
  }
  groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  return {
    groups,
    edges,
    parallelSafe: groups.length > 1,
    reason: groups.length > 1
      ? `${groups.length} независимых групп(ы): их можно вести параллельно, внутри каждой — последовательно`
      : 'всё связано в одну группу: параллелить нечего, иначе агенты перепишут друг друга',
  };
}

/**
 * Schedule a task DAG.
 * @param {Array<{id:string, agent:string, dependsOn?:string[]}>} nodes
 * @returns {{ok:boolean, order:string[], levels:string[][], criticalPath:string[], cpw:Object, error?:string, cycle?:string[]}}
 * @throws {Error} if a dependency names an unknown node or the graph has a cycle.
 */
export function scheduleDAG(nodes = [], { completed = [] } = {}) {
  if (!Array.isArray(nodes)) throw new Error('scheduleDAG: nodes must be an array');
  // crash-resume (2026-W30-R1): nodes the checkpoint log says already finished are dropped from
  // the schedule, not re-dispatched. Their dependants keep working, because a finished dependency
  // is satisfied — dropping the EDGE too would make the rest of the graph look unreachable.
  const doneSet = new Set(completed);
  if (doneSet.size) {
    nodes = nodes
      .filter((n) => !doneSet.has(n?.id))
      .map((n) => ({ ...n, dependsOn: (n.dependsOn || []).filter((d) => !doneSet.has(d)) }));
  }
  const byId = new Map();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || !n.id) throw new Error('scheduleDAG: every node needs a string id');
    if (byId.has(n.id)) throw new Error(`scheduleDAG: duplicate node id "${n.id}"`);
    byId.set(n.id, { ...n, dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn : [] });
  }
  // Validate edges point at real nodes.
  for (const n of byId.values()) {
    for (const dep of n.dependsOn) {
      if (!byId.has(dep)) throw new Error(`scheduleDAG: node "${n.id}" depends on unknown node "${dep}"`);
    }
  }

  // Kahn topological sort — detects cycles as leftover nodes.
  const indeg = new Map([...byId.keys()].map((id) => [id, 0]));
  const children = new Map([...byId.keys()].map((id) => [id, []]));
  for (const n of byId.values()) {
    for (const dep of n.dependsOn) {
      indeg.set(n.id, indeg.get(n.id) + 1);
      children.get(dep).push(n.id);
    }
  }

  // level(node) = longest dependency depth from a root (for parallel barriers).
  const level = new Map();
  const topo = [];
  let ready = [...byId.keys()].filter((id) => indeg.get(id) === 0).sort();
  for (const id of ready) level.set(id, 0);
  const q = [...ready];
  while (q.length) {
    const id = q.shift();
    topo.push(id);
    for (const c of children.get(id)) {
      level.set(c, Math.max(level.get(c) ?? 0, (level.get(id) ?? 0) + 1));
      indeg.set(c, indeg.get(c) - 1);
      if (indeg.get(c) === 0) q.push(c);
    }
  }
  if (topo.length !== byId.size) {
    const cycle = [...byId.keys()].filter((id) => !topo.includes(id));
    throw new Error(`scheduleDAG: cycle detected among [${cycle.join(', ')}]`);
  }

  // Critical-path weight: cpw(node) = 1 + max(cpw(children)); computed in reverse topo order.
  const cpw = new Map();
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    const kids = children.get(id);
    cpw.set(id, kids.length ? 1 + Math.max(...kids.map((c) => cpw.get(c))) : 1);
  }

  // levels[]: index = dependency depth; nodes in the same level are independent → parallel.
  const maxLevel = Math.max(0, ...[...level.values()]);
  const levels = Array.from({ length: maxLevel + 1 }, () => []);
  for (const [id, lv] of level) levels[lv].push(id);
  // Within a level, emit the longest critical path first (latency-aware).
  for (const lv of levels) lv.sort((a, b) => cpw.get(b) - cpw.get(a) || a.localeCompare(b));

  // Global order: level-by-level, longest-critical-path-first inside each level.
  const order = levels.flat();

  // Trace one longest chain for reporting: start at the max-cpw root, always follow the max-cpw child.
  const roots = [...byId.keys()].filter((id) => byId.get(id).dependsOn.length === 0);
  let start = roots.sort((a, b) => cpw.get(b) - cpw.get(a) || a.localeCompare(b))[0];
  const criticalPath = [];
  let cur = start;
  while (cur != null) {
    criticalPath.push(cur);
    const kids = children.get(cur);
    if (!kids.length) break;
    cur = kids.slice().sort((a, b) => cpw.get(b) - cpw.get(a) || a.localeCompare(b))[0];
  }

  return { ok: true, order, levels, criticalPath, cpw: Object.fromEntries(cpw) };
}

// ── self-test ──────────────────────────────────────────────────────────────
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--self-test')) {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  // A linear chain: lead → schema → api → ui.
  const chain = scheduleDAG([
    { id: 'lead', agent: 'engineering-lead' },
    { id: 'schema', agent: 'data-engineer', dependsOn: ['lead'] },
    { id: 'api', agent: 'backend-agent', dependsOn: ['schema'] },
    { id: 'ui', agent: 'frontend-agent', dependsOn: ['api'] },
  ]);
  ok('linear chain toposorts in dependency order', JSON.stringify(chain.order) === JSON.stringify(['lead', 'schema', 'api', 'ui']));
  ok('linear chain critical path spans all 4', chain.criticalPath.length === 4 && chain.criticalPath[0] === 'lead');
  ok('linear chain: 4 levels (one node each)', chain.levels.length === 4 && chain.levels.every((l) => l.length === 1));

  // A fan: lead → {api, docs}; api → ui. docs is an independent leaf, ui is on the long chain.
  const fan = scheduleDAG([
    { id: 'lead', agent: 'engineering-lead' },
    { id: 'api', agent: 'backend-agent', dependsOn: ['lead'] },
    { id: 'docs', agent: 'ux-writer', dependsOn: ['lead'] },
    { id: 'ui', agent: 'frontend-agent', dependsOn: ['api'] },
  ]);
  ok('fan: api and docs share a level (parallel)', fan.levels[1].includes('api') && fan.levels[1].includes('docs'));
  ok('fan: within the level the longer chain (api) is ordered first', fan.levels[1][0] === 'api');
  ok('fan: critical path is lead→api→ui (not the docs leaf)', JSON.stringify(fan.criticalPath) === JSON.stringify(['lead', 'api', 'ui']));

  // Cycle detection.
  let threw = false;
  try { scheduleDAG([{ id: 'a', agent: 'x', dependsOn: ['b'] }, { id: 'b', agent: 'y', dependsOn: ['a'] }]); } catch { threw = true; }
  ok('cycle is rejected (not silently scheduled)', threw);

  // Unknown-dependency detection.
  let threw2 = false;
  try { scheduleDAG([{ id: 'a', agent: 'x', dependsOn: ['ghost'] }]); } catch { threw2 = true; }
  ok('dependency on an unknown node is rejected', threw2);

  // Empty is valid (no sub-tasks → empty schedule).
  const empty = scheduleDAG([]);
  ok('empty DAG is valid and empty', empty.ok && empty.order.length === 0);

  // ── crash-resume: the schedule skips what the checkpoint log finished (2026-W30-R1) ─────
  ok('a completed node is dropped from the schedule', (() => {
    const r = scheduleDAG([{ id: 'a', agent: 'x' }, { id: 'b', agent: 'y', dependsOn: ['a'] }], { completed: ['a'] });
    return r.ok && r.order.join() === 'b';
  })());
  // dropping the node without dropping the EDGE would make the rest of the graph unreachable
  ok('its dependants still run — a finished dependency is SATISFIED, not missing',
    scheduleDAG([{ id: 'a', agent: 'x' }, { id: 'b', agent: 'y', dependsOn: ['a'] }], { completed: ['a'] }).ok === true);
  ok('with nothing completed the schedule is unchanged',
    scheduleDAG([{ id: 'a', agent: 'x' }, { id: 'b', agent: 'y', dependsOn: ['a'] }], { completed: [] }).order.join() === 'a,b');
  ok('everything completed → an empty, valid schedule',
    scheduleDAG([{ id: 'a', agent: 'x' }], { completed: ['a'] }).order.length === 0);

// ── cohesionPartition: edges from real imports (2026-W28-R4) ──────────────
  const islands = { 'a.mjs': "import x from './b.mjs';", 'b.mjs': '', 'c.mjs': "import y from './d.mjs';", 'd.mjs': '' };
  const ip = cohesionPartition(islands);
  ok('two independent islands become two groups', ip.groups.length === 2);
  ok('each island keeps its own members together',
    JSON.stringify(ip.groups[0]) === JSON.stringify(['a.mjs', 'b.mjs']));
  ok('separate groups mean parallel is safe', ip.parallelSafe === true);

  const chained = { 'a.mjs': "import x from './b.mjs';", 'b.mjs': "import y from './c.mjs';", 'c.mjs': '' };
  ok('a chain collapses into ONE group', cohesionPartition(chained).groups.length === 1);
  ok('one group means parallel is NOT safe, and says why',
    cohesionPartition(chained).parallelSafe === false && /перепишут друг друга/.test(cohesionPartition(chained).reason));
  // cohesion has no direction: whether A imports B or B imports A, they move together
  ok('the edge direction does not split a pair',
    cohesionPartition({ 'a.mjs': '', 'b.mjs': "import x from './a.mjs';" }).groups.length === 1);

  ok('an import of a file OUTSIDE the set is ignored, not invented as a node',
    JSON.stringify(importEdges({ 'a.mjs': "import x from './nowhere.mjs';" })) === JSON.stringify({ 'a.mjs': [] }));
  ok('a bare package import is not a cohesion edge',
    JSON.stringify(importEdges({ 'a.mjs': "import fs from 'node:fs';" })) === JSON.stringify({ 'a.mjs': [] }));
  ok('a file importing itself is not an edge',
    JSON.stringify(importEdges({ 'a.mjs': "import x from './a.mjs';" })) === JSON.stringify({ 'a.mjs': [] }));
  ok('export-from counts as a real edge too',
    JSON.stringify(importEdges({ 'a.mjs': "export { z } from './b.mjs';", 'b.mjs': '' })['a.mjs']) === JSON.stringify(['b.mjs']));
  ok('files with no imports at all are each their own group',
    cohesionPartition({ 'a.mjs': '', 'b.mjs': '' }).groups.length === 2);
  ok('an empty file set does not crash', cohesionPartition({}).groups.length === 0);

  if (fails) { console.log('\n\x1b[31mdag-schedule self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ dag-schedule schedules DAGs by dependency + critical path\x1b[0m');
  process.exit(0);
}
