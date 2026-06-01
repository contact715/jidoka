#!/usr/bin/env node
// run-state — resumable forward run-journal for a wave (GSD STATE.md pattern, jidoka idiom).
//
// THE GAP IT CLOSES: orchestration-planner emits a plan to stdout and writes nothing to disk; a build
// interrupted between phases (e.g. spec done, gate pending) has no on-disk record of where it is, so
// it restarts from the user re-typing the request. GSD survives a context reset by reloading
// .planning/STATE.md. This is that mechanism in our idiom — verified gap, both debate sides agreed.
//
// NOT A SECOND TRUTH: phases come from plan() in orchestration-planner.mjs (the single definition of
// the agent graph). This journal only tracks POSITION over that graph. The mcp__memory knowledge
// graph stays the LEARNING store; this is the RUN-POSITION store. Different concerns, no overlap.
//
// HONEST BOUNDARY:
//  - FULL: init / advance / resume / render + deterministic self-test (temp-dir, no real run touched).
//  - The journal is exactly as accurate as the orchestrator's --advance calls (not magic). The
//    dev-pipeline skill mandates those calls.
//  - --resume reports POSITION + the next step; it does NOT auto-execute the continuation. The
//    orchestrator (a fresh Claude session / dev-pipeline) reads it and proceeds — same model as GSD's
//    STATE.md being read by the next session.
//  - Resumes to a PHASE boundary, not mid-phase (agent work inside a phase is not checkpointed).
//
// FULL & self-tested. Usage:
//   node scripts/run-state.mjs --self-test
//   node scripts/run-state.mjs --init wave-58 --task '{"risk":"normal","surfaces":["backend"]}'
//   node scripts/run-state.mjs --advance wave-58 --phase build --status done [--note "..."]
//   node scripts/run-state.mjs --resume [wave-58]

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { plan } from './orchestration-planner.mjs';

const STATUSES = ['pending', 'running', 'done', 'failed'];
const MARK = { done: '[x]', running: '[>]', failed: '[!]', pending: '[ ]' };

// ── pure core ──────────────────────────────────────────────────────
export function phasesFromPlan(task) {
  return plan(task).phases.map(p => ({ phase: p.phase, status: 'pending', agents: p.agents || [], note: '' }));
}

export function initState(wave, task, now = new Date().toISOString()) {
  const phases = phasesFromPlan(task);
  return { wave, task, phases, current: phases[0]?.phase ?? null, events: [], createdAt: now, updatedAt: now };
}

export function advanceState(state, phase, status, note = '', now = new Date().toISOString()) {
  if (!STATUSES.includes(status)) throw new Error(`invalid status: ${status} (use ${STATUSES.join('|')})`);
  if (!state.phases.some(p => p.phase === phase)) throw new Error(`unknown phase: ${phase} (have ${state.phases.map(p => p.phase).join(', ')})`);
  const phases = state.phases.map(p => p.phase === phase ? { ...p, status, note: note || p.note } : p);
  const current = phases.find(p => p.status !== 'done')?.phase ?? null;
  const events = [...state.events, { at: now, phase, status, ...(note ? { note } : {}) }];
  return { ...state, phases, current, events, updatedAt: now };
}

// first phase that is not done = where a resume picks up
export function nextStep(state) {
  const pending = state.phases.find(p => p.status !== 'done');
  if (!pending) return { done: true, phase: null, agents: [], message: `wave ${state.wave} complete — all ${state.phases.length} phases done` };
  const agents = pending.agents.join(', ') || '(no agents)';
  const verb = pending.status === 'failed'
    ? `phase "${pending.phase}" FAILED${pending.note ? ` (${pending.note})` : ''} — fix or re-run`
    : pending.status === 'running'
      ? `phase "${pending.phase}" in progress — resume by dispatching`
      : `next: dispatch phase "${pending.phase}"`;
  return { done: false, phase: pending.phase, status: pending.status, agents: pending.agents, message: `${verb}: ${agents}` };
}

