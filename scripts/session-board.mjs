#!/usr/bin/env node
// @closes-class: parallel-work-invisible-across-sessions
// @scope: all
// @scope-ok: доска по определению собирает состояние ВСЕХ сессий машины
// @divergence: "одна ветка из разных копий даёт medium" — измеряемая величина «пути
//              рабочих копий разные» говорит «не пересекаемся», а правило «две сессии не
//              правят одно и то же» нарушено: копии разные, а ветка под ними одна
/**
 * session-board — реестр «кто что делает» для параллельных сессий.
 *
 * ЗАЧЕМ. У нас три слоя защиты от столкновений: замок папки (session-lock), замок коммита
 * (commit-lock) и серийная очередь (task-queue). Все три ОБОРОНИТЕЛЬНЫЕ: они не дают
 * испортить чужое. Ни один не знает, ЧТО сессия делает, поэтому роль тимлида — свести
 * работы, разрулить пересечение, спросить владельца работы — выполняется руками.
 *
 * НЕСУЩЕЕ СВОЙСТВО, ради которого доска вообще нужна. Восстановить авторство постфактум
 * НЕЛЬЗЯ: замер 2026-08-22 на projectx-app — 100 коммитов, один автор `contact715`,
 * уникальных адресов 1. Все сессии пишут под одной учётной записью. Именно на этом
 * ошиблась сессия jidoka-ba, приписав чужую работу projectx-app-18 по истории git, и сама
 * же это поймала. Значит намерение и владение объявляются В МОМЕНТ работы, а не выводятся
 * из следов после неё.
 *
 * ЧЕГО ДОСКА НЕ ДЕЛАЕТ, СОЗНАТЕЛЬНО:
 *   - не блокирует. Каждый наш жёсткий гейт, вставший на пути, начинали обходить; доска
 *     советует и записывает, а решение остаётся за человеком;
 *   - не убивает и не трогает чужие процессы (правило «живой родитель не трогается»);
 *   - не пишет в чужие записи: у каждой сессии свой файл, никто не редактирует чужой.
 *
 * Использование:
 *   node scripts/session-board.mjs --publish --intent "чиню таймаут vitest" --claims "e2e/**,playwright.config.ts"
 *   node scripts/session-board.mjs --list
 *   node scripts/session-board.mjs --conflicts
 *   node scripts/session-board.mjs --release
 *   node scripts/session-board.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BOARD_DIR = path.join(os.homedir(), '.jidoka', 'board');
/** Запись считается протухшей, если сессия не обновляла её дольше этого срока. */
export const STALE_MS = 45 * 60 * 1000;

const arg = (name, dflt = undefined) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};

