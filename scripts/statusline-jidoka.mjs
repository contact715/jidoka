#!/usr/bin/env node
// jidoka statusline PRO — framework health + live session telemetry in the Claude Code status bar.
//
// Shows: jidoka health (eval/halt) · git branch · model · context-window progress bar ·
// lines added/removed · session cost · effort marker · 5h rate-limit bar (when >=50%).
// Reads ONLY cached values (eval baseline, halt-state file, git branch) so it stays instant on the
// render path — it never runs a heavy gate (eval/instantiation-audit) per keystroke. Works in the
// framework repo AND in any project the framework is installed into (.jidoka/ present).
//
// Wired via settings.json "statusLine": { type: command, command: "node <path>/statusline-jidoka.mjs" }.
// Claude Code pipes a JSON context on stdin (model, workspace, context_window, cost, effort, rate_limits).
//
// Colorblind-safe palette (cyan→yellow→orange, blue for added / orange for removed) — pairs with
// the dark-daltonized base theme.
//
// FULL & self-tested. Usage:
//   node statusline-jidoka.mjs --self-test
//   echo '{"workspace":{"current_dir":"."}}' | node statusline-jidoka.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';

// ---------- tiny ANSI helpers (256-color, colorblind-safe set) ----------
const C = {
  mint:  s => `\x1b[38;5;49m${s}\x1b[0m`,   // accent / model
  cyan:  s => `\x1b[38;5;80m${s}\x1b[0m`,   // ok
  yellow:s => `\x1b[38;5;220m${s}\x1b[0m`,  // warn
  orange:s => `\x1b[38;5;208m${s}\x1b[0m`,  // hot / removed
  blue:  s => `\x1b[38;5;75m${s}\x1b[0m`,   // added
  violet:s => `\x1b[38;5;141m${s}\x1b[0m`,  // branch
  dim:   s => `\x1b[38;5;245m${s}\x1b[0m`,  // secondary
  bold:  s => `\x1b[1m${s}\x1b[0m`,
};

// pure: progress bar — ▰▰▰▱▱▱ colored by load (cyan <60, yellow <85, orange >=85)
export function bar(pct, width = 8) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((p / 100) * width);
  const paint = p >= 85 ? C.orange : p >= 60 ? C.yellow : C.cyan;
  return paint('▰'.repeat(filled)) + C.dim('▱'.repeat(width - filled)) + ' ' + paint(`${p}%`);
}

// pure: clip text to width with ellipsis
export function clip(text, room) {
  if (!text) return '';
  return text.length > room ? text.slice(0, Math.max(1, room - 1)) + '…' : text;
}

// pure: timer paint by how long the work has been running — dim <10m, amber <30m, orange after
export function timerPaint(elapsedMs) {
  if (elapsedMs >= 30 * 60000) return C.orange;
  if (elapsedMs >= 10 * 60000) return C.yellow;
  return C.dim;
}

// pure: should we play the "still working" nudge? true at 15m, then every 15m again
export function shouldNudge(st, now, intervalMs = 15 * 60000) {
  if (!st || st.state !== 'working' || st.ts == null) return false;
  if (now - st.ts < intervalMs) return false;
  return !st.nudgedAt || now - st.nudgedAt >= intervalMs;
}

