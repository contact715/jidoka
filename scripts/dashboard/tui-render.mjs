#!/usr/bin/env node
// tui-render.mjs — pure TUI renderer for jidoka top panel. ≤400 LOC.
// CONTRACT: PURE functions only — no fs, no Date.now(), no process.stdout.
// Input: snapshot (collectProject result), collectedAt (ISO string), cols (number).
// Output: string[] one entry per line. Caller joins with \n and writes.
//
// STUCK derivation: wave.status==='stuck' OR any phase status==='failed'
// OR updatedAt older than STUCK_THRESHOLD_MS (90 min). collectors.mjs unchanged.
//
// ANSI: \x1b[32m green/done · \x1b[33m amber/running · \x1b[31m red/stuck
//       \x1b[90m grey/pending · \x1b[0m reset  (matches statusline-jidoka.mjs)

const R = '\x1b[0m', G = '\x1b[32m', A = '\x1b[33m', X = '\x1b[31m', D = '\x1b[90m';
const STUCK_THRESHOLD_MS = 90 * 60 * 1000;
const SYM = { done: '✓', running: '▸', stuck: '!', pending: '○', idle: '◦' };
const STAGE = { discovery:'ПОИСК', spec:'СПЕК', tests:'ТЕСТЫ', build:'СБОРКА', gate:'ГЕЙТ', debug:'ДЕБАГ', launch:'ЗАПУСК', memory:'ПАМЯТЬ', done:'ГОТОВО' };
const COL_ORDER = ['discovery','spec','tests','build','gate','debug','memory','done'];
const CORE = new Set(['discovery','spec','tests','build','gate','debug','memory']);

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - strip(s).length));
const hline = (n, c = '─') => c.repeat(n);
const sec = (lbl, n) => { const h = `─── ${lbl} `; return h + '─'.repeat(Math.max(0, n - strip(h).length)); };
const bar = (p, w = 6) => { const f = Math.round(p / 100 * w); return '[' + '▓'.repeat(f) + '░'.repeat(w - f) + ']'; };
const cstat = (s) => s === 'done' ? G : s === 'running' ? A : (s === 'stuck' || s === 'failed') ? X : D;
const ssym = (s) => SYM[s] || SYM.idle;
const stageLabel = (w) => { const ph = w.current; return ph ? (STAGE[ph] || ph.toUpperCase()) : (w.progress === 100 ? 'ГОТОВО' : '—'); };
const dur = (ms) => { const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000); return h > 0 ? `${h}ч ${m}м` : `${m}м`; };

// ── interactive primitives (pure) ──────────────────────────────────────
const INV = '\x1b[7m';          // inverse video — the selected-row bar (colorblind-safe, not color-only)
const WINDOW = 8;               // max rows shown per section before clip summaries kick in

// pure: parse one SGR-1006 mouse report → {button,col,row,press} | null. M=press, m=release.
export function parseMouse(chunk) {
  const m = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(chunk || '');
  if (!m) return null;
  return { button: +m[1], col: +m[2], row: +m[3], press: m[4] === 'M' };
}

// pure: flat, ordered list of selectable rows, rebuilt every paint. Attention priority decides order
// so the cursor lands on what matters first: ЗАВИСЛО → СЕССИИ → ДОСКА. Sections are non-selectable;
// only their rows are. Each entry: { kind:'stuck'|'session'|'wave', id, label, ...payload }.
export function buildSelectables(snapshot, at) {
  const waves = snapshot.waves || [];
  const stuck = waves.filter((w) => isStuck(w, at));
  const sel = [];
  for (const w of stuck) sel.push({ kind: 'stuck', id: w.wave || '—', label: w.wave || '—', wave: w });
  for (const s of (snapshot.sessions || [])) sel.push({ kind: 'session', id: s.sessionId, label: s.topic || s.prompt || '', session: s });
  const stuckIds = new Set(stuck.map((w) => w.wave));
  for (const w of waves) { if (stuckIds.has(w.wave)) continue; sel.push({ kind: 'wave', id: w.wave || '—', label: w.wave || '—', wave: w }); }
  return sel;
}

// pure: navigation reducer — given current ui, a key, and the selectables list, return the next ui.
// The caller owns clamping intent; this returns a clamped cursor so the renderer never guards bounds.
export function reduceKey(ui, key, selectables) {
  const n = selectables.length;
  const clamp = (i) => n === 0 ? 0 : Math.max(0, Math.min(n - 1, i));
  const cur = clamp(ui.cursor || 0);
  const next = { ...ui, cursor: cur };
  if (n === 0) return next;
  if (key === 'down') return { ...next, cursor: clamp(cur + 1) };
  if (key === 'up') return { ...next, cursor: clamp(cur - 1) };
  if (key === 'tab' || key === 'shiftTab') return { ...next, cursor: sectionJump(selectables, cur, key === 'tab' ? 1 : -1) };
  if (key === 'esc') return { ...next, expanded: null };
  if (key === 'enter') {
    const row = selectables[cur];
    if (row && (row.kind === 'wave' || row.kind === 'stuck')) {
      return { ...next, expanded: ui.expanded === row.id ? null : row.id };
    }
    return next; // session Enter is a side-effect (focus), handled by the caller, not the reducer
  }
  return next;
}

