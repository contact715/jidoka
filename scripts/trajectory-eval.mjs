#!/usr/bin/env node
// trajectory-eval — evaluate the PATH a wave took, not just its outcome.
//
// GitHub research adopt (langchain-ai/agentevals) — its SEMANTICS (strict / unordered / superset /
// partial trajectory match), reimplemented on our stack, not its 0.0.x package. The framework
// declared "we eval the path, not just the result" but only ever checked form + outcome; this is
// the missing trajectory check.
//
// THE KEY FIT: agentevals needs hand-authored reference traces (its main dead-weight risk). We don't:
// the EXPECTED trajectory is plan(task) from orchestration-planner — the single definition of the
// agent graph. The ACTUAL trajectory is what really ran (agent-traces.jsonl). So this catches a wave
// that SKIPPED a required agent (e.g. shipped a critical wave without security-scanner / debate),
// using data that already exists — no manual reference traces.
//
// FULL & self-tested. Usage:
//   node scripts/trajectory-eval.mjs --self-test
//   node scripts/trajectory-eval.mjs --wave <wave>            # actual=agent-traces vs expected=plan(task)
//   node scripts/trajectory-eval.mjs --task '<json>'          # expected agents for a task type

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { plan } from './orchestration-planner.mjs';

// ── pure core: the agentevals semantics ───────────────────────────
// Compare an ACTUAL step list against an EXPECTED one. Steps are plain strings (agent or tool names).
//   strict     — identical sequence (order + content)
//   unordered  — same set (order ignored)
//   superset   — expected appears as an ordered subsequence of actual (actual may add steps)
//   contains   — every expected step is present in actual (order ignored; actual may add steps)
//   partial    — overlap ratio |expected ∩ actual| / |expected|
// Returns { pass, mode, missing, extra, score }.
export function compareTrajectory(actual = [], expected = [], mode = 'contains') {
  const A = actual.map(String), E = expected.map(String);
  const setA = new Set(A), setE = new Set(E);
  const missing = [...setE].filter(x => !setA.has(x));   // required but never ran
  const extra = [...setA].filter(x => !setE.has(x));     // ran but not in the plan
  const overlap = [...setE].filter(x => setA.has(x)).length;
  const score = E.length ? Math.round((overlap / setE.size) * 100) / 100 : 1;

  let pass;
  if (mode === 'strict') pass = A.length === E.length && A.every((s, i) => s === E[i]);
  else if (mode === 'unordered') pass = setA.size === setE.size && missing.length === 0 && extra.length === 0;
  else if (mode === 'superset') pass = isOrderedSubsequence(E, A);
  else if (mode === 'partial') pass = score >= 0.5;
  else pass = missing.length === 0; // 'contains' (default): all required present
  return { pass, mode, missing, extra, score };
}

// pure: is `sub` an ordered subsequence of `seq`?
export function isOrderedSubsequence(sub, seq) {
  let i = 0;
  for (const s of seq) if (i < sub.length && s === sub[i]) i++;
  return i === sub.length;
}

// pure: the EXPECTED agent set for a task type = every agent named across plan() phases.
export function expectedAgents(task) {
  return [...new Set(plan(task).phases.flatMap(p => p.agents || []))];
}

