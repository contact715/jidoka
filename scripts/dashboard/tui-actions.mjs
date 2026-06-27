#!/usr/bin/env node
// tui-actions.mjs — IMPURE action layer for the jidoka top control panel. ≤400 LOC.
// Executes the effects emitted by tui-control.mjs's pure reducer:
//   resumeHalt → node scripts/andon-resume.mjs (REUSE — the canonical andon mechanism)
//   advance    → node scripts/run-state.mjs --advance (REUSE — the canonical wave journal)
//   openTerminal → osascript: new Terminal.app tab, cd into project, run the command
// Every executed action is appended to docs/audits/tui-actions.jsonl {ts, action, wave, ok}
// (wave-tui-control AC-7) — the Kaizen metric source for operator round-trip time.
//
// Pure command BUILDERS are exported and self-tested (incl. AppleScript escaping, AC-6);
// runEffect() is the only place that spawns processes.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { methodFromTerminalId, runFocus } from './focus.mjs';   // jump the OS terminal to a session

// ── pure builders (self-tested) ───────────────────────────────────────────
// AC-6: escape for a shell command embedded in an AppleScript double-quoted string.
// Order matters: backslashes first, then double quotes.
export const escAppleScript = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
// single-quote a path for the shell inside that string ('"'"' dance for embedded quotes)
export const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function buildTerminalScript(dir, command) {
  const shell = `cd ${shQuote(dir)} && ${command}`;
  return `tell application "Terminal"\nactivate\ndo script "${escAppleScript(shell)}"\nend tell`;
}

export function buildResumeArgs(scriptPath, { wave, reason }) {
  return [scriptPath, '--wave', wave || 'unknown', '--approver', 'operator-tui', '--reason', reason, '--root-cause', reason];
}

export function buildAdvanceArgs(scriptPath, { wave, phase, status, note }) {
  return [scriptPath, '--advance', wave, '--phase', phase, '--status', status, '--note', note || ''];
}

export function actionRecord(action, wave, ok, nowIso) {
  return { ts: nowIso, action, wave: wave || null, ok: Boolean(ok) };
}