// pure: jump the cursor to the first row of the next/prev non-empty section (wraps). Sections are the
// runs of equal .kind in selectables (ЗАВИСЛО → СЕССИИ → ДОСКА order is already baked into the list).
function sectionJump(selectables, cur, dir) {
  const kinds = [];
  for (const s of selectables) if (!kinds.includes(s.kind)) kinds.push(s.kind);
  if (kinds.length <= 1) return cur;
  const curKind = selectables[cur]?.kind;
  const ki = kinds.indexOf(curKind);
  const targetKind = kinds[(ki + dir + kinds.length) % kinds.length];
  return selectables.findIndex((s) => s.kind === targetKind);
}

export function isStuck(wave, at) {
  // Done waves are NEVER stuck — finished is finished regardless of age.
  if (wave.status === 'done') return false;
  if (!wave.current && wave.progress === 100) return false;
  if (wave.status === 'stuck') return true;
  if ((wave.stages || []).some((s) => s.status === 'failed')) return true;
  if (wave.updatedAt && at) { const age = new Date(at) - new Date(wave.updatedAt); if (!isNaN(age) && age > STUCK_THRESHOLD_MS) return true; }
  return false;
}

export function renderHaltBanner(halt, cols) {
  if (!halt) return [];
  const w = cols - 2; const b = '─'.repeat(w);
  return [
    `┌${b}┐`,
    `│  ${X}! СТОП — пайплайн остановлен${R}${' '.repeat(Math.max(0, w - 32))}│`,
    `│${' '.repeat(w)}│`,
    `│  Что делать: владелец должен дать команду resume${' '.repeat(Math.max(0, w - 50))}│`,
    `│    node .jidoka/scripts/andon-resume.mjs${' '.repeat(Math.max(0, w - 42))}│`,
    `└${b}┘`,
  ];
}

export function renderStuckSection(stuckWaves, at, cols) {
  if (!stuckWaves?.length) return [];
  const lines = [sec(`ЗАВИСЛО (${stuckWaves.length})`, cols)];
  for (const w of stuckWaves) {
    let age = '';
    if (w.updatedAt && at) { const ms = new Date(at) - new Date(w.updatedAt); if (!isNaN(ms) && ms > 0) age = ` — застыло ${dur(ms)}`; }
    lines.push(`  ${X}!${R} ${w.wave || '—'}    ${stageLabel(w)}${age}`);
  }
  return [...lines, hline(cols)];
}

function boardLinear(waves, cols) {
  const lines = [sec('ДОСКА', cols)];
  for (const w of waves) {
    const s = w.status || 'pending', p = w.progress ?? 0;
    lines.push(`${cstat(s)}${ssym(s)}${R} ${pad(w.wave || '—', 22)} ${pad(stageLabel(w), 7)} ${String(p).padStart(3)}%${cols >= 80 ? ' ' + bar(p) : ''}`);
  }
  return [...lines, hline(cols)];
}

function boardKanban(waves, cols, frozen) {
  const buckets = Object.fromEntries(COL_ORDER.map((p) => [p, []]));
  for (const w of waves) { const ph = w.current || 'done'; (buckets[ph] ?? buckets['done']).push(w); }
  const shown = COL_ORDER.filter((p) => CORE.has(p) || buckets[p]?.length > 0);
  const cw = Math.max(9, Math.floor((cols - 2) / shown.length) - 1);
  const lines = [sec(frozen ? 'ДОСКА (заморожена)' : 'ДОСКА', cols), shown.map((p) => pad(STAGE[p] || p.toUpperCase(), cw)).join(' '), shown.map(() => '─'.repeat(cw)).join('  ')];
  const maxR = Math.max(1, ...shown.map((p) => buckets[p].length));
  for (let r = 0; r < maxR; r++) {
    lines.push(shown.map((ph) => { const w = buckets[ph][r]; if (!w) return ' '.repeat(cw); const s = frozen ? 'idle' : (w.status || 'pending'); return `${frozen ? D : cstat(s)}${frozen ? SYM.idle : ssym(s)}${R} ${pad((w.wave || '—').slice(0, cw - 3), cw - 2)}`; }).join(' '));
    if (shown.some((p) => buckets[p][r])) lines.push(shown.map((ph) => { const w = buckets[ph][r]; return pad(w ? `  ${String(w.progress ?? 0).padStart(3)}% ${bar(w.progress ?? 0, 4)}` : '', cw); }).join(' '));
  }
  return [...lines, hline(cols)];
}