// ── self-test (deterministic) ──────────────────────────────────────
function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('strict: identical → pass', compareTrajectory(['a', 'b'], ['a', 'b'], 'strict').pass === true);
  ok('strict: reordered → fail', compareTrajectory(['b', 'a'], ['a', 'b'], 'strict').pass === false);
  ok('unordered: same set any order → pass', compareTrajectory(['b', 'a'], ['a', 'b'], 'unordered').pass === true);
  ok('unordered: extra step → fail', compareTrajectory(['a', 'b', 'c'], ['a', 'b'], 'unordered').pass === false);
  ok('superset: expected is ordered subsequence → pass', compareTrajectory(['x', 'a', 'y', 'b'], ['a', 'b'], 'superset').pass === true);
  ok('superset: out-of-order expected → fail', compareTrajectory(['b', 'a'], ['a', 'b'], 'superset').pass === false);
  ok('contains: all required present (extra ok) → pass', compareTrajectory(['a', 'b', 'extra'], ['a', 'b'], 'contains').pass === true);
  ok('contains: a required step missing → fail + names it', (() => { const r = compareTrajectory(['a'], ['a', 'security-scanner'], 'contains'); return r.pass === false && r.missing.includes('security-scanner'); })());
  ok('partial: half overlap → score 0.5, pass at threshold', (() => { const r = compareTrajectory(['a'], ['a', 'b'], 'partial'); return r.score === 0.5 && r.pass === true; })());
  ok('reports extra steps', compareTrajectory(['a', 'rogue'], ['a'], 'contains').extra.includes('rogue'));
  ok('isOrderedSubsequence basic', isOrderedSubsequence(['a', 'b'], ['x', 'a', 'b']) === true && isOrderedSubsequence(['b', 'a'], ['a', 'b']) === false);
  // expected agents come from the real planner (not fabricated): a normal backend wave includes a build phase
  const ea = expectedAgents({ risk: 'normal', surfaces: ['backend'] });
  ok('expectedAgents: planner yields a non-empty agent set', Array.isArray(ea) && ea.length > 0);
  if (fails.length) { console.log(`\n\x1b[31mtrajectory-eval self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ trajectory-eval: path comparison (strict/unordered/superset/contains/partial) correct\x1b[0m');
  process.exit(0);
}

// ── CLI ────────────────────────────────────────────────────────────
function arg(k) { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; }

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const ROOT = process.cwd();
  const mode = arg('--mode') || 'contains';

  if (arg('--task')) {
    const task = JSON.parse(arg('--task'));
    console.log(`expected agents for ${JSON.stringify(task)}:`);
    console.log('  ' + expectedAgents(task).join(', '));
    process.exit(0);
  }

  const wave = arg('--wave');
  if (!wave) { console.error('usage: trajectory-eval.mjs --wave <wave> [--mode contains|strict|...] | --task <json> | --self-test'); process.exit(1); }

  const stateFile = join(ROOT, 'docs', 'runs', wave, 'state.json');
  if (!existsSync(stateFile)) { console.error(`no run-state journal for ${wave}`); process.exit(1); }
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const expected = expectedAgents(state.task || {});

  const tracesFile = process.env.AGENT_TRACES || join(ROOT, 'docs', 'audits', 'agent-traces.jsonl');
  const allTraces = existsSync(tracesFile) ? readFileSync(tracesFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  // prefer traces attributed to THIS wave; if none carry a wave tag, fall back to all (approximate).
  const tagged = allTraces.filter(t => t.wave === wave);
  const approximate = tagged.length === 0 && allTraces.length > 0;
  const traces = tagged.length ? tagged : allTraces;
  const actual = [...new Set(traces.map(t => t.agent).filter(Boolean))];

  const res = compareTrajectory(actual, expected, mode);
  console.log(`trajectory-eval ${wave} (mode: ${mode})`);
  console.log(`  expected agents (plan): ${expected.join(', ') || '(none)'}`);
  console.log(`  actually ran (traces):  ${actual.join(', ') || '(none traced)'}`);
  if (approximate) console.log('  ⓘ approximate: no traces carry a wave tag, comparing against ALL traced agents. For per-wave precision, agent-trace --ingest should include {"wave":"<wave>"}.');
  if (res.pass) { console.log(`\n\x1b[32m✓ every planned agent ran (coverage ${Math.round(res.score * 100)}%)\x1b[0m`); process.exit(0); }
  console.log(`\n\x1b[31m✗ planned agents that did NOT run: ${res.missing.join(', ')}\x1b[0m`);
  console.log(`  (coverage ${Math.round(res.score * 100)}% — a required agent skipped is a path gap, not just an outcome gap)`);
  if (!traces.length) console.log('  note: agent-traces.jsonl is empty — the orchestrator must --ingest dispatches for this to mean anything (honest boundary).');
  // hard-fail only on a TRUSTWORTHY (wave-tagged) comparison with real misses; approximate/empty → report, exit 0
  process.exit(!approximate && traces.length && res.missing.length ? 1 : 0);
}
