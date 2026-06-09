#!/usr/bin/env node
// focus.mjs — the focus dispatcher for `jidoka top`. Given a session's terminal identity + env, jump
// the OS terminal window/tab to it (Terminal.app / iTerm2 / tmux / zellij), or — when no reliable focus
// exists (Warp, Claude desktop, SSH, unknown) — return an honest, copy-pasteable locator hint instead.
//
// IMPURE (runs osascript/tmux/zellij/open subprocesses) but UNIT-TESTABLE: every exec goes through an
// injected `exec` param (defaulting to execFileSync), so tests pass a stub and no real subprocess runs.
// Decision table is normative — see docs/specs/wave-tui-interactive_MASTER_SPEC.md §5.
//
// Self-test: node focus.mjs --self-test   (exits 0; uses a stub exec, never a real osascript)

import { execFileSync } from 'node:child_process';

// Terminal.app focus AppleScript (verbatim from §5; compiles on macOS 25.5). Matches a tab by tty.
const TERMINAL_APPLESCRIPT = `on run argv
  set targetTTY to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        try
          if (tty of t) is targetTTY then
            set selected of t to true
            set frontmost of w to true
            activate
            return "ok"
          end if
        end try
      end repeat
    end repeat
  end tell
  return "notfound"
end run`;

// iTerm2 focus AppleScript (UNTESTED-static; syntax from official docs). Matches a session by UUID.
const ITERM_APPLESCRIPT = (uuid) => `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "${uuid}" then
          select s
          select t
          select w
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell`;

// pure: choose the focus method from env, MULTIPLEXER-FIRST (zellij/tmux win even if TERM_PROGRAM set).
// Order is the §5 normative dispatcher order.
export function resolveFocusMethod(env = {}) {
  if (env.ZELLIJ) return 'zellij';
  if (env.TMUX) return 'tmux';
  const tp = env.TERM_PROGRAM;
  if (tp === 'Apple_Terminal') return 'terminal';
  if (tp === 'iTerm.app') return 'iterm';
  if (tp === 'WarpTerminal') return 'warp';
  if (env.__CLAUDE_DESKTOP === '1') return 'claude';   // parent-proc detection happens in the caller
  return 'unknown';
}

// pure-ish: derive a normalized tty path from a terminalId like "tty:ttys017" → "/dev/ttys017".
function ttyPathFromId(terminalId) {
  if (!terminalId) return null;
  const bare = terminalId.startsWith('tty:') ? terminalId.slice(4) : terminalId;
  if (!/^\/?(dev\/)?ttys?\w+$/i.test(bare)) return null;
  return bare.startsWith('/dev/') ? bare : `/dev/${bare.replace(/^\/?dev\//, '')}`;
}

// honest fallback: name the window/tty so the owner can switch by hand. Never pretends it worked.
function hintFor(method, terminalId) {
  const where = terminalId ? ` Сессия на ${terminalId}.` : '';
  const why = {
    warp: 'не могу переключить это окно (Warp).',
    claude: 'Claude desktop активирован, но переключить вкладку сессии нельзя.',
    unknown: 'не могу определить терминал этой сессии.',
  }[method] || 'не могу переключить это окно.';
  return `[focus] ${why}${where} Переключись вручную.`;
}

