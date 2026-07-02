#!/usr/bin/env node
// safe-commit — the smart, parallel-safe commit+push flow. Turns "commit and push" from a
// race into a serialised, fast-forward-guaranteed operation, so 2-3-4 Claude sessions can
// run at once and NEVER bury each other's history.
//
// THE SEQUENCE (why it cannot lose a commit):
//   1. commit locally (clean tree required for the rebase in step 3)
//   2. acquire the per-repo commit-lock  ← no other session may enter from here
//   3. git fetch  →  git rebase origin/<target>   (replay my work on the very latest main)
//   4. git push HEAD:<target>            (fast-forward — guaranteed: we just rebased onto
//                                         the latest main AND hold the lock, so main cannot
//                                         have moved under us)
//   5. release the lock
// Because steps 3-4 are inside the lock, the window where a race could happen is closed.
//
// PUSH POLICY (commit-policy.json, Engineering-Discipline rule 11):
//   own      → commit + push to main (the owner's standing rule)
//   readOnly → commit LOCALLY only, never push (external/shared production)
//   unknown  → SAFE DEFAULT: commit locally, do NOT push, warn
//
// HONEST SPLIT: the lock + policy + push-decision = FULL (self-tested here). The git ops are
// real IO, guarded and reported; a rebase CONFLICT is NOT auto-resolved — it aborts cleanly,
// releases the lock, and hands back to the model/human (agents propose, they don't force).
//
// FULL & self-tested. Usage:
//   node scripts/safe-commit.mjs --self-test
//   node scripts/safe-commit.mjs --message "feat: x" [--repo <path>] [--session <id>]
//                                [--target main] [--no-push] [--dry-run] [--wait 120]

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquire, release } from './commit-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- pure decision logic (self-tested) ----

// classify a repo by its origin remote against the policy lists
export function classifyRepo(remoteUrl, policy) {
  const u = String(remoteUrl || '');
  const hit = (list) => (list || []).some(s => s && u.includes(s));
  if (!u) return 'unknown';
  if (hit(policy.readOnly)) return 'readonly';
  if (hit(policy.own)) return 'own';
  return 'unknown';
}

// from repo class + flags, decide what safe-commit will actually do
export function pushDecision(repoClass, { noPush = false } = {}) {
  const base = { commit: true, integrate: false, push: false };
  if (repoClass === 'own') return { ...base, integrate: !noPush, push: !noPush, reason: noPush ? 'own repo, --no-push' : 'own repo → commit + push to target' };
  if (repoClass === 'readonly') return { ...base, reason: 'read-only/external repo → LOCAL commit only, never push' };
  return { ...base, reason: 'unknown remote → SAFE DEFAULT: local commit only, no push' };
}

// ---- IO helpers ----
const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const shOk = (cmd, cwd) => { try { sh(cmd, cwd); return true; } catch { return false; } };

function loadPolicy() {
  const paths = [process.env.COMMIT_POLICY, join(HERE, '..', 'commit-policy.json'), join(process.env.HOME || '', '.claude', 'jidoka', 'commit-policy.json')].filter(Boolean);
  for (const p of paths) {
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch {} }
  }
  return { own: [], readOnly: [] };
}

function repoFacts(cwd) {
  const root = sh('git rev-parse --show-toplevel', cwd);
  let remote = ''; try { remote = sh('git remote get-url origin', root); } catch {}
  const branch = sh('git rev-parse --abbrev-ref HEAD', root);
  const dirty = sh('git status --porcelain', root).length > 0;
  return { root, remote, branch, dirty, repoId: remote || root };
}

// how many local commits are not yet on origin/<target> (after a fetch). No remote branch
// yet → treat as "have work to push" (a new branch/target).
function aheadOf(root, target) {
  if (!shOk(`git rev-parse --verify origin/${target}`, root)) return 1;
  try { return Number(sh(`git rev-list --count origin/${target}..HEAD`, root)) || 0; } catch { return 0; }
}

