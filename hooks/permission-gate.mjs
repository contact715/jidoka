#!/usr/bin/env node
// @closes-class: precedent-generalized-into-standing-permission, agent-uses-shared-git-stash
// @scope: changed
// @scope-ok: вход это ОДНА команда из вызова инструмента плюс небольшой реестр разрешений; файлов проекта не читает
// @divergence: "a real flag OUTSIDE quotes still fires alongside a quoted message" — мера «вырезать всё в кавычках» сказала бы «чисто», а настоящий --no-verify вне кавычек остаётся обходом
// permission-gate — PreToolUse hook on every tool that runs a shell command (Bash, Monitor,
// mcp__terminal__run_in_terminal). Blocks the actions that are only ever allowed by an explicit,
// scoped, expiring permission, refuses to accept precedent as a substitute, and blocks outright
// the git stash forms that can take another session's work.
//
// scoped-expiring-permission (2026-W32-K1). Engine copy of the ledger:
// ~/.claude/jidoka/scripts/permission-ledger.mjs (canon: ~/jidoka-framework/scripts/).
//
// It guards two actions:
//   git-no-verify    — `git ... --no-verify`. Three bypasses in four weeks, two of them justified in
//                      the transcript by "the owner allowed this once" rather than by a live permission.
//                      Grantable through the ledger.
//   git-shared-stash — `git stash` in a form that can take ANOTHER session's entry (bare, save, pop,
//                      push without -m, apply without a sha, drop without a ref, clear…). The stash
//                      stack is shared by the main checkout and every worktree. Twice in one wave
//                      (projectx-app, 2026-09-17) an executor ran stash/pop although the brief forbade
//                      it. NOT grantable: a safe form always exists. Rule: hooks/lib/git-stash-rule.mjs,
//                      red-teamed the same day (scripts/__tests__/git-stash-guard.test.mjs).
//
// FAIL-OPEN by construction: any internal error, missing ledger, unreadable input → exit 0.
// A guard that breaks the session is worse than the drift it prevents.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCli } from './lib/load-cli.mjs';

// Строгий разбор аргументов (2026-09-16). Код отказа 1, а не 2: для Claude Code код 2 у
// PreToolUse значит «заблокировать вызов инструмента», и опечатка в settings.json заперла бы
// каждую команду Bash.
const HOOK_BAD_CALL_EXIT = 1;

const LEDGER = process.env.JIDOKA_PERMISSIONS || join(homedir(), '.jidoka', 'permissions.jsonl');

// Инструменты, которые исполняют команду оболочки из tool_input.command. Monitor и терминал
// добавлены 2026-09-17: через них тот же `git stash pop` шёл мимо проверки, заведённой на Bash.
const SHELL_TOOLS = new Set(['Bash', 'Monitor', 'mcp__terminal__run_in_terminal']);

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

// The stash rule is loaded lazily: a missing or broken module must switch off ONLY the stash check,
// not take the --no-verify guard down with it (a failed static import kills the whole hook).
let stashRule = null;
async function loadStashRule() {
  try {
    stashRule = await import('./lib/git-stash-rule.mjs');
  } catch (e) {
    stashRule = null;
    console.error(`permission-gate: правило git stash не загрузилось (${e.message}) — проверка stash пропущена`);
  }
}

// what we guard. `find` returns the offending forms; empty means clean.
// The --no-verify detector runs on the SKELETON (quoted text blanked out). The stash detector parses
// the RAW command into real shell words instead: `bash -c '…'` and "$(…)" are quoted AND executed,
// and the skeleton would blank exactly those out.
const GUARDED = [
  {
    action: 'git-no-verify',
    grantable: true,
    // only a WRITING git command matters; `git log --no-verify` is not a thing, but be precise
    find: ({ skeleton }) => (/\bgit\b/.test(skeleton) && /--no-verify\b/.test(skeleton) && /\b(commit|push|merge|rebase)\b/.test(skeleton)
      ? ['git … --no-verify'] : []),
    what: 'обход pre-commit / pre-push проверок',
  },
  {
    action: 'git-shared-stash',
    grantable: false,
    find: ({ raw }) => (stashRule ? stashRule.stashViolations(raw) : []).map((v) => `${v.form} — ${v.reason}`),
    what: 'общий стек git stash',
    advice: () => (stashRule ? stashRule.STASH_ADVICE : []),
  },
];