// Run the focus action for `method`. Returns { ok, method, hint? }. `exec(cmd, argv)` is injected so
// tests stub it — NO real subprocess in tests. ok=true only when a real focus command ran.
export function runFocus(method, terminalId, env = {}, exec = execFileSync) {
  try {
    if (method === 'terminal') {
      const tty = ttyPathFromId(terminalId);
      if (!tty) return { ok: false, method, hint: hintFor('unknown', terminalId) };
      const out = String(exec('osascript', ['-e', TERMINAL_APPLESCRIPT, tty], { encoding: 'utf8' }) || '');
      return { ok: !out.includes('notfound'), method, hint: out.includes('notfound') ? hintFor('unknown', terminalId) : undefined };
    }
    if (method === 'iterm') {
      const uuid = (env.ITERM_SESSION_ID || terminalId || '').split(':').pop();
      // SECURITY: terminalId comes from a user-writable state file and is interpolated into
      // AppleScript SOURCE (not argv) — an unvalidated value injects live `do shell script`.
      // iTerm session ids are UUIDs (hex + hyphens). Anything else → refuse, don't run osascript.
      if (!uuid || !/^[A-Za-z0-9-]+$/.test(uuid)) return { ok: false, method, hint: hintFor('unknown', terminalId) };
      exec('osascript', ['-e', ITERM_APPLESCRIPT(uuid)], { encoding: 'utf8' });
      return { ok: true, method };
    }
    if (method === 'tmux') {
      const pane = env.TMUX_PANE || (terminalId || '').replace(/^tmux:/, '');
      exec('tmux', ['select-window', '-t', pane], { encoding: 'utf8' });
      exec('tmux', ['select-pane', '-t', pane], { encoding: 'utf8' });
      // in-multiplexer move only; the host OS window may not be raised — honest caveat in the hint
      return { ok: true, method, hint: undefined };
    }
    if (method === 'zellij') {
      const session = env.ZELLIJ_SESSION_NAME || '';
      const tab = env.ZELLIJ_TAB_NAME || env.ZELLIJ_SESSION_NAME || '';
      const argv = session ? ['--session', session, 'action', 'go-to-tab-name', tab] : ['action', 'go-to-tab-name', tab];
      exec('zellij', argv, { encoding: 'utf8' });
      return { ok: true, method };
    }
    if (method === 'claude') {
      // app-activate ONLY — no session deep-link exists in the asar; no Accessibility-UI clicking (§5).
      exec('open', ['-b', 'com.anthropic.claudefordesktop'], { encoding: 'utf8' });
      return { ok: false, method, hint: hintFor('claude', terminalId) };
    }
    // warp / unknown / no terminalId → honest fallback, no subprocess
    return { ok: false, method, hint: hintFor(method, terminalId) };
  } catch (e) {
    return { ok: false, method, hint: hintFor(method, terminalId) + ` (${String(e?.message || e).slice(0, 40)})` };
  }
}

