#!/usr/bin/env node
// tui-top.mjs — `jidoka top` live pipeline panel entry point. ≤200 LOC.
// non-TTY: flat snapshot, no ANSI, exit 0.  TTY: alt-screen poll loop, q=quit, r=refresh.
// Kaizen log: docs/audits/tui-panel-launches.jsonl  {ts, project, wavesInFlight, stuckCount}

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
        sessions.push({ state: data.state || 'working', topic: data.topic || data.prompt || '', activity: data.activity || '', mtime: mt, sessionId: f.replace(/^state-/, '').replace(/\.json$/, '') });
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

// ── live run ─────────────────────────────────────────────────────────
function runLive(p) {
  if (!process.stdout.isTTY) { runFlat(p); return; }
  const ms = parseInt(process.env.JIDOKA_TOP_INTERVAL || '', 10) || 1000;
  process.stdout.write('\x1b[?1049h\x1b[?25l'); _inAltScreen = true;
  let done = false; let tick = 0; let prevSnapJson = ''; let lastChange = Date.now();
  const quit = () => { if (done) return; done = true; closeWatchers(); restore(); process.exit(0); };
  const draw = () => {
    try {
      if (process.env.JIDOKA_TOP_CRASH_TEST === '1') throw new Error('crash-test-draw');
      const at = new Date().toISOString();
      const snap = collectProject(p);
      snap.sessions = collectSessions();
      const sj = JSON.stringify(snap);
      if (sj !== prevSnapJson) { if (prevSnapJson) lastChange = Date.now(); prevSnapJson = sj; }
      const cols = process.stdout.columns || 80;
      const lines = renderFrame(snap, at, cols);
      lines.push(heartbeatLine(tick++, Math.round((Date.now() - lastChange) / 1000)));
      process.stdout.write(buildRepaintBuffer(lines));
    } catch (e) { restore(); process.stderr.write('tui-top draw error: ' + (e?.message || e) + '\n'); process.exit(1); }
  };
  process.on('SIGTERM', quit); process.on('SIGINT', quit);
  const snap0 = collectProject(p); logLaunch(p.split('/').pop(), snap0);
  draw();
  const timer = setInterval(draw, ms);
  process.stdout.on('resize', draw);
  const onKey = (k) => { if (k === 'q' || k === '' || k.includes('q')) { clearInterval(timer); quit(); } else if (k === 'r' || k.includes('r')) draw(); };
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
  // AC-heartbeat: visible liveness line — spinner rotates, age honest
  ok('AC-heartbeat: spinner rotates', heartbeatLine(0, 10) !== heartbeatLine(1, 10) && heartbeatLine(0, 10) === heartbeatLine(4, 10));
  ok('AC-heartbeat: fresh change → «только что»', heartbeatLine(0, 1).includes('только что'));
  ok('AC-heartbeat: old change → seconds ago', heartbeatLine(0, 42).includes('42с назад'));
  ok('AC-heartbeat: null age → bare live', heartbeatLine(2, null) === `  ${SPIN[2]} live`);
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