export function renderStateMd(state) {
  const ns = nextStep(state);
  const lines = [
    `# Run state — ${state.wave}`, '',
    '> Forward run-journal written by `scripts/run-state.mjs` as the orchestrator advances.',
    '> Source of truth is `state.json`; this file is rendered from it. Do not edit by hand.',
    `> Updated: ${state.updatedAt}`, '',
    `Task: \`${JSON.stringify(state.task)}\``, '',
    '## Phases', '',
  ];
  for (const p of state.phases) lines.push(`- ${MARK[p.status]} ${p.phase} — ${p.status}${p.note ? ` (${p.note})` : ''}`);
  lines.push('', '## Next step', '', ns.message, '');
  if (state.events.length) {
    lines.push('## Events', '');
    for (const e of state.events) lines.push(`- ${e.at} · ${e.phase} → ${e.status}${e.note ? ` (${e.note})` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── IO ─────────────────────────────────────────────────────────────
export function runDir(root, wave) { return join(root, 'docs', 'runs', wave); }

export function saveState(root, state) {
  const dir = runDir(root, state.wave);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  writeFileSync(join(dir, 'STATE.md'), renderStateMd(state));
  return dir;
}

export function loadState(root, wave) {
  const f = join(runDir(root, wave), 'state.json');
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8'));
}

export function latestWave(root) {
  const base = join(root, 'docs', 'runs');
  if (!existsSync(base)) return null;
  const waves = readdirSync(base).filter(d => existsSync(join(base, d, 'state.json')));
  if (!waves.length) return null;
  return waves.map(w => ({ w, u: loadState(root, w).updatedAt })).sort((a, b) => (a.u < b.u ? 1 : -1))[0].w;
}

// ── self-test (deterministic, temp-dir) ────────────────────────────
function selfTest() {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const t = (n) => `2026-06-01T00:00:0${n}.000Z`;

  let s = initState('wave-test', { risk: 'normal', surfaces: ['backend'] }, t(0));
  const names = s.phases.map(p => p.phase);
  ok('init derives phases from plan() (discovery+spec+build+gate)', ['discovery', 'spec', 'build', 'gate'].every(p => names.includes(p)));
  ok('init: all phases pending', s.phases.every(p => p.status === 'pending'));
  ok('init: current = first phase', s.current === 'discovery');
  ok('init: nextStep points at discovery, not done', (() => { const n = nextStep(s); return !n.done && n.phase === 'discovery'; })());

  s = advanceState(s, 'discovery', 'done', '', t(1));
  ok('advance: discovery → done', s.phases.find(p => p.phase === 'discovery').status === 'done');
  ok('advance: event appended', s.events.length === 1 && s.events[0].phase === 'discovery');
  ok('advance: current moved off discovery', s.current === 'spec');

  s = advanceState(s, 'spec', 'done', '', t(2));
  s = advanceState(s, 'tests', 'done', '', t(3));
  s = advanceState(s, 'build', 'running', 'wiring api', t(4));
  const nb = nextStep(s);
  ok('nextStep: names running build phase + its agents', nb.phase === 'build' && /build/.test(nb.message) && nb.agents.length > 0);

  // realistic order: phases complete in sequence, so a failed phase is the earliest unfinished one
  let f = initState('wave-fail', { risk: 'trivial', surfaces: ['frontend'] }, t(0));
  f = advanceState(f, 'discovery', 'done', '', t(1));
  f = advanceState(f, 'build', 'failed', 'boom', t(2));
  ok('failed phase (earliest unfinished) surfaces in nextStep', /FAILED/.test(nextStep(f).message));
  ok('resume from earliest unfinished, not a later pending phase', nextStep(f).phase === 'build');

  let d = initState('wave-done', { risk: 'trivial', surfaces: ['frontend'] }, t(0));
  for (const p of d.phases.map(x => x.phase)) d = advanceState(d, p, 'done', '', t(1));
  ok('all done → nextStep.done = complete', nextStep(d).done === true);

  ok('invalid status throws', (() => { try { advanceState(s, 'build', 'bogus'); return false; } catch { return true; } })());
  ok('unknown phase throws', (() => { try { advanceState(s, 'nope', 'done'); return false; } catch { return true; } })());

  const md = renderStateMd(s);
  ok('render: STATE.md has wave + a done phase + Next step', md.includes('wave-test') && md.includes('discovery — done') && md.includes('## Next step'));

  const tmp = mkdtempSync(join(tmpdir(), 'jidoka-runstate-'));
  try {
    saveState(tmp, s);
    const reloaded = loadState(tmp, 'wave-test');
    ok('IO: save then load round-trips', !!reloaded && reloaded.wave === 'wave-test' && reloaded.phases.length === s.phases.length);
    ok('IO: missing wave loads as null', loadState(tmp, 'no-such') === null);
    saveState(tmp, advanceState(initState('wave-newer', { risk: 'trivial', surfaces: ['frontend'] }, t(8)), 'discovery', 'done', '', t(9)));
    ok('IO: latestWave picks most-recently-updated', latestWave(tmp) === 'wave-newer');
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  if (fails.length) { console.log(`\n\x1b[31mrun-state self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ run-state: journal init/advance/resume/render correct\x1b[0m');
  process.exit(0);
}

// ── CLI ────────────────────────────────────────────────────────────
function arg(k) { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; }

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const ROOT = process.cwd();
  const mode = process.argv[2];

  if (mode === '--init') {
    const wave = process.argv[3];
    if (!wave || wave.startsWith('--')) { console.error("usage: --init <wave> --task '<json>'"); process.exit(1); }
    const task = JSON.parse(arg('--task') || '{"risk":"normal","surfaces":["frontend"]}');
    const s = initState(wave, task);
    const dir = saveState(ROOT, s);
    console.log(`✓ init ${wave}: ${s.phases.length} phases pending → ${join(dir, 'STATE.md')}`);
    console.log('  ' + nextStep(s).message);
    process.exit(0);
  }

  if (mode === '--advance') {
    const wave = process.argv[3];
    const s = loadState(ROOT, wave);
    if (!s) { console.error(`no run found for ${wave} (run --init first)`); process.exit(1); }
    try {
      const ns = advanceState(s, arg('--phase'), arg('--status'), arg('--note') || '');
      saveState(ROOT, ns);
      console.log(`✓ ${wave}: ${arg('--phase')} → ${arg('--status')}`);
      console.log('  ' + nextStep(ns).message);
      process.exit(0);
    } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
  }

  if (mode === '--resume') {
    const wave = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : latestWave(ROOT);
    if (!wave) { console.log('no run found — nothing to resume'); process.exit(0); }
    const s = loadState(ROOT, wave);
    if (!s) { console.log(`no run found for ${wave} — nothing to resume`); process.exit(0); }
    const done = s.phases.filter(p => p.status === 'done').map(p => p.phase);
    console.log(`resume ${s.wave} — task ${JSON.stringify(s.task)}`);
    console.log(`  done: ${done.join(', ') || '(none)'}`);
    console.log(`  ${nextStep(s).message}`);
    process.exit(0);
  }

  console.error('usage: run-state.mjs --self-test | --init <wave> --task <json> | --advance <wave> --phase <p> --status <s> [--note ..] | --resume [<wave>]');
  process.exit(1);
}
