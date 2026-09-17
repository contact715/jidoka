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
// FULL & self-tested. Usage (full text: --help, the USAGE constant below):
//   node scripts/safe-commit.mjs --self-test
//   node scripts/safe-commit.mjs --help
//   node scripts/safe-commit.mjs --message "feat: x" [--repo <path>] [--session <id>]
//                                [--target main] [--no-push] [--dry-run] [--wait 120]
// An unknown flag exits 2 before any git call (2026-09-16: `--help` used to run the flow).

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync, statSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseCli as parseStrict, runCli } from './lib/cli.mjs';
import { acquire, release } from './commit-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// only-staged-flag (2026-W32-S1) — safe-commit used to run `git add -A` unconditionally.
// That is right for a lone session ("commit everything I did") and dangerous the moment a
// second session holds unfinished work in the same tree. 2026-07-31: an agent staged five
// text files explicitly, called safe-commit, and `git add -A` swept in 66+ files belonging to
// a parallel session, including a 140 MB webpack cache. Nothing in the engine noticed; the
// push failed only because GitHub rejects files that large. History was saved by an external
// size limit, not by us.
//
// Two changes, both here:
//   --only-staged   commit exactly what the caller staged, never widen the selection
//   sweep guard     before a wide `git add -A`, look at what would be swept and REFUSE when it
//                   carries the fingerprints of someone else's working tree
//
// The guard is deliberately about SHAPE, not about count alone: a build artifact or a huge
// file in an unstaged tree is the signal that this tree is not exclusively yours.

export const ARTIFACT_PATTERNS = [
  /(^|\/)node_modules\//, /(^|\/)\.next(-[\w-]+)?\//, /(^|\/)dist\//, /(^|\/)build\//,
  /(^|\/)\.turbo\//, /(^|\/)coverage\//, /(^|\/)\.cache\//, /(^|\/)target\//,
  /(^|\/)__pycache__\//, /\.log$/,
];

export const SWEEP_FILE_LIMIT = 25;          // files
export const SWEEP_SIZE_LIMIT = 25 * 1024 * 1024; // bytes, well under GitHub's 100 MB refusal

/** Parse `git status --porcelain` into {path, staged} rows. Pure. */
export function parseStatus(porcelain = '') {
  const out = [];
  for (const line of String(porcelain).split('\n')) {
    if (line.length < 4) continue;
    const x = line[0], y = line[1];
    let path = line.slice(3).trim();
    if (path.includes(' -> ')) path = path.split(' -> ').pop().trim();     // rename
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1); // quoted path
    out.push({ path, staged: x !== ' ' && x !== '?', untracked: x === '?' && y === '?' });
  }
  return out;
}

/**
 * Would a wide `git add -A` sweep in someone else's work? Pure.
 * @param {string} porcelain   output of `git status --porcelain`
 * @param {(p:string)=>number} sizeOf  bytes on disk for a path (0 when unknown)
 */
export function sweepRisk(porcelain, sizeOf = () => 0) {
  const rows = parseStatus(porcelain);
  const unstaged = rows.filter(r => !r.staged);
  const reasons = [];

  const artifacts = unstaged.filter(r => ARTIFACT_PATTERNS.some(re => re.test(r.path)));
  if (artifacts.length) {
    reasons.push(`${artifacts.length} build-artifact path(s) would be swept in, e.g. ${artifacts[0].path}`);
  }
  const huge = unstaged.map(r => ({ ...r, size: sizeOf(r.path) })).filter(r => r.size > SWEEP_SIZE_LIMIT);
  if (huge.length) {
    reasons.push(`${huge.length} file(s) over ${Math.round(SWEEP_SIZE_LIMIT / 1024 / 1024)} MB, e.g. ${huge[0].path} (${Math.round(huge[0].size / 1024 / 1024)} MB)`);
  }
  if (unstaged.length > SWEEP_FILE_LIMIT) {
    reasons.push(`${unstaged.length} unstaged path(s), over the ${SWEEP_FILE_LIMIT}-file limit, which looks like a second session's tree`);
  }
  return { risky: reasons.length > 0, reasons, unstagedCount: unstaged.length, stagedCount: rows.length - unstaged.length };
}

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