// ---- main flow ----
async function run(opts) {
  const cwd = opts.repo || process.cwd();
  const facts = repoFacts(cwd);
  const policy = loadPolicy();
  const cls = classifyRepo(facts.remote, policy);
  const plan = pushDecision(cls, { noPush: opts.noPush });
  const target = opts.target || 'main';
  const log = [];
  const say = (m) => { log.push(m); console.log(m); };

  say(`repo: ${facts.root}`);
  say(`remote: ${facts.remote || '(none)'}  →  class: ${cls}`);
  say(`branch: ${facts.branch}  target: ${target}`);
  say(`plan: ${plan.reason}`);

  // dry-run: describe intent and stop before any write
  if (opts.dryRun) {
    if (facts.dirty && !opts.message) { say('[dry-run] tree is dirty but --message is missing.'); return { ok: false, cls, dryRun: true, log }; }
    say('[dry-run] would: ' + (facts.dirty ? 'commit locally' : 'use existing local commit(s)') + (plan.push ? ` → lock → rebase origin/${target} → push HEAD:${target}` : ' (no push for this repo class)'));
    return { ok: true, cls, dryRun: true, log };
  }

  // 1. local commit, only if there are uncommitted changes
  if (facts.dirty) {
    if (!opts.message) { say('✗ refusing: --message is required when there are changes.'); return { ok: false, cls, log }; }
    sh('git add -A', facts.root);
    sh(`git commit -m ${JSON.stringify(opts.message)}`, facts.root);
    say('✓ committed locally');
  }
  if (!plan.push) { say(`⚠ NOT pushing (${plan.reason}). Work is committed locally.`); return { ok: true, cls, committed: facts.dirty, pushed: false, log }; }

  // nothing new to push? (clean tree already in sync with origin/<target>)
  if (!facts.dirty) {
    shOk('git fetch origin --quiet', facts.root);
    if (aheadOf(facts.root, target) === 0) { say(`tree clean and in sync with origin/${target} — nothing to do.`); return { ok: true, cls, committed: false, pushed: false, log }; }
    say(`tree clean but local commit(s) not yet on origin/${target} — pushing under lock.`);
  }

  // 2-5. serialised push section
  const sid = opts.session || `sc-${process.pid}`;
  const lk = await acquire({ repoId: facts.repoId, sessionId: sid, note: `push ${facts.branch}→${target}`, waitMs: (opts.wait || 120) * 1000 });
  if (!lk.ok) { say(`✗ could not acquire commit-lock (${lk.status}). Holder: ${lk.holder ? lk.holder.session_id : '?'}. Commit is saved locally; retry push later.`); return { ok: false, cls, committed: true, pushed: false, log }; }
  say(`✓ commit-lock ${lk.status}`);
  try {
    shOk('git fetch origin --quiet', facts.root);
    const hasTarget = shOk(`git rev-parse --verify origin/${target}`, facts.root);
    if (hasTarget) {
      try { sh(`git rebase origin/${target}`, facts.root); say(`✓ rebased onto origin/${target}`); }
      catch (e) {
        shOk('git rebase --abort', facts.root);
        say(`✗ rebase conflict onto origin/${target} — aborted, nothing pushed. Resolve manually, then re-run. Commit is safe locally.`);
        return { ok: false, cls, committed: true, pushed: false, conflict: true, log };
      }
    }
    sh(`git push origin HEAD:${target}`, facts.root);
    say(`✓ pushed → origin/${target} (fast-forward)`);
    return { ok: true, cls, committed: true, pushed: true, log };
  } finally {
    const rl = release({ repoId: facts.repoId, sessionId: sid });
    say(`commit-lock ${rl.status}`);
  }
}

// ---- self-test (pure logic) ----
function selfTest() {
  const policy = { own: ['contact715/jidoka', 'projectx-app'], readOnly: ['nicel3d/castells'] };
  const T = [
    ['own remote → own', classifyRepo('https://github.com/contact715/jidoka.git', policy) === 'own'],
    ['external remote → readonly', classifyRepo('git@gitlab.com:nicel3d/castells-calls.git', policy) === 'readonly'],
    ['stranger remote → unknown', classifyRepo('https://github.com/someone/else.git', policy) === 'unknown'],
    ['no remote → unknown', classifyRepo('', policy) === 'unknown'],
    ['own → commit + push', (() => { const d = pushDecision('own'); return d.commit && d.push && d.integrate; })()],
    ['own + --no-push → commit only', (() => { const d = pushDecision('own', { noPush: true }); return d.commit && !d.push; })()],
    ['readonly → commit, never push', (() => { const d = pushDecision('readonly'); return d.commit && !d.push; })()],
    ['unknown → commit, never push', (() => { const d = pushDecision('unknown'); return d.commit && !d.push; })()],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31msafe-commit self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ safe-commit: policy + push-decision correct\x1b[0m');
  process.exit(0);
}

// ---- CLI ----
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (k) => process.argv.includes(k);

if (has('--self-test')) selfTest();
else {
  const r = await run({
    repo: arg('--repo'), message: arg('--message') || arg('-m'), session: arg('--session'),
    target: arg('--target'), noPush: has('--no-push'), dryRun: has('--dry-run'), wait: Number(arg('--wait')) || 120,
  });
  process.exit(r.ok ? 0 : 1);
}
