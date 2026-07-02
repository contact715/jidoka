#!/usr/bin/env node
// commit-lock — a short-lived, per-REPO lease that serialises the commit+push critical
// section so that N parallel Claude sessions can NEVER lose each other's commits.
//
// WHY THIS EXISTS (2026-07-02): session-lock guards a WORKING TREE (who owns a folder).
// It does not stop two sessions, each in their own worktree/branch, from racing to update
// the SAME remote main — session A pushes, session B (who fetched before A pushed) pushes
// on top and A's history is buried or B's push is rejected and hand-fixed under pressure.
// The fix is not "hope the fetch is fresh" (the number lives only in memory until push);
// it is to make "fetch → rebase-onto-origin → push" ATOMIC per repo. This lease is that
// mutex: while one session holds it, no other session enters the commit section for the
// same repo. Combined with rebase-then-push, a fast-forward push is then guaranteed.
//
// HONEST SPLIT (same discipline as session-lock.mjs):
//   MECHANICAL (this script): the lease — acquire (blocking, with wait+retry), classify,
//   release, check. Deterministic, self-tested.
//   SEMANTIC (safe-commit.mjs / the model): what to DO inside the section (rebase, resolve
//   a conflict, decide push target). commit-lock only guarantees exclusivity.
//
// The lease is keyed by REPO IDENTITY (remote URL if present, else the toplevel path), so
// the same repo checked out in several worktrees shares ONE lock. TTL is short: a commit
// section that has not refreshed for TTL is assumed dead and is free to take over — a
// crashed session must not hold a repo hostage.
//
// FULL & self-tested. Usage:
//   node scripts/commit-lock.mjs --self-test
//   node scripts/commit-lock.mjs --acquire --repo <id> --session <id> [--wait 120] [--note "..."]
//   node scripts/commit-lock.mjs --release --repo <id> --session <id>
//   node scripts/commit-lock.mjs --check   --repo <id>

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

const TTL_MS = 10 * 60 * 1000;      // a commit section idle for 10 min is assumed dead
const POLL_MS = 1500;               // how often --acquire re-checks a held lock
const LOCK_DIR = join(process.env.HOME || '', '.claude', 'session-env', 'commit-locks');

// pure: lock-file name for a repo identity (hash keeps any url/path filesystem-safe)
export function lockName(repoId) {
  return createHash('sha1').update(String(repoId || '')).digest('hex').slice(0, 16) + '.json';
}

// pure: classify an existing lease against the asking session.
//   'free'     — no lease / unreadable
//   'owned'    — same session already holds it (re-entrant refresh)
//   'stale'    — holder dead OR lease expired (safe to take over)
//   'conflict' — ANOTHER live session holds this repo's commit section
export function classify(lease, sessionId, now, pidAlive, ttlMs = TTL_MS) {
  if (!lease || typeof lease !== 'object' || !lease.session_id) return 'free';
  if (lease.session_id === sessionId) return 'owned';
  if (lease.ts == null || now - lease.ts > ttlMs) return 'stale';
  if (!pidAlive) return 'stale';
  return 'conflict';
}

// pure: plain-language line describing who holds the section
export function holderLine(lease) {
  if (!lease || !lease.session_id) return 'no holder';
  const ageS = lease.ts ? Math.round((Date.now() - lease.ts) / 1000) : '?';
  return `session ${String(lease.session_id).slice(0, 8)} (pid ${lease.pid}, ${ageS}s ago${lease.note ? ', ' + lease.note : ''})`;
}

// ---- IO layer ----
const lockPath = (repoId) => join(LOCK_DIR, lockName(repoId));
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readLease = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function writeLease(p, lease) {
  mkdirSync(LOCK_DIR, { recursive: true });
  writeFileSync(p, JSON.stringify(lease, null, 2));
}

// acquire — blocking with wait+retry. Resolves { ok, status, holder }.
export async function acquire({ repoId, sessionId, note = '', waitMs = 120000, ttlMs = TTL_MS, pollMs = POLL_MS }) {
  const p = lockPath(repoId);
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const lease = readLease(p);
    const state = classify(lease, sessionId, Date.now(), lease && isAlive(lease.pid), ttlMs);
    if (state === 'conflict' && Date.now() < deadline) { await sleep(pollMs); continue; }
    if (state === 'conflict') return { ok: false, status: 'timeout', holder: lease };
    writeLease(p, { session_id: sessionId, pid: process.pid, host: hostname(), repo: repoId, note, ts: Date.now() });
    return { ok: true, status: state === 'owned' ? 'refreshed' : state === 'stale' ? 'took-over' : 'acquired' };
  }
}

export function release({ repoId, sessionId }) {
  const p = lockPath(repoId);
  const lease = readLease(p);
  if (!lease) return { ok: true, status: 'already-free' };
  if (lease.session_id !== sessionId) return { ok: false, status: 'not-owner', holder: lease };
  try { unlinkSync(p); } catch {}
  return { ok: true, status: 'released' };
}

export function check({ repoId }) {
  const lease = readLease(lockPath(repoId));
  const alive = lease && isAlive(lease.pid);
  return { state: classify(lease, '\0none', Date.now(), alive), holder: lease };
}

// ---- self-test (pure logic, no real git) ----
function selfTest() {
  const now = 1_000_000;
  const T = [
    ['no lease → free', classify(null, 's1', now, false) === 'free'],
    ['same session → owned', classify({ session_id: 's1', ts: now, pid: 1 }, 's1', now, true) === 'owned'],
    ['expired lease → stale', classify({ session_id: 's2', ts: now - TTL_MS - 1, pid: 1 }, 's1', now, true) === 'stale'],
    ['dead holder → stale', classify({ session_id: 's2', ts: now, pid: 1 }, 's1', now, false) === 'stale'],
    ['live other holder → conflict', classify({ session_id: 's2', ts: now, pid: 1 }, 's1', now, true) === 'conflict'],
    ['same repo id → same lock file', lockName('git@github.com:contact715/jidoka.git') === lockName('git@github.com:contact715/jidoka.git')],
    ['different repo id → different lock file', lockName('a') !== lockName('b')],
    ['holderLine names the session', holderLine({ session_id: 'abcdef123', pid: 42, ts: Date.now() }).includes('abcdef12')],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mcommit-lock self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ commit-lock: lease logic correct\x1b[0m');
  process.exit(0);
}

// ---- CLI (only when run directly, NOT when imported by safe-commit) ----
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (k) => process.argv.includes(k);
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;

if (!isMain) { /* imported as a module — expose functions, run no CLI */ }
else if (has('--self-test')) selfTest();
else if (has('--acquire')) {
  const r = await acquire({ repoId: arg('--repo'), sessionId: arg('--session') || String(process.pid), note: arg('--note') || '', waitMs: (Number(arg('--wait')) || 120) * 1000 });
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
} else if (has('--release')) {
  const r = release({ repoId: arg('--repo'), sessionId: arg('--session') || String(process.pid) });
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
} else if (has('--check')) {
  const r = check({ repoId: arg('--repo') });
  console.log(`${r.state}${r.holder ? ' — ' + holderLine(r.holder) : ''}`);
  process.exit(0);
} else {
  console.log('commit-lock — usage: --self-test | --acquire --repo <id> --session <id> [--wait N] | --release --repo <id> --session <id> | --check --repo <id>');
  process.exit(0);
}
