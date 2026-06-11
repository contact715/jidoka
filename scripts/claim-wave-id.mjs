#!/usr/bin/env node
// claim-wave-id.mjs — атомарное резервирование номера волны между параллельными сессиями.
//
// Родился из тройной коллизии wave-id в projectx-app (2026-06-10): две сессии трижды за день
// забирали один номер (203/204/205), оба пуша отбивались, конфликты в генерируемых файлах.
// «git fetch перед стартом» не работает: номер живёт только в памяти сессии до первого
// коммита, окно гонки — часы.
//
// Механизм: клейм = однострочная JSONL-запись в docs/specs/_CLAIMED_WAVES.jsonl, которую
// скрипт коммитит ПОВЕРХ СВЕЖЕЙ УДАЛЁННОЙ ветки через git plumbing (hash-object → read-tree
// во временный индекс → write-tree → commit-tree → push <sha>:refs/heads/<branch>).
// Локальная ветка, индекс и рабочее дерево НЕ трогаются — грязное дерево и отставшая на
// N коммитов ветка не мешают клейму. Отбитый пуш (non-fast-forward) = «номер уже занят»:
// перечитать, взять следующий, повторить. Это CAS-семантика на чистом git, без сервера.
//
// Источники занятых номеров (union, далее max+1):
//   - локальные docs/retros|specs|runs (ловит спек, созданный локально и ещё не запушенный)
//   - дерево удалённой ветки (git ls-tree) и её реестр (git show) — после fetch
//   - сабжекты коммитов локальной и удалённой ветки (волны, живущие только в сообщениях)
//   - сам реестр клеймов (локальный файл + удалённая версия)
//
// Usage: node scripts/claim-wave-id.mjs [--session id] [--remote origin] [--branch dev]
//        [--registry docs/specs/_CLAIMED_WAVES.jsonl] [--max-attempts 5] [--json] [--self-test]
// stdout: "wave-N" (или JSON с --json); пояснения — на stderr. Без remote — локальный fallback.

import {
  readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync,
  readdirSync, mkdtempSync, rmSync, unlinkSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const REGISTRY_REL = 'docs/specs/_CLAIMED_WAVES.jsonl';
const SCAN_DIRS = ['docs/retros', 'docs/specs', 'docs/runs'];

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}
function shTry(cmd, opts = {}) { try { return sh(cmd, opts); } catch { return null; } }
function shInput(cmd, input, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}

// Числовые wave-id из любых строк (имена файлов, пути, сабжекты коммитов).
// Именованные волны (wave-judge-debias) номер не занимают.
export function parseWaveNumbers(names) {
  const nums = new Set();
  for (const name of names) {
    for (const m of String(name).matchAll(/(?:^|[^a-z0-9])wave-(\d+)/gi)) nums.add(Number(m[1]));
  }
  return nums;
}

// Объединение всех источников занятых номеров. remoteRef = refs/remotes/<remote>/<branch>
// (после fetch) либо null — тогда только локальные источники.
export function collectUsed({ root, registryRel = REGISTRY_REL, remoteRef = null }) {
  const names = [];
  for (const d of SCAN_DIRS) {
    try { names.push(...readdirSync(join(root, d), { recursive: true }).map(String)); } catch { /* нет каталога */ }
  }
  const local = shTry('git log --pretty=%s -200', { cwd: root });
  if (local) names.push(...local.split('\n'));

  const regTexts = [];
  try { regTexts.push(readFileSync(join(root, registryRel), 'utf8')); } catch { /* нет файла */ }

  if (remoteRef) {
    const ls = shTry(`git ls-tree -r --name-only ${remoteRef} -- ${SCAN_DIRS.join(' ')}`, { cwd: root });
    if (ls) names.push(...ls.split('\n'));
    const lg = shTry(`git log --pretty=%s -200 ${remoteRef}`, { cwd: root });
    if (lg) names.push(...lg.split('\n'));
    const t = shTry(`git show ${remoteRef}:${registryRel}`, { cwd: root });
    if (t) regTexts.push(t);
  }

  const used = parseWaveNumbers(names);
  for (const line of regTexts.join('\n').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (Number.isInteger(r.n)) used.add(r.n);
    } catch { /* битая строка не валит клейм */ }
  }
  return used;
}

const nextFree = used => (used.size ? Math.max(...used) : 0) + 1;

function identityEnv(root) {
  const name = shTry('git config user.name', { cwd: root }) || 'jidoka-claim';
  const email = shTry('git config user.email', { cwd: root }) || 'claim@jidoka.local';
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

function localClaim({ root, session, registryRel, say }) {
  const used = collectUsed({ root, registryRel });
  const n = nextFree(used);
  const rec = { wave: `wave-${n}`, n, session, ts: new Date().toISOString(), host: hostname(), mode: 'local' };
  const p = join(root, registryRel);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(rec) + '\n');
  say(`⚠ remote не найден — ${rec.wave} зарезервирован только локально (${registryRel})`);
  return { wave: rec.wave, n, attempts: 1, mode: 'local', record: rec };
}

