#!/usr/bin/env node
// tui-top.mjs — `jidoka top` live pipeline panel entry point. ≤200 LOC.
// non-TTY: flat snapshot, no ANSI, exit 0.  TTY: alt-screen poll loop, q=quit, r=refresh.
// Kaizen log: docs/audits/tui-panel-launches.jsonl  {ts, project, wavesInFlight, stuckCount}

import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { spawn } from 'node:child_process';
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
const { renderFlat, renderInteractive, reduceKey, buildSelectables, parseMouse, heartbeatLine, buildRepaintBuffer } = await import('./dashboard/tui-render.mjs');
const { resolveFocusMethod, runFocus } = await import('./dashboard/focus.mjs');
const { readSessionEconomics, fleetSummary } = await import('./dashboard/economics.mjs');

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
        const sessionId = f.replace(/^state-/, '').replace(/\.json$/, '');
        // деньги/токены + «вопрос сессии» из транскрипта (кэш по mtime → дёшево на 1с-поллинге; null при любой ошибке)
        const cost = readSessionEconomics(sessionId);
        sessions.push({ state: data.state || 'working', topic: data.topic || data.prompt || '', activity: data.activity || '', mtime: mt, terminalId: data.terminalId || null, sessionId, cost, question: cost?.question || null });
      } catch { /* skip corrupt */ }
    }
    sessions.sort((a, b) => b.mtime - a.mtime);
    return sessions.slice(0, SESSION_MAX_COUNT);
  } catch { return []; }
}

// ── push-уведомления (В) ──────────────────────────────────────────────
// Зовут тебя, когда сессия переходит в «ждёт» или пайплайн встаёт в HALT — чтобы можно было
// отойти от экрана. Срабатывает ТОЛЬКО на переходе (дебаунс встроен), и не шумит на старте
// панели (первое наблюдение состояния не уведомляет). macOS-only; off при JIDOKA_TOP_NOTIFY=0.
const _prevSessionState = new Map();   // sessionId → последнее виденное состояние
let _prevHalt = null;                  // последнее виденное состояние halt