function sh(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

/**
 * Настоящее имя репозитория, а НЕ имя рабочей копии.
 *
 * Дефект пойман на живых данных 2026-08-22: `git rev-parse --show-toplevel` в рабочей копии
 * возвращает саму копию (`.jidoka-wt-board`), а не репозиторий (`jidoka-framework`). На этом
 * ломалось главное: две сессии в РАЗНЫХ копиях ОДНОГО репозитория, пушащие в одну ветку, —
 * это ровно та гонка, ради которой доска и заведена, и она бы не опозналась.
 *
 * Правильный признак — общий каталог git: он один на репозиторий и все его копии.
 */
export function repoNameFrom(commonDir, toplevel) {
  if (commonDir) {
    const root = path.dirname(String(commonDir).replace(/\/\.git\/?$/, '/.git'));
    if (root && root !== '.') return path.basename(root);
  }
  return toplevel ? path.basename(toplevel) : null;
}

/**
 * Живость записи. ГЛАВНЫЙ признак — СВЕЖЕСТЬ, а не процесс.
 *
 * Дефект пойман на живых данных 2026-08-22: в запись писался pid процесса `node`, который
 * публиковал её и тут же завершался. Из-за этого доска считала мёртвыми ВСЕ записи, включая
 * собственную, и печатала «0 живых сессий» при работающей сессии. Прибор врал в успокаивающую
 * сторону: пересечений «не было» просто потому, что живых не было ни одного.
 *
 * Поэтому: свежесть решает всегда, а pid только УСИЛИВАЕТ вердикт и только когда он настоящий
 * (записан явно как pid самой сессии). Неизвестный pid не является доказательством смерти —
 * это тот же класс `unverifiable-counted-as-violated` (2026-08-11), где недоступность файла
 * засчитали за нарушение.
 */
export function isStale(entry, now, pidAlive) {
  if (!entry) return true;
  const age = now - (entry.updatedAt || entry.startedAt || 0);
  if (age > STALE_MS) return true;
  if (entry.pid && pidAlive === false) return true;   // известный pid и он мёртв
  return false;                                        // свежая запись живёт
}

/**
 * 2026-08-24 — АВТОМАТИЧЕСКАЯ заявка: сессия объявляет, что трогает файл, без того чтобы
 * кто-то об этом помнил.
 *
 * Доска простояла с одной протухшей записью двое суток именно потому, что публикация была
 * ручной командой. Механизм, который надо не забыть позвать, наполняется ровно столько
 * раз, сколько раз о нём вспомнили; в нашем случае — один.
 *
 * Чистая: вернуть запись с добавленной заявкой. Каталог вместо файла нарочно — иначе
 * заявок станут сотни и доска превратится в журнал правок вместо карты намерений.
 *
 * @param {object|null} entry прежняя запись (или null, если сессии на доске ещё нет)
 * @param {string} file путь, который сессия трогает
 * @param {number} now
 * @param {number} maxClaims потолок, чтобы карта осталась читаемой
 * @returns {object} новая запись
 */
export function mergeClaim(entry, file, now = Date.now(), maxClaims = 24) {
  const dir = String(file || '').split('/').slice(0, -1).join('/');
  const claim = dir ? `${dir}/**` : String(file || '');
  const base = entry || { claims: [], startedAt: now, status: 'working' };
  const claims = Array.isArray(base.claims) ? [...base.claims] : [];
  if (claim && !claims.includes(claim)) claims.push(claim);
  // Свежие заявки важнее старых: карта должна показывать, где сессия СЕЙЧАС.
  const trimmed = claims.length > maxClaims ? claims.slice(claims.length - maxClaims) : claims;
  return { ...base, claims: trimmed, updatedAt: now };
}

/** Простое сопоставление шаблона пути. Только звёздочки, без внешних зависимостей. */
export function matchesGlob(pattern, filePath) {
  if (!pattern || !filePath) return false;
  const rx = '^' + String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*') + '$';
  return new RegExp(rx).test(String(filePath));
}

/** Пересекаются ли два набора заявленных путей. Грубо, но без ложного спокойствия. */
export function claimsOverlap(a = [], b = []) {
  for (const x of a) for (const y of b) {
    if (x === y) return true;
    if (matchesGlob(x, y) || matchesGlob(y, x)) return true;
    const bare = (s) => String(s).split('*')[0].replace(/\/$/, '');
    const bx = bare(x), by = bare(y);
    if (bx && by && (bx === by || bx.startsWith(by + '/') || by.startsWith(bx + '/'))) return true;
  }
  return false;
}

/**
 * Найти пересечения между живыми записями. Чистая функция — вся логика проверяется
 * без файловой системы и без запуска процессов.
 *
 * Уровни: high означает, что работы столкнутся и кто-то потеряет правки;
 * medium означает гонку при отправке.
 */
export function conflicts(entries = []) {
  const live = entries.filter((e) => e && e.status !== 'released');
  const out = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (a.session === b.session) continue;
      if (a.worktree && a.worktree === b.worktree) {
        out.push({ level: 'high', kind: 'same-worktree', a: a.session, b: b.session,
          detail: `обе сессии в одной папке ${a.worktree} — правки перетрут друг друга` });
        continue;
      }
      if (claimsOverlap(a.claims, b.claims)) {
        out.push({ level: 'high', kind: 'claims-overlap', a: a.session, b: b.session,
          detail: `заявлены пересекающиеся пути: ${(a.claims || []).join(', ')} и ${(b.claims || []).join(', ')}` });
        continue;
      }
      if (a.repo && a.repo === b.repo && a.branch && a.branch === b.branch) {
        out.push({ level: 'medium', kind: 'same-branch', a: a.session, b: b.session,
          detail: `один репозиторий и ветка ${a.repo}@${a.branch} — гонка при отправке, коммить через safe-commit` });
      }
    }
  }
  return out.sort((x, y) => (x.level === 'high' ? 0 : 1) - (y.level === 'high' ? 0 : 1));
}

// ---------- ввод-вывод ----------

function sessionName() {
  return process.env.JIDOKA_SESSION || arg('--session') ||
    `${path.basename(process.cwd())}-${String(process.ppid || process.pid).slice(-2)}`;
}

