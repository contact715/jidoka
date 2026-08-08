#!/usr/bin/env node
// worktree-session — the whole life of an isolated working copy in one command.
//
// declarative-worktree-seed (2026-W32-R9, also executes 2026-W31-R7)
//
// WHY A FRESH WORKTREE IS USELESS BY DEFAULT. `git worktree add` gives a clean checkout of
// tracked files and nothing else. Everything a project actually needs to RUN is gitignored:
// .env, node_modules, build caches. So the isolated copy that was supposed to let a second
// session work safely cannot start a dev server, cannot run a build, and the session either
// gives up on isolation or starts editing the shared tree, which is how a parallel session's
// 66 files ended up in someone else's commit on 2026-07-31.
//
// The engine already had `dispatch-parallel-implementations.mjs`, which creates N worktrees for
// N attempts. It does not seed them and does not tear them down. That is the gap here, not the
// worktree creation itself.
//
// The idea is workmux's `files:` section (raine/workmux, 2k stars, Rust): declare which
// gitignored paths follow you into a fresh worktree, and whether they are copied or linked.
// Big directories are symlinked (node_modules is gigabytes and read-only in practice); small
// secrets are copied, because a symlinked .env edited in the worktree would silently rewrite
// the main one.
//
// Also here: a free TCP port per session, so two isolated copies can both run a dev server
// without fighting over 3000, and a teardown that REFUSES to delete work.
//
// Seed spec: .jidoka/worktree-seed.json, or the "worktreeSeed" key in package.json, or the
// built-in default. Shape: [{ "path": ".env", "mode": "copy" }, { "path": "node_modules", "mode": "link" }]
//
// Zero dependencies. Usage:
//   node scripts/worktree-session.mjs --self-test
//   node scripts/worktree-session.mjs create fix-login          # branch + worktree + seed + port
//   node scripts/worktree-session.mjs list
//   node scripts/worktree-session.mjs remove fix-login          # refuses if work would be lost

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, cpSync, symlinkSync, statSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

export const DEFAULT_SEED = [
  { path: '.env', mode: 'copy' },
  { path: '.env.local', mode: 'copy' },
  { path: '.env.development.local', mode: 'copy' },
  { path: 'node_modules', mode: 'link' },
  { path: '.venv', mode: 'link' },
];

// ── pure core ────────────────────────────────────────────────────────────────

/** Read a seed spec from whatever declared it, falling back to the default. Pure. */
export function resolveSeedSpec({ seedFile = null, pkg = null } = {}) {
  const fromFile = seedFile && Array.isArray(seedFile) ? seedFile : null;
  const fromPkg = pkg && Array.isArray(pkg.worktreeSeed) ? pkg.worktreeSeed : null;
  const spec = fromFile || fromPkg || DEFAULT_SEED;
  return spec
    .map((e) => (typeof e === 'string' ? { path: e, mode: 'copy' } : e))
    .filter((e) => e && typeof e.path === 'string' && e.path.trim())
    .map((e) => ({ path: e.path.trim(), mode: e.mode === 'link' ? 'link' : 'copy' }));
}

/**
 * What seeding would do. Pure: takes probes, returns actions and skips, touches nothing.
 * A path missing in the source is a SKIP, not an error — most projects have no .venv.
 */
export function planSeed(spec, { exists = () => false, isDir = () => false } = {}) {
  const actions = []; const skipped = [];
  for (const e of spec) {
    if (!exists(e.path)) { skipped.push({ ...e, why: 'нет в исходном дереве' }); continue; }
    // A directory declared as copy is a trap: node_modules copied per worktree eats the disk.
    const mode = e.mode === 'link' || isDir(e.path) ? 'link' : 'copy';
    actions.push({ path: e.path, mode, downgraded: mode !== e.mode });
  }
  return { actions, skipped };
}

/** First free port in a range. Pure given the probe. */
export function pickPort(isFree, start = 3100, end = 3199) {
  for (let p = start; p <= end; p++) if (isFree(p)) return p;
  return null;
}

/**
 * May this worktree be removed? Refuses on ANY uncommitted change or unpushed commit —
 * deleting a worktree deletes the work in it, and that is not recoverable from the reflog.
 * Pure.
 */