// Главный вход. Клейм-коммит строится поверх удалённой головы во временном индексе и
// пушится как <sha>:refs/heads/<branch>; локальная ветка/дерево не участвуют вообще.
// beforePush — тестовый крючок для детерминированной симуляции гонки.
export function claimWave({
  root,
  session = process.env.CLAUDE_SESSION_ID || `${hostname()}-${process.pid}`,
  remote,
  branch,
  registryRel = REGISTRY_REL,
  maxAttempts = 5,
  beforePush = null,
  quiet = false,
} = {}) {
  root = resolve(root || sh('git rev-parse --show-toplevel'));
  const say = m => { if (!quiet) process.stderr.write(m + '\n'); };

  if (!remote || !branch) {
    const up = shTry('git rev-parse --abbrev-ref --symbolic-full-name @{u}', { cwd: root });
    if (up && up.includes('/')) {
      const i = up.indexOf('/');
      remote = remote || up.slice(0, i);
      branch = branch || up.slice(i + 1);
    } else {
      remote = remote || (shTry('git remote', { cwd: root }) || '').split('\n').filter(Boolean)[0];
      branch = branch || shTry('git rev-parse --abbrev-ref HEAD', { cwd: root });
    }
  }
  if (!remote) return localClaim({ root, session, registryRel, say });

  const remoteRef = `refs/remotes/${remote}/${branch}`;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    shTry(`git fetch --quiet ${remote} ${branch}`, { cwd: root });
    const head = shTry(`git rev-parse --verify --quiet ${remoteRef}`, { cwd: root });
    if (!head) {
      say(`⚠ ветки ${remote}/${branch} нет на remote — переключаюсь на локальный клейм`);
      return localClaim({ root, session, registryRel, say });
    }

    const used = collectUsed({ root, registryRel, remoteRef });
    const n = nextFree(used);
    const rec = { wave: `wave-${n}`, n, session, ts: new Date().toISOString(), host: hostname() };

    const base = shTry(`git show ${remoteRef}:${registryRel}`, { cwd: root }) || '';
    const content = (base ? base.replace(/\n*$/, '\n') : '') + JSON.stringify(rec) + '\n';
    const blob = shInput('git hash-object -w --stdin', content, { cwd: root });

    const idx = join(tmpdir(), `claim-wave-idx-${process.pid}-${attempt}-${Math.floor(Math.random() * 1e6)}`);
    const env = { ...process.env, GIT_INDEX_FILE: idx, ...identityEnv(root) };
    let commit;
    try {
      sh(`git read-tree ${head}`, { cwd: root, env });
      sh(`git update-index --add --cacheinfo 100644,${blob},${registryRel}`, { cwd: root, env });
      const tree = sh('git write-tree', { cwd: root, env });
      commit = shInput(`git commit-tree ${tree} -p ${head}`, `chore(wave): claim ${rec.wave} [${session}]\n`, { cwd: root, env });
    } finally {
      try { unlinkSync(idx); } catch { /* индекс мог не создаться */ }
    }

    if (beforePush) beforePush(attempt);
    try {
      sh(`git push --quiet ${remote} ${commit}:refs/heads/${branch}`, { cwd: root });
      say(`✓ ${rec.wave} зарезервирован (${remote}/${branch}, попытка ${attempt})`);
      return { wave: rec.wave, n, attempts: attempt, mode: 'remote', record: rec };
    } catch (e) {
      lastErr = e;
      say(`✗ пуш клейма ${rec.wave} отбит — номер заняли параллельно, беру следующий`);
    }
  }
  throw new Error(`не удалось зарезервировать номер за ${maxAttempts} попыток (${lastErr ? lastErr.message.split('\n')[0] : 'push rejected'})`);
}

