#!/usr/bin/env node
// @closes-class: precedent-generalized-into-standing-permission
// permission-gate — PreToolUse hook on Bash. Blocks the actions that are only ever allowed by
// an explicit, scoped, expiring permission, and refuses to accept precedent as a substitute.
//
// scoped-expiring-permission (2026-W32-K1). Engine copy of the ledger:
// ~/.claude/jidoka/scripts/permission-ledger.mjs (canon: ~/jidoka-framework/scripts/).
//
// Today it guards one action, the one that was measurably drifting: `git ... --no-verify`.
// Three bypasses in four weeks, two of them justified in the transcript by "the owner allowed
// this once in exactly this situation" rather than by a live permission.
//
// FAIL-OPEN by construction: any internal error, missing ledger, unreadable input → exit 0.
// A guard that breaks the session is worse than the drift it prevents.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEDGER = process.env.JIDOKA_PERMISSIONS || join(homedir(), '.jidoka', 'permissions.jsonl');

/**
 * Strip everything that is DATA rather than command syntax: heredoc bodies, and single- or
 * double-quoted strings. Without this the guard fires on a MENTION of the flag instead of on
 * its use — which it did, on its own commit message, five minutes after being written. A
 * guard that cannot tell "doing X" from "writing about X" is noise, and noise gets bypassed.
 */
export function commandSkeleton(cmd = '') {
  let s = String(cmd);
  // heredoc bodies: <<'EOF' ... EOF  /  <<EOF ... EOF  /  <<-EOF
  s = s.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, ' <<HEREDOC ');
  // an unterminated heredoc (the body runs to the end of the command)
  s = s.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*$/m, ' <<HEREDOC ');
  s = s.replace(/'[^']*'/g, " '' ");      // single-quoted
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, ' "" '); // double-quoted
  return s;
}

// what we guard: [action name, detector]. Detectors run on the SKELETON, never on raw text.
const GUARDED = [
  {
    action: 'git-no-verify',
    // only a WRITING git command matters; `git log --no-verify` is not a thing, but be precise
    test: (skeleton) => /\bgit\b/.test(skeleton) && /--no-verify\b/.test(skeleton) && /\b(commit|push|merge|rebase)\b/.test(skeleton),
    what: 'обход pre-commit / pre-push проверок',
  },
];

// ── self-test ────────────────────────────────────────────────────────────────
// The first case is the one that actually happened: this guard blocked the very commit that
// introduced it, because the flag was named inside the commit message.
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const fires = (cmd) => GUARDED[0].test(commandSkeleton(cmd));

  ok('real bypass fires', fires('git push --no-verify origin main') === true);
  ok('real bypass on commit fires', fires('git commit --no-verify -m x') === true);
  ok('ordinary push does not fire', fires('git push origin main') === false);
  ok('non-git command does not fire', fires('npm run build -- --no-verify') === false);

  // the incident: the flag NAMED inside a heredoc commit message
  const heredoc = ["git commit -q -F - <<'EOF'", 'feat: guard', '', 'Six encounters with `git ... --no-verify`, three bypasses.', 'EOF'].join('\n');
  ok('flag mentioned inside a heredoc message does NOT fire', fires(heredoc) === false);
  ok('flag mentioned inside a single-quoted string does NOT fire', fires("git commit -m 'do not use --no-verify here'") === false);
  ok('flag mentioned inside a double-quoted string does NOT fire', fires('git commit -m "never pass --no-verify"') === false);
  ok('a real flag OUTSIDE quotes still fires alongside a quoted message',
    fires('git commit -m "ordinary message" --no-verify') === true);
  ok('heredoc that mentions it AND a real flag outside still fires',
    fires(["git commit --no-verify -F - <<'EOF'", 'about --no-verify', 'EOF'].join('\n')) === true);
  ok('unterminated heredoc is still stripped', fires("git commit -F - <<'EOF'\ntext about --no-verify") === false);
  ok('empty command does not fire', fires('') === false);

  if (fails) { console.log(`\n\x1b[31mpermission-gate self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ permission-gate: detects the ACTION, not a mention of it\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  const readStdin = () => new Promise((res) => {
    let d = '';
    process.stdin.on('data', (c) => { d += c; });
    process.stdin.on('end', () => res(d));
    setTimeout(() => res(d), 2000);
  });

  function scopeCovers(grantScope, target) {
    if (!grantScope) return false;
    if (grantScope === '*') return true;
    if (!target) return false;
    const g = String(grantScope).replace(/\/+$/, '');
    const t = String(target).replace(/\/+$/, '');
    return t === g || t.startsWith(`${g}/`);
  }

  function check(action, scope) {
    if (!existsSync(LEDGER)) return { allowed: false, reason: 'never granted (no permission ledger yet)' };
    const events = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const byId = new Map();
    for (const e of events) {
      if (!e || !e.id) continue;
      if (e.type === 'grant') byId.set(e.id, e);
      else if (e.type === 'revoke') byId.delete(e.id);
    }
    const now = Date.now();
    const live = [...byId.values()].filter((g) => typeof g.expiresAt === 'number' && g.expiresAt > now);
    const hit = live.find((g) => g.action === action && scopeCovers(g.scope, scope));
    if (hit) return { allowed: true, reason: `granted by ${hit.by || '?'}: "${hit.reason || ''}"` };
    const expired = events.filter((e) => e.type === 'grant' && e.action === action && scopeCovers(e.scope, scope) && e.expiresAt <= now);
    if (expired.length) {
      const last = expired.sort((a, b) => b.expiresAt - a.expiresAt)[0];
      return { allowed: false, expiredBefore: true, reason: `это уже разрешали однажды (${new Date(last.at).toISOString().slice(0, 10)}, «${last.reason || 'без причины'}»), и то разрешение истекло` };
    }
    return { allowed: false, reason: 'такого разрешения не давали' };
  }

  (async () => {
    let input = '';
    try { input = await readStdin(); } catch { process.exit(0); }
    let cmd = '', cwd = '';
    try {
      const j = JSON.parse(input);
      if (j.tool_name && j.tool_name !== 'Bash') process.exit(0);
      cmd = (j.tool_input && j.tool_input.command) || '';
      cwd = j.cwd || process.cwd();
    } catch { process.exit(0); }
    if (!cmd) process.exit(0);

    let repo = cwd;
    try {
      repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 4000 }).trim() || cwd;
    } catch { /* not a git repo: fall back to cwd */ }

    const skeleton = commandSkeleton(cmd);
    for (const g of GUARDED) {
      let hit = false;
      try { hit = g.test(skeleton); } catch { hit = false; }
      if (!hit) continue;
      let verdict;
      try { verdict = check(g.action, repo); } catch { process.exit(0); } // fail-open
      if (verdict.allowed) {
        console.error(`permission-gate: ${g.action} разрешён (${verdict.reason})`);
        process.exit(0);
      }
      console.error([
        `permission-gate: ${g.what} заблокирован.`,
        `  ${verdict.reason}.`,
        verdict.expiredBefore
          ? '  Прошлое «да» не делает разрешение постоянным. Нужно спросить заново.'
          : '  Это действие требует явного разрешения владельца, с областью и сроком.',
        '  Если владелец согласен, разрешение записывается так:',
        `    node ~/.claude/jidoka/scripts/permission-ledger.mjs grant ${g.action} --scope "${repo}" --hours 6 --by <кто> --reason "<почему именно сейчас>"`,
        '  Без записи обходить проверки нельзя: именно так одноразовое разрешение тихо становится правилом.',
      ].join('\n'));
      process.exit(2);
    }
    process.exit(0);
  })();
}