// pure: mission line — state icon + elapsed + the user's pinned ask, truncated to width.
// When the latest prompt is a short continuation («делай все три»), the TOPIC (last substantive
// ask) is shown first so the line always explains itself: ◇ <тема> ❯ <короткая команда>
export function promptLine(prompt, cols = 100, state = '', elapsedMs = null, topic = '') {
  const icon = state === 'working' ? C.mint('▶') : state === 'waiting' ? C.yellow('⏳ жду ответа') : state === 'done' ? C.cyan('✓') : '';
  const t = elapsedMs != null && elapsedMs >= 60000 && state === 'working' ? timerPaint(elapsedMs)(` ${fmtDur(elapsedMs)}`) : '';
  const head = icon ? `${icon}${t} ` : '';
  if (!prompt && !topic && !head) return '';
  const headLen = head.replace(/\x1b\[[0-9;]*m/g, '').length;
  const room = Math.max(20, (cols || 100) - 4 - headLen);
  if (topic && prompt && topic !== prompt) {
    const tRoom = Math.max(12, Math.floor(room * 0.62));
    const pRoom = Math.max(8, room - tRoom - 3);
    return head + C.violet('◇ ') + C.dim(clip(topic, tRoom)) + C.violet(' ❯ ') + clip(prompt, pRoom);
  }
  return head + C.violet('◇ ') + C.dim(clip(topic || prompt, room));
}

// pure: activity + plan-progress line — what is happening RIGHT NOW
// todos: [{content, status, activeForm}]; returns '' when nothing to show
export function missionLine({ activity, todos, state }, cols = 100) {
  const parts = [];
  if (state === 'working' && activity) parts.push(C.cyan('⚙ ') + C.dim(clip(activity, Math.floor((cols || 100) * 0.45))));
  if (Array.isArray(todos) && todos.length) {
    const done = todos.filter(t => t.status === 'completed').length;
    const cur = todos.find(t => t.status === 'in_progress');
    let seg = C.mint(`✓ ${done}/${todos.length}`);
    if (cur) seg += C.dim(' ▸ ') + C.dim(clip(cur.activeForm || cur.content || '', Math.floor((cols || 100) * 0.4)));
    parts.push(seg);
  }
  return parts.join(C.dim(' │ '));
}

// pure: 5025000 ms → "1h24m", 95000 → "2m", null → ''
export function fmtDur(ms) {
  if (ms == null || ms < 60000) return '';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

// pure: build the status string from already-read facts (testable without fs/git)
export function render({ jidoka, evalPct, halt, project, branch, model, ctxPct, costUsd, linesAdd, linesDel, effort, rate5h, rate7d, durMs }) {
  const parts = [];

  // 1) jidoka health (only inside a jidoka-enabled repo)
  if (jidoka) {
    const icon = halt ? '🔴 HALT' : evalPct === 100 ? '🟢' : evalPct != null ? '🟡' : '⚪';
    parts.push(`${icon} jidoka${evalPct != null ? C.dim(` eval ${evalPct}%`) : ''}`);
  }

  // 2) project (folder basename) + git branch — WHERE the work is happening
  if (project) parts.push(C.bold(C.blue(`⌂ ${project}`)));
  if (branch) parts.push(C.violet(`⎇ ${branch}`));

  // 3) model
  if (model) parts.push(C.bold(C.mint(`✦ ${model}`)));

  // 4) context-window progress bar
  if (ctxPct != null) parts.push(`${C.dim('ctx')} ${bar(ctxPct)}`);

  // 5) lines added/removed this session (blue/orange — daltonized-friendly)
  if (linesAdd || linesDel) parts.push(`${C.blue(`+${linesAdd || 0}`)} ${C.orange(`−${linesDel || 0}`)}`);

  // 6) session cost + duration
  if (costUsd != null) parts.push(C.dim(`$${costUsd.toFixed(2)}`));
  const dur = fmtDur(durMs);
  if (dur) parts.push(C.dim(`⏱ ${dur}`));

  // 7) effort marker — only when it deviates from the usual
  if (effort && ['max', 'xhigh', 'low'].includes(effort)) parts.push(C.yellow(`⚡${effort}`));

  // 8) rate limits — each appears only when half-spent, so they never nag early
  if (rate5h != null && rate5h >= 50) parts.push(`${C.dim('5h')} ${bar(rate5h, 5)}`);
  if (rate7d != null && rate7d >= 50) parts.push(`${C.dim('7d')} ${bar(rate7d, 5)}`);

  return parts.join(C.dim(' │ ')) || C.dim('…');
}

function gather(cwd) {
  const isJidoka = existsSync(join(cwd, 'docs/evals/_baseline.json')) || existsSync(join(cwd, '.jidoka'));
  let evalPct = null;
  for (const p of ['docs/evals/_baseline.json', '.jidoka/_baseline.json']) {
    try { evalPct = Math.round(JSON.parse(readFileSync(join(cwd, p), 'utf8')).pass_rate * 100); break; } catch { /* none */ }
  }
  let halt = false;
  for (const p of ['docs/audits/andon-halt.json', '.jidoka/andon-halt.json', 'docs/audits/halt-state.json']) {
    if (existsSync(join(cwd, p))) { halt = true; break; }
  }
  let branch = '';
  try { branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not git */ }
  const project = (cwd || '').split('/').filter(Boolean).pop() || '';
  return { jidoka: isJidoka, evalPct, halt, branch, project };
}

// pure: pull session telemetry out of the stdin context (all fields optional)
export function telemetry(ctx) {
  return {
    model: ctx.model?.display_name || '',
    ctxPct: ctx.context_window?.used_percentage ?? null,
    costUsd: ctx.cost?.total_cost_usd ?? null,
    linesAdd: ctx.cost?.total_lines_added ?? 0,
    linesDel: ctx.cost?.total_lines_removed ?? 0,
    effort: ctx.effort?.level || '',
    rate5h: ctx.rate_limits?.five_hour?.used_percentage ?? null,
    rate7d: ctx.rate_limits?.seven_day?.used_percentage ?? null,
    durMs: ctx.cost?.total_duration_ms ?? null,
  };
}

function selfTest() {
  const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
  const T = [
    ['100% eval → green', strip(render({ jidoka: true, evalPct: 100, branch: 'main' })).startsWith('🟢')],
    ['<100% eval → yellow', strip(render({ jidoka: true, evalPct: 90 })).startsWith('🟡')],
    ['halt overrides → red', strip(render({ jidoka: true, evalPct: 100, halt: true })).includes('🔴 HALT')],
    ['no baseline → white marker', strip(render({ jidoka: true, evalPct: null })).startsWith('⚪')],
    ['non-jidoka cwd → branch+model', strip(render({ jidoka: false, branch: 'dev', model: 'Opus' })) === '⎇ dev │ ✦ Opus'],
    ['project shown before branch', strip(render({ jidoka: false, project: 'projectx-app', branch: 'dev' })) === '⌂ projectx-app │ ⎇ dev'],
    ['project hidden when empty', !strip(render({ jidoka: false, branch: 'dev' })).includes('⌂')],
    ['ctx bar at 50% → half filled', strip(bar(50, 8)) === '▰▰▰▰▱▱▱▱ 50%'],
    ['ctx bar clamps >100', strip(bar(140, 4)) === '▰▰▰▰ 100%'],
    ['lines shown', strip(render({ jidoka: false, linesAdd: 12, linesDel: 3 })) === '+12 −3'],
    ['cost shown', strip(render({ jidoka: false, costUsd: 1.234 })).includes('$1.23')],
    ['rate5h hidden below 50', !strip(render({ jidoka: false, model: 'X', rate5h: 30 })).includes('5h')],
    ['rate5h shown at 60', strip(render({ jidoka: false, model: 'X', rate5h: 60 })).includes('5h')],
    ['effort max shown', strip(render({ jidoka: false, model: 'X', effort: 'max' })).includes('⚡max')],
    ['effort high hidden', !strip(render({ jidoka: false, model: 'X', effort: 'high' })).includes('⚡')],
    ['telemetry defaults safe', telemetry({}).ctxPct === null && telemetry({}).linesAdd === 0],
    ['empty → placeholder', strip(render({})) === '…'],
    ['duration 84m → 1h24m', fmtDur(84 * 60000) === '1h24m'],
    ['duration 2m → 2m', fmtDur(120000) === '2m'],
    ['duration <1m hidden', fmtDur(30000) === '' && fmtDur(null) === ''],
    ['7d shown at 75', strip(render({ jidoka: false, model: 'X', rate7d: 75 })).includes('7d')],
    ['7d hidden below 50', !strip(render({ jidoka: false, model: 'X', rate7d: 20 })).includes('7d')],
    ['prompt pinned', strip(promptLine('сделай красиво', 80)) === '◇ сделай красиво'],
    ['тема ❯ короткая команда', strip(promptLine('делай все три', 100, 'working', null, 'усиль закреплённый промпт киллер-фичами')) === '▶ ◇ усиль закреплённый промпт киллер-фичами ❯ делай все три'],
    ['тема == промпт → без дубля', !strip(promptLine('одна задача', 100, 'working', null, 'одна задача')).includes('❯')],
    ['только тема (промпт пуст) → показана тема', strip(promptLine('', 100, '', null, 'тема работы')) === '◇ тема работы'],
    ['комбо влезает в ширину', strip(promptLine('к'.repeat(99), 60, 'working', null, 'т'.repeat(99))).length <= 60],
    ['prompt truncated to width', strip(promptLine('а'.repeat(200), 60)).length <= 60],
    ['prompt empty → no line', promptLine('') === ''],
    ['working → ▶ + timer', strip(promptLine('п', 80, 'working', 5 * 60000)) === '▶ 5m ◇ п'],
    ['working <1m → no timer', strip(promptLine('п', 80, 'working', 30000)) === '▶ ◇ п'],
    ['waiting → ⏳ жду ответа', strip(promptLine('п', 80, 'waiting', 999999)).startsWith('⏳ жду ответа')],
    ['done → ✓, no timer', strip(promptLine('п', 80, 'done', 999999)) === '✓ ◇ п'],
    ['mission: activity shown while working', strip(missionLine({ state: 'working', activity: 'ставлю ccboard' })) === '⚙ ставлю ccboard'],
    ['mission: activity hidden when done', missionLine({ state: 'done', activity: 'x' }) === ''],
    ['mission: todo progress + current', strip(missionLine({ todos: [{ status: 'completed' }, { status: 'in_progress', activeForm: 'пишу тесты' }, { status: 'pending' }] })) === '✓ 1/3 ▸ пишу тесты'],
    ['mission: empty todos → no segment', missionLine({ todos: [] }) === ''],
    ['mission: both segments joined', strip(missionLine({ state: 'working', activity: 'a', todos: [{ status: 'pending' }] })).includes('│')],
    ['clip respects room', clip('абвгде', 4) === 'абв…' && clip('аб', 4) === 'аб'],
    ['timer dim <10m', timerPaint(5 * 60000) === C.dim],
    ['timer amber 10-30m', timerPaint(12 * 60000) === C.yellow],
    ['timer orange ≥30m', timerPaint(31 * 60000) === C.orange],
    ['nudge fires at 15m', shouldNudge({ state: 'working', ts: 0 }, 15 * 60000) === true],
    ['nudge silent before 15m', shouldNudge({ state: 'working', ts: 0 }, 14 * 60000) === false],
    ['nudge not repeated within 15m', shouldNudge({ state: 'working', ts: 0, nudgedAt: 15 * 60000 }, 20 * 60000) === false],
    ['nudge re-fires after another 15m', shouldNudge({ state: 'working', ts: 0, nudgedAt: 15 * 60000 }, 30 * 60000) === true],
    ['nudge silent when waiting/done', shouldNudge({ state: 'waiting', ts: 0 }, 99 * 60000) === false && shouldNudge({ state: 'done', ts: 0 }, 99 * 60000) === false],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mstatusline-jidoka self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ statusline-jidoka PRO: render correct\x1b[0m');
  process.exit(0);
}

// read session state written by hooks/session-state.mjs; falls back to the legacy prompt file
function readSessionState(sessionId) {
  if (!sessionId) return {};
  const base = join(process.env.HOME || '', '.claude', 'session-env');
  try { return JSON.parse(readFileSync(join(base, `state-${sessionId}.json`), 'utf8')); } catch { /* none */ }
  try { return { prompt: readFileSync(join(base, `prompt-${sessionId}.txt`), 'utf8').trim() }; } catch { return {}; }
}

// read this session's todo list (TodoWrite store) — [] when absent/empty
function readTodos(sessionId) {
  if (!sessionId) return [];
  try {
    const arr = JSON.parse(readFileSync(join(process.env.HOME || '', '.claude', 'todos', `${sessionId}-agent-${sessionId}.json`), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let ctx = {}; try { ctx = JSON.parse(raw || '{}'); } catch { /* none */ }
  const cwd = ctx.workspace?.current_dir || ctx.cwd || process.cwd();
  const cols = parseInt(process.env.COLUMNS, 10) || 100;
  const st = readSessionState(ctx.session_id);
  const now = Date.now();
  const elapsed = st.ts ? now - st.ts : null;
  // gentle "still working" nudge at 15m, re-armed every 15m; fire-and-forget, never delays render
  if (shouldNudge(st, now)) {
    try {
      spawn('afplay', [join(process.env.HOME || '', '.claude', 'sounds', 'nudge.wav')], { detached: true, stdio: 'ignore' }).unref();
      writeFileSync(join(process.env.HOME || '', '.claude', 'session-env', `state-${ctx.session_id}.json`), JSON.stringify({ ...st, nudgedAt: now }), 'utf8');
    } catch { /* sound is best-effort */ }
  }
  const lines = [
    render({ ...gather(cwd), ...telemetry(ctx) }),
    promptLine(st.prompt, cols, st.state, elapsed, st.topic),
    missionLine({ activity: st.activity, todos: readTodos(ctx.session_id), state: st.state }, cols),
  ].filter(Boolean);
  process.stdout.write(lines.join('\n'));
}
