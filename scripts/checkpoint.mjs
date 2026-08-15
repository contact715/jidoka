#!/usr/bin/env node
// @closes-class: declaration-over-implementation
// checkpoint — append-only event log per wave: the state of a run is what happened, not what
// someone reconstructed afterwards.
//
// THE GAP (2026-W29-R6 raised to keystone in W30-R1; LangGraph, OpenHands SDK and humanlayer
// factor-12 independently converged on the same primitive). A dispatch loop that dies mid-DAG
// leaves nothing behind: the retry re-dispatches nodes that already succeeded, paying for them
// twice and — worse — sometimes producing a different result the second time, so the run is not
// even idempotent. Meanwhile `dag-schedule` optimises a critical path nobody ever measured,
// because no timestamps were ever recorded.
//
// One primitive closes three standing gaps at once:
//   1. crash-resume — deterministic replay of what completed, instead of guessing from the disk
//   2. human-in-the-loop — a node parks on `status:'interrupt'` and the loop stops there
//   3. the missing timestamp stream that lead-time telemetry needs
//
// SHAPE: one JSON object per line, appended, never rewritten.
//   { wave, node, agent, status, outputHash, ts }
// State = reduce(events). Append-only is the point: a file that is only ever added to cannot lose
// history to a concurrent writer, and a half-written last line costs exactly one event.
//
// FULL & self-tested. Usage:
//   node scripts/checkpoint.mjs --self-test
//   node scripts/checkpoint.mjs record <wave> <node> <agent> <status> [outputHash]
//   node scripts/checkpoint.mjs completed <wave>

import { appendFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

export const STATUSES = ['done', 'failed', 'interrupt'];
const STORE = process.env.CHECKPOINT_LOG || join(homedir(), '.jidoka', 'checkpoints');

export const logPath = (wave, root = STORE) => join(root, `${String(wave).replace(/[^\w.-]/g, '_')}.jsonl`);

/** Hash of a node's output, so a replay can tell "same node, different result". Pure. */
export const outputHash = (text = '') => createHash('sha256').update(String(text)).digest('hex').slice(0, 12);

/**
 * Parse an append-only log. Pure.
 * A TRUNCATED LAST LINE is expected, not exceptional: a process killed mid-append leaves one. It
 * costs exactly that event and never the file — throwing here would turn a crash into data loss,
 * which is the opposite of what a checkpoint is for.
 */
export function parseLog(text = '') {
  const lines = String(text).split('\n').filter((l) => l.trim());
  const events = [];
  let truncated = 0;
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e && e.node) events.push(e);
    } catch { truncated++; }
  }
  return { events, truncated };
}

/**
 * Reduce events to run state. Pure. Later events win, so a retried node's final status is the one
 * that counts.
 * @returns {{completed:string[], failed:string[], interrupted:string[], byNode:object}}
 */
export function reduceEvents(events = []) {
  const byNode = {};
  for (const e of events) byNode[e.node] = e;
  const of = (s) => Object.values(byNode).filter((e) => e.status === s).map((e) => e.node).sort();
  return { completed: of('done'), failed: of('failed'), interrupted: of('interrupt'), byNode };
}

/**
 * May the dispatch loop proceed past this point? Pure.
 * An interrupt node PARKS the run: it is not a failure, and it must not be skipped either — the
 * whole point of human-in-the-loop is that the machine waits.
 */
export function resumePlan(nodes = [], events = []) {
  const { completed, interrupted } = reduceEvents(events);
  const done = new Set(completed);
  const parked = interrupted[0] ?? null;
  const remaining = nodes.filter((n) => !done.has(n));
  return {
    skip: nodes.filter((n) => done.has(n)),
    remaining,
    parked,
    canProceed: parked === null,
    reason: parked
      ? `остановлено на узле "${parked}": он ждёт человека, пропускать его нельзя`
      : remaining.length
        ? `возобновление: ${done.size} узл(ов) уже готовы и не будут переделаны`
        : 'все узлы готовы',
  };
}

// ── IO ──────────────────────────────────────────────────────────────────────
export function record({ wave, node, agent = '', status = 'done', output = '' }, root = STORE) {
  if (!wave || !node) throw new Error('checkpoint.record: wave and node are required');
  if (!STATUSES.includes(status)) throw new Error(`checkpoint.record: status must be one of ${STATUSES.join('|')}`);
  const file = logPath(wave, root);
  mkdirSync(dirname(file), { recursive: true });
  const event = { wave, node, agent, status, outputHash: outputHash(output), ts: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(event) + '\n');
  return event;
}

