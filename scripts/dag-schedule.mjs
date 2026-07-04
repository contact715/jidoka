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

/**
 * Schedule a task DAG.
 * @param {Array<{id:string, agent:string, dependsOn?:string[]}>} nodes
 * @returns {{ok:boolean, order:string[], levels:string[][], criticalPath:string[], cpw:Object, error?:string, cycle?:string[]}}
 * @throws {Error} if a dependency names an unknown node or the graph has a cycle.
 */
export function scheduleDAG(nodes = []) {
  if (!Array.isArray(nodes)) throw new Error('scheduleDAG: nodes must be an array');
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

  if (fails) { console.log('\n\x1b[31mdag-schedule self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ dag-schedule schedules DAGs by dependency + critical path\x1b[0m');
  process.exit(0);
}