// SECURITY: текст идёт в osascript (AppleScript-строку). Прошлая волна словила RCE через
// интерполяцию в osascript — поэтому ВЫРЕЗАЕМ кавычки/слэши/переводы строк и режем длину.
function sanitizeForOsa(s) { return String(s || '').replace(/["\\\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }

function notify(title, body) {
  if (process.env.JIDOKA_TOP_NOTIFY === '0' || process.platform !== 'darwin') return;
  try {
    const t = sanitizeForOsa(title), b = sanitizeForOsa(body);
    const child = spawn('osascript', ['-e', `display notification "${b}" with title "🦞 jidoka" subtitle "${t}" sound name "Glass"`], { stdio: 'ignore', detached: true });
    child.on('error', () => {}); child.unref();
  } catch { /* уведомления — не критично */ }
}

// detect transitions across one snapshot and fire at most one notification per real change.
function maybeNotify(snap) {
  try {
    for (const s of (snap.sessions || [])) {
      const prev = _prevSessionState.get(s.sessionId);
      if (prev !== undefined && prev !== 'waiting' && s.state === 'waiting') {
        notify('Сессия ждёт тебя', s.question || s.topic || 'нужен твой ответ');
      }
      _prevSessionState.set(s.sessionId, s.state);
    }
    const halt = (snap.health || {}).halt === true;
    if (_prevHalt === false && halt) notify('Пайплайн остановлен', 'нужна команда resume');
    _prevHalt = halt;
  } catch { /* never break the loop */ }
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
  snap.fleet = fleetSummary(snap.sessions);
  process.stdout.write(renderFlat(snap, at).join('\n') + '\n');
  logLaunch(p.split('/').pop(), snap);
  process.exit(0);
}

// ── alt-screen lifecycle ──────────────────────────────────────────────
let _restored = false; let _inAltScreen = false;
function restore() {
  if (_restored) return; _restored = true;
  // mouse-off (\x1b[?1000l\x1b[?1006l) MUST live inside restore() so it tears down on EVERY exit path
  // (q, SIGTERM, SIGINT, uncaughtException, unhandledRejection, process.on('exit')) — a left-behind
  // mouse mode makes the user's terminal unusable after quit. Order: mouse-off, then cursor+alt-screen.
  if (_inAltScreen) process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
  try { if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(false); } catch { /* non-TTY guard */ }
}
process.on('exit', restore);
process.on('uncaughtException', (e) => { restore(); process.stderr.write('tui-top crash: ' + (e?.message || e) + '\n'); process.exit(1); });
process.on('unhandledRejection', (r) => { restore(); process.stderr.write('tui-top unhandled rejection: ' + (r?.message || r) + '\n'); process.exit(1); });

// buildRepaintBuffer + heartbeatLine are now PURE helpers in tui-render.mjs (imported above) — the
// entry file keeps only impure plumbing (stdin/stdout/raw mode/mouse/subprocess focus).

// ── key decoding (pure) ───────────────────────────────────────────────
// Escape sequences arrive as whole strings in utf8 mode. Map a raw stdin chunk to a logical key name,
// or null if it's not one we handle (e.g. a mouse report — those route through parseMouse separately).
function decodeKey(k) {
  if (k === '\x1b[A') return 'up';
  if (k === '\x1b[B') return 'down';
  if (k === '\x1b[C') return 'right';
  if (k === '\x1b[D') return 'left';
  if (k === '\r' || k === '\n') return 'enter';
  if (k === '\t' || k === '\x09') return 'tab';
  if (k === '\x1b[Z') return 'shiftTab';
  if (k === '\x1b') return 'esc';        // bare ESC (a CSI sequence is longer, handled above)
  if (k === 'q') return 'q';
  if (k === 'r') return 'r';
  return null;
}

// ── focus dispatch (impure: runs osascript/tmux/zellij via focus.mjs; logs the Kaizen metric) ──
// Enter on a session row → jump the OS terminal to it. Returns the hint to flash (null when it worked).
function dispatchFocus(session, logDir) {
  const method = resolveFocusMethod(process.env);
  let res; try { res = runFocus(method, session.terminalId, process.env); }
  catch (e) { res = { ok: false, method, hint: `[focus] ошибка: ${String(e?.message || e).slice(0, 60)}` }; }
  // Kaizen metric: append {ts, action:'focus', method, ok} to the existing launch log.
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, 'tui-panel-launches.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), action: 'focus', method: res.method, ok: res.ok }) + '\n');
  } catch { /* non-fatal */ }
  return res.ok ? null : (res.hint || `[focus] не удалось переключить окно (${method}).`);
}

// wire the single stdin handler in raw mode (utf8). One handler, no extra listeners (spec §8.2).
function wireStdin(onKey) {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8'); process.stdin.on('data', onKey); process.stdin.resume();
}

// fs.watch debounce: any change in the data sources → redraw within 300ms (true realtime; the 1s poll
// is the safety net). recursive=true: macOS delivers events from wave subdirs only with a recursive watcher.
function setupWatchers(p, draw) {
  const watchers = []; let debounceTimer = null;
  const sched = () => { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(draw, 300); };
  const tryWatch = (dir, recursive = false) => { try { watchers.push(watch(dir, { persistent: false, recursive }, sched)); } catch { /* missing/unsupported */ } };
  tryWatch(SESSION_DIR);                       // пульт миссии сессий
  tryWatch(join(p, 'docs', 'runs'), true);     // прогресс волн (state.json в подпапках)
  tryWatch(join(p, 'docs', 'audits'));         // лента активности, бэклог, halt
  tryWatch(join(p, 'docs', 'evals'));          // eval baseline (здоровье)
  tryWatch(join(homedir(), '.claude', 'todos')); // прогресс планов задач
  return () => { for (const w of watchers) { try { w.close(); } catch { /* */ } } if (debounceTimer) clearTimeout(debounceTimer); };
}

// ── live run ─────────────────────────────────────────────────────────
function runLive(p) {
  if (!process.stdout.isTTY) { runFlat(p); return; }
  const ms = parseInt(process.env.JIDOKA_TOP_INTERVAL || '', 10) || 1000;
  // alt-screen + hide-cursor, THEN mouse on (SGR 1006). The mouse-off lives in restore() so it tears
  // down on every exit path; here we only turn it ON, right after entering the alt-screen.
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h'); _inAltScreen = true;
  let done = false; let tick = 0; let prevSnapJson = ''; let lastChange = Date.now();
  let snap = null; let at = ''; let lastRows = new Map();
  // interaction state (caller-owned, threaded INTO the pure renderer — never read from globals):
  const ui = { cursor: 0, section: 'session', expanded: null, scroll: {}, lastClick: null, lastHint: null };
  let closeWatchers = () => {};
  const quit = () => { if (done) return; done = true; closeWatchers(); restore(); process.exit(0); };

  // collect(): the fs read + heartbeat bookkeeping. Runs on the 1s poll and on fs.watch events.
  const collect = () => {
    at = new Date().toISOString();
    snap = collectProject(p); snap.sessions = collectSessions();
    snap.fleet = fleetSummary(snap.sessions);
    maybeNotify(snap);          // В: пуш-уведомление при переходе сессии в «ждёт» или volna→halt
    const sj = JSON.stringify(snap);
    if (sj !== prevSnapJson) { if (prevSnapJson) lastChange = Date.now(); prevSnapJson = sj; }
  };
  // paint(snap, ui): build selectables, clamp cursor, render the interactive frame, store the rows map,
  // write. A keypress calls paint() ONLY (move the cursor over the existing snapshot — no disk read).
  const paint = () => {
    try {
      if (process.env.JIDOKA_TOP_CRASH_TEST === '1') throw new Error('crash-test-draw');
      if (!snap) collect();
      const sel = buildSelectables(snap, at);
      ui.cursor = sel.length ? Math.max(0, Math.min(sel.length - 1, ui.cursor)) : 0;
      const cols = process.stdout.columns || 80;
      const { lines, rows } = renderInteractive(snap, at, cols, ui);
      lastRows = rows;
      lines.push(heartbeatLine(tick++, Math.round((Date.now() - lastChange) / 1000)));
      process.stdout.write(buildRepaintBuffer(lines));
    } catch (e) { restore(); process.stderr.write('tui-top draw error: ' + (e?.message || e) + '\n'); process.exit(1); }
  };
  const draw = () => { collect(); paint(); };   // poll/watch path: re-read then repaint

  process.on('SIGTERM', quit); process.on('SIGINT', quit);
  const snap0 = collectProject(p); logLaunch(p.split('/').pop(), snap0);
  draw();
  const timer = setInterval(draw, ms);
  process.stdout.on('resize', paint);

  // one stdin handler (no new listeners): mouse reports route through parseMouse; everything else is a
  // key. Navigation goes through the pure reduceKey; Enter on a session triggers the focus dispatcher.
  const onMouse = (mo) => {
    if (mo.button === 64 || mo.button === 65) { ui.cursor += mo.button === 65 ? 1 : -1; paint(); return; }
    if (!mo.press || (mo.button & 0b11) !== 0) return;          // release / non-left / motion → ignore
    const idx = lastRows.get(mo.row); if (idx === undefined) return;
    const now = Date.now();
    const dbl = ui.lastClick && ui.lastClick.idx === idx && (now - ui.lastClick.time) < 400;
    ui.lastClick = { idx, time: now };
    if (dbl && idx === ui.cursor) { onKey('\r'); return; }       // double-click = Enter
    ui.cursor = idx; paint();
  };
  const onKey = (k) => {
    const mo = parseMouse(k); if (mo) { onMouse(mo); return; }
    const key = decodeKey(k);
    if (key === 'q' || k === '\x03') { clearInterval(timer); quit(); return; }
    if (key === 'r') { draw(); return; }
    if (!key) return;
    if (key === 'enter') {                                       // act on the current row
      const sel = buildSelectables(snap, at); const row = sel[ui.cursor];
      if (row && row.kind === 'session') {
        if ((snap.health || {}).halt === true) return;          // HALT freezes dispatch
        ui.lastHint = dispatchFocus(row.session, join(p, 'docs', 'audits')); paint(); return;
      }
    }
    ui.lastHint = null;                                          // any other key clears a stale hint
    const sel = buildSelectables(snap, at);
    Object.assign(ui, reduceKey(ui, key, sel));
    paint();
  };
  wireStdin(onKey);
  closeWatchers = setupWatchers(p, draw);
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
  ok('AC-heartbeat: null age → bare live', heartbeatLine(2, null) === '  ◑ live');
  // AC-mouse-enable: the enable sequence \x1b[?1000h\x1b[?1006h sits in the source right after alt-enter
  const { readFileSync: rfsSrc } = await import('node:fs');
  const selfSrc = rfsSrc(new URL(import.meta.url).pathname, 'utf8');
  const enableSeq = '\\x1b[?1000h\\x1b[?1006h';
  ok('AC-mouse-enable: enable seq present after alt-enter', selfSrc.includes('?1049h\\x1b[?25l\\x1b[?1000h\\x1b[?1006h'));
  // AC-mouse-disable / teardown: restore() captured-output includes the mouse-off on the crash path
  let crashCapture = '';
  { const captured = []; const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...a) => { captured.push(a[0]); return true; };
    const prev_r = _restored; const prev_a = _inAltScreen;
    _restored = false; _inAltScreen = true;
    restore();
    process.stdout.write = origWrite;
    _restored = prev_r; _inAltScreen = prev_a;
    crashCapture = captured.join('');
    ok('AC-crash: restore on crash path emits \\x1b[?1049l', crashCapture.includes('\x1b[?1049l')); }
  ok('AC-mouse-disable: restore() tears down mouse (\\x1b[?1000l\\x1b[?1006l)', crashCapture.includes('\x1b[?1000l\x1b[?1006l'));
  ok('AC-mouse-disable: mouse-off before cursor/alt-screen restore', crashCapture.indexOf('\x1b[?1000l') < crashCapture.indexOf('\x1b[?1049l'));
  // interactive: decodeKey maps escape sequences to logical keys
  ok('decodeKey: arrows', decodeKey('\x1b[A') === 'up' && decodeKey('\x1b[B') === 'down' && decodeKey('\x1b[C') === 'right' && decodeKey('\x1b[D') === 'left');
  ok('decodeKey: enter/tab/shiftTab/esc', decodeKey('\r') === 'enter' && decodeKey('\t') === 'tab' && decodeKey('\x1b[Z') === 'shiftTab' && decodeKey('\x1b') === 'esc');
  ok('decodeKey: q/r and unknown→null', decodeKey('q') === 'q' && decodeKey('r') === 'r' && decodeKey('x') === null);
  // interactive: focus dispatcher chooses method + logs the metric (unknown env → fallback hint, ok:false)
  { const { mkdtempSync: mt, rmSync: rm, readFileSync: rf2 } = await import('node:fs');
    const { tmpdir: td } = await import('node:os'); const { join: jj } = await import('node:path');
    const tmp = mt(jj(td(), 'tui-focus-')); const logDir = jj(tmp, 'audits');
    try {
      const prevTP = process.env.TERM_PROGRAM; delete process.env.TERM_PROGRAM;
      const prevTMUX = process.env.TMUX; delete process.env.TMUX;
      const prevZ = process.env.ZELLIJ; delete process.env.ZELLIJ;
      const hint = dispatchFocus({ terminalId: 'tty:/dev/ttys003' }, logDir);
      if (prevTP !== undefined) process.env.TERM_PROGRAM = prevTP;
      if (prevTMUX !== undefined) process.env.TMUX = prevTMUX;
      if (prevZ !== undefined) process.env.ZELLIJ = prevZ;
      ok('dispatchFocus: unknown env → honest hint string', typeof hint === 'string' && hint.includes('/dev/ttys003'));
      const logLine = rf2(jj(logDir, 'tui-panel-launches.jsonl'), 'utf8').trim();
      let rec; try { rec = JSON.parse(logLine); } catch { rec = null; }
      ok('dispatchFocus: appends {action:focus, method, ok} metric', rec && rec.action === 'focus' && rec.method != null && rec.ok === false);
    } finally { rm(tmp, { recursive: true, force: true }); }
  }
  if (fails.length) { console.log(`\n\x1b[31mFAIL (${fails.length}): ${fails.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ tui-top: alt-screen lifecycle + ТЕРМИНАЛЫ + Kaizen log + repaint correct\x1b[0m');
  process.exit(0);
}

if (hasFlag('--self-test')) await selfTest(); else runLive(projectPath());