// hook-refusal-readable (2026-09-16) — a hook that says "no" is an answer, not a crash.
// `sh()` throws on a non-zero exit, and the commit and push calls did not catch it: Node
// printed the error object with a stack and clipped the hook's text ("... 8910 more
// characters"). Twice that day the reason (oracle-divergence in pre-commit,
// spec-structural-gate in pre-push) had to be recovered by running the hook by hand.
// Now git's whole output is printed as is, then one verdict line, and the run exits 1.
// The verdict names what happened and what is left: git exits 128 when it dies on its own
// (no identity, no network), a remote refusal carries "[rejected]", everything else on
// exit 1 is the hook. A refused commit leaves staged changes, not a commit.
/** @param {'commit'|'push'} step  @param {{stdout?:string, stderr?:string, status?:number|null, message?:string}} failure */
export function gitRefusal(step, { stdout = '', stderr = '', status = null, message = '' } = {}) {
  const streams = [stdout, stderr].map(s => String(s ?? '').replace(/\s+$/, '')).filter(Boolean);
  const output = streams.length ? streams.join('\n') : String(message ?? '').trim();
  const who = status === 128 ? `git ${step} failed`
    : step === 'push' && /\[(remote )?rejected\]/.test(output) ? 'push rejected by the remote'
    : `refused by ${step} hook`;
  const left = step === 'push' ? 'commit is saved locally, nothing was pushed'
    : 'nothing was committed, the changes stay staged';
  const code = Number.isInteger(status) ? ` (git exit ${status})` : '';
  return { output, verdict: `✗ ${who} — ${left}${code}` };
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
    // only-staged-flag: never widen the caller's selection when they asked for precision,
    // and refuse a wide sweep that carries another session's tree with it.
    if (opts.onlyStaged) {
      const staged = sh('git diff --cached --name-only', facts.root).trim();
      if (!staged) { say('✗ refusing: --only-staged given but the index is empty. Stage the paths you mean first.'); return { ok: false, cls, log }; }
      say(`--only-staged: committing ${staged.split('\n').length} staged path(s), leaving the rest of the tree alone`);
    } else {
      const porcelain = sh('git status --porcelain', facts.root);
      const sizeOf = (p) => { try { return statSync(join(facts.root, p)).size; } catch { return 0; } };
      const risk = sweepRisk(porcelain, sizeOf);
      if (risk.risky && !opts.forceSweep) {
        say('✗ refusing to `git add -A`: this tree does not look exclusively yours.');
        for (const r of risk.reasons) say(`    ${r}`);
        say('    Stage exactly what you mean and re-run with --only-staged, or pass --force-sweep');
        say('    if you are certain every unstaged change is yours. (2026-07-31: an unconditional');
        say('    add -A swept 66 files and a 140 MB cache from a parallel session into one commit.)');
        return { ok: false, cls, log };
      }
      sh('git add -A', facts.root);
    }
    // via a message file so multi-line messages keep their newlines (‑m would literalise them)
    const msgFile = join(tmpdir(), `safe-commit-${process.pid}.txt`);
    writeFileSync(msgFile, opts.message);
    try { sh(`git commit -F ${JSON.stringify(msgFile)}`, facts.root); }
    catch (e) {
      const r = gitRefusal('commit', e);
      if (r.output) say(r.output);
      say(r.verdict);
      return { ok: false, cls, committed: false, pushed: false, refusedAt: 'commit', log };
    } finally { try { unlinkSync(msgFile); } catch {} }
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
    try { sh(`git push origin HEAD:${target}`, facts.root); }
    catch (e) {
      const r = gitRefusal('push', e);
      if (r.output) say(r.output);
      say(r.verdict);
      return { ok: false, cls, committed: true, pushed: false, refusedAt: 'push', log };
    }
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
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  // ── sweep guard (2026-W32-S1) — the 2026-07-31 incident shape ────────────
  {
    // git status --porcelain as it looked that night: five staged text files of mine,
    // plus a parallel session's tree including a webpack cache.
    const mine = ['M  docs/a.md', 'M  docs/b.md', 'A  docs/c.md', 'M  docs/d.md', 'M  docs/e.md'];
    const theirs = [' M app/x.tsx', '?? .next-mocks/cache/0.pack', ' M lib/y.ts'];
    const porcelain = [...mine, ...theirs].join('\n');

    const rows = parseStatus(porcelain);
    ok('parseStatus splits staged from unstaged', rows.filter(r => r.staged).length === 5 && rows.filter(r => !r.staged).length === 3);
    ok('parseStatus handles a rename arrow', parseStatus('R  old.md -> new.md')[0].path === 'new.md');
    ok('parseStatus handles a quoted path', parseStatus('?? "with space.md"')[0].path === 'with space.md');
    ok('parseStatus ignores blank/short lines', parseStatus('\n\nM  a.md\n').length === 1);

    const big = (p) => (p.includes('.next-mocks') ? 140 * 1024 * 1024 : 1024);
    const risk = sweepRisk(porcelain, big);
    ok('sweep guard fires on the real incident shape', risk.risky === true);
    ok('sweep guard names the build artifact', risk.reasons.join(' ').includes('.next-mocks'));
    ok('sweep guard names the 140 MB file', risk.reasons.join(' ').includes('140 MB'));
    ok('sweep guard counts staged vs unstaged', risk.stagedCount === 5 && risk.unstagedCount === 3);

    // a lone session with ordinary unstaged work is NOT blocked
    const solo = ['M  a.md', ' M b.md', ' M c.md'].join('\n');
    ok('ordinary solo tree is not flagged', sweepRisk(solo, () => 1024).risky === false);

    // each trigger fires on its own
    ok('artifact path alone triggers', sweepRisk(' M node_modules/x/index.js', () => 10).risky === true);
    ok('oversize file alone triggers', sweepRisk(' M data.bin', () => 30 * 1024 * 1024).risky === true);
    ok('many unstaged files alone triggers',
      sweepRisk(Array.from({ length: 30 }, (_, i) => ` M f${i}.ts`).join('\n'), () => 10).risky === true);
    ok('exactly at the file limit is NOT flagged (strict >)',
      sweepRisk(Array.from({ length: 25 }, (_, i) => ` M f${i}.ts`).join('\n'), () => 10).risky === false);

    // a STAGED artifact is the caller's own decision, not a foreign sweep
    ok('a staged build artifact is not treated as someone else\'s tree',
      sweepRisk('A  dist/bundle.js', () => 10).risky === false);
    ok('empty status → no risk', sweepRisk('', () => 0).risky === false);
  }

  // ── CLI parsing (2026-09-16): `--help` was silently ignored and the full flow ran.
  // On a dirty tree it stopped only for lack of --message; on a clean tree with unpushed
  // commits it went on to `git push origin HEAD:main`. Unknown input must stop BEFORE any work.
  {
    const p = (argv) => parseCommitArgs(argv);
    ok('--help is recognised (long and short)', p(['--help']).help === true && p(['-h']).help === true);
    ok('unknown flag is an error', Boolean(p(['--bogus']).error));
    ok('unknown flag next to a valid --message is an error', Boolean(p(['--message', 'x', '--bogus']).error));
    ok('--message without a value is an error', Boolean(p(['--message']).error));
    ok('--message followed by a flag is an error', Boolean(p(['--message', '--dry-run']).error));
    ok('a positional argument is an error', Boolean(p(['feat: x']).error));
    ok('--wait must be a positive number', Boolean(p(['--wait', 'abc']).error) && Boolean(p(['--wait', '0']).error));
    ok('a message that starts with "- " is taken verbatim, like git -m', p(['--message', '- пункт']).opts?.message === '- пункт'
      && p(['-m', '-fix: typo in docs']).opts?.message === '-fix: typo in docs');
    ok('a flag-shaped message value is still an error (forgotten message must not become a commit)',
      Boolean(p(['-m', '--no-push']).error) && Boolean(p(['--message', '-x']).error));
    const full = p(['-m', 'feat: x', '--repo', '/r', '--session', 's', '--target', 'dev', '--no-push',
      '--dry-run', '--wait', '30', '--only-staged', '--force-sweep']);
    ok('every documented flag parses', !full.error && full.opts.message === 'feat: x' && full.opts.repo === '/r'
      && full.opts.session === 's' && full.opts.target === 'dev' && full.opts.noPush && full.opts.dryRun
      && full.opts.wait === 30 && full.opts.onlyStaged && full.opts.forceSweep);
    ok('no flags is valid (clean-tree push), wait defaults to 120', !p([]).error && p([]).opts.wait === 120);

    // end to end, from a directory that is NOT a git repo: any work at all would fail on git
    const cli = (...a) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...a], { encoding: 'utf8', cwd: tmpdir() });
    const help = cli('--help');
    ok('--help from the shell: exit 0, usage printed, no git touched',
      help.status === 0 && help.stdout.includes('--message') && !/fatal|repo:/.test(help.stdout + help.stderr));
    const bogus = cli('--bogus');
    ok('unknown flag from the shell: exit 2 before any work',
      bogus.status === 2 && bogus.stderr.includes('--bogus') && !/fatal|repo:/.test(bogus.stdout + bogus.stderr));
  }

  refusalChecks(ok);

  if (fails) { console.log('\n\x1b[31msafe-commit self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ safe-commit: policy + push-decision correct\x1b[0m');
  process.exit(0);
}

