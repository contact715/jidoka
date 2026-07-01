#!/usr/bin/env node
// tui-control.mjs — PURE key state machine + overlay renderer for the jidoka top control panel.
// CONTRACT: like tui-render.mjs — no fs, no Date.now(), no process.stdout. ≤400 LOC.
//
// reduce(ui, key, ctx) → { ui, effects[] }   — the panel's brain (wave-tui-control spec)
//   ctx = { waves: snapshot.waves, halt: boolean }   (plain data, supplied by the shell)
//   effects: {type:'quit'|'refresh'} | {type:'resumeHalt',wave,reason}
//          | {type:'advance',wave,phase,status,note} | {type:'openTerminal',command}
//          | {type:'loadLog'} | {type:'loadCost'} | {type:'focusSession',terminalId,topic}
// renderOverlay(ui, cols) → string[]  — confirm / input / log / cost boxes + status msg.
//
// Side effects live in tui-actions.mjs; stdin/stdout wiring lives in tui-top.mjs.

import { needsYouSessions } from './tui-render.mjs';   // shared "waiting on the owner" predicate (pure)

const R = '\x1b[0m', G = '\x1b[32m', A = '\x1b[33m', X = '\x1b[31m', D = '\x1b[90m', I = '\x1b[7m';
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

export function initialUi() {
  return { mode: 'board', sel: 0, selId: null, msg: '', confirm: null, input: null, log: null, logScroll: 0, cost: null };
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// BUG-1: the board re-sorts live — selection follows the WAVE ID; the row index is only
// a fallback for when the selected wave vanished from the snapshot.
const selIndex = (ui, waves) => {
  const byId = ui.selId ? waves.findIndex((w) => w.wave === ui.selId) : -1;
  return byId !== -1 ? byId : clamp(ui.sel, 0, Math.max(0, waves.length - 1));
};
const selWave = (ui, ctx) => (ctx.waves || [])[selIndex(ui, ctx.waves || [])] || null;

// re-run target: the first FAILED phase, else the current phase (AC-3).
export function rerunTarget(wave) {
  if (!wave) return null;
  const failed = (wave.stages || []).find((s) => s.status === 'failed');
  if (failed) return failed.phase;
  return wave.current || null;
}

function boardKey(ui, key, ctx) {
  const waves = ctx.waves || [];
  const u = { ...ui, msg: '' };
  const move = (d) => { const i = clamp(selIndex(ui, waves) + d, 0, Math.max(0, waves.length - 1)); return { ui: { ...u, sel: i, selId: waves[i]?.wave ?? null }, effects: [] }; };
  if (key === '\x1b[A' || key === 'k') return move(-1);
  if (key === '\x1b[B' || key === 'j') return move(+1);
  if (key === 'q' || key === '\x03') return { ui: u, effects: [{ type: 'quit' }] };
  if (key === 'r') return { ui: u, effects: [{ type: 'refresh' }] };
  if (key === '\r' || key === '\n') {
    const w = selWave(ui, ctx);
    if (!w) return { ui: { ...u, msg: 'нет волн на доске' }, effects: [] };
    return { ui: { ...u, msg: `открываю терминал: продолжить ${w.wave}` }, effects: [{ type: 'openTerminal', command: `claude "/jidoka-resume ${w.wave}"` }] };
  }
  if (key === 'n') return { ui: { ...u, mode: 'input', input: { label: 'Новая волна — опиши задачу (Enter — запустить, Esc — отмена)', value: '', action: 'newWave' } }, effects: [] };
  if (key === 's') {
    if (!ctx.halt) return { ui: { ...u, msg: 'СТОП не активен — снимать нечего' }, effects: [] };
    const w = selWave(ui, ctx);
    return { ui: { ...u, mode: 'input', input: { label: 'Причина снятия СТОП (попадёт в журнал; Esc — отмена)', value: '', action: 'resumeHalt', wave: w?.wave || null } }, effects: [] };
  }
  if (key === 'g') {
    const w = selWave(ui, ctx);
    const phase = rerunTarget(w);
    if (!w || !phase) return { ui: { ...u, msg: 'нет этапа для перезапуска' }, effects: [] };
    return { ui: { ...u, mode: 'confirm', confirm: { text: `Перезапустить этап «${phase}» волны ${w.wave}? (пометится pending, продолжение — Enter на волне)`, action: 'rerun', wave: w.wave, phase } }, effects: [] };
  }
  if (key === 'p') {
    const w = selWave(ui, ctx);
    const phase = w?.current || null;
    if (!w || !phase) return { ui: { ...u, msg: 'нет текущего этапа — пропускать нечего' }, effects: [] };
    return { ui: { ...u, mode: 'confirm', confirm: { text: `Пропустить этап «${phase}» волны ${w.wave}? (пометится done с пометкой skip)`, action: 'skip', wave: w.wave, phase } }, effects: [] };
  }
  if (key === 'l') return { ui: { ...u, mode: 'log', logScroll: 0 }, effects: [{ type: 'loadLog' }] };
  if (key === '$' || key === 'm') return { ui: { ...u, mode: 'cost' }, effects: [{ type: 'loadCost' }] };
  if (key === 'f') {
    // jump to the session waiting on the owner (first needs-you row); the action layer focuses its
    // recorded terminal via focus.mjs, or prints an honest hint when that window can't be switched.
    const ny = needsYouSessions(ctx.sessions);
    if (!ny.length) return { ui: { ...u, msg: 'нет сессий, ждущих ответа' }, effects: [] };
    const t = ny[0];
    return { ui: { ...u, msg: `перехожу к сессии: ${(t.topic || t.prompt || 'сессия').slice(0, 40)}` },
      effects: [{ type: 'focusSession', terminalId: t.terminalId || null, topic: t.topic || t.prompt || '' }] };
  }
  if (key === '?' || key === 'h') return { ui: { ...u, mode: 'help' }, effects: [] };
  return { ui, effects: [] };
}

// the full operator legend, in plain language — opened with ? right inside the panel
export const HELP_LINES = [
  '↑↓     выбрать волну на доске (выбранная помечена ▶)',
  'Enter  продолжить выбранную волну — откроется вкладка терминала с готовой командой',
  'n      новая волна: напиши задачу, Enter — откроется терминал с запуском',
  's      снять СТОП: панель спросит причину (попадёт в журнал) и снимет остановку',
  'g      перезапустить упавший этап выбранной волны',
  'p      пропустить застрявший этап (с пометкой, кто и что пропустил)',
  'l      живой лог: последние реплики агента, не выходя из панели',
  '$      деньги и время: сколько волна шла, сколько токенов съела, во что ≈обходится',
  'f      перейти к сессии, которая ждёт твоего ответа (прыжок в её окно терминала)',
  'r      обновить · q выход · Esc закрыть это окно',
];

function confirmKey(ui, key) {
  const c = ui.confirm;
  if (key === 'y' || key === '\r' || key === '\n') {
    const eff = c.action === 'rerun'
      ? { type: 'advance', wave: c.wave, phase: c.phase, status: 'pending', note: 're-run by operator (tui)' }
      : { type: 'advance', wave: c.wave, phase: c.phase, status: 'done', note: 'skipped by operator (tui)' };
    return { ui: { ...ui, mode: 'board', confirm: null, msg: c.action === 'rerun' ? `этап ${c.phase} → pending` : `этап ${c.phase} пропущен` }, effects: [eff] };
  }
  if (key === 'n' || key === '\x1b' || key === 'q') return { ui: { ...ui, mode: 'board', confirm: null, msg: 'отменено' }, effects: [] };
  return { ui, effects: [] };
}

function inputKey(ui, key) {
  const inp = ui.input;
  if (key === '\x1b') return { ui: { ...ui, mode: 'board', input: null, msg: 'отменено' }, effects: [] };
  if (key === '\r' || key === '\n') {
    const v = inp.value.trim();
    if (!v) return { ui: { ...ui, mode: 'board', input: null, msg: 'пустой ввод — отменено' }, effects: [] };
    if (inp.action === 'newWave') {
      return { ui: { ...ui, mode: 'board', input: null, msg: 'открываю терминал: новая волна' }, effects: [{ type: 'openTerminal', command: `claude "/jidoka-plan ${v.replace(/"/g, "'")}"` }] };
    }
    // BUG-3: andon-resume rejects reason/root-cause under 10 chars — catch it HERE with a
    // human message instead of a shell error after the fact
    if (v.length < 10) {
      return { ui: { ...ui, input: { ...inp, label: 'Причина слишком короткая — журнал разбора требует минимум 10 символов. Допиши (Esc — отмена)' } }, effects: [] };
    }
    return { ui: { ...ui, mode: 'board', input: null, msg: 'СТОП: снимаю…' }, effects: [{ type: 'resumeHalt', wave: inp.wave, reason: v }] };
  }
  if (key === '\x7f' || key === '\b') return { ui: { ...ui, input: { ...inp, value: inp.value.slice(0, -1) } }, effects: [] };
  // printable chunk (paste-friendly): keep chars ≥ space, drop escape sequences / control chars
  if (!key.startsWith('\x1b')) {
    const printable = [...key].filter((ch) => ch >= ' ').join('');
    if (printable) return { ui: { ...ui, input: { ...inp, value: (inp.value + printable).slice(0, 160) } }, effects: [] };
  }
  return { ui, effects: [] };
}

function viewKey(ui, key) {
  if (key === '\x1b[A' && ui.mode === 'log') return { ui: { ...ui, logScroll: ui.logScroll + 5 }, effects: [] };
  if (key === '\x1b[B' && ui.mode === 'log') return { ui: { ...ui, logScroll: Math.max(0, ui.logScroll - 5) }, effects: [] };
  if (key === 'q' || key === '\x1b' || key === '\r' || key === '\n') return { ui: { ...ui, mode: 'board', msg: '' }, effects: [] };
  if (key === '\x03') return { ui, effects: [{ type: 'quit' }] };
  return { ui, effects: [] };
}

export function reduce(ui, key, ctx = {}) {
  if (ui.mode === 'confirm') return confirmKey(ui, key);
  if (ui.mode === 'input') return inputKey(ui, key);
  if (ui.mode === 'log' || ui.mode === 'cost' || ui.mode === 'help') return viewKey(ui, key);
  return boardKey(ui, key, ctx);
}

// ── overlays (pure render) ────────────────────────────────────────────────
function box(title, body, cols, color = A) {
  const w = Math.min(cols - 2, Math.max(40, ...[title, ...body].map((l) => strip(l).length + 6)));
  const pad = (s) => `│ ${s}${' '.repeat(Math.max(0, w - 3 - strip(s).length))}│`;
  return [`${color}┌─ ${title} ${'─'.repeat(Math.max(0, w - 5 - strip(title).length))}┐${R}`,
    ...body.map((l) => `${color}${pad(l)}${R}`),
    `${color}└${'─'.repeat(w - 1)}┘${R}`];
}

export function renderOverlay(ui, cols) {
  const lines = [];
  if (ui.msg) lines.push(`  ${A}» ${ui.msg}${R}`);
  if (ui.mode === 'confirm' && ui.confirm) lines.push(...box('ПОДТВЕРДИ', [ui.confirm.text, '', `${G}y/Enter${R} — да    ${X}n/Esc${R} — нет`], cols));
  if (ui.mode === 'input' && ui.input) lines.push(...box('ВВОД', [ui.input.label, '', `> ${ui.input.value}${I} ${R}`], cols));
  if (ui.mode === 'log') {
    const all = ui.log || ['(лог пока пуст — нет транскриптов проекта)'];
    const page = all.slice(Math.max(0, all.length - 14 - ui.logScroll), Math.max(14, all.length - ui.logScroll));
    lines.push(...box('ЖИВОЙ ЛОГ (последние реплики · ↑↓ листать · Esc назад)', page.length ? page : ['(пусто)'], cols, D));
  }
  if (ui.mode === 'help') lines.push(...box('ПОМОЩЬ — что умеет панель', HELP_LINES, cols, G));
  if (ui.mode === 'cost') {
    const rows = (ui.cost || []).map((c) => `${(c.wave || '—').slice(0, 26).padEnd(28)}${String(c.durMin != null ? fmtDur(c.durMin) : '—').padStart(8)}${String(c.tokens != null ? fmtTok(c.tokens) : '—').padStart(10)}${String(c.usd != null ? '≈$' + c.usd.toFixed(2) : '—').padStart(9)}`);
    lines.push(...box('ДЕНЬГИ И ВРЕМЯ (≈ оценка по транскриптам · Esc назад)',
      [`${'волна'.padEnd(28)}${'время'.padStart(8)}${'токены'.padStart(10)}${'цена'.padStart(9)}`, ...(rows.length ? rows : ['(нет данных)'])], cols, D));
  }
  return lines;
}

export const fmtDur = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h > 0 ? `${h}ч ${m}м` : `${m}м`; };
export const fmtTok = (t) => t >= 1e6 ? (t / 1e6).toFixed(1) + 'M' : t >= 1e3 ? Math.round(t / 1e3) + 'k' : String(t);