// ── self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  const fails = [];
  const ok = (name, cond) => {
    if (!cond) fails.push(name);
    console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  };
  const tmp = mkdtempSync(join(tmpdir(), 'claim-wave-'));
  const git = (cwd, cmd) => sh(`git ${cmd}`, { cwd });
  const mkCommit = (dir, rel, text, msg) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
    git(dir, `add ${rel}`);
    git(dir, `commit -q -m "${msg}"`);
  };

  try {
    // T1 — разбор номеров из имён файлов и сабжектов; именованные волны не считаются
    const s = parseWaveNumbers([
      'wave-205_MASTER_SPEC.md', 'wave-12.md', 'wave-judge-debias_MASTER_SPEC.md',
      'briefs/wave-9_MICRO.md', 'feat(home): wave-205 — Home absorbs Dashboards',
    ]);
    ok('T1 parseWaveNumbers извлекает {205,12,9}, игнорирует wave-judge-debias',
      s.has(205) && s.has(12) && s.has(9) && s.size === 3);

    // fixture: bare origin + клоны A и B (две «параллельные сессии»)
    const bare = join(tmp, 'origin.git');
    sh(`git init -q --bare -b main "${bare}"`);
    const A = join(tmp, 'A');
    mkdirSync(A);
    git(A, 'init -q -b main');
    git(A, 'config user.name tester');
    git(A, 'config user.email t@local');
    git(A, `remote add origin "${bare}"`);
    mkCommit(A, 'docs/retros/wave-206.md', '# retro', 'retro wave-206');
    git(A, 'push -q -u origin main');
    const B = join(tmp, 'B');
    sh(`git clone -q "${bare}" "${B}"`);
    git(B, 'config user.name tester2');
    git(B, 'config user.email t2@local');

    const claimQ = (root, extra = {}) =>
      claimWave({ root, remote: 'origin', branch: 'main', quiet: true, ...extra });
    const bareReg = () => sh(`git --git-dir="${bare}" show main:${REGISTRY_REL}`);

    // T2 — первый клейм: следующий за wave-206, попадает на origin, локально ничего не трогает
    const headBefore = git(A, 'rev-parse HEAD');
    const r2 = claimQ(A, { session: 'sessA' });
    ok('T2 первый клейм = wave-207 и его запись лежит на origin',
      r2.n === 207 && bareReg().includes('"wave-207"'));
    ok('T2 локальная ветка/дерево сессии A не тронуты (клейм — только на origin)',
      git(A, 'rev-parse HEAD') === headBefore
      && !existsSync(join(A, REGISTRY_REL))
      && git(A, 'status --porcelain') === '');

    // T3 — параллельная сессия видит чужой клейм через origin и берёт следующий номер
    const r3 = claimQ(B, { session: 'sessB' });
    ok('T3 вторая сессия берёт wave-208 (чужой клейм виден без pull)', r3.n === 208);

    // T4 — гонка: пока B готовит пуш, A успевает заклеймить тот же номер → пуш B отбит →
    // B перечитывает и берёт следующий. Это центральный сценарий инцидента 2026-06-10.
    let injected = false;
    const r4 = claimQ(B, {
      session: 'sessB',
      beforePush: () => { if (!injected) { injected = true; claimQ(A, { session: 'sessA' }); } },
    });
    const regNums = bareReg().trim().split('\n').map(l => JSON.parse(l).n);
    ok('T4 отбитый пуш → следующий номер (B получает 210 со 2-й попытки)',
      r4.n === 210 && r4.attempts === 2);
    ok('T4 реестр на origin строго 207,208,209,210 — без дублей',
      JSON.stringify(regNums) === JSON.stringify([207, 208, 209, 210]));

    // T7 — незакоммиченный локальный спек тоже источник (кейс: спек создан, пуша ещё не было)
    mkdirSync(join(A, 'docs/specs'), { recursive: true });
    writeFileSync(join(A, 'docs/specs/wave-500_MASTER_SPEC.md'), '# spec');
    const r7 = claimQ(A, { session: 'sessA' });
    ok('T7 незакоммиченный локальный wave-500 учтён → клейм 501', r7.n === 501);

    // T5 — реестр сам по себе источник: у B нет файла wave-500, max=501 живёт только в реестре
    const r5 = claimQ(B, { session: 'sessB' });
    ok('T5 реестр на origin — самостоятельный источник → клейм 502', r5.n === 502);

    // T6 — без remote: локальный fallback с записью в реестр
    const L = join(tmp, 'L');
    mkdirSync(L);
    git(L, 'init -q -b main');
    git(L, 'config user.name t');
    git(L, 'config user.email t@l');
    mkCommit(L, 'docs/retros/wave-3.md', 'r', 'retro wave-3');
    const r6 = claimWave({ root: L, session: 'sessL', quiet: true });
    const localReg = readFileSync(join(L, REGISTRY_REL), 'utf8');
    ok('T6 без remote — локальный fallback: wave-4, запись в локальный реестр',
      r6.n === 4 && r6.mode === 'local' && localReg.includes('"wave-4"'));
  } catch (e) {
    fails.push(`crash: ${e.message}`);
    console.log(`  \x1b[31m✗ self-test crashed: ${e.message}\x1b[0m`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (fails.length) {
    console.log(`\n\x1b[31mclaim-wave-id self-test FAILED (${fails.length})\x1b[0m`);
    process.exit(1);
  }
  console.log('\n\x1b[32m✓ claim-wave-id self-test: резервирование атомарно, гонка разрешается следующим номером\x1b[0m');
  process.exit(0);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function cli() {
  const arg = (k, d = null) => {
    const i = process.argv.indexOf(k);
    return i > -1 ? process.argv[i + 1] : d;
  };
  try {
    const res = claimWave({
      session: arg('--session') || undefined,
      remote: arg('--remote') || undefined,
      branch: arg('--branch') || undefined,
      registryRel: arg('--registry') || undefined,
      maxAttempts: Number(arg('--max-attempts', 5)),
    });
    process.stdout.write(process.argv.includes('--json') ? JSON.stringify(res) + '\n' : res.wave + '\n');
  } catch (e) {
    process.stderr.write(`claim-wave-id: ${e.message}\n`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  else cli();
}
