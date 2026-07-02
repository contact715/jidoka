#!/usr/bin/env node
// session-lock — file-based lease so TWO Claude sessions don't fight over ONE working tree.
//
// WHY THIS EXISTS (the live case it was born from, 2026-06-05): while one session was
// mid-merge in projectx-app, a second session mass-edited docs/specs/** in the SAME
// working tree (Edit failed with "file modified since read"), and force-updated the
// branch the first session was about to push. Hours of careful merge work nearly lost.
// The worktree-isolation idea existed in docs but had NO mechanical half.
//
// HONEST SPLIT (same discipline as spec-drift-check.mjs):
//   MECHANICAL (this script): one lease file per project directory; the FIRST session
//   holds it, every other session gets a LOUD warning naming the holder. Deterministic.
//   SEMANTIC (the model): deciding what to do — switch to an isolated worktree
//   (EnterWorktree), coordinate with the other session, or consciously proceed.
//   The lock WARNS, it does not hard-block: the human may intentionally run two
//   sessions and accept the risk. A silent race is the failure mode, not parallelism.
//
// MECHANICS: lease = JSON file in ~/.claude/session-env/locks/<hash-of-cwd>.json
//   { session_id, pid, cwd, ts }. Acquired/refreshed via the --hook entry on
//   SessionStart + UserPromptSubmit. A lease is STALE (free to take over) when its
//   pid is dead OR its ts is older than TTL (default 30 min — an abandoned session
//   should not hold a directory hostage).
//
// FULL & self-tested. Usage:
//   node session-lock.mjs --self-test
//   echo '{"session_id":"abc","cwd":"/path"}' | node session-lock.mjs --hook
//   node session-lock.mjs --check   --cwd /path
//   node session-lock.mjs --release --cwd /path --session abc

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

const TTL_MS = 30 * 60 * 1000; // a lease not refreshed for 30 min is abandoned

const LOCK_DIR = join(process.env.HOME || '', '.claude', 'session-env', 'locks');

// pure: lock-file name for a directory (hash keeps any path filesystem-safe)
export function lockName(cwd) {
  return createHash('sha1').update(String(cwd || '')).digest('hex').slice(0, 16) + '.json';
}

// pure: classify an existing lease against the asking session.
//   returns 'free'      — no lease / unreadable lease
//           'owned'     — same session already holds it (refresh)
//           'stale'     — holder dead or lease expired (take over)
//           'conflict'  — ANOTHER live session holds this directory
export function classify(lease, sessionId, now, pidAlive, ttlMs = TTL_MS) {
  if (!lease || typeof lease !== 'object' || !lease.session_id) return 'free';
  if (lease.session_id === sessionId) return 'owned';
  if (lease.ts == null || now - lease.ts > ttlMs) return 'stale';
  if (!pidAlive) return 'stale';
  return 'conflict';
}

