#!/usr/bin/env node
// tui-control.mjs — PURE key state machine + overlay renderer for the jidoka top control panel.
// CONTRACT: like tui-render.mjs — no fs, no Date.now(), no process.stdout. ≤400 LOC.
//
// reduce(ui, key, ctx) → { ui, effects[] }   — the panel's brain (wave-tui-control spec)
//   ctx = { waves: snapshot.waves, halt: boolean }   (plain data, supplied by the shell)
//   effects: {type:'quit'|'refresh'} | {type:'resumeHalt',wave,reason}
//          | {type:'advance',wave,phase,status,note} | {type:'openTerminal',command}
//          | {type:'loadLog'} | {type:'loadCost'}
// renderOverlay(ui, cols) → string[]  — confirm / input / log / cost boxes + status msg.
//
// Side effects live in tui-actions.mjs; stdin/stdout wiring lives in tui-top.mjs.

const R = '\x1b[0m', G = '\x1b[32m', A = '\x1b[33m', X = '\x1b[31m', D = '\x1b[90m', I = '\x1b[7m';
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

export function initialUi() {
  return { mode: 'board', sel: 0, msg: '', confirm: null, input: null, log: null, logScroll: 0, cost: null };
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const selWave = (ui, ctx) => (ctx.waves || [])[clamp(ui.sel, 0, Math.max(0, (ctx.waves || []).length - 1))] || null;

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
  if (key === '\x1b[A' || key === 'k') return { ui: { ...u, sel: clamp(ui.sel - 1, 0, Math.max(0, waves.length - 1)) }, effects: [] };
  if (key === '\x1b[B' || key === 'j') return { ui: { ...u, sel: clamp(ui.sel + 1, 0, Math.max(0, waves.length - 1)) }, effects: [] };
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
  return { ui, effects: [] };
}

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
  if (ui.mode === 'log' || ui.mode === 'cost') return viewKey(ui, key);
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
  r = reduce(r.ui, '\r', ctx);
  ok('AC-2: Enter yields resumeHalt effect with reason', r.effects.length === 1 && r.effects[0].type === 'resumeHalt' && r.effects[0].reason === 'x');
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
