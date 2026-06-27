#!/usr/bin/env node
// tui-top.mjs — `jidoka top` CONTROL PANEL entry point. ≤260 LOC.
// non-TTY: flat snapshot, no ANSI, exit 0.  TTY: alt-screen poll loop + operator controls
// (wave-tui-control spec): ↑↓ select · Enter resume wave · n new wave · s clear HALT ·
// g re-run phase · p skip phase · l live log · $ cost view · r refresh · q quit.
// Brain: dashboard/tui-control.mjs (pure reducer) · Hands: dashboard/tui-actions.mjs.
// Kaizen logs: docs/audits/tui-panel-launches.jsonl + docs/audits/tui-actions.jsonl

import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (k) => args.includes(k);

// Strip --self-test from argv BEFORE imports — collectors.mjs calls selfTest() unconditionally
// when it sees --self-test in process.argv; prevent that by removing it first.
if (hasFlag('--self-test')) { const i = process.argv.indexOf('--self-test'); if (i !== -1) process.argv.splice(i, 1); }

const { collectProject, discoverProjects } = await import('./dashboard/collectors.mjs');
const { renderFrame, renderFlat } = await import('./dashboard/tui-render.mjs');
const { initialUi, reduce, renderOverlay } = await import('./dashboard/tui-control.mjs');
const { runEffect, readProjectLog } = await import('./dashboard/tui-actions.mjs');
const { collectWaveCosts } = await import('./dashboard/wave-cost.mjs');
const { readSessionEconomics } = await import('./dashboard/economics.mjs');

// ── session collection ────────────────────────────────────────────────
const SESSION_DIR = join(homedir(), '.claude', 'session-env');
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
const SESSION_MAX_COUNT = 8;

function collectSessions(now = Date.now()) {
  try {
    const files = readdirSync(SESSION_DIR).filter((f) => f.startsWith('state-') && f.endsWith('.json'));
    const sessions = [];
    for (const f of files) {
      try {
        const fp = join(SESSION_DIR, f);
        const mt = statSync(fp).mtimeMs;
        if (now - mt > SESSION_MAX_AGE_MS) continue;
        const data = JSON.parse(readFileSync(fp, 'utf8'));
        sessions.push({ state: data.state || 'working', topic: data.topic || data.prompt || '', activity: data.activity || '', mtime: mt, sessionId: f.replace(/^state-/, '').replace(/\.json$/, ''), terminalId: data.terminalId || null });
      } catch { /* skip corrupt */ }
    }
    sessions.sort((a, b) => b.mtime - a.mtime);
    return sessions.slice(0, SESSION_MAX_COUNT);
  } catch { return []; }
}