// pure: the warning the user/model sees on a conflict — plain language, names the holder
export function conflictMessage(lease, cwd) {
  const ageMin = lease.ts ? Math.round((Date.now() - lease.ts) / 60000) : '?';
  return (
    `⚠ Папка ${cwd} уже занята другой сессией Claude (id ${String(lease.session_id).slice(0, 8)}…, ` +
    `активна ${ageMin} мин назад). Две сессии в одной папке перетирают правки друг друга. ` +
    `Правильный ход: работать из изолированной копии (EnterWorktree) или закрыть вторую сессию. ` +
    `Коммитить только через safe-commit.mjs — он сериализует пуш замком коммита, ` +
    `чтобы сессии не теряли историю друг друга (см. docs/PARALLEL_SESSIONS_PROTOCOL.md). ` +
    `Замок предупреждает, не блокирует — но молчаливая гонка уже стоила часов (2026-06-05).`
  );
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readLease(cwd) {
  try { return JSON.parse(readFileSync(join(LOCK_DIR, lockName(cwd)), 'utf8')); } catch { return null; }
}

function writeLease(cwd, sessionId) {
  mkdirSync(LOCK_DIR, { recursive: true });
  writeFileSync(
    join(LOCK_DIR, lockName(cwd)),
    JSON.stringify({ session_id: sessionId, pid: process.ppid || process.pid, cwd, ts: Date.now(), host: hostname() }),
    'utf8',
  );
}

// acquire-or-refresh; returns { state, lease } so the hook can build its output
export function acquire(cwd, sessionId) {
  const lease = readLease(cwd);
  const state = classify(lease, sessionId, Date.now(), isPidAlive(lease?.pid));
  if (state !== 'conflict') writeLease(cwd, sessionId);
  return { state, lease };
}

function selfTest() {
  const now = 1000000;
  const live = { session_id: 'other', pid: 1, ts: now - 60000 };
  const T = [
    ['no lease → free', classify(null, 's', now, false) === 'free'],
    ['own lease → owned', classify({ session_id: 's', pid: 1, ts: now }, 's', now, true) === 'owned'],
    ['другая живая сессия → conflict', classify(live, 's', now, true) === 'conflict'],
    ['мёртвый pid → stale', classify(live, 's', now, false) === 'stale'],
    ['просроченная аренда → stale', classify({ session_id: 'o', pid: 1, ts: now - TTL_MS - 1 }, 's', now, true) === 'stale'],
    ['без ts → stale', classify({ session_id: 'o', pid: 1 }, 's', now, true) === 'stale'],
    ['lockName стабилен', lockName('/a/b') === lockName('/a/b') && lockName('/a/b') !== lockName('/a/c')],
    ['conflictMessage называет холдера', conflictMessage({ session_id: 'abcdef1234', ts: Date.now() }, '/p').includes('abcdef12')],
    ['real acquire→owned→release', (() => {
      const dir = `/tmp/session-lock-selftest-${process.pid}`;
      const a1 = acquire(dir, 'self-test-A');
      const a2 = acquire(dir, 'self-test-A');
      const a3 = acquire(dir, 'self-test-B'); // same pid → alive → conflict
      try { unlinkSync(join(LOCK_DIR, lockName(dir))); } catch { /* ok */ }
      return a1.state !== 'conflict' && a2.state === 'owned' && a3.state === 'conflict';
    })()],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31msession-lock self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ session-lock: lease logic correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] && process.argv[1].endsWith('session-lock.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] || true) : null; };

  if (argv.includes('--self-test')) selfTest();

  if (argv.includes('--hook')) {
    // stdin: Claude Code hook JSON (SessionStart / UserPromptSubmit)
    let ctx = {};
    try { ctx = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* none */ }
    const cwd = ctx.cwd || ctx.workspace?.current_dir || process.cwd();
    const sessionId = ctx.session_id || '';
    if (!sessionId) process.exit(0); // nothing to lease against
    const { state, lease } = acquire(cwd, sessionId);
    if (state === 'conflict') {
      const msg = conflictMessage(lease, cwd);
      process.stdout.write(JSON.stringify({
        systemMessage: msg,
        hookSpecificOutput: { hookEventName: ctx.hook_event_name || 'UserPromptSubmit', additionalContext: msg },
      }));
    }
    process.exit(0);
  }

  if (argv.includes('--check')) {
    const cwd = flag('--cwd') || process.cwd();
    const lease = readLease(cwd);
    const state = classify(lease, flag('--session') || '', Date.now(), isPidAlive(lease?.pid));
    console.log(JSON.stringify({ state, lease }, null, 2));
    process.exit(0);
  }

  if (argv.includes('--release')) {
    const cwd = flag('--cwd') || process.cwd();
    const lease = readLease(cwd);
    if (lease && (!flag('--session') || lease.session_id === flag('--session'))) {
      try { unlinkSync(join(LOCK_DIR, lockName(cwd))); console.log('released'); } catch { /* ok */ }
    } else console.log('not owner / no lease');
    process.exit(0);
  }

  console.log('usage: session-lock.mjs --self-test | --hook | --check [--cwd d] | --release [--cwd d] [--session id]');
}