// A throwaway repo whose hook refuses with a long report, the way real gates do, and one
// safe-commit run against it. HOME points into the sandbox, so the commit-lock and git's
// global config never touch the machine; GIT_* from a calling hook are dropped for the same
// reason. For 'push' the origin is a local bare repo that a sandbox policy calls "own".
function refusalSandbox(step) {
  const root = mkdtempSync(join(tmpdir(), 'safe-commit-refusal-'));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), HOME: root, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args, cwd = repo) => spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  const repo = join(root, 'repo'), hooks = join(root, 'hooks'), bare = join(root, 'origin.git');
  try {
    mkdirSync(repo); mkdirSync(hooks);
    git(['init', '-q']);
    for (const [k, v] of [['user.email', 'sc@test'], ['user.name', 'sc'], ['commit.gpgsign', 'false']]) git(['config', k, v]);
    git(['commit', '-q', '--allow-empty', '-m', 'init']);
    const reason = `${step.toUpperCase()}-REFUSAL-REASON-AT-THE-END`;
    const report = 'i=0\nwhile [ $i -lt 400 ]; do echo "gate report line $i: padding padding padding"; i=$((i+1)); done\n';
    writeFileSync(join(hooks, `pre-${step}`), `#!/bin/sh\n${report}echo "${reason}"\nexit 1\n`, { mode: 0o755 });
    git(['config', 'core.hooksPath', hooks]);
    if (step === 'push') {
      git(['init', '-q', '--bare', bare], root);
      git(['remote', 'add', 'origin', bare]);
      env.COMMIT_POLICY = join(root, 'policy.json');
      writeFileSync(env.COMMIT_POLICY, JSON.stringify({ own: [bare], readOnly: [] }));
    }
    writeFileSync(join(repo, 'change.txt'), 'x\n');
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '-m', 'test: refusal', '--repo', repo, '--wait', '5'], { env, encoding: 'utf8' });
    const lockDir = join(root, '.claude', 'session-env', 'commit-locks');
    return {
      status: run.status, out: `${run.stdout}${run.stderr}`, reason,
      commits: Number(git(['rev-list', '--count', 'HEAD']).stdout.trim()),
      staged: git(['diff', '--cached', '--name-only']).stdout.trim(),
      locksLeft: existsSync(lockDir) ? readdirSync(lockDir).length : 0,
    };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// ── hook refusal (2026-09-16): the refusal text must reach the reader whole, with a verdict