export function readBoard(dir = BOARD_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* битую запись пропускаем */ }
  }
  return out;
}

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function cmdPublish() {
  const cwd = process.cwd();
  const name = sessionName();
  const entry = {
    session: name,
    // pid ТОЛЬКО если его назвали явно: pid публикующего `node` бесполезен, он умирает сразу
    pid: Number(arg('--pid', '')) || null,
    host: os.hostname(),
    worktree: cwd,
    repo: repoNameFrom(sh('git rev-parse --path-format=absolute --git-common-dir', cwd), sh('git rev-parse --show-toplevel', cwd) || cwd),
    branch: sh('git branch --show-current', cwd) || null,
    intent: arg('--intent', '') || '',
    claims: (arg('--claims', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    status: 'working',
  };
  const target = path.join(BOARD_DIR, `${name}.json`);
  if (fs.existsSync(target)) {
    try { entry.startedAt = JSON.parse(fs.readFileSync(target, 'utf8')).startedAt || entry.startedAt; } catch { /* ok */ }
  }
  fs.mkdirSync(BOARD_DIR, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(entry, null, 2) + '\n');
  console.log(`доска: ${name} в ${entry.repo}@${entry.branch || '?'} — ${entry.intent || '(намерение не названо)'}`);
  const c = conflicts(readBoard().filter((e) => !isStale(e, Date.now(), pidAlive(e.pid))));
  const mine = c.filter((x) => x.a === name || x.b === name);
  if (mine.length) {
    console.log(`\nпересечений с соседями: ${mine.length}`);
    for (const x of mine) console.log(`  [${x.level}] ${x.a} и ${x.b}: ${x.detail}`);
  }
}

function cmdList() {
  const now = Date.now();
  const all = readBoard();
  if (!all.length) return console.log('доска пуста — ни одна сессия не объявила, чем занята');
  for (const e of all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    const stale = isStale(e, now, pidAlive(e.pid));
    const age = Math.round((now - (e.updatedAt || now)) / 60000);
    console.log(`${stale ? '  -' : '  *'} ${String(e.session).padEnd(22)} ${String(e.repo || '?').padEnd(16)} ${String(e.branch || '?').padEnd(20)} ${age}м  ${e.intent || '(намерение не названо)'}${stale ? '  [протухла]' : ''}`);
    if (e.claims && e.claims.length) console.log(`      заявлено: ${e.claims.join(', ')}`);
  }
}

function cmdConflicts() {
  const now = Date.now();
  const live = readBoard().filter((e) => !isStale(e, now, pidAlive(e.pid)));
  const c = conflicts(live);
  if (!c.length) { console.log(`доска: ${live.length} живых сессий, пересечений нет`); process.exit(0); }
  console.log(`пересечений: ${c.length} (живых сессий ${live.length})`);
  for (const x of c) console.log(`  [${x.level}] ${x.kind}: ${x.a} и ${x.b}\n      ${x.detail}`);
  console.log('\nДоска НЕ блокирует. Разведите работы или договоритесь сообщением;');
  console.log('решение остаётся за человеком.');
  process.exit(c.some((x) => x.level === 'high') ? 1 : 0);
}

function cmdRelease() {
  const f = path.join(BOARD_DIR, `${sessionName()}.json`);
  if (!fs.existsSync(f)) return console.log('нечего освобождать');
  try {
    const e = JSON.parse(fs.readFileSync(f, 'utf8'));
    e.status = 'released'; e.updatedAt = Date.now();
    fs.writeFileSync(f, JSON.stringify(e, null, 2) + '\n');
    console.log(`${e.session} освободила заявку`);
  } catch { console.log('запись повреждена, пропускаю'); }
}

function selfTest() {
  const checks = [];
  const ok = (n, c) => checks.push({ n, pass: !!c });
  const now = Date.now();
  const E = (o) => ({ session: 's', pid: 1, worktree: '/w', repo: 'r', branch: 'b', claims: [], startedAt: now, updatedAt: now, status: 'working', ...o });

  ok('одна папка на двоих даёт high', conflicts([E({ session: 'a' }), E({ session: 'b' })])[0].level === 'high');
  ok('разные папки и разные пути — пересечений нет',
    conflicts([E({ session: 'a', worktree: '/x', claims: ['app/**'] }), E({ session: 'b', worktree: '/y', repo: 'r2', claims: ['lib/**'] })]).length === 0);
  ok('пересекающиеся заявки дают claims-overlap',
    conflicts([E({ session: 'a', worktree: '/x', claims: ['e2e/**'] }), E({ session: 'b', worktree: '/y', claims: ['e2e/spec.ts'] })])[0].kind === 'claims-overlap');
  ok('одна ветка из разных копий даёт medium',
    conflicts([E({ session: 'a', worktree: '/x', claims: ['app/**'] }), E({ session: 'b', worktree: '/y', claims: ['lib/**'] })])[0].level === 'medium');
  ok('высокие идут первыми',
    conflicts([E({ session: 'a', worktree: '/x', claims: ['a/**'] }), E({ session: 'b', worktree: '/y', claims: ['b/**'] }), E({ session: 'c', worktree: '/x' })])[0].level === 'high');
  ok('сама с собой не конфликтует', conflicts([E({ session: 'a' }), E({ session: 'a' })]).length === 0);
  ok('освобождённая заявка не участвует',
    conflicts([E({ session: 'a' }), E({ session: 'b', status: 'released' })]).length === 0);
  ok('пустая доска даёт пусто', conflicts([]).length === 0);

  // ── автоматическая заявка (2026-08-24) ──────────────────────────────────
  ok('заявка берётся КАТАЛОГОМ, а не отдельным файлом',
    mergeClaim(null, 'lib/booking/x.ts', 1).claims[0] === 'lib/booking/**');
  ok('повторная правка того же каталога не плодит заявок',
    mergeClaim(mergeClaim(null, 'lib/a.ts', 1), 'lib/b.ts', 2).claims.length === 1);
  ok('новый каталог добавляет заявку',
    mergeClaim(mergeClaim(null, 'lib/a.ts', 1), 'app/b.ts', 2).claims.length === 2);
  ok('время последней правки обновляется', mergeClaim(null, 'a/b.ts', 77).updatedAt === 77);
  ok('начало сессии НЕ переписывается новой заявкой',
    mergeClaim({ claims: [], startedAt: 5 }, 'a/b.ts', 99).startedAt === 5);
  ok('файл в корне не даёт пустую заявку', mergeClaim(null, 'README.md', 1).claims[0] === 'README.md');
  ok('потолок заявок держит карту читаемой',
    (() => { let e = null; for (let i = 0; i < 40; i++) e = mergeClaim(e, `d${i}/x.ts`, i, 24); return e.claims.length === 24 && e.claims.at(-1) === 'd39/**'; })());
  ok('двойная звезда покрывает вложенное', matchesGlob('e2e/**', 'e2e/a/b.ts'));
  ok('одинарная звезда НЕ покрывает вложенное', !matchesGlob('app/*.ts', 'app/x/y.ts'));
  ok('точное совпадение путей', claimsOverlap(['a/b.ts'], ['a/b.ts']));
  ok('каталог покрывает файл внутри', claimsOverlap(['app/'], ['app/page.tsx']));
  ok('соседние каталоги НЕ пересекаются', !claimsOverlap(['app/'], ['appendix/x.ts']));
  ok('пустые заявки не пересекаются', !claimsOverlap([], ['a']));

  // имя репозитория, а не рабочей копии (дефект пойман на живых данных)
  ok('рабочая копия отдаёт имя РЕПОЗИТОРИЯ, а не свою папку',
    repoNameFrom('/Users/x/jidoka-framework/.git', '/Users/x/.jidoka-wt-board') === 'jidoka-framework');
  ok('обычный клон отдаёт своё же имя',
    repoNameFrom('/Users/x/projectx-app/.git', '/Users/x/projectx-app') === 'projectx-app');
  ok('без общего каталога падаем на имя копии',
    repoNameFrom('', '/Users/x/projectx-app') === 'projectx-app');
  ok('две копии одного репозитория дают ОДНО имя',
    repoNameFrom('/r/.git', '/wt-a') === repoNameFrom('/r/.git', '/wt-b'));

  ok('свежая запись БЕЗ pid жива (pid публикатора бесполезен)',
    isStale({ updatedAt: now }, now, false) === false);
  ok('свежая запись С мёртвым явным pid — протухла',
    isStale({ updatedAt: now, pid: 999999 }, now, false) === true);
  ok('свежая и живая не протухла', isStale({ updatedAt: now, pid: 1 }, now, true) === false);
  ok('живая, но старше срока — протухла', isStale({ updatedAt: now - STALE_MS - 1 }, now, true) === true);
  ok('пустая запись означает протухла', isStale(null, now, true) === true);

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`${c.pass ? '  ok ' : '  ХХ '} ${c.n}`);
  console.log(`\nsession-board самопроверка: ${checks.length - failed.length} прошло, ${failed.length} упало`);
  process.exit(failed.length ? 1 : 0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  else if (process.argv.includes('--publish')) cmdPublish();
  else if (process.argv.includes('--conflicts')) cmdConflicts();
  else if (process.argv.includes('--release')) cmdRelease();
  else cmdList();
}