// ── self-test ────────────────────────────────────────────────────────────────
// The first case is the one that actually happened: this guard blocked the very commit that
// introduced it, because the flag was named inside the commit message.
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const fires = (cmd) => GUARDED[0].find({ skeleton: commandSkeleton(cmd), raw: cmd }).length > 0;

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

  // git stash: the shared stack. Real forms fire, mentions do not.
  const stash = (cmd) => GUARDED[1].find({ skeleton: commandSkeleton(cmd), raw: cmd }).length > 0;
  ok('git stash rule is loaded (otherwise every stash case below is a false green)', stashRule !== null);
  ok('git stash pop fires', stash('git stash pop') === true);
  ok('bare git stash fires', stash('git stash') === true);
  ok('git stash save fires', stash('git stash save wip') === true);
  ok('git stash push without -m fires', stash('git stash push -u') === true);
  ok('git stash apply without a sha fires', stash('git stash apply') === true);
  ok('git -C <dir> stash pop fires', stash('git -C /repo stash pop') === true);
  ok('stash in the middle of an && / ; chain fires', stash('cd /r && npm test; git stash && npm test') === true);
  ok("stash inside bash -c '…' fires", stash("bash -c 'git stash pop'") === true);
  ok('stash inside "$(…)" fires', stash('echo "$(git stash pop)"') === true);
  ok('tagged push passes', stash('git stash push -u -m "wave-368-base"') === false);
  ok('git stash list / show pass', stash('git stash list') === false && stash('git stash show -p') === false);
  ok('apply <sha> and drop <ref> pass', stash('git stash apply 3f2a9c1') === false && stash('git stash drop stash@{1}') === false);
  ok('a commit message that mentions git stash does NOT fire', stash('git commit -m "агент сделал git stash pop"') === false);
  ok('a heredoc commit body that mentions git stash does NOT fire',
    stash(["git commit -F - <<'EOF'", 'fix: forbid git stash', '', 'git stash && git stash pop', 'EOF'].join('\n')) === false);
  ok('a bare mention with echo does NOT fire', stash('echo git stash pop') === false);
  const advice = GUARDED[1].advice().join('\n');
  ok('the block names the WIP commit and the detached worktree', /WIP/.test(advice) && /git worktree add --detach/.test(advice));

  if (fails) { console.log(`\n\x1b[31mpermission-gate self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ permission-gate: detects the ACTION (--no-verify, git stash), not a mention of it\x1b[0m');
  process.exit(0);
}

// Разбор — первое, что делает хук: незнакомый флаг или лишнее слово — отказ до чтения stdin
// и реестра разрешений. Слово события хук не читает, поэтому слов не принимает.
export const CLI = {
  name: 'permission-gate',
  path: 'hooks/permission-gate.mjs',
  summary: 'Хук PreToolUse на Bash, Monitor и терминале: git --no-verify проходит только по живой записи в реестре разрешений; опасные формы git stash (общий стек сессий) блокируются всегда. Данные события — в stdin.',
  selfTest: true,
  badCallExit: HOOK_BAD_CALL_EXIT,
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const { selfTest: wantsSelfTest } = (await loadCli(import.meta.url)).runCli(CLI);
  await loadStashRule();
  if (wantsSelfTest) selfTest();

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
      if (j.tool_name && !SHELL_TOOLS.has(j.tool_name)) process.exit(0);
      cmd = (j.tool_input && typeof j.tool_input.command === 'string' && j.tool_input.command) || '';
      cwd = j.cwd || process.cwd();
    } catch { process.exit(0); }
    if (!cmd) process.exit(0);

    let repo = null;
    const repoOf = () => {
      if (repo !== null) return repo;
      repo = cwd;
      try {
        repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd;
      } catch { /* not a git repo: fall back to cwd */ }
      return repo;
    };

    // Находка красной команды 2026-09-17: живое разрешение на --no-verify завершало хук кодом 0
    // раньше, чем он доходил до проверки stash. Разрешение пропускает ТОЛЬКО своё действие:
    // после него цикл идёт дальше, выход с 0 — лишь когда проверены все.
    const skeleton = commandSkeleton(cmd);
    for (const g of GUARDED) {
      let hits = [];
      try { hits = g.find({ skeleton, raw: cmd }); } catch { hits = []; } // fail-open
      if (!hits.length) continue;
      if (!g.grantable) {
        console.error([
          `permission-gate: ${g.what} — команда заблокирована.`,
          ...hits.map((h) => `  · ${h}`),
          ...g.advice(),
        ].join('\n'));
        process.exit(2);
      }
      let verdict;
      try { verdict = check(g.action, repoOf()); } catch { continue; } // fail-open для ЭТОЙ проверки
      if (verdict.allowed) {
        console.error(`permission-gate: ${g.action} разрешён (${verdict.reason})`);
        continue;
      }
      console.error([
        `permission-gate: ${g.what} заблокирован.`,
        `  ${verdict.reason}.`,
        verdict.expiredBefore
          ? '  Прошлое «да» не делает разрешение постоянным. Нужно спросить заново.'
          : '  Это действие требует явного разрешения владельца, с областью и сроком.',
        '  Если владелец согласен, разрешение записывается так:',
        `    node ~/.claude/jidoka/scripts/permission-ledger.mjs grant ${g.action} --scope "${repoOf()}" --hours 6 --by <кто> --reason "<почему именно сейчас>"`,
        '  Без записи обходить проверки нельзя: именно так одноразовое разрешение тихо становится правилом.',
      ].join('\n'));
      process.exit(2);
    }
    process.exit(0);
  })();
}