// ── resolution helpers ────────────────────────────────────────────────────
// A script lives at scripts/<name> in the framework repo or .jidoka/scripts/<name> in installs.
export function resolveScript(projectPath, name) {
  for (const base of ['scripts', '.jidoka/scripts']) {
    const p = join(projectPath, base, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function logAction(projectPath, rec) {
  try {
    const dir = existsSync(join(projectPath, '.jidoka')) ? join(projectPath, '.jidoka', 'docs', 'audits') : join(projectPath, 'docs', 'audits');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'tui-actions.jsonl'), JSON.stringify(rec) + '\n');
  } catch { /* non-fatal */ }
}

// the halted wave id, if the andon state file knows it (better than guessing from selection)
function haltedWave(projectPath) {
  try {
    const st = JSON.parse(readFileSync(join(projectPath, '.sdd-halt-state.json'), 'utf8'));
    return st?.active?.wave || null;
  } catch { return null; }
}

// ── live log: tail the newest transcript of this project ─────────────────
// ~/.claude/projects/<munged-path>/<sessionId>.jsonl — munge: '/' and '.' → '-'
export const mungeProjectPath = (p) => String(p).replace(/[/.]/g, '-');

export function parseTranscriptTail(raw, maxLines = 40) {
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const m = j.message; if (!m) continue;
    const ts = j.timestamp ? String(j.timestamp).slice(11, 19) : '—';
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === 'text' && c.text?.trim()) out.push(`${ts} 🤖 ${c.text.trim().replace(/\s+/g, ' ').slice(0, 110)}`);
        else if (c.type === 'tool_use') out.push(`${ts} ⚙ ${c.name}${c.input?.description ? ': ' + String(c.input.description).slice(0, 80) : ''}`);
      }
    } else if (m.role === 'user' && typeof m.content === 'string' && m.content.trim() && !m.content.startsWith('<')) {
      out.push(`${ts} 👤 ${m.content.trim().replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  return out.slice(-maxLines);
}

export function readProjectLog(projectPath, home = homedir(), maxLines = 40) {
  try {
    const dir = join(home, '.claude', 'projects', mungeProjectPath(projectPath));
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, mt: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt);
    if (!files.length) return [];
    const fp = join(dir, files[0].f);
    const size = statSync(fp).size;
    // read only the last 256KB — transcripts grow to many MB
    const CHUNK = 256 * 1024;
    let raw;
    if (size > CHUNK) {
      const { openSync, readSync, closeSync } = require('node:fs');
      const fd = openSync(fp, 'r'); const buf = Buffer.alloc(CHUNK);
      readSync(fd, buf, 0, CHUNK, size - CHUNK); closeSync(fd);
      raw = buf.toString('utf8'); raw = raw.slice(raw.indexOf('\n') + 1);
    } else raw = readFileSync(fp, 'utf8');
    return parseTranscriptTail(raw, maxLines);
  } catch { return []; }
}
// node:module createRequire shim for the targeted byte-range read above
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ── effect executor ───────────────────────────────────────────────────────
export function runEffect(effect, ctx = {}) {
  const projectPath = ctx.projectPath;
  const now = new Date().toISOString();
  const done = (action, wave, ok, msg) => { logAction(projectPath, actionRecord(action, wave, ok, now)); return { ok, msg }; };
  try {
    if (effect.type === 'resumeHalt') {
      const script = resolveScript(projectPath, 'andon-resume.mjs');
      if (!script) return done('resumeHalt', effect.wave, false, 'andon-resume.mjs не найден в проекте');
      const wave = haltedWave(projectPath) || effect.wave || 'unknown';
      const out = execFileSync('node', buildResumeArgs(script, { wave, reason: effect.reason }), { cwd: projectPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return done('resumeHalt', wave, true, out.trim().split('\n').pop() || 'СТОП снят');
    }
    if (effect.type === 'advance') {
      const script = resolveScript(projectPath, 'run-state.mjs');
      if (!script) return done('advance', effect.wave, false, 'run-state.mjs не найден в проекте');
      const out = execFileSync('node', buildAdvanceArgs(script, effect), { cwd: projectPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return done(`advance:${effect.status}`, effect.wave, true, out.trim().split('\n')[0] || 'этап отмечен');
    }
    if (effect.type === 'openTerminal') {
      if (process.platform !== 'darwin') return done('openTerminal', null, false, 'открытие терминала поддержано только на macOS');
      execFileSync('osascript', ['-e', buildTerminalScript(projectPath, effect.command)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return done('openTerminal', null, true, 'вкладка Terminal открыта — подтверди запуск там');
    }
    if (effect.type === 'focusSession') {
      // jump the owner's terminal to the waiting session. The panel only has the session's RECORDED
      // terminalId (not its live env), so resolve the focus method from the id's shape (focus.mjs).
      // ctx.exec is injectable for tests — no real osascript/tmux/zellij runs in the harness.
      const method = methodFromTerminalId(effect.terminalId);
      const res = runFocus(method, effect.terminalId, {}, ctx.exec || execFileSync);
      // Kaizen metric (spec §1): every jump is logged {action:'focus', method, ok} for the feedback loop.
      logAction(projectPath, { ...actionRecord('focus', null, res.ok, now), method });
      return { ok: res.ok, msg: res.ok ? `перешёл в окно сессии (${method})` : (res.hint || 'не удалось переключить окно — переключись вручную') };
    }
    return { ok: false, msg: `неизвестный эффект: ${effect.type}` };
  } catch (e) {
    const msg = (e?.stderr?.toString?.() || e?.message || String(e)).trim().split('\n').pop();
    return done(effect.type, effect.wave || null, false, msg.slice(0, 120));
  }
}

// ── self-test ─────────────────────────────────────────────────────────────
async function selfTest() {
  const fails = []; const ok = (n, c, d = '') => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}${d ? `  (${d})` : ''}`); };

  // AC-6: AppleScript injection safety
  const evil = 'fix "x" && rm -rf \\ ; say "pwned"';
  const script = buildTerminalScript('/tmp/my dir', `claude "/jidoka-plan ${evil}"`);
  ok('AC-6: double quotes escaped', !/[^\\]"(?!\)|$)/m.test(script.split('do script "')[1]?.split('"\nend')[0] || 'x"x'), 'no raw " inside');
  ok('AC-6: backslash doubled', script.includes('\\\\'));
  ok('AC-6: dir single-quoted for shell', script.includes("cd '/tmp/my dir'"));
  ok('AC-6: command text present', script.includes('jidoka-plan'));
  const q = shQuote(`a'b`);
  ok("AC-6: shQuote survives embedded '", q === `'a'\\''b'`);

  // builders
  const ra = buildResumeArgs('/x/andon-resume.mjs', { wave: 'w-1', reason: 'причина' });
  ok('resume args: wave+approver+reason+root-cause', ra.includes('--wave') && ra.includes('w-1') && ra.includes('operator-tui') && ra.filter((a) => a === 'причина').length === 2);
  const aa = buildAdvanceArgs('/x/run-state.mjs', { wave: 'w-2', phase: 'gate', status: 'pending', note: 'n' });
  ok('advance args: --advance w --phase --status --note', aa[1] === '--advance' && aa[2] === 'w-2' && aa.includes('gate') && aa.includes('pending'));

  // AC-7 record shape
  const rec = actionRecord('advance:done', 'w-3', true, '2026-06-05T12:00:00Z');
  ok('AC-7: record has ts/action/wave/ok', rec.ts && rec.action === 'advance:done' && rec.wave === 'w-3' && rec.ok === true);

  // munge
  ok('munge: / and . → -', mungeProjectPath('/Users/x/.claude/jidoka') === '-Users-x--claude-jidoka');

  // transcript tail parser
  const raw = [
    JSON.stringify({ timestamp: '2026-06-05T10:00:01Z', message: { role: 'user', content: 'почини логин' } }),
    JSON.stringify({ timestamp: '2026-06-05T10:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: 'смотрю auth.ts' }] } }),
    JSON.stringify({ timestamp: '2026-06-05T10:00:09Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { description: 'run tests' } }] } }),
    'garbage not json',
    JSON.stringify({ timestamp: '2026-06-05T10:00:11Z', message: { role: 'user', content: '<system-reminder>noise</system-reminder>' } }),
  ].join('\n');
  const tail = parseTranscriptTail(raw);
  ok('log: user line parsed', tail.some((l) => l.includes('👤') && l.includes('почини логин')));
  ok('log: assistant text parsed', tail.some((l) => l.includes('🤖') && l.includes('auth.ts')));
  ok('log: tool_use parsed with description', tail.some((l) => l.includes('⚙ Bash') && l.includes('run tests')));
  ok('log: garbage + system noise skipped', tail.length === 3);
  ok('log: maxLines respected', parseTranscriptTail(raw, 2).length === 2);

  // runEffect failure paths are graceful (no project)
  const { mkdtempSync, rmSync, readFileSync: rfs, existsSync: ex } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmp = mkdtempSync(join(tmpdir(), 'tui-act-'));
  try {
    const r1 = runEffect({ type: 'resumeHalt', wave: 'w', reason: 'r' }, { projectPath: tmp });
    ok('graceful: resumeHalt without script → ok:false', r1.ok === false && r1.msg.includes('не найден'));
    const r2 = runEffect({ type: 'advance', wave: 'w', phase: 'p', status: 'done', note: '' }, { projectPath: tmp });
    ok('graceful: advance without script → ok:false', r2.ok === false);
    const lf = join(tmp, 'docs', 'audits', 'tui-actions.jsonl');
    ok('AC-7: failed actions still logged', ex(lf) && rfs(lf, 'utf8').trim().split('\n').length === 2);
    const first = JSON.parse(rfs(lf, 'utf8').trim().split('\n')[0]);
    ok('AC-7: log row is valid JSON with ok:false', first.ok === false && first.action === 'resumeHalt');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  ok('graceful: unknown effect', runEffect({ type: 'nope' }, { projectPath: '/tmp' }).ok === false);

  // ported: focusSession wires the reducer's effect to focus.mjs (no real subprocess — exec injected)
  const tmp2 = mkdtempSync(join(tmpdir(), 'tui-focus-'));
  try {
    // success path: a real tty id drives a terminal focus through the injected exec stub
    let exCall = null; const stub = (c, a) => { exCall = { c, a }; return 'ok'; };
    const rf = runEffect({ type: 'focusSession', terminalId: 'tty:/dev/ttys017', topic: 'нужен код' }, { projectPath: tmp2, exec: stub });
    ok('focusSession: resolves method + invokes exec (osascript + tty)', exCall?.c === 'osascript' && JSON.stringify(exCall.a).includes('/dev/ttys017'));
    ok('focusSession: ok:true names the method', rf.ok === true && rf.msg.includes('terminal'));
    const lf = join(tmp2, 'docs', 'audits', 'tui-actions.jsonl');
    const rec = JSON.parse(rfs(lf, 'utf8').trim().split('\n').pop());
    ok('focusSession: logs Kaizen metric {action:focus, method, ok}', rec.action === 'focus' && rec.method === 'terminal' && rec.ok === true);
    // honest fallback: a degenerate id can't focus → ok:false + hint, NO subprocess
    let ran = false;
    const rf2 = runEffect({ type: 'focusSession', terminalId: 'tty:??', topic: 'x' }, { projectPath: tmp2, exec: () => { ran = true; return ''; } });
    ok('focusSession: degenerate id → ok:false + hint, no subprocess', rf2.ok === false && typeof rf2.msg === 'string' && ran === false);
    const rec2 = JSON.parse(rfs(lf, 'utf8').trim().split('\n').pop());
    ok('focusSession: fallback logged with method unknown', rec2.action === 'focus' && rec2.method === 'unknown' && rec2.ok === false);
  } finally { rmSync(tmp2, { recursive: true, force: true }); }

  if (fails.length) { console.log(`\n\x1b[31mFAIL (${fails.length}): ${fails.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ tui-actions: builders (AC-6) + journal (AC-7) + log tail + focus + graceful failures correct\x1b[0m'); process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--self-test')) await selfTest();