export function renderBoard(waves, cols, opts = {}) {
  if (!waves?.length) return [sec('ДОСКА', cols), ''];
  return cols < 100 ? boardLinear(waves, cols) : boardKanban(waves, cols, opts.frozen || false);
}

export function renderTerminals(waves, cols) {
  const wt = (waves || []).filter((w) => w.terminalId);
  if (!wt.length) return [];
  return [sec('ТЕРМИНАЛЫ', cols), ...wt.map((w) => `  ${pad(w.wave || '—', 22)} →  ${w.terminalId}`), hline(cols)];
}

// sessions: [{ state, topic, activity, mtime, sessionId }] — already resolved by caller (no fs here).
// state icons: working=▶ green, waiting=⏳ gold, done=✓ grey.
export function renderSessions(sessions, cols) {
  if (!sessions?.length) return [];
  const SES_ICON = { working: `${G}▶${R}`, waiting: `${A}⏳${R}`, done: `${D}✓${R}` };
  const lines = [sec('СЕССИИ', cols)];
  for (const s of sessions) {
    const icon = SES_ICON[s.state] || `${D}◦${R}`;
    const topic = (s.topic || s.prompt || '').slice(0, 45);
    const act = s.activity ? `  ${D}${s.activity.slice(0, 35)}${R}` : '';
    lines.push(`  ${icon} ${pad(topic, 46)}${act}`);
  }
  return [...lines, hline(cols)];
}

// pure: wrap a rendered row as the SELECTED bar — inverse video over the full padded width PLUS a ▶
// gutter marker replacing the leading 2-space indent. pad/strip discount ANSI so columns stay aligned.
export function markSelected(line, cols) {
  const body = line.startsWith('  ') ? line.slice(2) : line;
  const padded = pad(`▶ ${body}`, cols);
  return `${INV}${padded}${R}`;
}

// pure: the 3-line inline detail block for an expanded wave — phases, last 3 events, owner note.
// All dim (\x1b[90m), indented 4 spaces, non-selectable. Pulled straight from the snapshot the caller
// already holds, so this stays pure.
export function renderWaveDetail(wave) {
  const stages = wave.stages || [];
  const byPhase = Object.fromEntries(stages.map((s) => [s.phase, s.status]));
  const sym = (st) => st === 'done' ? SYM.done : st === 'running' ? SYM.running : (st === 'stuck' || st === 'failed') ? SYM.stuck : SYM.pending;
  const CORE_ORDER = ['discovery', 'spec', 'tests', 'build', 'gate', 'debug', 'memory'];
  const phaseLine = CORE_ORDER.map((p) => `${sym(byPhase[p])}${STAGE[p]}`).join(' ');
  const events = (wave.events || []).slice(0, 3);
  const evLines = events.length
    ? events.map((e) => `    ${D}${(e.ts ? String(e.ts).slice(11, 16) : '—')} · ${(e.who || '—')} · ${(e.what || '')}${R}`)
    : [`    ${D}(событий нет)${R}`];
  const note = wave.note || '—';
  return [
    `    ${D}${phaseLine}${R}`,
    ...evLines,
    `    ${D}заметка: ${note}${R}`,
  ];
}

export function renderActivity(activity, cols) {
  const items = (activity || []).slice(0, 5);
  const lines = [sec('ЛЕНТА (последние действия)', cols)];
  if (!items.length) { lines.push('  (нет записей)'); } else {
    for (const a of items) lines.push(`  ${a.ts ? String(a.ts).slice(11, 16) : '—'}  ${pad(String(a.agent || '—').slice(0, 18), 18)} ${String(a.action || '').slice(0, 30)}${a.label ? '  ' + String(a.label).slice(0, 20) : ''}`);
  }
  return [...lines, hline(cols)];
}

export function renderFooter(cols) { return [hline(cols), `  ${cols >= 100 ? 'q выход · r обновить · ← → проект' : 'q · r · ←→'}`]; }

// ── relocated pure helpers (moved out of tui-top.mjs to free its LOC budget) ──
const SPIN = ['◐', '◓', '◑', '◒'];
// pure: visible liveness + honest data age. The spinner proves the loop is alive even when nothing
// changes; the age says when the SNAPSHOT last actually differed. tui-top imports this back.
export function heartbeatLine(tick, secSinceChange) {
  const age = secSinceChange == null ? '' : secSinceChange < 3 ? ' · данные изменились только что' : ` · данные менялись ${secSinceChange}с назад`;
  return `  ${SPIN[tick % SPIN.length]} live${age}`;
}

// pure: compose raw frame lines into a stdout write with erase sequences. \x1b[K erases to end of line
// after each line, \x1b[J erases below after the last, so no stale content persists between frames.
export function buildRepaintBuffer(lines) {
  return '\x1b[H' + lines.map((l) => l + '\x1b[K').join('\n') + '\n\x1b[J';
}