export function loadEvents(wave, root = STORE) {
  const file = logPath(wave, root);
  if (!existsSync(file)) return { events: [], truncated: 0 };
  try { return parseLog(readFileSync(file, 'utf8')); } catch { return { events: [], truncated: 0 }; }
}

function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const dir = mkdtempSync(join(tmpdir(), 'ckpt-'));

  ok('an event round-trips through the log', (() => {
    record({ wave: 'w1', node: 'a', agent: 'be', status: 'done', output: 'x' }, dir);
    return loadEvents('w1', dir).events[0].node === 'a';
  })());
  ok('append never rewrites: two events, two lines', (() => {
    record({ wave: 'w1', node: 'b', status: 'done' }, dir);
    return loadEvents('w1', dir).events.length === 2;
  })());
  ok('the later status of a node wins', (() => {
    record({ wave: 'w1', node: 'b', status: 'failed' }, dir);
    return reduceEvents(loadEvents('w1', dir).events).failed.includes('b');
  })());
  ok('an unknown status is refused at write time',
    (() => { try { record({ wave: 'w1', node: 'c', status: 'maybe' }, dir); return false; } catch { return true; } })());
  ok('a wave with no log is empty, not an error', loadEvents('never-ran', dir).events.length === 0);

  // a killed process leaves a half-written line; it must cost one event, never the file
  const trunc = parseLog('{"node":"a","status":"done"}\n{"node":"b","stat');
  ok('a truncated last line costs one event, not the log', trunc.events.length === 1 && trunc.truncated === 1);

  // ── THE PROOF THE RECOMMENDATION DEMANDED ────────────────────────────────
  // "kill mid-DAG → resume skips completed nodes; an interrupt node blocks". Without this run
  // executably, the feature would be scaffolding claiming crash-resume — the engine's own
  // core-property-substituted-by-scaffold class, committed by the very entry warning against it.
  const nodes = ['spec', 'build', 'gate', 'ship'];
  const crashed = [
    { node: 'spec', status: 'done' },
    { node: 'build', status: 'done' },
  ];
  const r = resumePlan(nodes, crashed);
  ok('CRASH-RESUME: finished nodes are skipped', r.skip.join() === 'build,spec' || r.skip.sort().join() === 'build,spec');
  ok('CRASH-RESUME: unfinished nodes remain', r.remaining.join() === 'gate,ship');
  ok('CRASH-RESUME: the run may proceed', r.canProceed === true);

  const parkedRun = resumePlan(nodes, [{ node: 'spec', status: 'done' }, { node: 'build', status: 'interrupt' }]);
  ok('HITL: an interrupt node PARKS the run', parkedRun.canProceed === false && parkedRun.parked === 'build');
  ok('HITL: the parked node is NOT skipped', !parkedRun.skip.includes('build'));
  ok('HITL: the reason names the waiting node', /build/.test(parkedRun.reason));
  ok('a run with nothing recorded resumes from the start', resumePlan(nodes, []).remaining.length === 4);
  ok('every node done → nothing remaining',
    resumePlan(['a'], [{ node: 'a', status: 'done' }]).remaining.length === 0);

  ok('the output hash distinguishes a different result for the same node',
    outputHash('one') !== outputHash('two'));

  rmSync(dir, { recursive: true, force: true });
  if (fails) { console.log(`\n\x1b[31mcheckpoint self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ checkpoint: crash-resume skips finished nodes, an interrupt parks the run\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'record') {
    const [wave, node, agent, status, output] = rest;
    console.log(JSON.stringify(record({ wave, node, agent, status: status || 'done', output: output || '' })));
    process.exit(0);
  }
  if (cmd === 'completed') {
    const { events, truncated } = loadEvents(rest[0]);
    const state = reduceEvents(events);
    if (truncated) console.error(`⚠ ${truncated} обрезанн(ая/ых) строк(а/и) — процесс убили при дозаписи; событие потеряно, журнал цел`);
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  }
  console.log('usage: checkpoint.mjs record <wave> <node> <agent> <status> [output] | completed <wave> | --self-test');
  process.exit(0);
}
