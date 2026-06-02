#!/usr/bin/env node
// agent-benchmark — outcome-based agent evaluation (the frontier SWE-bench-style practice jidoka lacked).
//
// jidoka measured MECHANISMS (self-tests) and JUDGES (golden cases). It did NOT measure the thing the
// labs measure: "can the agent RESOLVE a real task end-to-end?" — an OUTCOME, verified by a deterministic
// check after the agent's change. This is that benchmark: a held-out set of tasks, each carrying a
// verifier (not the answer), and a resolution-rate that moves wave over wave.
//
// HONEST split (FULL scoring / DORMANT agent-run): the task format, the verifier-runner, and the
// resolution-rate scoring are FULL & self-tested here. The AGENT EXECUTION (dispatch the build pipeline
// per task to PRODUCE a change) is the orchestrator's job — exactly like kaizen data is the product's job.
// The harness scores OUTCOMES in the current tree; the orchestrator produces them.
// Contamination hygiene: a task carries {prompt, verify} and NEVER the expected diff — the agent must
// not be able to read the answer from the task (the SWE-bench task-ID-leakage lesson).
//
// task:   { id, prompt, verify: { cmd, expectExit?, contains?: [], absent?: [] } }
// result: { id, verifyExit, verifyOut }   (recorded after an agent attempt)
//
// Usage:
//   node scripts/agent-benchmark.mjs --self-test
//   node scripts/agent-benchmark.mjs --verify [tasks.jsonl]     run each task's verifier in the CURRENT tree, score
//   node scripts/agent-benchmark.mjs --score <results.jsonl> --tasks <tasks.jsonl>

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DEFAULT_TASKS = 'docs/benchmarks/_tasks.jsonl';

// pure: does a recorded verify-result count as RESOLVED for its task?
export function resolved(task, result) {
  if (!result) return false;
  const v = task.verify || {};
  const wantExit = v.expectExit ?? 0;
  if (result.verifyExit !== wantExit) return false;
  const out = String(result.verifyOut || '');
  if (Array.isArray(v.contains) && !v.contains.every((s) => out.includes(s))) return false;
  if (Array.isArray(v.absent) && v.absent.some((s) => out.includes(s))) return false;
  return true;
}

// pure: resolution rate over tasks + their recorded results
export function scoreRun(tasks, results) {
  const byId = Object.fromEntries((results || []).map((r) => [r.id, r]));
  const perTask = tasks.map((t) => ({ id: t.id, resolved: resolved(t, byId[t.id]) }));
  const res = perTask.filter((p) => p.resolved).length;
  return { total: tasks.length, resolved: res, rate: tasks.length ? Math.round((100 * res) / tasks.length) : 0, perTask };
}

// run one task's verifier in the CURRENT working tree (the agent's change must already be applied)
export function runVerify(task) {
  try {
    const out = execSync(task.verify.cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    return { id: task.id, verifyExit: 0, verifyOut: out };
  } catch (e) {
    return { id: task.id, verifyExit: e.status ?? 1, verifyOut: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const t = { id: 'x', verify: { cmd: 'true', expectExit: 0, contains: ['ok'], absent: ['ERR'] } };
  ok('resolved: exit matches + contains present + absent missing → true', resolved(t, { id: 'x', verifyExit: 0, verifyOut: 'all ok here' }) === true);
  ok('resolved: wrong exit → false', resolved(t, { id: 'x', verifyExit: 1, verifyOut: 'all ok here' }) === false);
  ok('resolved: missing required substring → false', resolved(t, { id: 'x', verifyExit: 0, verifyOut: 'nothing' }) === false);
  ok('resolved: forbidden substring present → false', resolved(t, { id: 'x', verifyExit: 0, verifyOut: 'ok but ERR' }) === false);
  ok('resolved: no result recorded → false (not a free pass)', resolved(t, undefined) === false);
  ok('resolved: default expectExit is 0', resolved({ id: 'y', verify: {} }, { id: 'y', verifyExit: 0, verifyOut: '' }) === true);

  const tasks = [{ id: 'a', verify: {} }, { id: 'b', verify: {} }, { id: 'c', verify: {} }];
  const results = [{ id: 'a', verifyExit: 0 }, { id: 'b', verifyExit: 1 }];
  const s = scoreRun(tasks, results);
  ok('scoreRun: 1 of 3 resolved → rate 33', s.resolved === 1 && s.rate === 33);
  ok('scoreRun: a missing result counts as unresolved (c)', s.perTask.find((p) => p.id === 'c').resolved === false);
  ok('scoreRun: empty tasks → rate 0 (no false 100%)', scoreRun([], []).rate === 0);
  // contamination guard: a task must not carry the answer (no `diff`/`patch`/`expected` field)
  ok('contamination: seed tasks carry no expected-diff field', !existsSync(DEFAULT_TASKS) || readJsonl(DEFAULT_TASKS).every((t2) => !('diff' in t2 || 'patch' in t2 || 'expected' in t2)));
  // runVerify is real: a true/false shell command maps to exit 0/1
  ok('runVerify: a passing command → verifyExit 0', runVerify({ id: 'z', verify: { cmd: 'true' } }).verifyExit === 0);
  ok('runVerify: a failing command → verifyExit != 0', runVerify({ id: 'z', verify: { cmd: 'false' } }).verifyExit !== 0);

  if (fails.length) { console.log(`\n\x1b[31magent-benchmark self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ agent-benchmark: resolution scoring + verifier-runner correct\x1b[0m');
  process.exit(0);
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : d; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  if (process.argv.includes('--verify')) {
    const tp = arg('--verify', DEFAULT_TASKS);
    const tasksPath = existsSync(tp) ? tp : DEFAULT_TASKS;
    if (!existsSync(tasksPath)) { console.error(`no task set at ${tasksPath}`); process.exit(2); }
    const tasks = readJsonl(tasksPath);
    const results = tasks.map(runVerify);
    const s = scoreRun(tasks, results);
    console.log(`agent-benchmark — ${tasks.length} task(s), verified in the current tree\n`);
    for (const p of s.perTask) console.log(`  ${p.resolved ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${p.id}`);
    console.log(`\n  resolution rate: ${s.resolved}/${s.total} = ${s.rate}%`);
    console.log('  (HONEST: this verifies OUTCOMES in the current tree. The benchmark MOVES when the build agent attempts');
    console.log('   held-out tasks first — that dispatch is the orchestrator\'s job; this harness scores what it produced.)');
    process.exit(s.rate === 100 ? 0 : 1);
  }

  const rp = arg('--score'), tp = arg('--tasks', DEFAULT_TASKS);
  if (!rp || !existsSync(rp)) { console.error('usage: --verify [tasks.jsonl] | --score <results.jsonl> --tasks <tasks.jsonl>  (or --self-test)'); process.exit(2); }
  const s = scoreRun(readJsonl(tp), readJsonl(rp));
  console.log(`agent-benchmark: ${s.resolved}/${s.total} resolved = ${s.rate}%`);
  process.exit(0);
}