// pure: the two-line context footer (§6.5). Line 1 = action hint for the row under the cursor (drops
// when nothing is selectable); line 2 = constant key legend. Honest about unreachable windows.
export function renderContextFooter(selectables, ui, cols, halt) {
  const legend = cols >= 100
    ? '  ↑↓ выбор · Tab секция · Enter действие · Esc свернуть · q выход · r обновить · ←→ проект'
    : '  ↑↓ · Tab · Enter · q · r · ←→';
  const lines = [hline(cols)];
  const row = selectables[ui.cursor || 0];
  let hint1 = null;
  if (halt) hint1 = `  ${X}СТОП — пайплайн остановлен; resume: node .jidoka/scripts/andon-resume.mjs${R}`;
  else if (ui.lastHint) hint1 = `  ${A}${ui.lastHint}${R}`;
  else if (row) hint1 = `  ${footerHintFor(row, ui)}`;
  if (hint1 != null) lines.push(cols < 100 ? clip(hint1, cols) : hint1);
  lines.push(legend);
  return lines;
}

// pure: line-1 hint text for one selectable row, per the §6.5 table.
function footerHintFor(row, ui) {
  if (row.kind === 'session') {
    const s = row.session, t = (s.topic || s.prompt || '').slice(0, 40);
    if (s.state === 'done') return `${D}✓ ${t} — сессия завершена${R}`;
    if (!s.terminalId) return `${A}▶ ${t} — это окно нельзя переключить отсюда${R}`;
    return `${G}▶ ${t} — Enter: перейти в это окно${R}`;
  }
  if (row.kind === 'stuck') return `${X}! ${row.label} — застыло, Enter: что случилось${R}`;
  // wave
  const open = ui.expanded === row.id;
  return open ? `${A}▼ ${row.label} — Enter/Esc: свернуть${R}` : `${A}▶ ${row.label} — Enter: показать детали волны${R}`;
}

const clip = (s, cols) => { const v = strip(s); return v.length <= cols - 2 ? s : '  ' + v.slice(0, cols - 3) + '…'; };

export function renderEmpty(snapshot, cols) {
  const lines = ['', '  Нет активных волн.', '', sec('НЕДАВНО ЗАВЕРШИЛИСЬ', cols)];
  const recent = (snapshot.waves || []).filter((w) => !w.current || w.progress === 100).slice(0, 5);
  if (!recent.length) lines.push('  (нет завершённых волн)');
  else for (const w of recent) lines.push(`  ${G}✓${R} ${pad(w.wave || '—', 26)} завершена ${w.updatedAt ? String(w.updatedAt).slice(0, 10) : '—'}  ${w.progress ?? 0}%`);
  return [...lines, hline(cols), sec('КАК ЗАПУСТИТЬ ВОЛНУ', cols), '  Скажи Claude: "запусти dev-pipeline для [название задачи]"', '  или запусти вручную: node .jidoka/scripts/common-launcher.mjs', hline(cols)];
}

function renderHeader(snapshot, at, cols) {
  const h = snapshot.health || {}, lv = h.level || 'unknown';
  const hc = lv === 'green' ? G : lv === 'red' ? X : A;
  const hs = lv === 'green' ? '🟢 GREEN' : lv === 'red' ? '🔴 HALT' : '🟡 AMBER';
  const ev = h.evalPct != null ? `  eval ${h.evalPct}%` : '', br = snapshot.pipeline?.branch || '';
  const ac = (snapshot.waves || []).filter((w) => w.current).length;
  const top = `╔${'═'.repeat(cols - 2)}╗`, bot = `╚${'═'.repeat(cols - 2)}╝`;
  const la = `║  🦞 jidoka  ${hc}${hs}${R}${ev}    ${br ? `[${br}]` : ''}`;
  const lb = `║  ${ac} волн в полёте · обновлено ${at ? String(at).slice(11, 19) : ''}`;
  return [top, la + ' '.repeat(Math.max(0, cols - 1 - strip(la).length)) + '║', lb + ' '.repeat(Math.max(0, cols - 1 - strip(lb).length)) + '║', bot];
}