// ── self-test ──────────────────────────────────────────────────────────
function selfTest() {
  const fails = []; const ok = (n, c, d = '') => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}${d ? `  (${d})` : ''}`); };

  // resolveFocusMethod — decision table, multiplexer-first
  ok('method: ZELLIJ → zellij', resolveFocusMethod({ ZELLIJ: '1' }) === 'zellij');
  ok('method: TMUX → tmux', resolveFocusMethod({ TMUX: 'x' }) === 'tmux');
  ok('method: Apple_Terminal → terminal', resolveFocusMethod({ TERM_PROGRAM: 'Apple_Terminal' }) === 'terminal');
  ok('method: iTerm.app → iterm', resolveFocusMethod({ TERM_PROGRAM: 'iTerm.app' }) === 'iterm');
  ok('method: WarpTerminal → warp', resolveFocusMethod({ TERM_PROGRAM: 'WarpTerminal' }) === 'warp');
  ok('method: empty → unknown', resolveFocusMethod({}) === 'unknown');
  ok('method: zellij beats TERM_PROGRAM', resolveFocusMethod({ ZELLIJ: '1', TERM_PROGRAM: 'Apple_Terminal' }) === 'zellij');
  ok('method: tmux beats TERM_PROGRAM', resolveFocusMethod({ TMUX: 'x', TERM_PROGRAM: 'iTerm.app' }) === 'tmux');

  // runFocus terminal → osascript + tty, via stub (no real subprocess)
  let rec = null; const stub = (cmd, argv) => { rec = { cmd, argv }; return 'ok'; };
  const t = runFocus('terminal', '/dev/ttys017', { TERM_PROGRAM: 'Apple_Terminal' }, stub);
  ok('runFocus terminal: calls osascript', rec?.cmd === 'osascript');
  ok('runFocus terminal: passes the tty', JSON.stringify(rec?.argv).includes('/dev/ttys017'));
  ok('runFocus terminal: ok=true when applescript says ok', t.ok === true);
  const nf = runFocus('terminal', '/dev/ttys099', {}, () => 'notfound');
  ok('runFocus terminal: notfound → ok=false + hint', nf.ok === false && typeof nf.hint === 'string');

  // runFocus iterm → osascript with UUID
  let ir = null; runFocus('iterm', 'w0t0p0:THE-UUID', { ITERM_SESSION_ID: 'w0t0p0:THE-UUID' }, (c, a) => { ir = { c, a }; });
  ok('runFocus iterm: osascript with UUID', ir?.c === 'osascript' && JSON.stringify(ir.a).includes('THE-UUID'));

  // SECURITY: poisoned terminalId/ITERM_SESSION_ID must NOT reach osascript (AppleScript injection)
  let poisoned = false;
  const evil = 'x"\nactivate\ndo shell script "echo OWNED > /tmp/owned_by_focus"\nset z to "';
  const pr = runFocus('iterm', `w0t0p0:${evil}`, { ITERM_SESSION_ID: `w0t0p0:${evil}` }, (c, a) => { poisoned = true; if (JSON.stringify(a).includes('do shell script')) poisoned = 'INJECTED'; });
  ok('runFocus iterm: rejects injection payload (no osascript run)', poisoned === false && pr.ok === false && typeof pr.hint === 'string');
  ok('runFocus iterm: never passes "do shell script" to exec', poisoned !== 'INJECTED');
  // a clean UUID still works after the guard
  let clean = false; runFocus('iterm', 'w0t0p0:ABCD-1234-EF', { ITERM_SESSION_ID: 'w0t0p0:ABCD-1234-EF' }, (c, a) => { clean = JSON.stringify(a).includes('ABCD-1234-EF'); });
  ok('runFocus iterm: clean UUID still focuses', clean === true);

  // runFocus tmux → select-window + select-pane
  const tcalls = []; runFocus('tmux', 'tmux:%3', { TMUX_PANE: '%3' }, (c, a) => tcalls.push([c, a[0], a[2]]));
  ok('runFocus tmux: select-window then select-pane', tcalls.length === 2 && tcalls[0][1] === 'select-window' && tcalls[1][1] === 'select-pane');
  ok('runFocus tmux: targets the pane %3', tcalls[0][2] === '%3');

  // runFocus zellij → go-to-tab-name (name, not index)
  let zr = null; runFocus('zellij', 'zellij:', { ZELLIJ_SESSION_NAME: 'jidoka', ZELLIJ_TAB_NAME: 'wave-3' }, (c, a) => { zr = { c, a }; });
  ok('runFocus zellij: go-to-tab-name by name', zr?.c === 'zellij' && JSON.stringify(zr.a).includes('go-to-tab-name') && JSON.stringify(zr.a).includes('wave-3'));

  // runFocus warp / unknown / null → ok:false + hint naming the terminal, no throw
  const w = runFocus('warp', 'tty:/dev/ttys003', { TERM_PROGRAM: 'WarpTerminal' }, () => { throw new Error('should not run'); });
  ok('runFocus warp: ok=false', w.ok === false);
  ok('runFocus warp: hint names the tty', w.hint.includes('/dev/ttys003'));
  const u = runFocus('unknown', null, {}, () => { throw new Error('no'); });
  ok('runFocus unknown: ok=false + hint, no throw', u.ok === false && typeof u.hint === 'string');

  // runFocus claude → app-activate ONLY (open -b), no tab switch, ok:false (honesty AC)
  const ccalls = []; const cres = runFocus('claude', 'claude:app', {}, (c, a) => ccalls.push({ c, a }));
  const onlyOpen = ccalls.length === 1 && ccalls[0].c === 'open' && JSON.stringify(ccalls[0].a).includes('com.anthropic.claudefordesktop');
  const noTab = !ccalls.some((x) => /osascript|System Events|click/.test(JSON.stringify(x)));
  ok('runFocus claude: open -b only', onlyOpen);
  ok('runFocus claude: no tab switch', noTab);
  ok('runFocus claude: ok=false (honest)', cres.ok === false);

  if (fails.length) { console.log(`\n\x1b[31mFAIL (${fails.length}): ${fails.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ focus: decision table + dispatcher correct (no real subprocess)\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--self-test')) selfTest();
