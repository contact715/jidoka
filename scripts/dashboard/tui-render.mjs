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

// one wave row; sel=true → ▶ marker + bold name. cost {durMin, usd} → ⏱/$ tail (cols permitting).
function waveRow(w, cols, sel, cost) {
  const s = w.status || 'pending', p = w.progress ?? 0;
  const mark = sel ? `\x1b[36m▶\x1b[0m` : ' ';
  const name = sel ? `\x1b[1m${pad(w.wave || '—', 22)}\x1b[22m` : pad(w.wave || '—', 22);
  let tailStr = cols >= 80 ? ' ' + bar(p) : '';
  if (cols >= 96 && cost && cost.durMin != null) {
    const money = cost.usd != null ? ` · ≈$${cost.usd.toFixed(2)}` : '';
    tailStr += `  ${D}⏱ ${Math.round(cost.durMin)}м${money}${R}`;
  }
  return `${mark}${cstat(s)}${ssym(s)}${R} ${name} ${pad(stageLabel(w), 7)} ${String(p).padStart(3)}%${tailStr}`;
}

function boardLinear(waves, cols, opts = {}) {
  const lines = [sec('ДОСКА', cols)];
  waves.forEach((w, i) => lines.push(waveRow(w, cols, opts.selectedWave != null && w.wave === opts.selectedWave, (opts.costs || {})[w.wave])));
  return [...lines, hline(cols)];
}

function boardKanban(waves, cols, frozen, selectedWave = null) {
  const buckets = Object.fromEntries(COL_ORDER.map((p) => [p, []]));
  for (const w of waves) { const ph = w.current || 'done'; (buckets[ph] ?? buckets['done']).push(w); }
  const shown = COL_ORDER.filter((p) => CORE.has(p) || buckets[p]?.length > 0);
  const cw = Math.max(9, Math.floor((cols - 2) / shown.length) - 1);
  const lines = [sec(frozen ? 'ДОСКА (заморожена)' : 'ДОСКА', cols), shown.map((p) => pad(STAGE[p] || p.toUpperCase(), cw)).join(' '), shown.map(() => '─'.repeat(cw)).join('  ')];
  const maxR = Math.max(1, ...shown.map((p) => buckets[p].length));
  for (let r = 0; r < maxR; r++) {
    lines.push(shown.map((ph) => { const w = buckets[ph][r]; if (!w) return ' '.repeat(cw); const s = frozen ? 'idle' : (w.status || 'pending'); const seld = selectedWave != null && w.wave === selectedWave; const nm = pad((w.wave || '—').slice(0, cw - 3), cw - 2); return `${frozen ? D : cstat(s)}${frozen ? SYM.idle : ssym(s)}${R} ${seld ? `\x1b[7m${nm}\x1b[27m` : nm}`; }).join(' '));
    if (shown.some((p) => buckets[p][r])) lines.push(shown.map((ph) => { const w = buckets[ph][r]; return pad(w ? `  ${String(w.progress ?? 0).padStart(3)}% ${bar(w.progress ?? 0, 4)}` : '', cw); }).join(' '));
  }
  return [...lines, hline(cols)];
}

export function renderBoard(waves, cols, opts = {}) {
  if (!waves?.length) return [sec('ДОСКА', cols), ''];
  // selection / cost columns need the row layout — prefer linear whenever the panel is interactive
  return (cols < 100 || opts.interactive) ? boardLinear(waves, cols, opts) : boardKanban(waves, cols, opts.frozen || false, opts.selectedWave);
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

export function renderActivity(activity, cols) {
  const items = (activity || []).slice(0, 5);
  const lines = [sec('ЛЕНТА (последние действия)', cols)];
  if (!items.length) { lines.push('  (нет записей)'); } else {
    for (const a of items) lines.push(`  ${a.ts ? String(a.ts).slice(11, 16) : '—'}  ${pad(String(a.agent || '—').slice(0, 18), 18)} ${String(a.action || '').slice(0, 30)}${a.label ? '  ' + String(a.label).slice(0, 20) : ''}`);
  }
  return [...lines, hline(cols)];
}

export function renderFooter(cols, controls = false) {
  if (!controls) return [hline(cols), `  ${cols >= 100 ? 'q выход · r обновить · ← → проект' : 'q · r · ←→'}`];
  return [hline(cols), cols >= 110
    ? `  ↑↓ выбор · Enter продолжить волну · n новая · s снять СТОП · g перезапуск этапа · p пропустить · l лог · $ деньги · ? помощь · q выход`
    : `  ↑↓ · Enter волна · n нов · s СТОП · g перезапуск · p пропуск · l лог · $ деньги · ? · q`];
}

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

// ui (optional, from tui-control.mjs initialUi/reduce): selection cursor + interactive footer.
// snapshot.costs (optional, from wave-cost.mjs): { [wave]: {durMin, usd} } → row tails.
export function renderFrame(snapshot, collectedAt, cols, ui = null) {
  cols = cols || 80;
  const h = snapshot.health || {}, halt = h.halt === true, waves = snapshot.waves || [];
  const stuck = waves.filter((w) => isStuck(w, collectedAt));
  const selectedWave = ui ? (waves[Math.min(ui.sel ?? 0, Math.max(0, waves.length - 1))]?.wave ?? null) : null;
  const lines = [...renderHeader(snapshot, collectedAt, cols)];
  if (halt) lines.push('', ...renderHaltBanner(halt, cols));
  if (stuck.length) lines.push('', ...renderStuckSection(stuck, collectedAt, cols));
  if (!waves.length) lines.push(...renderEmpty(snapshot, cols));
  else lines.push('', ...renderBoard(waves, cols, { frozen: halt, interactive: Boolean(ui), selectedWave, costs: snapshot.costs || {} }));
  lines.push(...renderTerminals(waves, cols), ...renderSessions(snapshot.sessions, cols), ...renderActivity(snapshot.activity, cols), ...renderFooter(cols, Boolean(ui)));
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

  // wave-tui-control AC-9: selection + cost + interactive footer
  const iw = [mw({ wave: 'wave-one' }), mw({ wave: 'wave-two' })];
  const isnap = ms({ waves: iw, costs: { 'wave-two': { durMin: 95, usd: 12.34 } } });
  const il = renderFrame(isnap, AT, 120, { sel: 1 });
  ok('AC-9: selected wave marked ▶', il.some((l) => l.includes('▶') && l.includes('wave-two')));
  ok('AC-9: unselected wave not marked', !il.some((l) => l.includes('▶') && l.includes('wave-one')));
  ok('AC-9: cost tail ≈$ on its wave row', il.some((l) => l.includes('wave-two') && l.includes('≈$12.34') && l.includes('⏱')));
  ok('AC-9: interactive footer lists control keys', il.some((l) => l.includes('СТОП') && l.includes('деньги')));
  ok('AC-9: ui=null keeps legacy footer', renderFrame(ms(), AT, 120).some((l) => l.includes('← → проект')));
  ok('AC-9: interactive board is linear even when wide', !il.some((l) => l.includes('ПОИСК') && l.includes('СПЕК') && l.includes('ГОТОВО')));
  ok('AC-9: selection clamps beyond bounds', renderFrame(isnap, AT, 120, { sel: 99 }).some((l) => l.includes('▶')));

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