// ── interactive frame (pure) ───────────────────────────────────────────
// Returns { lines, rows } where rows: Map<screenRow(1-based), selectableIndex> for mouse mapping.
// Same content as renderFrame, plus: the selected row gets the inverse+▶ bar, the expanded wave/stuck
// row gets its 3-line detail block, and the footer becomes the two-line context footer. PURE: all of
// cursor/expanded/scroll come in via `ui`; nothing is read from globals.
export function renderInteractive(snapshot, collectedAt, cols, ui = {}) {
  cols = cols || 80;
  const h = snapshot.health || {}, halt = h.halt === true, waves = snapshot.waves || [];
  const selectables = buildSelectables(snapshot, collectedAt);
  const cursor = selectables.length ? Math.max(0, Math.min(selectables.length - 1, ui.cursor || 0)) : 0;
  const expanded = halt ? null : ui.expanded;       // §6.6: HALT freezes expansion/selection
  const stuck = waves.filter((w) => isStuck(w, collectedAt));
  const rows = new Map();
  const lines = [...renderHeader(snapshot, collectedAt, cols)];
  if (halt) lines.push('', ...renderHaltBanner(halt, cols));

  // helper: push a section header + its selectable rows, mapping each row's screen line → its sel index.
  const pushSection = (header, items, makeLine, sub = 'stuck') => {
    if (!items.length) return;
    lines.push('', header);
    for (const it of items) {
      const idx = selectables.findIndex((s) => s.kind === it.kind && s.id === it.id);
      let line = makeLine(it.payload);
      if (!halt && idx === cursor) line = markSelected(line, cols);
      lines.push(line);
      if (idx >= 0) rows.set(lines.length, idx);   // 1-based screen row = lines.length (0-based + header offset handled by caller)
      if (!halt && expanded != null && it.id === expanded && (sub === 'wave' || sub === 'stuck')) {
        for (const dl of renderWaveDetail(it.payload)) lines.push(dl);
      }
    }
    lines.push(hline(cols));
  };

  // ЗАВИСЛО (stuck)
  pushSection(sec(`ЗАВИСЛО (${stuck.length})`, cols),
    stuck.map((w) => ({ kind: 'stuck', id: w.wave || '—', payload: w })),
    (w) => stuckRowText(w, collectedAt), 'stuck');

  // СЕССИИ
  const sessions = (snapshot.sessions || []);
  pushSection(sec('СЕССИИ', cols),
    sessions.map((s) => ({ kind: 'session', id: s.sessionId, payload: s })),
    (s) => sessionRowText(s), 'session');

  // ДОСКА — linear list of non-stuck waves (interactive path uses the linear layout for a 1:1 row map)
  const stuckIds = new Set(stuck.map((w) => w.wave));
  const boardWaves = waves.filter((w) => !stuckIds.has(w.wave));
  if (!waves.length) { lines.push(...renderEmpty(snapshot, cols)); }
  else pushSection(sec('ДОСКА', cols),
    boardWaves.map((w) => ({ kind: 'wave', id: w.wave || '—', payload: w })),
    (w) => boardRowText(w), 'wave');

  lines.push(...renderContextFooter(selectables, { ...ui, cursor, expanded }, cols, halt));
  return { lines, rows };
}

// pure row-text helpers shared by renderInteractive (mirror the section renderers' row formatting).
function stuckRowText(w, at) {
  let age = '';
  if (w.updatedAt && at) { const ms = new Date(at) - new Date(w.updatedAt); if (!isNaN(ms) && ms > 0) age = ` — застыло ${dur(ms)}`; }
  return `  ${X}!${R} ${w.wave || '—'}    ${stageLabel(w)}${age}`;
}
function sessionRowText(s) {
  const SES_ICON = { working: `${G}▶${R}`, waiting: `${A}⏳${R}`, done: `${D}✓${R}` };
  const icon = SES_ICON[s.state] || `${D}◦${R}`;
  const topic = (s.topic || s.prompt || '').slice(0, 45);
  const act = s.activity ? `  ${D}${s.activity.slice(0, 35)}${R}` : '';
  return `  ${icon} ${pad(topic, 46)}${act}`;
}
function boardRowText(w) {
  const s = w.status || 'pending', p = w.progress ?? 0;
  return `  ${cstat(s)}${ssym(s)}${R} ${pad(w.wave || '—', 22)} ${pad(stageLabel(w), 7)} ${String(p).padStart(3)}%`;
}

export function renderFrame(snapshot, collectedAt, cols, ui = {}) {
  cols = cols || 80;
  const h = snapshot.health || {}, halt = h.halt === true, waves = snapshot.waves || [];
  const stuck = waves.filter((w) => isStuck(w, collectedAt));
  const lines = [...renderHeader(snapshot, collectedAt, cols)];
  if (halt) lines.push('', ...renderHaltBanner(halt, cols));
  if (stuck.length) lines.push('', ...renderStuckSection(stuck, collectedAt, cols));
  if (!waves.length) lines.push(...renderEmpty(snapshot, cols));
  else lines.push('', ...renderBoard(waves, cols, { frozen: halt }));
  lines.push(...renderTerminals(waves, cols), ...renderSessions(snapshot.sessions, cols), ...renderActivity(snapshot.activity, cols), ...renderFooter(cols));
  return lines;
}