export function removalVerdict({ porcelain = '', ahead = 0, force = false } = {}) {
  const dirty = String(porcelain).split('\n').filter((l) => l.trim()).length;
  const reasons = [];
  if (dirty) reasons.push(`${dirty} незакоммиченных файл(ов)`);
  if (ahead > 0) reasons.push(`${ahead} коммит(ов) не отправлено`);
  if (!reasons.length) return { allowed: true, reason: 'чисто, всё отправлено' };
  if (force) return { allowed: true, reason: `удаляю по --force, теряю: ${reasons.join(', ')}` };
  return { allowed: false, reason: `отказ: ${reasons.join(', ')}. Сохрани работу или передай --force, если она правда не нужна.` };
}

/** Where a session's worktree lives. Pure. */
export const worktreePathFor = (repoRoot, name) => path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-wt-${name}`);
export const branchFor = (name) => `wt/${name}`;

// ── I/O ──────────────────────────────────────────────────────────────────────
const sh = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// quiet variant: git writes to stderr for perfectly normal states (a branch with no upstream),
// and that noise reads like a failure to whoever is watching.
const shq = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const portFree = (p) => new Promise((res) => {
  const s = createServer();
  s.once('error', () => res(false));
  s.once('listening', () => s.close(() => res(true)));
  s.listen(p, '127.0.0.1');
});

function loadSpec(root) {
  let seedFile = null; let pkg = null;
  try { seedFile = JSON.parse(readFileSync(path.join(root, '.jidoka/worktree-seed.json'), 'utf8')); } catch { /* none */ }
  try { pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { /* none */ }
  return resolveSeedSpec({ seedFile, pkg });
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  // spec resolution
  ok('default spec is used when nothing is declared', resolveSeedSpec().length === DEFAULT_SEED.length);
  ok('a package.json key overrides the default', resolveSeedSpec({ pkg: { worktreeSeed: ['.env'] } }).length === 1);
  ok('a seed file beats package.json', resolveSeedSpec({ seedFile: [{ path: 'a' }, { path: 'b' }], pkg: { worktreeSeed: ['.env'] } }).length === 2);
  ok('bare strings become copy entries', resolveSeedSpec({ pkg: { worktreeSeed: ['.env'] } })[0].mode === 'copy');
  ok('an unknown mode falls back to copy', resolveSeedSpec({ pkg: { worktreeSeed: [{ path: 'x', mode: 'teleport' }] } })[0].mode === 'copy');
  ok('empty entries are dropped', resolveSeedSpec({ pkg: { worktreeSeed: ['', '  ', null, { path: 'ok' }] } }).length === 1);

  // planning
  const spec = [{ path: '.env', mode: 'copy' }, { path: 'node_modules', mode: 'link' }, { path: '.venv', mode: 'link' }];
  const exists = (p) => p === '.env' || p === 'node_modules';
  const isDir = (p) => p === 'node_modules';
  const plan = planSeed(spec, { exists, isDir });
  ok('missing paths are skipped, not fatal', plan.skipped.length === 1 && plan.skipped[0].path === '.venv');
  ok('present paths become actions', plan.actions.length === 2);
  ok('a secret file is copied, not linked', plan.actions.find((a) => a.path === '.env').mode === 'copy');
  ok('a big directory is linked', plan.actions.find((a) => a.path === 'node_modules').mode === 'link');
  // the trap: a directory declared as copy would duplicate gigabytes per worktree
  const trap = planSeed([{ path: 'node_modules', mode: 'copy' }], { exists: () => true, isDir: () => true });
  ok('a directory declared as copy is downgraded to link', trap.actions[0].mode === 'link');
  ok('the downgrade is reported, not silent', trap.actions[0].downgraded === true);

  // ports
  ok('picks the first free port', pickPort((p) => p >= 3102, 3100, 3110) === 3102);
  ok('returns null when the whole range is busy', pickPort(() => false, 3100, 3102) === null);
  ok('a single-port range works', pickPort(() => true, 3100, 3100) === 3100);

  // removal safety
  ok('clean and pushed → may remove', removalVerdict({ porcelain: '', ahead: 0 }).allowed === true);
  ok('uncommitted changes → refuse', removalVerdict({ porcelain: ' M a.ts\n?? b.ts', ahead: 0 }).allowed === false);
  ok('refusal counts the files', /2 незакоммиченных/.test(removalVerdict({ porcelain: ' M a.ts\n?? b.ts' }).reason));
  ok('unpushed commits → refuse', removalVerdict({ porcelain: '', ahead: 2 }).allowed === false);
  ok('refusal names the unpushed commits', /2 коммит/.test(removalVerdict({ porcelain: '', ahead: 2 }).reason));
  ok('--force allows it', removalVerdict({ porcelain: ' M a.ts', ahead: 1, force: true }).allowed === true);
  ok('--force still states what is lost', /теряю/.test(removalVerdict({ porcelain: ' M a.ts', force: true }).reason));

  // naming
  ok('worktree sits beside the repo, not inside it', worktreePathFor('/x/repo', 'fix') === '/x/repo-wt-fix');
  ok('branch is namespaced', branchFor('fix') === 'wt/fix');

  if (fails) { console.log(`\n\x1b[31mworktree-session self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ worktree-session: seeding plan, port choice and removal safety correct\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('worktree-session.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const cmd = argv[0];
  const name = argv[1];
  const force = argv.includes('--force');

  let root;
  try { root = sh(['rev-parse', '--show-toplevel'], process.cwd()); }
  catch { console.error('worktree-session: не git-репозиторий'); process.exit(2); }

  if (cmd === 'list') {
    console.log(sh(['worktree', 'list'], root));
    process.exit(0);
  }

  if (cmd === 'create') {
    if (!name) { console.error('usage: create <имя>'); process.exit(2); }
    const wt = worktreePathFor(root, name);
    const branch = branchFor(name);
    if (existsSync(wt)) { console.error(`worktree-session: ${wt} уже существует`); process.exit(2); }
    try { sh(['worktree', 'add', '-b', branch, wt], root); }
    catch (e) { console.error(`worktree-session: не смог создать: ${String(e.message).split('\n')[0]}`); process.exit(1); }
    console.log(`✓ ветка ${branch}, копия ${wt}`);

    const spec = loadSpec(root);
    const plan = planSeed(spec, {
      exists: (p) => existsSync(path.join(root, p)),
      isDir: (p) => { try { return statSync(path.join(root, p)).isDirectory(); } catch { return false; } },
    });
    for (const a of plan.actions) {
      const from = path.join(root, a.path); const to = path.join(wt, a.path);
      try {
        mkdirSync(path.dirname(to), { recursive: true });
        if (a.mode === 'link') symlinkSync(from, to);
        else cpSync(from, to);
        console.log(`  ${a.mode === 'link' ? 'ссылка' : 'копия'}: ${a.path}${a.downgraded ? ' (папка, поэтому ссылка, а не копия)' : ''}`);
      } catch (e) { console.log(`  ✗ ${a.path}: ${String(e.message).split('\n')[0]}`); }
    }
    for (const s of plan.skipped) console.log(`  пропуск: ${s.path} (${s.why})`);

    let port = null;
    for (let p = 3100; p <= 3199; p++) { if (await portFree(p)) { port = p; break; } } // eslint-disable-line no-await-in-loop
    console.log(port ? `  свободный порт: ${port}  (PORT=${port} npm run dev)` : '  свободный порт не найден в 3100-3199');
    console.log(`\ncd ${wt}`);
    process.exit(0);
  }

  if (cmd === 'remove') {
    if (!name) { console.error('usage: remove <имя>'); process.exit(2); }
    const wt = worktreePathFor(root, name);
    if (!existsSync(wt)) { console.error(`worktree-session: ${wt} не существует`); process.exit(2); }
    let porcelain = ''; let ahead = 0;
    try { porcelain = sh(['status', '--porcelain'], wt); } catch { /* keep empty */ }
    try { ahead = Number(shq(['rev-list', '--count', '@{u}..HEAD'], wt) || 0); }
    catch { try { ahead = Number(shq(['rev-list', '--count', 'HEAD', '--not', '--remotes'], wt) || 0); } catch { ahead = 0; } }
    const v = removalVerdict({ porcelain, ahead, force });
    if (!v.allowed) { console.error(`worktree-session: ${v.reason}`); process.exit(1); }
    // symlinked seeds must never be followed on delete: rm -rf through a node_modules symlink
    // would delete the MAIN tree's dependencies.
    sh(['worktree', 'remove', force ? '--force' : '', wt].filter(Boolean), root);
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* git already removed it */ }
    console.log(`✓ удалено: ${wt} (${v.reason})`);
    process.exit(0);
  }

  console.log('usage: worktree-session.mjs create <имя> | list | remove <имя> [--force]  |  --self-test');
}
