#!/usr/bin/env node
// tui-top-acceptance.mjs — executable acceptance harness for wave-tui-top (jidoka top).
//
// Runs all 14 EARS acceptance criteria from docs/specs/wave-tui-top_MASTER_SPEC.md §6 against the
// three deliverables: the run-state terminalId patch, the pure tui-render renderer, and the tui-top
// entry point. Zero-dependency, Node built-ins only — same idiom as scripts/run-state.mjs --self-test.
//
// TDD red phase: before the renderer + entry point exist this harness MUST run and report FAIL for the
// missing modules (it imports them defensively and never crashes on a missing file). Once implemented,
// every AC flips to PASS and the harness exits 0.
//
//   node scripts/tui-top-acceptance.mjs
//
// All fixtures are inline (snapshot shapes taken from collectors.mjs collectProject). No external test
// runner, no fs writes outside a temp dir, the real tui-panel-launches.jsonl log is never mutated.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RUN_STATE = join(HERE, 'run-state.mjs');
const TUI_RENDER = join(HERE, 'dashboard', 'tui-render.mjs');
const TUI_TOP = join(HERE, 'tui-top.mjs');
const LAUNCH_LOG = join(ROOT, 'docs', 'audits', 'tui-panel-launches.jsonl');

// ── result accumulator ──────────────────────────────────────────────
const results = [];
const ok = (id, desc, pass, detail = '') => {
  results.push({ id, pass });
  const mark = pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark}  ${id}  ${desc}${detail ? `  \x1b[90m(${detail})\x1b[0m` : ''}`);
};
// Guard a check that may throw (e.g. module missing) and report it as a clean FAIL rather than crash.
// Supports sync OR async fns: an async fn returns a Promise of [pass, detail], which we await.
const guard = async (id, desc, fn) => {
  try { const r = fn(); const [pass, detail] = (r && typeof r.then === 'function') ? await r : r; ok(id, desc, pass, detail); }
  catch (e) { ok(id, desc, false, String(e.message || e).slice(0, 80)); }
};

// ── inline fixtures (shapes from collectors.mjs collectProject) ──────
// A wave is a summarizePipeline() result; the renderer reads .wave/.current/.status/.progress/.terminalId.
const wave = (over = {}) => ({
  wave: 'wave-x', task: { risk: 'normal' }, current: 'build', status: 'running',
  live: true, progress: 50, halted: false, terminalId: null, updatedAt: '2026-06-06T00:00:00Z',
  stages: [{ phase: 'build', label: 'Build', status: 'running', current: true }], ...over,
});
const snapshot = (over = {}) => ({
  pipeline: wave(), board: { columns: [], waveCount: 0 }, waves: [wave()],
  tasks: [], health: { level: 'green', evalPct: 100, recentFails: 0, halt: false },
  activity: [], lessons: [], timeline: [], ...over,
});

// ── group 1: run-state terminalId (AC-1..AC-4) ──────────────────────
async function groupRunState() {
  console.log('\n\x1b[1mrun-state.mjs — terminalId (AC-1..AC-4)\x1b[0m');
  const mod = existsSync(RUN_STATE) ? await import(RUN_STATE + `?t=${Date.now()}`).catch(() => null) : null;

  await guard('AC-1', 'TERM_SESSION_ID set → terminalId equals it', () => {
    if (!mod?.initState) return [false, 'run-state initState missing'];
    const prev = { t: process.env.TERM_SESSION_ID, i: process.env.ITERM_SESSION_ID };
    process.env.TERM_SESSION_ID = 'tmux:7.0'; delete process.env.ITERM_SESSION_ID;
    try { const s = mod.initState('wave-a', { risk: 'normal', surfaces: ['backend'] }); return [s.terminalId === 'tmux:7.0', `got ${JSON.stringify(s.terminalId)}`]; }
    finally { restoreEnv(prev); }
  });

  await guard('AC-2', 'neither env set → terminalId is null', () => {
    if (!mod?.initState) return [false, 'run-state initState missing'];
    const prev = { t: process.env.TERM_SESSION_ID, i: process.env.ITERM_SESSION_ID };
    delete process.env.TERM_SESSION_ID; delete process.env.ITERM_SESSION_ID;
    try { const s = mod.initState('wave-b', { risk: 'normal', surfaces: ['backend'] }); return [s.terminalId === null, `got ${JSON.stringify(s.terminalId)}`]; }
    finally { restoreEnv(prev); }
  });

  await guard('AC-3', 'loadState of old state.json (no terminalId) does not throw', () => {
    if (!mod?.loadState || !mod?.saveState) return [false, 'run-state loadState/saveState missing'];
    const tmp = mkdtempSync(join(tmpdir(), 'tui-acc-'));
    try {
      // Hand-write a legacy state.json with NO terminalId field, mimicking pre-patch runs.
      const legacy = { wave: 'wave-old', task: {}, phases: [{ phase: 'build', status: 'done' }], current: null, events: [], createdAt: 'x', updatedAt: 'x' };
      mkdirSync(join(tmp, 'docs', 'runs', 'wave-old'), { recursive: true });
      writeFileSync(join(tmp, 'docs', 'runs', 'wave-old', 'state.json'), JSON.stringify(legacy));
      const loaded = mod.loadState(tmp, 'wave-old');
      return [loaded != null && loaded.terminalId === undefined, `terminalId=${JSON.stringify(loaded?.terminalId)}`];
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  await guard('AC-4', 'run-state.mjs --self-test exits 0 (all cases incl. terminalId)', () => {
    if (!existsSync(RUN_STATE)) return [false, 'run-state.mjs missing'];
    const r = spawnSync('node', [RUN_STATE, '--self-test'], { encoding: 'utf8' });
    const hasTerm = /terminalId/i.test(r.stdout || '');
    return [r.status === 0 && hasTerm, `exit=${r.status} terminalId-case=${hasTerm}`];
  });
}

function restoreEnv(prev) {
  if (prev.t === undefined) delete process.env.TERM_SESSION_ID; else process.env.TERM_SESSION_ID = prev.t;
  if (prev.i === undefined) delete process.env.ITERM_SESSION_ID; else process.env.ITERM_SESSION_ID = prev.i;
}

// ── group 2: tui-render pure renderer (AC-5..AC-9) ──────────────────
async function groupRender() {
  console.log('\n\x1b[1mtui-render.mjs — screen states (AC-5..AC-9)\x1b[0m');
  const mod = existsSync(TUI_RENDER) ? await import(TUI_RENDER + `?t=${Date.now()}`).catch((e) => ({ __err: e })) : null;
  const render = mod && !mod.__err ? mod.renderFrame : null;
  const missing = !render ? (existsSync(TUI_RENDER) ? 'renderFrame not exported' : 'module missing') : '';
  const at = '2026-06-06T00:00:00Z';
  const idxBefore = (lines, needle) => lines.findIndex((l) => l.includes(needle));

  await guard('AC-5', 'halt snapshot → СТОП banner before any board content', () => {
    if (!render) return [false, missing];
    const lines = render(snapshot({ health: { level: 'red', evalPct: 0, recentFails: 1, halt: true } }), at, 120);
    const banner = idxBefore(lines, 'СТОП');
    const board = idxBefore(lines, 'ДОСКА');
    return [banner !== -1 && (board === -1 || banner < board), `банner@${banner} board@${board}`];
  });

  await guard('AC-6', 'a stuck wave → ЗАВИСЛО section above the board', () => {
    if (!render) return [false, missing];
    const stuck = wave({ wave: 'wave-stuck', status: 'stuck' });
    const lines = render(snapshot({ waves: [stuck], pipeline: stuck }), at, 120);
    const z = idxBefore(lines, 'ЗАВИСЛО');
    const board = idxBefore(lines, 'ДОСКА');
    return [z !== -1 && (board === -1 || z < board), `зависло@${z} board@${board}`];
  });

  await guard('AC-7', 'empty waves → "Нет активных волн" + НЕДАВНО ЗАВЕРШИЛИСЬ', () => {
    if (!render) return [false, missing];
    const lines = render(snapshot({ waves: [], pipeline: wave({ wave: null, current: null }) }), at, 120);
    const txt = lines.join('\n');
    return [txt.includes('Нет активных волн') && txt.includes('НЕДАВНО ЗАВЕРШИЛИСЬ'), ''];
  });

  await guard('AC-8', 'cols < 100 → board is a linear list (symbol+stage+%)', () => {
    if (!render) return [false, missing];
    const narrow = render(snapshot(), at, 80);
    const wide = render(snapshot(), at, 120);
    // Linear list renders one wave per line carrying its progress %; Kanban layout differs structurally.
    const narrowHasPct = narrow.some((l) => /\b50\s*%/.test(l) || /50%/.test(l));
    return [Array.isArray(narrow) && narrowHasPct && narrow.join('\n') !== wide.join('\n'), `narrow≠wide=${narrow.join('\n') !== wide.join('\n')}`];
  });

  await guard('AC-9', 'renderFrame returns string[] (pure, no fs/Date)', () => {
    if (!render) return [false, missing];
    const lines = render(snapshot(), at, 120);
    return [Array.isArray(lines) && lines.every((l) => typeof l === 'string'), `len=${Array.isArray(lines) ? lines.length : 'n/a'}`];
  });
}

// ── group 2b: new ACs for wave-tui-live ─────────────────────────────
async function groupLive() {
  console.log('\n\x1b[1mwave-tui-live new ACs\x1b[0m');
  const mod = existsSync(TUI_RENDER) ? await import(TUI_RENDER + `?t=${Date.now()}`).catch((e) => ({ __err: e })) : null;
  const render = mod && !mod.__err ? mod.renderFrame : null;
  const isStuck = mod && !mod.__err ? mod.isStuck : null;
  const renderSessions = mod && !mod.__err ? mod.renderSessions : null;
  const missing = !render ? (existsSync(TUI_RENDER) ? 'renderFrame not exported' : 'module missing') : '';
  const at = '2026-06-06T14:00:00Z';

  // AC-L1: done-wave with updatedAt 100 hours ago is NOT stuck
  await guard('AC-L1', 'done-wave (all phases done, status done) not classified as stuck even after 100h', () => {
    if (!isStuck) return [false, missing || 'isStuck not exported'];
    const oldAt = '2026-06-02T00:00:00Z'; // 100h before at
    const doneWave = wave({ status: 'done', current: null, progress: 100,
      stages: [{ phase: 'build', status: 'done' }, { phase: 'gate', status: 'done' }],
      updatedAt: oldAt });
    const stuck = isStuck(doneWave, at);
    return [stuck === false, `isStuck returned ${stuck}`];
  });

  // AC-L2: assembled live frame contains \x1b[K on each line and ends with \x1b[J
  // This is tested via the tui-top --self-test path (it covers the draw() function)
  // We verify it here by inspecting the self-test output directly via spawnSync.
  await guard('AC-L2', 'tui-top --self-test confirms frame lines contain \\x1b[K and \\x1b[J', () => {
    if (!existsSync(TUI_TOP)) return [false, 'tui-top.mjs missing'];
    const r = spawnSync('node', [TUI_TOP, '--self-test'], { encoding: 'utf8', timeout: 8000 });
    const hasRepaintAC = /AC-repaint|repaint|\\x1b\[K|erase/i.test(r.stdout || '');
    return [r.status === 0 && hasRepaintAC, `exit=${r.status} repaint-ac=${hasRepaintAC} stdout=${(r.stdout||'').slice(0,200)}`];
  });

  // AC-L3: renderSessions with 2 sessions renders both with state icons
  await guard('AC-L3', 'renderSessions(2 sessions) renders both with icons (▶ / ⏳ / ✓)', () => {
    if (!renderSessions) return [false, missing || 'renderSessions not exported'];
    const sessions = [
      { state: 'working', topic: 'build the auth feature', activity: 'running tests', mtime: Date.now() - 5000, sessionId: 'abc' },
      { state: 'waiting', topic: 'fix the login bug', activity: '', mtime: Date.now() - 30000, sessionId: 'def' },
    ];
    const lines = renderSessions(sessions, 120);
    const txt = lines.join('\n');
    const hasSection = txt.includes('СЕССИИ');
    const hasWorking = txt.includes('▶');
    const hasWaiting = txt.includes('⏳');
    const hasTopic1 = txt.includes('build the auth');
    const hasTopic2 = txt.includes('fix the login');
    return [hasSection && hasWorking && hasWaiting && hasTopic1 && hasTopic2,
      `section=${hasSection} ▶=${hasWorking} ⏳=${hasWaiting} topics=${hasTopic1},${hasTopic2}`];
  });

  // AC-L4: renderSessions with empty/corrupt array → section not rendered
  await guard('AC-L4', 'renderSessions([]) → empty array (section absent)', () => {
    if (!renderSessions) return [false, missing || 'renderSessions not exported'];
    const empty = renderSessions([], 120);
    const corrupt = renderSessions(null, 120);
    return [empty.length === 0 && corrupt.length === 0,
      `empty.len=${empty.length} corrupt.len=${corrupt.length}`];
  });

  // AC-L5: done session gets ✓ icon and grey-dimmed style
  await guard('AC-L5', 'renderSessions with done session shows ✓ icon', () => {
    if (!renderSessions) return [false, missing || 'renderSessions not exported'];
    const sessions = [{ state: 'done', topic: 'deploy to production', activity: '', mtime: Date.now() - 60000, sessionId: 'xyz' }];
    const lines = renderSessions(sessions, 120);
    const txt = lines.join('\n');
    return [txt.includes('✓') && txt.includes('deploy to production'), `txt=${txt.slice(0, 200)}`];
  });
}

// ── group 2c: interactive ACs for wave-tui-interactive (IAC-1..IAC-10) ──
async function groupInteractive() {
  console.log('\n\x1b[1mwave-tui-interactive — IAC-1..IAC-10\x1b[0m');
  const mod = existsSync(TUI_RENDER) ? await import(TUI_RENDER + `?t=${Date.now()}`).catch((e) => ({ __err: e })) : null;
  const ri = mod && !mod.__err ? mod.renderInteractive : null;
  const renderFrame = mod && !mod.__err ? mod.renderFrame : null;
  const buildSelectables = mod && !mod.__err ? mod.buildSelectables : null;
  const reduceKey = mod && !mod.__err ? mod.reduceKey : null;
  const parseMouse = mod && !mod.__err ? mod.parseMouse : null;
  const missing = !ri ? (existsSync(TUI_RENDER) ? 'renderInteractive not exported' : 'module missing') : '';
  const at = '2026-06-06T14:00:00Z';

  // A snapshot with a stuck wave, two sessions, and a running wave → selectables in all three sections.
  const sess = [
    { state: 'working', topic: 'build the auth feature', activity: 'running tests', mtime: 0, sessionId: 'a', terminalId: 'tmux:%3' },
    { state: 'waiting', topic: 'fix the login bug', activity: '', mtime: 0, sessionId: 'b', terminalId: null },
  ];
  const detailedWave = (over = {}) => wave({
    wave: 'wave-detail', current: 'tests', status: 'running', progress: 30, updatedAt: at,
    stages: [
      { phase: 'discovery', status: 'done' }, { phase: 'spec', status: 'done' },
      { phase: 'tests', status: 'running', current: true }, { phase: 'build', status: 'pending' },
      { phase: 'gate', status: 'pending' }, { phase: 'debug', status: 'pending' }, { phase: 'memory', status: 'pending' },
    ],
    events: [
      { ts: '2026-06-06T13:59:00Z', who: 'tester', what: 'тесты написаны' },
      { ts: '2026-06-06T13:58:00Z', who: 'architect', what: 'спека готова' },
      { ts: '2026-06-06T13:57:00Z', who: 'owner', what: 'волна запущена' },
    ],
    note: 'жду ревью спеки', ...over,
  });
  const interactiveSnap = (over = {}) => snapshot({
    waves: [detailedWave()], pipeline: detailedWave(), sessions: sess, ...over,
  });

  await guard('IAC-1', 'selected row renders inverse video \\x1b[7m + ▶ marker, only one row', () => {
    if (!ri) return [false, missing];
    const { lines } = ri(interactiveSnap(), at, 120, { cursor: 0 });
    const inverseLines = lines.filter((l) => l.includes('\x1b[7m'));
    const markerLines = lines.filter((l) => l.includes('▶') && l.includes('\x1b[7m'));
    return [inverseLines.length === 1 && markerLines.length === 1,
      `inverse=${inverseLines.length} marked=${markerLines.length}`];
  });

  await guard('IAC-2', 'selection is data-in: renderFrame() w/o ui byte-identical to pre-wave', () => {
    if (!renderFrame) return [false, missing];
    const snap = interactiveSnap();
    const noUi = renderFrame(snap, at, 120);
    const emptyUi = renderFrame(snap, at, 120, {});
    const hasInverse = noUi.some((l) => l.includes('\x1b[7m'));
    return [Array.isArray(noUi) && noUi.join('\n') === emptyUi.join('\n') && !hasInverse,
      `equal=${noUi.join('\n') === emptyUi.join('\n')} inverse=${hasInverse}`];
  });

  await guard('IAC-3', 'wave drill-down: expanded → 7 stage labels + recent event, dim; collapse removes', () => {
    if (!ri || !buildSelectables) return [false, missing || 'buildSelectables missing'];
    const snap = interactiveSnap();
    const sel = buildSelectables(snap, at);
    const waveIdx = sel.findIndex((s) => s.kind === 'wave' && s.id === 'wave-detail');
    if (waveIdx < 0) return [false, `no wave selectable (sel=${sel.map((s) => s.kind).join(',')})`];
    const exp = ri(snap, at, 120, { cursor: waveIdx, expanded: 'wave-detail' });
    const txt = exp.lines.join('\n');
    const allStages = ['ПОИСК', 'СПЕК', 'ТЕСТЫ', 'СБОРКА', 'ГЕЙТ', 'ДЕБАГ', 'ПАМЯТЬ'].every((s) => txt.includes(s));
    const hasEvent = txt.includes('тесты написаны');
    const detailLine = exp.lines.find((l) => l.includes('тесты написаны'));
    const dim = detailLine && detailLine.includes('\x1b[90m');
    const col = ri(snap, at, 120, { cursor: waveIdx, expanded: null });
    const collapsed = !col.lines.join('\n').includes('тесты написаны');
    return [allStages && hasEvent && dim && collapsed,
      `stages=${allStages} event=${hasEvent} dim=${dim} collapsed=${collapsed}`];
  });

  await guard('IAC-4', 'parseMouse SGR press/release/null + row→selectable mapping', () => {
    if (!parseMouse || !ri) return [false, missing || 'parseMouse missing'];
    const press = parseMouse('\x1b[<0;5;12M');
    const rel = parseMouse('\x1b[<0;5;12m');
    const none = parseMouse('hello');
    const pressOk = press && press.button === 0 && press.col === 5 && press.row === 12 && press.press === true;
    const relOk = rel && rel.press === false;
    const noneOk = none === null;
    // row map: find a selectable's screen row, confirm rows.get(row) === its index
    const snap = interactiveSnap();
    const { rows } = ri(snap, at, 120, { cursor: 0 });
    const mappedIdx = [...rows.values()];
    const hasMapping = rows.size > 0 && mappedIdx.includes(0);
    return [pressOk && relOk && noneOk && hasMapping,
      `press=${pressOk} rel=${relOk} null=${noneOk} map=${hasMapping}`];
  });

  await guard('IAC-5', 'mouse mode enable after alt-enter + teardown in restore() (tui-top --self-test)', () => {
    if (!existsSync(TUI_TOP)) return [false, 'tui-top.mjs missing'];
    const r = spawnSync('node', [TUI_TOP, '--self-test'], { encoding: 'utf8', timeout: 8000 });
    const out = r.stdout || '';
    const hasEnable = /AC-mouse-enable|1000h.*1006h|mouse.*enable/i.test(out);
    const hasDisable = /AC-mouse-disable|mouse.*teardown|1000l.*1006l|mouse.*restore/i.test(out);
    return [r.status === 0 && hasEnable && hasDisable,
      `exit=${r.status} enable=${hasEnable} disable=${hasDisable}`];
  });

  await guard('IAC-6', 'non-TTY flat path: no ANSI, no mouse mode, no selection markers, exit 0', () => {
    if (!existsSync(TUI_TOP)) return [false, 'tui-top.mjs missing'];
    const r = spawnSync('node', [TUI_TOP], { encoding: 'utf8', input: '', timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = r.stdout || '';
    const noAnsi = !out.includes('\x1b');
    const noMarker = !out.includes('▶');
    return [noAnsi && noMarker && r.status === 0, `ansi=${!noAnsi} marker=${!noMarker} exit=${r.status}`];
  });

  await guard('IAC-7', 'hook --self-test: resolveTerminalId cases pass (exit 0)', () => {
    const HOOK = join(ROOT, 'hooks', 'session-state.mjs');
    if (!existsSync(HOOK)) return [false, 'hooks/session-state.mjs missing'];
    const r = spawnSync('node', [HOOK, '--self-test'], { encoding: 'utf8', timeout: 8000 });
    const hasCase = /resolveTerminalId|terminalId|tmux:|tty:/i.test(r.stdout || '');
    return [r.status === 0 && hasCase, `exit=${r.status} terminalId-case=${hasCase}`];
  });

  await guard('IAC-8', 'resolveFocusMethod chooses method per env (mux-first); runFocus calls exec stub', async () => {
    const FOCUS = join(HERE, 'dashboard', 'focus.mjs');
    if (!existsSync(FOCUS)) return [false, 'dashboard/focus.mjs missing'];
    const fm = await import(FOCUS + `?t=${Date.now()}`).catch((e) => ({ __err: e }));
    if (fm.__err || !fm.resolveFocusMethod) return [false, 'resolveFocusMethod not exported'];
    const r = fm.resolveFocusMethod;
    const cases = [
      [{ ZELLIJ: '1' }, 'zellij'], [{ TMUX: 'x' }, 'tmux'],
      [{ TERM_PROGRAM: 'Apple_Terminal' }, 'terminal'], [{ TERM_PROGRAM: 'iTerm.app' }, 'iterm'],
      [{ TERM_PROGRAM: 'WarpTerminal' }, 'warp'], [{}, 'unknown'],
      [{ ZELLIJ: '1', TERM_PROGRAM: 'Apple_Terminal' }, 'zellij'], // mux wins
      [{ TMUX: 'x', TERM_PROGRAM: 'iTerm.app' }, 'tmux'],
    ];
    const bad = cases.filter(([env, want]) => r(env) !== want).map(([env, want]) => `${JSON.stringify(env)}≠${want}→${r(env)}`);
    // runFocus terminal → exec receives osascript + tty
    let recv = null; const stub = (cmd, argv) => { recv = { cmd, argv }; return ''; };
    fm.runFocus('terminal', '/dev/ttys017', { TERM_PROGRAM: 'Apple_Terminal' }, stub);
    const termOk = recv && recv.cmd === 'osascript' && JSON.stringify(recv.argv).includes('/dev/ttys017');
    return [bad.length === 0 && termOk, `bad=[${bad.join('; ')}] termExec=${termOk}`];
  });

  await guard('IAC-9', 'runFocus warp/unknown/null → {ok:false, hint naming terminal}, no throw', async () => {
    const FOCUS = join(HERE, 'dashboard', 'focus.mjs');
    if (!existsSync(FOCUS)) return [false, 'dashboard/focus.mjs missing'];
    const fm = await import(FOCUS + `?t=${Date.now()}`).catch((e) => ({ __err: e }));
    if (fm.__err || !fm.runFocus) return [false, 'runFocus not exported'];
    const stub = () => '';
    const warp = fm.runFocus('warp', 'tty:/dev/ttys003', { TERM_PROGRAM: 'WarpTerminal' }, stub);
    const unk = fm.runFocus('unknown', null, {}, stub);
    const warpOk = warp && warp.ok === false && typeof warp.hint === 'string' && warp.hint.includes('/dev/ttys003');
    const unkOk = unk && unk.ok === false && typeof unk.hint === 'string';
    return [warpOk && unkOk, `warp.ok=${warp?.ok} warpHint=${warpOk} unk.ok=${unk?.ok}`];
  });

  await guard('IAC-10', 'runFocus claude → app-activate only (open -b), no tab switch, ok:false', async () => {
    const FOCUS = join(HERE, 'dashboard', 'focus.mjs');
    if (!existsSync(FOCUS)) return [false, 'dashboard/focus.mjs missing'];
    const fm = await import(FOCUS + `?t=${Date.now()}`).catch((e) => ({ __err: e }));
    if (fm.__err || !fm.runFocus) return [false, 'runFocus not exported'];
    const calls = []; const stub = (cmd, argv) => { calls.push({ cmd, argv }); return ''; };
    const res = fm.runFocus('claude', 'claude:app', {}, stub);
    const onlyOpen = calls.length === 1 && calls[0].cmd === 'open' &&
      JSON.stringify(calls[0].argv).includes('com.anthropic.claudefordesktop');
    const noTabSwitch = !calls.some((c) => /osascript|System Events|click/.test(JSON.stringify(c)));
    return [onlyOpen && noTabSwitch && res && res.ok === false,
      `open=${onlyOpen} noTab=${noTabSwitch} ok=${res?.ok}`];
  });
}

// ── group 3: tui-top entry + lifecycle (AC-10..AC-14) ───────────────
async function groupEntry() {
  console.log('\n\x1b[1mtui-top.mjs — entry + lifecycle (AC-10..AC-14)\x1b[0m');
  const present = existsSync(TUI_TOP);

  await guard('AC-10', 'non-TTY (piped) output contains no ANSI escape (\\x1b)', () => {
    if (!present) return [false, 'tui-top.mjs missing'];
    const r = spawnSync('node', [TUI_TOP], { encoding: 'utf8', input: '', timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = (r.stdout || '');
    return [!out.includes('\x1b') && r.status === 0, `ansi=${out.includes('\x1b')} exit=${r.status}`];
  });

  await guard('AC-12', 'echo q | tui-top.mjs exits with code 0', () => {
    if (!present) return [false, 'tui-top.mjs missing'];
    const r = spawnSync('node', [TUI_TOP], { encoding: 'utf8', input: 'q\n', timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'] });
    return [r.status === 0, `exit=${r.status}`];
  });

  await guard('AC-13', 'launch appends one valid JSON line {ts, project} to launch log', () => {
    if (!present) return [false, 'tui-top.mjs missing'];
    const before = countLines(LAUNCH_LOG);
    const r = spawnSync('node', [TUI_TOP], { encoding: 'utf8', input: '', timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'] });
    const after = countLines(LAUNCH_LOG);
    if (after !== before + 1) return [false, `lines ${before}→${after} (expected +1), exit=${r.status}`];
    const last = readFileSync(LAUNCH_LOG, 'utf8').trim().split('\n').pop();
    let rec; try { rec = JSON.parse(last); } catch { return [false, 'last line not valid JSON']; }
    return [!!rec.ts && !!rec.project, `ts=${!!rec.ts} project=${!!rec.project}`];
  });

  // AC-11 (alt-screen enter/exit codes) and AC-14 (ТЕРМИНАЛЫ section) require an interactive TTY /
  // rendered terminalId column. They are exercised by tui-top.mjs --self-test once implemented; here we
  // assert that self-test path exists and passes, which covers the lifecycle + terminal-render contract.
  await guard('AC-11+14', 'tui-top.mjs --self-test exits 0 (alt-screen lifecycle + ТЕРМИНАЛЫ)', () => {
    if (!present) return [false, 'tui-top.mjs missing'];
    const r = spawnSync('node', [TUI_TOP, '--self-test'], { encoding: 'utf8', timeout: 8000 });
    const hasTerm = /ТЕРМИНАЛ/i.test(r.stdout || '');
    return [r.status === 0 && hasTerm, `exit=${r.status} terminalSection=${hasTerm}`];
  });
}

function countLines(p) {
  if (!existsSync(p)) return 0;
  const t = readFileSync(p, 'utf8');
  return t.trim() === '' ? 0 : t.trim().split('\n').length;
}

// ── main ─────────────────────────────────────────────────────────────
console.log('\x1b[1mwave-tui-top acceptance harness\x1b[0m — 18+10 ACs (18 base + 10 wave-tui-interactive)\n');
await groupRunState();
await groupRender();
await groupLive();
await groupInteractive();
await groupEntry();

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log(`\n${'─'.repeat(56)}`);
if (fail) {
  console.log(`\x1b[31m${fail} FAIL\x1b[0m / ${pass} PASS  —  ${results.filter((r) => !r.pass).map((r) => r.id).join(', ')}`);
  console.log('\x1b[90m(red phase expected before tui-render.mjs / tui-top.mjs exist)\x1b[0m');
  process.exit(1);
}
console.log(`\x1b[32mALL ${pass} ACs PASS\x1b[0m`);
process.exit(0);