export function renderFlat(snapshot, collectedAt) {
  const h = snapshot.health || {}, waves = snapshot.waves || [];
  const lines = [`jidoka-snapshot ${collectedAt || ''}`, `health ${h.level || 'unknown'} eval=${h.evalPct ?? 'n/a'}% halt=${h.halt || false} branch=${snapshot.pipeline?.branch || ''}`, `waves ${waves.filter((w) => w.current).length} inflight`, ''];
  for (const w of waves) lines.push(`WAVE ${w.wave} stage=${stageLabel(w)} progress=${w.progress ?? 0}% status=${w.status || (w.current ? 'running' : 'done')}${w.terminalId ? ` terminal=${w.terminalId}` : ''}`);
  const sw = waves.filter((w) => w.status === 'stuck');
  if (sw.length) { lines.push(''); for (const w of sw) lines.push(`STUCK ${w.wave} stage=${stageLabel(w)}`); }
  const ses = (snapshot.sessions || []);
  if (ses.length) { lines.push(''); for (const s of ses) lines.push(`SESSION ${s.state || 'unknown'} topic=${String(s.topic || s.prompt || '').slice(0, 45)}${s.activity ? ` activity=${s.activity.slice(0, 35)}` : ''}`); }
  const act = (snapshot.activity || []).slice(0, 5);
  if (act.length) { lines.push(''); for (const a of act) lines.push(`ACTIVITY ${a.ts ? String(a.ts).slice(11, 16) : '—'} ${a.agent || '—'} action=${a.action || ''}`); }
  return lines;
}