// line and exit 1, never as a Node stack with "... N more characters".
function refusalChecks(ok) {
  const long = Array.from({ length: 400 }, (_, i) => `report line ${i}`).join('\n');
  const c = gitRefusal('commit', { stdout: '', stderr: `${long}\nREASON-TAIL\n`, status: 1 });
  ok('refusal keeps the whole hook text, tail included', c.output === `${long}\nREASON-TAIL`);
  ok('commit hook refusal: verdict line, nothing claimed as committed',
    c.verdict.startsWith('✗ refused by commit hook — ') && c.verdict.includes('nothing was committed') && !c.verdict.includes('saved locally'));
  const p = gitRefusal('push', { stdout: 'out part', stderr: 'err part\nerror: failed to push some refs', status: 1 });
  ok('push hook refusal: the requested verdict line', p.verdict.startsWith('✗ refused by push hook — commit is saved locally'));
  ok('stdout and stderr are both printed, stdout first', p.output === 'out part\nerr part\nerror: failed to push some refs');
  ok('a remote rejection is not called a hook refusal',
    gitRefusal('push', { stderr: ' ! [rejected]        HEAD -> main (fetch first)', status: 1 }).verdict.startsWith('✗ push rejected by the remote — '));
  ok('git dying on its own (exit 128) is not called a hook refusal',
    gitRefusal('push', { stderr: 'fatal: could not read Username', status: 128 }).verdict.startsWith('✗ git push failed — '));
  ok('no streams at all → the error message is shown instead of nothing',
    gitRefusal('commit', { message: 'spawnSync /bin/sh ENOENT' }).output === 'spawnSync /bin/sh ENOENT');

  const cm = refusalSandbox('commit');
  ok('pre-commit refusal from the shell: exit 1', cm.status === 1);
  ok('pre-commit refusal: the whole hook report is printed, first line to the tail',
    cm.out.includes('gate report line 0:') && cm.out.includes('gate report line 399:') && cm.out.includes(cm.reason));
  ok('pre-commit refusal: no Node stack, no clipping',
    !cm.out.includes('at file://') && !/more characters/.test(cm.out));
  ok('pre-commit refusal: verdict printed, no commit made, changes still staged',
    cm.out.includes('✗ refused by commit hook — ') && cm.commits === 1 && cm.staged === 'change.txt');

  const pu = refusalSandbox('push');
  ok('pre-push refusal from the shell: exit 1 with the whole report',
    pu.status === 1 && pu.out.includes('gate report line 0:') && pu.out.includes(pu.reason));
  ok('pre-push refusal: no Node stack, verdict says the commit is kept',
    !pu.out.includes('at file://') && pu.out.includes('✗ refused by push hook — commit is saved locally') && pu.commits === 2);
  ok('pre-push refusal: the commit-lock is released', pu.out.includes('commit-lock released') && pu.locksLeft === 0);
}