// ── self-test ─────────────────────────────────────────────────────────────
function selfTest() {
  const fails = []; const ok = (n, c, d = '') => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}${d ? `  (${d})` : ''}`); };
  const W = (o = {}) => ({ wave: 'wave-a', current: 'gate', status: 'running', progress: 50, stages: [{ phase: 'build', status: 'done' }, { phase: 'gate', status: 'running' }], ...o });
  const ctx = { waves: [W(), W({ wave: 'wave-b', current: 'build' })], halt: false };

  // AC-1 selection
  let st = initialUi();
  st = reduce(st, '\x1b[B', ctx).ui;
  ok('AC-1: ↓ moves selection', st.sel === 1);
  st = reduce(st, '\x1b[B', ctx).ui;
  ok('AC-1: selection clamps at bottom', st.sel === 1);
  st = reduce(st, '\x1b[A', ctx).ui;
  ok('AC-1: ↑ moves selection back', st.sel === 0);

  // AC-2 resume halt via input
  let r = reduce(initialUi(), 's', { ...ctx, halt: true });
  ok('AC-2: s enters input mode when halted', r.ui.mode === 'input' && r.ui.input.action === 'resumeHalt');
  r = reduce(r.ui, 'x', ctx); r = reduce(r.ui, 'y', ctx);
  ok('AC-2: typing accumulates', r.ui.input.value === 'xy');
  r = reduce(r.ui, '\x7f', ctx);
  ok('AC-2: backspace deletes', r.ui.input.value === 'x');
  for (const ch of ' — починили гейт') r = reduce(r.ui, ch, ctx); // дотягиваем до ≥10 символов (правило журнала)
  r = reduce(r.ui, '\r', ctx);
  ok('AC-2: Enter yields resumeHalt effect with reason', r.effects.length === 1 && r.effects[0].type === 'resumeHalt' && r.effects[0].reason.startsWith('x'));
  let r2 = reduce(initialUi(), 's', { ...ctx, halt: true }); r2 = reduce(r2.ui, '\x1b', ctx);
  ok('AC-2: Esc cancels with no effect', r2.effects.length === 0 && r2.ui.mode === 'board');
  ok('AC-2: s without halt → message, no input', reduce(initialUi(), 's', ctx).ui.mode === 'board');

  // AC-3 re-run targets failed phase first
  const failedW = W({ stages: [{ phase: 'tests', status: 'failed' }, { phase: 'gate', status: 'running' }] });
  ok('AC-3: rerunTarget picks failed phase', rerunTarget(failedW) === 'tests');
  ok('AC-3: rerunTarget falls back to current', rerunTarget(W()) === 'gate');
  let g = reduce(initialUi(), 'g', { waves: [failedW], halt: false });
  ok('AC-3: g opens confirm for failed phase', g.ui.mode === 'confirm' && g.ui.confirm.phase === 'tests');
  g = reduce(g.ui, 'y', ctx);
  ok('AC-3: confirm yields advance pending', g.effects[0]?.type === 'advance' && g.effects[0].status === 'pending' && g.effects[0].phase === 'tests');

  // AC-4 skip current phase
  let p = reduce(initialUi(), 'p', ctx);
  ok('AC-4: p opens confirm for current phase', p.ui.mode === 'confirm' && p.ui.confirm.phase === 'gate');
  const pd = reduce(p.ui, 'n', ctx);
  ok('AC-4: declined confirm → no effect', pd.effects.length === 0 && pd.ui.mode === 'board');
  const py = reduce(p.ui, '\r', ctx);
  ok('AC-4: confirmed skip → advance done + skip note', py.effects[0]?.status === 'done' && py.effects[0].note.includes('skip'));

  // AC-5 new wave + resume wave open terminals
  let nv = reduce(initialUi(), 'n', ctx);
  for (const ch of 'fix auth') nv = reduce(nv.ui, ch, ctx);
  nv = reduce(nv.ui, '\r', ctx);
  ok('AC-5: new wave → openTerminal with /jidoka-plan + text', nv.effects[0]?.type === 'openTerminal' && nv.effects[0].command.includes('/jidoka-plan fix auth'));
  const en = reduce(initialUi(), '\r', ctx);
  ok('AC-5: Enter on wave → openTerminal /jidoka-resume', en.effects[0]?.type === 'openTerminal' && en.effects[0].command.includes('/jidoka-resume wave-a'));

  // AC-11 empty board: keys are safe no-ops
  const empty = { waves: [], halt: false };
  ok('AC-11: Enter on empty board safe', reduce(initialUi(), '\r', empty).effects.length === 0);
  ok('AC-11: g on empty board safe', reduce(initialUi(), 'g', empty).ui.mode === 'board');
  ok('AC-11: p on empty board safe', reduce(initialUi(), 'p', empty).ui.mode === 'board');

  // overlays
  const ov = renderOverlay({ ...initialUi(), mode: 'confirm', confirm: { text: 'Q?', action: 'skip', wave: 'w', phase: 'x' } }, 100);
  ok('overlay: confirm box renders', ov.some((l) => l.includes('ПОДТВЕРДИ')) && ov.some((l) => l.includes('Q?')));
  const oi = renderOverlay({ ...initialUi(), mode: 'input', input: { label: 'L', value: 'abc', action: 'newWave' } }, 100);
  ok('overlay: input box shows value', oi.some((l) => l.includes('> abc')));
  const oc = renderOverlay({ ...initialUi(), mode: 'cost', cost: [{ wave: 'w-1', durMin: 75, tokens: 1500000, usd: 3.21 }] }, 100);
  ok('overlay: cost row renders ≈$', oc.some((l) => l.includes('≈$3.21') && l.includes('1ч 15м') && l.includes('1.5M')));
  ok('overlay: msg line renders', renderOverlay({ ...initialUi(), msg: 'hi' }, 80)[0].includes('hi'));
  ok('overlay: board+no msg → empty', renderOverlay(initialUi(), 80).length === 0);

  // BUG-1 (2026-06-06 hunt): the board re-sorts every second — selection must follow the
  // WAVE ID, not the row number, or p/g/Enter hit the WRONG wave mid-reorder
  let s1 = reduce(initialUi(), '\x1b[B', ctx); // move onto wave-b (row 1)
  ok('bug-1: selection records the wave id', s1.ui.selId === 'wave-b');
  const reordered = { waves: [W({ wave: 'wave-b', current: 'build' }), W()], halt: false }; // wave-b jumped to row 0
  const p1 = reduce(s1.ui, 'p', reordered);
  ok('bug-1: action targets the selected WAVE after reorder', p1.ui.confirm?.wave === 'wave-b' && p1.ui.confirm?.phase === 'build');
  const s2 = reduce(s1.ui, '\x1b[B', reordered); // from wave-b (now row 0) down → wave-a
  ok('bug-1: arrows continue from the wave\'s NEW position', s2.ui.selId === 'wave-a');
  const en1 = reduce(s1.ui, '\r', reordered);
  ok('bug-1: Enter resumes the selected wave, not the row', en1.effects[0]?.command.includes('wave-b'));
  ok('bug-1: vanished selection falls back to a safe row', reduce(s1.ui, 'p', { waves: [W()], halt: false }).ui.confirm?.wave === 'wave-a');

  // BUG-3: andon-resume validates reason/root-cause at MIN 10 chars — the panel must
  // catch a short reason BEFORE shelling out, with a clear message
  let rh = reduce(initialUi(), 's', { ...ctx, halt: true });
  for (const ch of 'мало') rh = reduce(rh.ui, ch, ctx);
  rh = reduce(rh.ui, '\r', ctx);
  ok('bug-3: short СТОП reason rejected in the panel', rh.effects.length === 0 && rh.ui.mode === 'input');
  ok('bug-3: rejection explains the 10-char rule', (rh.ui.input.label || '').includes('10'));
  let rh2 = { ui: rh.ui, effects: [] };
  for (const ch of ' договорились с владельцем') rh2 = reduce(rh2.ui, ch, ctx);
  rh2 = reduce(rh2.ui, '\r', ctx);
  ok('bug-3: long reason passes through', rh2.effects[0]?.type === 'resumeHalt' && rh2.effects[0].reason.length >= 10);

  // help: ? opens the in-panel legend, Esc closes, full wording present
  let hp = reduce(initialUi(), '?', ctx);
  ok('help: ? opens help mode', hp.ui.mode === 'help' && hp.effects.length === 0);
  const hov = renderOverlay(hp.ui, 120);
  ok('help: overlay titled ПОМОЩЬ', hov.some((l) => l.includes('ПОМОЩЬ')));
  ok('help: legend covers all controls', ['снять СТОП', 'живой лог', 'деньги и время', 'новая волна', 'перезапустить', 'пропустить'].every((t) => hov.some((l) => l.includes(t))));
  hp = reduce(hp.ui, '\x1b', ctx);
  ok('help: Esc returns to board', hp.ui.mode === 'board');

  // ported: f jumps to the session waiting on the owner → focusSession effect with its terminalId
  const fCtx = { ...ctx, sessions: [
    { state: 'working', topic: 'идёт сборка', sessionId: 'a' },
    { state: 'waiting', topic: 'нужен код из Telegram', terminalId: 'tty:/dev/ttys017', sessionId: 'b' },
  ] };
  const f1 = reduce(initialUi(), 'f', fCtx);
  ok('f: emits focusSession for the waiting session', f1.effects[0]?.type === 'focusSession' && f1.effects[0].terminalId === 'tty:/dev/ttys017');
  ok('f: carries the session topic + status msg', f1.effects[0]?.topic.includes('код') && f1.ui.msg.includes('перехожу'));
  const f2 = reduce(initialUi(), 'f', { ...ctx, sessions: [{ state: 'working', topic: 'работаю', question: 'Подтвердить деплой?', terminalId: 'tmux:%2' }] });
  ok('f: a question (not just waiting) also counts as needs-you', f2.effects[0]?.type === 'focusSession' && f2.effects[0].terminalId === 'tmux:%2');
  const f3 = reduce(initialUi(), 'f', { ...ctx, sessions: [{ state: 'working', topic: 'a' }, { state: 'done', topic: 'b' }] });
  ok('f: no waiting session → message, no effect', f3.effects.length === 0 && f3.ui.msg.includes('ждущих'));
  const f4 = reduce(initialUi(), 'f', { ...ctx, sessions: [] });
  ok('f: empty sessions → safe no-op message', f4.effects.length === 0 && f4.ui.mode === 'board');

  // AC-10 purity: no fs/Date.now/process.stdout above selfTest
  const src = SRC_FOR_PURITY;
  ok('AC-10: no Date.now()', !src.includes('Date.now('));
  ok('AC-10: no process.stdout', !src.includes('process.stdout'));
  ok('AC-10: no fs import', !src.includes("from 'node:fs'"));

  if (fails.length) { console.log(`\n\x1b[31mFAIL (${fails.length}): ${fails.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ tui-control: reducer ACs 1-5,10,11 + overlays correct\x1b[0m'); process.exit(0);
}

let SRC_FOR_PURITY = '';
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--self-test')) {
  const { readFileSync } = await import('node:fs');
  const all = readFileSync(new URL(import.meta.url).pathname, 'utf8').split('\n');
  const stL = all.findIndex((l) => /^function selfTest/.test(l));
  SRC_FOR_PURITY = all.slice(0, stL).filter((l) => !l.trimStart().startsWith('//')).join('\n');
  selfTest();
}