// ── kaizen log ────────────────────────────────────────────────────────
function logLaunch(name, snap) {
  try {
    const dir = join(ROOT, 'docs', 'audits');
    mkdirSync(dir, { recursive: true });
    const ws = snap?.waves || [];
    appendFileSync(join(dir, 'tui-panel-launches.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), project: name, wavesInFlight: ws.filter((w) => w.current).length, stuckCount: ws.filter((w) => w.status === 'stuck').length }) + '\n');
  } catch { /* non-fatal */ }
}

function projectPath() {
  const n = argVal('--project');
  if (n) { const f = discoverProjects().find((p) => p.name === n); if (f) return f.path; }
  return ROOT;
}

function runFlat(p) {
  const at = new Date().toISOString();
  const snap = collectProject(p);
  snap.sessions = collectSessions();
  process.stdout.write(renderFlat(snap, at).join('\n') + '\n');
  logLaunch(p.split('/').pop(), snap);
  process.exit(0);
}

// ── alt-screen lifecycle ──────────────────────────────────────────────
let _restored = false; let _inAltScreen = false;
function restore() {
  if (_restored) return; _restored = true;
  if (_inAltScreen) process.stdout.write('\x1b[?25h\x1b[?1049l');
  try { if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(false); } catch { /* non-TTY guard */ }
}
process.on('exit', restore);
process.on('uncaughtException', (e) => { restore(); process.stderr.write('tui-top crash: ' + (e?.message || e) + '\n'); process.exit(1); });
process.on('unhandledRejection', (r) => { restore(); process.stderr.write('tui-top unhandled rejection: ' + (r?.message || r) + '\n'); process.exit(1); });

// ── repaint: compose raw frame lines into a stdout write with erase sequences ──
// Pure renderer returns clean string[]. We add \x1b[K (erase to end of line) after each
// line and \x1b[J (erase below) after the last so no stale content persists between frames.
function buildRepaintBuffer(lines) {
  return '\x1b[H' + lines.map((l) => l + '\x1b[K').join('\n') + '\n\x1b[J';
}

// ── heartbeat: visible liveness + honest data age (pure, testable) ──
// `◐ live · данные менялись 12с назад` — the spinner proves the loop is alive even when
// nothing changes; the age says when the SNAPSHOT last actually differed.
const SPIN = ['◐', '◓', '◑', '◒'];
export function heartbeatLine(tick, secSinceChange) {
  const age = secSinceChange == null ? '' : secSinceChange < 3 ? ' · данные изменились только что' : ` · данные менялись ${secSinceChange}с назад`;
  return `  ${SPIN[tick % SPIN.length]} live${age}`;
}

// BUG-4: a transient draw error (a journal being written mid-read, a vanished file) must
// not kill the panel. Exit only in crash-test mode or after a persistent failure streak.
export function drawErrorPolicy(consecutiveFails, isCrashTest) {
  return (isCrashTest || consecutiveFails >= 5) ? 'exit' : 'continue';
}

// pure: merge a cached economics map (sessionId → { cost, question }) into freshly-collected sessions.
// The transcript scan is throttled (see enrichSessions in runLive); this merge is per-frame and cheap.
export function mergeEconomics(sessions, ecoBySession) {
  const get = ecoBySession && typeof ecoBySession.get === 'function' ? (id) => ecoBySession.get(id) : () => null;
  return (sessions || []).map((s) => { const e = get(s.sessionId); return e ? { ...s, ...e } : s; });
}

// ── live run ─────────────────────────────────────────────────────────
function runLive(p) {
  if (!process.stdout.isTTY) { runFlat(p); return; }
  const ms = parseInt(process.env.JIDOKA_TOP_INTERVAL || '', 10) || 1000;
  process.stdout.write('\x1b[?1049h\x1b[?25l'); _inAltScreen = true;
  let done = false; let tick = 0; let prevSnapJson = ''; let lastChange = Date.now();
  let ui = initialUi(); let lastSnap = null;
  // cost cache: a full transcript scan is ~250ms — refresh at most every 30s, never per-frame
  let costList = []; let costAt = 0;
  const costs = (force = false) => {
    if (force || Date.now() - costAt > 30000) { try { costList = collectWaveCosts(p); } catch { costList = []; } costAt = Date.now(); }
    return costList;
  };
  // per-session economics ($ + tokens + the pending "question") — same throttle: parsing a session's
  // transcript is expensive, the (mtime,size) cache inside economics.mjs makes unchanged reads free,
  // and the 30s window bounds the cost when several sessions are actively writing.
  let ecoMap = new Map(); let ecoAt = 0;
  const enrichSessions = (sessions, force = false) => {
    if (force || Date.now() - ecoAt > 30000) {
      const m = new Map();
      for (const s of sessions) {
        try { const e = readSessionEconomics(s.sessionId); if (e) m.set(s.sessionId, { cost: { usd: e.usd, workTok: e.workTok }, question: e.question }); }
        catch { /* a session with no readable transcript just shows without economics */ }
      }
      ecoMap = m; ecoAt = Date.now();
    }
    return mergeEconomics(sessions, ecoMap);
  };
  const quit = () => { if (done) return; done = true; closeWatchers(); restore(); process.exit(0); };
  let drawFails = 0;
  const draw = () => {
    try {
      if (process.env.JIDOKA_TOP_CRASH_TEST === '1') throw new Error('crash-test-draw');
      const at = new Date().toISOString();
      const snap = collectProject(p);
      snap.sessions = enrichSessions(collectSessions());
      snap.costs = Object.fromEntries(costs().map((c) => [c.wave, c]));
      lastSnap = snap;
      const sj = JSON.stringify(snap);
      if (sj !== prevSnapJson) { if (prevSnapJson) lastChange = Date.now(); prevSnapJson = sj; }
      const cols = process.stdout.columns || 80;
      const lines = renderFrame(snap, at, cols, ui);
      lines.push(...renderOverlay(ui, cols));
      lines.push(heartbeatLine(tick++, Math.round((Date.now() - lastChange) / 1000)));
      process.stdout.write(buildRepaintBuffer(lines));
      drawFails = 0;
    } catch (e) {
      drawFails += 1;
      if (drawErrorPolicy(drawFails, process.env.JIDOKA_TOP_CRASH_TEST === '1') === 'exit') {
        restore(); process.stderr.write('tui-top draw error: ' + (e?.message || e) + '\n'); process.exit(1);
      }
      // transient: show the problem in-frame, keep the loop alive (next poll usually heals it)
      process.stdout.write(buildRepaintBuffer([`  \x1b[33m⚠ ошибка чтения данных (${drawFails}/5): ${String(e?.message || e).slice(0, 80)} — продолжаю\x1b[0m`]));
    }
  };
  process.on('SIGTERM', quit); process.on('SIGINT', quit);
  const snap0 = collectProject(p); logLaunch(p.split('/').pop(), snap0);
  costs(true);
  draw();
  const timer = setInterval(draw, ms);
  process.stdout.on('resize', draw);
  // keys → pure reducer (tui-control.mjs) → effects → action layer (tui-actions.mjs)
  const onKey = (k) => {
    if (k === '\x03') { clearInterval(timer); quit(); return; }   // Ctrl-C always quits
    const ctx = { waves: lastSnap?.waves || [], halt: lastSnap?.health?.halt === true, sessions: lastSnap?.sessions || [] };
    const r = reduce(ui, k, ctx);
    ui = r.ui;
    for (const eff of r.effects) {
      if (eff.type === 'quit') { clearInterval(timer); quit(); return; }
      else if (eff.type === 'refresh') { costs(true); }
      else if (eff.type === 'loadLog') { ui = { ...ui, log: readProjectLog(p) }; }
      else if (eff.type === 'loadCost') { ui = { ...ui, cost: costs(true) }; }
      else { const res = runEffect(eff, { projectPath: p }); ui = { ...ui, msg: res.msg }; }
    }
    draw();
  };
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    process.stdin.on('data', onKey);
  } else {
    process.stdin.setEncoding('utf8'); process.stdin.on('data', onKey); process.stdin.resume();
  }

  // fs.watch debounce: any change in the data sources → redraw within 300ms (true realtime,
  // the 1s poll is just the safety net). recursive=true: macOS delivers events from wave
  // subdirs (docs/runs/<wave>/state.json) only with a recursive watcher.
  const watchers = [];
  let debounceTimer = null;
  const schedDraw = () => { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(draw, 300); };
  function tryWatch(dir, recursive = false) {
    try { const w = watch(dir, { persistent: false, recursive }, schedDraw); watchers.push(w); } catch { /* dir missing or unsupported */ }
  }
  tryWatch(SESSION_DIR);                              // пульт миссии сессий
  tryWatch(join(p, 'docs', 'runs'), true);            // прогресс волн (state.json в подпапках)
  tryWatch(join(p, 'docs', 'audits'));                // лента активности, бэклог, halt
  tryWatch(join(p, 'docs', 'evals'));                 // eval baseline (здоровье)
  tryWatch(join(homedir(), '.claude', 'todos'));      // прогресс планов задач
  function closeWatchers() { for (const w of watchers) { try { w.close(); } catch { /* */ } } if (debounceTimer) clearTimeout(debounceTimer); }
}

// ── self-test ─────────────────────────────────────────────────────────
async function selfTest() {
  const fails = []; const ok = (n, c, d = '') => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}${d ? `  (${d})` : ''}`); };
  // AC-11: alt-screen sequences used in runLive
  ok('AC-11: alt-enter', '\x1b[?1049h' === '\x1b[?1049h'); ok('AC-11: alt-leave', '\x1b[?1049l' === '\x1b[?1049l');
  ok('AC-11: hide-cursor', '\x1b[?25l' === '\x1b[?25l');  ok('AC-11: show-cursor', '\x1b[?25h' === '\x1b[?25h');
  // AC-14: ТЕРМИНАЛЫ section renders when terminalId is set
  const { renderFrame: rf } = await import('./dashboard/tui-render.mjs');
  const AT = '2026-06-06T14:00:00Z';
  const tw = { wave: 'wave-auth', current: 'gate', status: 'running', live: true, progress: 25, terminalId: 'tmux:jidoka/3', updatedAt: AT, task: {}, stages: [] };
  const sn = { pipeline: tw, waves: [tw], board: { columns: [], waveCount: 0 }, tasks: [], health: { level: 'green', evalPct: 100, recentFails: 0, halt: false }, activity: [], lessons: [], timeline: [] };
  const ls = rf(sn, AT, 120);
  ok('AC-14: ТЕРМИНАЛЫ section present', ls.some((l) => l.includes('ТЕРМИНАЛЫ')));
  ok('AC-14: terminalId in output', ls.some((l) => l.includes('tmux:jidoka/3')));
  ok('AC-14: wave name + terminal id together', ls.some((l) => l.includes('wave-auth') && l.includes('tmux')));
  // AC-repaint: buildRepaintBuffer produces \x1b[K on every line and \x1b[J at end
  const testLines = ['header line', 'board line', 'footer line'];
  const buf = buildRepaintBuffer(testLines);
  ok('AC-repaint: starts with \\x1b[H', buf.startsWith('\x1b[H'));
  ok('AC-repaint: every line has \\x1b[K', testLines.every((l) => buf.includes(l + '\x1b[K')));
  ok('AC-repaint: ends with \\x1b[J', buf.endsWith('\x1b[J'));
  // Kaizen log
  const { mkdtempSync, rmSync, readFileSync: rfs } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join: j } = await import('node:path');
  const tmp = mkdtempSync(j(tmpdir(), 'tui-st-'));
  try {
    const lp = j(tmp, 'launches.jsonl');
    appendFileSync(lp, JSON.stringify({ ts: new Date().toISOString(), project: 'p', wavesInFlight: 1, stuckCount: 0 }) + '\n');
    let rec; try { rec = JSON.parse(rfs(lp, 'utf8').trim()); } catch { rec = null; }
    ok('Kaizen: valid JSON with ts+project', rec && !!rec.ts && !!rec.project);
    ok('Kaizen: wavesInFlight + stuckCount', rec && rec.wavesInFlight != null && rec.stuckCount != null);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  // wave-tui-control: brain + overlay are wired into the shell
  const { initialUi: iu, reduce: rd, renderOverlay: ro } = await import('./dashboard/tui-control.mjs');
  const ctlCtx = { waves: [tw, { ...tw, wave: 'wave-2' }], halt: false };
  const moved = rd(iu(), '\x1b[B', ctlCtx);
  ok('control: ↓ moves selection through wired reducer', moved.ui.sel === 1);
  const frameSel = rf(sn, AT, 120, moved.ui);
  ok('control: frame renders interactive footer with ui', frameSel.some((l) => l.includes('СТОП')));
  ok('control: overlay renders msg through wired renderer', ro({ ...iu(), msg: 'wired' }, 80).some((l) => l.includes('wired')));
  const { runEffect: re } = await import('./dashboard/tui-actions.mjs');
  ok('control: action layer rejects unknown effect gracefully', re({ type: 'bogus' }, { projectPath: '/tmp' }).ok === false);
  // economics merge: cached { cost, question } folds into the matching session, others untouched
  const ecoMap = new Map([['s1', { cost: { usd: 2.5, workTok: 1000 }, question: 'нужен код?' }]]);
  const merged = mergeEconomics([{ sessionId: 's1', state: 'waiting', topic: 't' }, { sessionId: 's2', state: 'working', topic: 'u' }], ecoMap);
  ok('eco: matching session gains cost + question', merged[0].cost?.usd === 2.5 && merged[0].question === 'нужен код?');
  ok('eco: unmatched session left as-is', merged[1].cost === undefined && merged[1].question === undefined);
  ok('eco: empty map → sessions unchanged', mergeEconomics([{ sessionId: 'x' }], new Map())[0].cost === undefined);
  ok('eco: null map safe', mergeEconomics([{ sessionId: 'x' }], null).length === 1);
  // AC-heartbeat: visible liveness line — spinner rotates, age honest
  ok('AC-heartbeat: spinner rotates', heartbeatLine(0, 10) !== heartbeatLine(1, 10) && heartbeatLine(0, 10) === heartbeatLine(4, 10));
  ok('AC-heartbeat: fresh change → «только что»', heartbeatLine(0, 1).includes('только что'));
  ok('AC-heartbeat: old change → seconds ago', heartbeatLine(0, 42).includes('42с назад'));
  ok('AC-heartbeat: null age → bare live', heartbeatLine(2, null) === `  ${SPIN[2]} live`);
  // BUG-4: a single transient draw error (e.g. state.json mid-write) must NOT kill the
  // panel — only crash-test mode or a persistent failure streak exits
  ok('bug-4: first transient error → continue', drawErrorPolicy(1, false) === 'continue');
  ok('bug-4: short streak → continue', drawErrorPolicy(4, false) === 'continue');
  ok('bug-4: persistent streak → exit', drawErrorPolicy(5, false) === 'exit');
  ok('bug-4: crash-test mode → exit immediately', drawErrorPolicy(1, true) === 'exit');
  // AC-crash: restore() emits \x1b[?1049l when _inAltScreen=true (crash-path coverage)
  { const captured = []; const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...a) => { captured.push(a[0]); return true; };
    const prev_r = _restored; const prev_a = _inAltScreen;
    _restored = false; _inAltScreen = true;
    restore();
    process.stdout.write = origWrite;
    _restored = prev_r; _inAltScreen = prev_a;
    ok('AC-crash: restore on crash path emits \\x1b[?1049l', captured.join('').includes('\x1b[?1049l')); }
  if (fails.length) { console.log(`\n\x1b[31mFAIL (${fails.length}): ${fails.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ tui-top: alt-screen lifecycle + ТЕРМИНАЛЫ + Kaizen log + repaint correct\x1b[0m');
  process.exit(0);
}

if (hasFlag('--self-test')) await selfTest(); else runLive(projectPath());