// ---- CLI ----
export const USAGE =`Usage:
  node scripts/safe-commit.mjs --message "feat: x" [--repo <path>] [--session <id>]
                               [--target main] [--no-push] [--dry-run] [--wait 120]
                               [--only-staged | --force-sweep]
  node scripts/safe-commit.mjs --self-test
  node scripts/safe-commit.mjs --help

  -m, --message <text>  commit message (required when the tree has changes)
      --repo <path>     repository to work in (default: current directory)
      --session <id>    commit-lock holder id (default: sc-<pid>)
      --target <branch> branch to rebase onto and push to (default: main)
      --no-push         commit locally, never push
      --dry-run         describe the plan, write nothing
      --wait <seconds>  how long to wait for the commit-lock (default: 120)
      --only-staged     commit exactly what is staged, never \`git add -A\`
      --force-sweep     allow \`git add -A\` even when the tree looks shared

A message starting with "-" is taken as is ("- item"); a flag-shaped one needs --message=-x.
Exit codes: 0 done, 1 refused or failed, 2 bad invocation (nothing was run).`;

// Strict on purpose: an unknown flag, a stray word or a flag without its value stops the
// script BEFORE any git call. The old parser ignored what it did not know, so `--help`
// ran the whole commit-and-push flow.
// A message value is taken verbatim, like `git commit -m`, so "- item" or "-fix: typo" pass.
// A value shaped like a flag ("--no-push", "-x") stays an error: a forgotten message must
// not quietly become a commit named after the next flag. Both rules live in scripts/lib/cli.mjs;
// the spec is exported so every call site of this script is checked against it.
export const CLI = {
  name: 'safe-commit',
  usage: USAGE,
  selfTest: true,
  options: {
    message: { type: 'string', short: 'm' },
    repo: { type: 'string' },
    session: { type: 'string' },
    target: { type: 'string' },
    wait: { type: 'number', default: 120 },
    'no-push': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    'only-staged': { type: 'boolean' },
    'force-sweep': { type: 'boolean' },
  },
};

function toOpts(r) {
  if (r.error) return { error: r.error };
  const { values } = r;
  if (!(values.wait > 0)) return { error: `--wait takes a positive number of seconds, got: ${values.wait}` };
  return {
    help: r.help,
    selfTest: r.selfTest,
    opts: {
      repo: values.repo, message: values.message, session: values.session, target: values.target,
      noPush: values['no-push'] === true, dryRun: values['dry-run'] === true, wait: values.wait,
      onlyStaged: values['only-staged'] === true, forceSweep: values['force-sweep'] === true,
    },
  };
}

/** Pure: parse argv against CLI (the self-test drives it directly). */
export function parseCommitArgs(argv) {
  return toOpts(parseStrict(argv, CLI));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const cli = toOpts(runCli(CLI));
  if (cli.error) { console.error(`safe-commit: bad invocation — ${cli.error}\nNothing was run.\n\n${USAGE}`); process.exit(2); }
  if (cli.selfTest) selfTest();
  else {
    const r = await run(cli.opts);
    process.exit(r.ok ? 0 : 1);
  }
}