// ── self-test ──────────────────────────────────────────────────────────
async function selfTest() {
  const fails = []; const ok = (n, c, d = '') => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}${d ? `  (${d})` : ''}`); };
  const AT = '2026-06-06T14:00:00Z', C = 120;
  const mw = (o = {}) => ({ wave: 'wave-x', current: 'build', status: 'running', live: true, progress: 50, terminalId: null, updatedAt: AT, task: {}, stages: [{ phase: 'build', status: 'running' }], ...o });
  const ms = (o = {}) => ({ pipeline: mw(), waves: [mw()], board: { columns: [], waveCount: 0 }, tasks: [], health: { level: 'green', evalPct: 100, recentFails: 0, halt: false }, activity: [], lessons: [], timeline: [], ...o });

  const n = renderFrame(ms(), AT, C);
  ok('state1: string[]', Array.isArray(n) && n.every((l) => typeof l === 'string'), `len=${n.length}`);
  ok('state1: header present', n.some((l) => l.includes('jidoka')));

  const hl = renderFrame(ms({ health: { level: 'red', evalPct: 0, recentFails: 1, halt: true } }), AT, C);
  const bi = hl.findIndex((l) => l.includes('СТОП')), di = hl.findIndex((l) => l.includes('ДОСКА'));
  ok('state2: СТОП banner present', bi !== -1, `idx=${bi}`);
  ok('state2: banner before board', di === -1 || bi < di, `banner@${bi} board@${di}`);

  const el = renderFrame(ms({ waves: [], pipeline: mw({ wave: null, current: null }) }), AT, C).join('\n');
  ok('state3: Нет активных волн', el.includes('Нет активных волн'));
  ok('state3: НЕДАВНО ЗАВЕРШИЛИСЬ', el.includes('НЕДАВНО ЗАВЕРШИЛИСЬ'));

  const ml = renderFrame(ms({ pipeline: { ...mw(), branch: 'main' } }), AT, C);
  ok('state4: header renders', ml.length > 0 && ml[0].includes('╔'));

  const nw = renderFrame(ms(), AT, 80), ww = renderFrame(ms(), AT, C);
  ok('state5: narrow array', Array.isArray(nw));
  ok('state5: differs from wide', nw.join('\n') !== ww.join('\n'));
  ok('state5: progress % in narrow', nw.some((l) => /50\s*%/.test(l)));

  const sw = mw({ wave: 'wave-s', status: 'stuck' });
  const sl = renderFrame(ms({ waves: [sw], pipeline: sw }), AT, C);
  const zi = sl.findIndex((l) => l.includes('ЗАВИСЛО')), brd = sl.findIndex((l) => l.includes('ДОСКА'));
  ok('state6: ЗАВИСЛО present', zi !== -1, `idx=${zi}`);
  ok('state6: ЗАВИСЛО before board', brd === -1 || zi < brd, `z@${zi} b@${brd}`);

  const tw = mw({ wave: 'wave-t', terminalId: 'tmux:j/2' });
  const tl = renderFrame(ms({ waves: [tw] }), AT, C);
  ok('terminals: section present', tl.some((l) => l.includes('ТЕРМИНАЛЫ')));
  ok('terminals: terminalId in output', tl.some((l) => l.includes('tmux:j/2')));

  const fl = renderFlat(ms(), AT);
  ok('flat: string[]', Array.isArray(fl));
  ok('flat: no ANSI', fl.every((l) => !l.includes('\x1b')));
  ok('flat: WAVE entry', fl.some((l) => l.startsWith('WAVE')));

  // wave-tui-live: done-wave not stuck
  const doneWave = mw({ status: 'done', current: null, progress: 100, updatedAt: '2026-06-02T00:00:00Z',
    stages: [{ phase: 'build', status: 'done' }, { phase: 'gate', status: 'done' }] });
  ok('done-wave: not stuck even after 100h', !isStuck(doneWave, AT));
  const runningOld = mw({ status: 'running', current: 'gate', updatedAt: '2026-06-02T00:00:00Z' });
  ok('running-wave old: IS stuck', isStuck(runningOld, AT));

  // wave-tui-live: renderSessions
  const ses2 = [
    { state: 'working', topic: 'build the auth feature', activity: 'running tests', mtime: 0, sessionId: 'a' },
    { state: 'waiting', topic: 'fix the login bug', activity: '', mtime: 0, sessionId: 'b' },
  ];
  const sl2 = renderSessions(ses2, C);
  ok('sessions: section header', sl2.some((l) => l.includes('СЕССИИ')));
  ok('sessions: ▶ for working', sl2.some((l) => l.includes('▶')));
  ok('sessions: ⏳ for waiting', sl2.some((l) => l.includes('⏳')));
  ok('sessions: both topics', sl2.some((l) => l.includes('build the auth')) && sl2.some((l) => l.includes('fix the login')));
  ok('sessions: empty → no output', renderSessions([], C).length === 0);
  ok('sessions: null → no output', renderSessions(null, C).length === 0);
  const slDone = renderSessions([{ state: 'done', topic: 'deploy prod', activity: '', mtime: 0, sessionId: 'c' }], C);
  ok('sessions: ✓ for done', slDone.some((l) => l.includes('✓')));

  // renderFrame includes sessions when snapshot.sessions present
  const sfSnap = ms({ sessions: ses2 });
  const sfLines = renderFrame(sfSnap, AT, C);
  ok('frame: СЕССИИ when sessions in snapshot', sfLines.some((l) => l.includes('СЕССИИ')));

  // renderFlat includes SESSION lines
  const ffSnap = ms({ sessions: [{ state: 'working', topic: 'flat-test-topic', activity: 'doing', mtime: 0, sessionId: 'x' }] });
  const ffLines = renderFlat(ffSnap, AT);
  ok('flat: SESSION entry', ffLines.some((l) => l.startsWith('SESSION')));
  ok('flat: SESSION no ANSI', ffLines.every((l) => !l.includes('\x1b')));

  // ── wave-tui-interactive ────────────────────────────────────────────
  // parseMouse
  const mp = parseMouse('\x1b[<0;5;12M');
  ok('mouse: press parsed', mp && mp.button === 0 && mp.col === 5 && mp.row === 12 && mp.press === true);
  ok('mouse: release press=false', parseMouse('\x1b[<0;5;12m')?.press === false);
  ok('mouse: non-mouse → null', parseMouse('hello') === null);
  ok('mouse: wheel-up button 64', parseMouse('\x1b[<64;1;1M')?.button === 64);

  // interactive fixture: stuck + 2 sessions + 1 wave
  const detW = mw({ wave: 'wave-detail', current: 'tests', status: 'running', progress: 30,
    stages: [{ phase: 'discovery', status: 'done' }, { phase: 'spec', status: 'done' },
      { phase: 'tests', status: 'running', current: true }, { phase: 'build', status: 'pending' },
      { phase: 'gate', status: 'pending' }, { phase: 'debug', status: 'pending' }, { phase: 'memory', status: 'pending' }],
    events: [{ ts: '2026-06-06T13:59:00Z', who: 'tester', what: 'тесты написаны' },
      { ts: '2026-06-06T13:58:00Z', who: 'arch', what: 'спека готова' }],
    note: 'жду ревью' });
  const isnap = ms({ waves: [detW], pipeline: detW, sessions: ses2 });

  // buildSelectables order: stuck → sessions → waves
  const sels = buildSelectables(isnap, AT);
  ok('selectables: includes 2 sessions', sels.filter((s) => s.kind === 'session').length === 2);
  ok('selectables: includes wave-detail', sels.some((s) => s.kind === 'wave' && s.id === 'wave-detail'));
  ok('selectables: sessions before waves', sels.findIndex((s) => s.kind === 'session') < sels.findIndex((s) => s.kind === 'wave'));

  // IAC-1: selected row → one inverse bar + ▶ marker
  const i0 = renderInteractive(isnap, AT, C, { cursor: 0 });
  const invLines = i0.lines.filter((l) => l.includes(INV));
  ok('interactive: exactly one inverse-selected row', invLines.length === 1, `count=${invLines.length}`);
  ok('interactive: selected row has ▶ marker', invLines[0]?.includes('▶'));
  ok('interactive: returns rows map', i0.rows instanceof Map && i0.rows.size > 0);
  ok('interactive: rows map contains index 0', [...i0.rows.values()].includes(0));

  // IAC-3: drill-down expand → 7 stage labels + event, dim; collapse removes
  const wIdx = sels.findIndex((s) => s.kind === 'wave' && s.id === 'wave-detail');
  const iExp = renderInteractive(isnap, AT, C, { cursor: wIdx, expanded: 'wave-detail' });
  const etxt = iExp.lines.join('\n');
  ok('drilldown: all 7 stage labels', ['ПОИСК', 'СПЕК', 'ТЕСТЫ', 'СБОРКА', 'ГЕЙТ', 'ДЕБАГ', 'ПАМЯТЬ'].every((s) => etxt.includes(s)));
  ok('drilldown: recent event text', etxt.includes('тесты написаны'));
  ok('drilldown: detail line is dim', iExp.lines.find((l) => l.includes('тесты написаны'))?.includes(D));
  ok('drilldown: note shown', etxt.includes('жду ревью'));
  const iCol = renderInteractive(isnap, AT, C, { cursor: wIdx, expanded: null });
  ok('drilldown: collapse removes block', !iCol.lines.join('\n').includes('тесты написаны'));

  // reduceKey navigation
  ok('reduceKey: down increments cursor', reduceKey({ cursor: 0 }, 'down', sels).cursor === 1);
  ok('reduceKey: up clamps at 0', reduceKey({ cursor: 0 }, 'up', sels).cursor === 0);
  ok('reduceKey: down clamps at end', reduceKey({ cursor: sels.length - 1 }, 'down', sels).cursor === sels.length - 1);
  ok('reduceKey: enter on wave toggles expand', reduceKey({ cursor: wIdx, expanded: null }, 'enter', sels).expanded === 'wave-detail');
  ok('reduceKey: enter on expanded wave collapses', reduceKey({ cursor: wIdx, expanded: 'wave-detail' }, 'enter', sels).expanded === null);
  ok('reduceKey: esc collapses', reduceKey({ cursor: 0, expanded: 'wave-detail' }, 'esc', sels).expanded === null);
  ok('reduceKey: enter on session is no-op (focus is caller side-effect)', reduceKey({ cursor: sels.findIndex((s) => s.kind === 'session'), expanded: null }, 'enter', sels).expanded == null);
  ok('reduceKey: empty selectables → cursor 0, no throw', reduceKey({ cursor: 5 }, 'down', []).cursor === 0);
  // Tab jumps between sections (session → wave)
  const sIdx = sels.findIndex((s) => s.kind === 'session');
  ok('reduceKey: Tab jumps to next section', sels[reduceKey({ cursor: sIdx }, 'tab', sels).cursor].kind !== 'session');

  // IAC-2: renderFrame backward-compat — no-ui vs empty-ui byte-identical, no inverse bar
  const bcA = renderFrame(isnap, AT, C);
  const bcB = renderFrame(isnap, AT, C, {});
  ok('compat: renderFrame ui-less == empty-ui', bcA.join('\n') === bcB.join('\n'));
  ok('compat: renderFrame has no inverse bar', !bcA.some((l) => l.includes(INV)));

  // HALT freezes interaction: no inverse marker even with a cursor
  const haltSnap = ms({ waves: [detW], pipeline: detW, sessions: ses2, health: { level: 'red', evalPct: 0, recentFails: 1, halt: true } });
  const iHalt = renderInteractive(haltSnap, AT, C, { cursor: 0, expanded: 'wave-detail' });
  ok('halt: no inverse selection bar', !iHalt.lines.some((l) => l.includes(INV)));
  ok('halt: no detail block while stopped', !iHalt.lines.join('\n').includes('тесты написаны'));

  // relocated helpers still work
  ok('heartbeat: spinner rotates', heartbeatLine(0, 10) !== heartbeatLine(1, 10) && heartbeatLine(0, 10) === heartbeatLine(4, 10));
  ok('repaint: \\x1b[K + \\x1b[J', buildRepaintBuffer(['a']).includes('a\x1b[K') && buildRepaintBuffer(['a']).endsWith('\x1b[J'));

  const { readFileSync: rfs } = await import('node:fs');
  const src = rfs(new URL(import.meta.url).pathname, 'utf8');
  const stL = src.split('\n').findIndex((l) => /^async function selfTest/.test(l));
  const code = src.split('\n').slice(0, stL).filter((l) => !l.trimStart().startsWith('//')).join('\n');
  ok('pure: no Date.now()', !code.includes('Date.now('));
  ok('pure: no process.stdout', !code.includes('process.stdout'));
  ok('pure: no readFileSync', !code.includes('readFileSync') && !code.includes('readFile('));

  if (fails.length) { console.log(`\n\x1b[31mFAIL (${fails.length}): ${fails.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ tui-render: screen states + sessions + done-wave correct\x1b[0m'); process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--self-test')) selfTest();
