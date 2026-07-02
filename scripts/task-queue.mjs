#!/usr/bin/env node
// task-queue — a strictly SERIAL work queue. When Claude works autonomously it pulls ONE
// task, drives it to done (build → verify → safe-commit), then pulls the next. Never all at
// once — one in flight at a time, however many are queued (30, 40, 50).
//
// THE ONE INVARIANT (mechanical, self-tested): at most ONE task is `in_progress` at any
// moment. `next` refuses to start a new task while one is still open — it hands back the
// active one instead. That is what makes the queue serial rather than a fan-out.
//
// This is the queue the app's "Suggested task" cards can be routed into (by the user or by
// Claude via `add`). Each task carries an optional prompt + repo so a worker session knows
// exactly what to do and where. Commits from a worked task go through safe-commit.mjs, so
// the queue inherits the parallel-safe commit guarantees for free.
//
// HONEST SPLIT: the queue store + serial invariant + state transitions = FULL (self-tested).
// Actually DOING a task (writing code, running gates) is the worker session's job; this
// script only says which task is next and records its lifecycle.
//
// FULL & self-tested. Usage:
//   node scripts/task-queue.mjs --self-test
//   node scripts/task-queue.mjs add "title" [--prompt "..."] [--repo <path>]
//   node scripts/task-queue.mjs list [--all]
//   node scripts/task-queue.mjs status
//   node scripts/task-queue.mjs next            # start the next task (serial gate)
//   node scripts/task-queue.mjs done <id>
//   node scripts/task-queue.mjs fail <id> "reason"
//   node scripts/task-queue.mjs reset <id>      # in_progress/failed → queued

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const STORE = process.env.TASK_QUEUE || join(process.env.HOME || '', '.jidoka', 'task-queue', 'queue.jsonl');

// ---- pure logic (self-tested) ----

// the serial gate: given all tasks, decide what `next` returns.
//   { blocked: <active task> }   — one already in_progress → do NOT start another
//   { start: <task> }            — the oldest queued task, to be marked in_progress
//   { empty: true }              — nothing queued
export function pickNext(items) {
  const active = items.find(t => t.status === 'in_progress');
  if (active) return { blocked: active };
  const queued = items.filter(t => t.status === 'queued').sort((a, b) => (a.created || 0) - (b.created || 0));
  if (!queued.length) return { empty: true };
  return { start: queued[0] };
}

export function summarize(items) {
  const s = { queued: 0, in_progress: 0, done: 0, failed: 0 };
  for (const t of items) s[t.status] = (s[t.status] || 0) + 1;
  return s;
}

export function applyStatus(items, id, status, patch = {}) {
  return items.map(t => t.id === id ? { ...t, status, ...patch } : t);
}

// pure id from title+seq (no Date.now in tests; caller passes ts)
export function makeId(title, ts) {
  return createHash('sha1').update(`${title}|${ts}`).digest('hex').slice(0, 8);
}

// ---- IO ----
const load = () => existsSync(STORE) ? readFileSync(STORE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const save = (items) => { mkdirSync(dirname(STORE), { recursive: true }); writeFileSync(STORE, items.map(i => JSON.stringify(i)).join('\n') + (items.length ? '\n' : '')); };

function cmdAdd(title, prompt, repo) {
  const items = load();
  const ts = Date.now();
  const task = { id: makeId(title + items.length, ts), title, prompt: prompt || title, repo: repo || process.cwd(), status: 'queued', created: ts };
  items.push(task); save(items);
  console.log(`+ queued ${task.id}  ${title}  (total queued: ${summarize(items).queued})`);
}

function cmdList(all) {
  const items = load().filter(t => all || t.status === 'queued' || t.status === 'in_progress');
  if (!items.length) { console.log('(queue empty)'); return; }
  for (const t of items) {
    const mark = { queued: '·', in_progress: '▶', done: '✓', failed: '✗' }[t.status] || '?';
    console.log(`${mark} ${t.id} [${t.status}] ${t.title}${t.repo ? '  @' + t.repo.split('/').pop() : ''}`);
  }
}

function cmdStatus() {
  const items = load();
  const s = summarize(items);
  const active = items.find(t => t.status === 'in_progress');
  console.log(`queue: ${s.queued} waiting · ${s.in_progress} in progress · ${s.done} done · ${s.failed} failed`);
  console.log(active ? `▶ active: ${active.id} — ${active.title}` : '▶ active: none (free to pull next)');
}

function cmdNext() {
  const items = load();
  const r = pickNext(items);
  if (r.blocked) { console.log(JSON.stringify({ blocked: true, active: r.blocked })); return; }
  if (r.empty) { console.log(JSON.stringify({ empty: true })); return; }
  const started = applyStatus(items, r.start.id, 'in_progress', { started: Date.now() });
  save(started);
  console.log(JSON.stringify({ start: { ...r.start, status: 'in_progress' } }));
}

function cmdTransition(id, status, patch) {
  const items = load();
  if (!items.some(t => t.id === id)) { console.log(`✗ no task ${id}`); process.exit(1); }
  save(applyStatus(items, id, status, patch)); console.log(`${id} → ${status}`);
}

// ---- self-test ----
function selfTest() {
  const items = [
    { id: 'a', status: 'queued', created: 1 },
    { id: 'b', status: 'queued', created: 2 },
    { id: 'c', status: 'done', created: 0 },
  ];
  const withActive = [{ id: 'x', status: 'in_progress', created: 5 }, ...items];
  const T = [
    ['pickNext returns oldest queued', pickNext(items).start.id === 'a'],
    ['pickNext blocks when one in_progress', pickNext(withActive).blocked.id === 'x'],
    ['pickNext empty when none queued', pickNext([{ id: 'z', status: 'done' }]).empty === true],
    ['applyStatus flips only the target', applyStatus(items, 'a', 'in_progress').find(t => t.id === 'a').status === 'in_progress'],
    ['applyStatus leaves others alone', applyStatus(items, 'a', 'in_progress').find(t => t.id === 'b').status === 'queued'],
    ['summarize tallies', (() => { const s = summarize(items); return s.queued === 2 && s.done === 1; })()],
    ['makeId is stable for same input', makeId('t', 100) === makeId('t', 100)],
    ['makeId differs by ts', makeId('t', 100) !== makeId('t', 200)],
    ['serial: after start, next would block', (() => { const started = applyStatus(items, 'a', 'in_progress'); return !!pickNext(started).blocked; })()],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mtask-queue self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ task-queue: serial invariant + transitions correct\x1b[0m');
  process.exit(0);
}

// ---- CLI ----
const argv = process.argv.slice(2);
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
const cmd = argv[0];

if (!isMain) { /* imported — no CLI */ }
else if (argv.includes('--self-test')) selfTest();
else if (cmd === 'add') cmdAdd(argv[1], arg('--prompt'), arg('--repo'));
else if (cmd === 'list') cmdList(argv.includes('--all'));
else if (cmd === 'status') cmdStatus();
else if (cmd === 'next') cmdNext();
else if (cmd === 'done') cmdTransition(argv[1], 'done', { finished: Date.now() });
else if (cmd === 'fail') cmdTransition(argv[1], 'failed', { finished: Date.now(), note: argv[2] || '' });
else if (cmd === 'reset') cmdTransition(argv[1], 'queued', {});
else { console.log('task-queue — usage: add|list|status|next|done <id>|fail <id> "reason"|reset <id>|--self-test'); }
