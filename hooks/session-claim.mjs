#!/usr/bin/env node
// session-claim — сессия САМА объявляет, какие каталоги трогает, на каждой правке.
//
// @closes-class: parallel-work-invisible-across-sessions
// @scope: changed
// @scope-ok: вход это ОДИН путь из вызова инструмента; дешевле уже некуда
// @divergence: "РАСХОЖДЕНИЕ: доска есть, механизм есть, а записей ноль" — измеряемая
//              величина «доска построена» говорит «сессии видны», а правило «сосед знает,
//              где я работаю» нарушено: публикация была ручной командой и её не звали
//
// ЗАЧЕМ. Доска параллельных сессий построена 2026-08-22 и к 2026-08-24 содержала ОДНУ
// протухшую запись двухдневной давности. Причина не в доске: публикация была ручной
// командой, а механизм, который надо не забыть позвать, наполняется ровно столько раз,
// сколько раз о нём вспомнили. Здесь публикация происходит от самой работы.
//
// ЧЕГО ЭТОТ ХУК НЕ ДЕЛАЕТ. Он НИКОГДА не блокирует и ничего не решает: только записывает
// «я тут». Решение принимает session-collision на коммите, когда цена ошибки уже видна.
// Сторож, который спорит на каждой правке, будет отключён в первый же день.
//
// Вход: JSON вызова инструмента на stdin (PreToolUse). Выход: всегда 0.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Инструменты, которые ПИШУТ. Чтение файла заявкой не является. */
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

/** Как часто перезаписывать запись доски. Правок бывают сотни в минуту. */
const DEBOUNCE_MS = 20_000;

/**
 * Чистая: надо ли вообще что-то делать по этому вызову.
 * @param {{tool_name?:string, tool_input?:object}} payload
 * @returns {string|null} путь, который надо заявить, либо null
 */
export function claimFrom(payload) {
  if (!payload || !WRITE_TOOLS.test(String(payload.tool_name || ''))) return null;
  const i = payload.tool_input || {};
  const p = i.file_path || i.filePath || i.path || i.notebook_path;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
}

/**
 * Чистая: путь ОТНОСИТЕЛЬНО корня репозитория.
 *
 * Поймано сквозным прогоном 2026-08-24, юнит-тесты это пропустили. Хук писал абсолютный
 * путь, а `git diff --cached --name-only` отдаёт относительный, поэтому заявка и индекс
 * никогда не совпадали и точная ветка «заявлено соседом» не сработала бы ни разу. Две
 * величины выглядели сравнимыми и сравнимыми не были.
 *
 * @param {string} file абсолютный или относительный путь
 * @param {string} root корень репозитория
 * @returns {string}
 */
export function toRepoRelative(file, root) {
  const f = String(file || '');
  const r = String(root || '').replace(/\/+$/, '');
  if (!r || !f.startsWith(r + '/')) return f;
  return f.slice(r.length + 1);
}

/**
 * Чистая: пора ли писать на доску. Слишком частая запись это не защита, а износ диска
 * и шум в чужих отчётах.
 */
export function shouldWrite(entry, now, debounceMs = DEBOUNCE_MS) {
  if (!entry) return true;
  return now - (entry.updatedAt || 0) > debounceMs;
}

async function main() {
  let raw = '';
  try {
    for await (const chunk of process.stdin) raw += chunk;
  } catch { process.exit(0); }
  let payload = null;
  try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }

  const file = claimFrom(payload);
  if (!file) process.exit(0);

  try {
    // Хук живёт в ДВУХ местах: в репозитории движка и в ~/.claude/hooks. Относительный
    // путь верен только в первом, поэтому ищем доску по обоим адресам. Без этого хук,
    // установленный в среду, молча ничего бы не писал — и доска снова осталась бы пустой.
    const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
    const candidates = [
      join(HERE, 'scripts', 'session-board.mjs'),
      join(homedir(), '.claude', 'jidoka', 'scripts', 'session-board.mjs'),
    ];
    const boardMod = candidates.find((c) => existsSync(c));
    if (!boardMod) process.exit(0);
    const { mergeClaim, BOARD_DIR } = await import(boardMod);

    const name = process.env.JIDOKA_SESSION
      || `${process.cwd().split('/').pop()}-${String(process.pid).slice(-2)}`;
    const target = join(BOARD_DIR, `${name}.json`);
    let prev = null;
    if (existsSync(target)) { try { prev = JSON.parse(readFileSync(target, 'utf8')); } catch { prev = null; } }

    // Корень репозитория той папки, где идёт правка: заявка обязана быть в тех же
    // единицах, что и индекс git.
    let root = '';
    try {
      const { execFileSync } = await import('node:child_process');
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(file), encoding: 'utf8' }).trim();
    } catch { root = ''; }
    const rel = toRepoRelative(file, root);

    const now = Date.now();
    // Новый каталог записывается сразу: именно он и есть новость для соседа. Иначе ждём.
    const merged = mergeClaim(prev, rel, now);
    const claimsGrew = !prev || (merged.claims || []).length !== (prev.claims || []).length;
    if (!claimsGrew && !shouldWrite(prev, now)) process.exit(0);

    mkdirSync(BOARD_DIR, { recursive: true });
    writeFileSync(target, JSON.stringify({
      session: name,
      worktree: process.cwd(),
      pid: process.pid,
      status: 'working',
      ...merged,
    }, null, 2) + '\n');
  } catch {
    // Fail-open и молча: заявка это удобство, а не гарантия. Хук, который ломает правку
    // ради собственной записи, будет отключён, и тогда не станет ни заявок, ни доски.
  }
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    const fails = [];
    let ran = 0;
    const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

    ok('правка файла даёт заявку',
      claimFrom({ tool_name: 'Edit', tool_input: { file_path: '/a/b.ts' } }) === '/a/b.ts');
    ok('запись файла даёт заявку',
      claimFrom({ tool_name: 'Write', tool_input: { file_path: '/a/c.ts' } }) === '/a/c.ts');
    ok('ЧТЕНИЕ заявкой не является',
      claimFrom({ tool_name: 'Read', tool_input: { file_path: '/a/b.ts' } }) === null);
    ok('Bash заявкой не является (путь там не поле, а текст команды)',
      claimFrom({ tool_name: 'Bash', tool_input: { command: 'rm /a/b.ts' } }) === null);
    ok('вызов без пути игнорируется',
      claimFrom({ tool_name: 'Edit', tool_input: {} }) === null);
    ok('мусор на входе не роняет', claimFrom(null) === null && claimFrom({}) === null);
    ok('первая заявка пишется сразу', shouldWrite(null, 1000) === true);
    ok('РАСХОЖДЕНИЕ: доска есть, механизм есть, а записей ноль',
      // Свежая запись без новых каталогов НЕ переписывается: без этого хук молотил бы
      // диск на каждой правке, его бы отключили, и доска снова стала бы пустой.
      shouldWrite({ updatedAt: 1000 }, 1000 + 1) === false);
    ok('после паузы запись обновляется',
      shouldWrite({ updatedAt: 1000 }, 1000 + DEBOUNCE_MS + 1) === true);
    ok('РАСХОЖДЕНИЕ: абсолютный путь и индекс git это разные единицы',
      toRepoRelative('/repo/lib/a.ts', '/repo') === 'lib/a.ts');
    ok('путь вне корня остаётся как есть', toRepoRelative('/other/a.ts', '/repo') === '/other/a.ts');
    ok('пустой корень ничего не ломает', toRepoRelative('lib/a.ts', '') === 'lib/a.ts');
    ok('хвостовой слеш в корне не мешает', toRepoRelative('/repo/lib/a.ts', '/repo/') === 'lib/a.ts');

    if (fails.length) { console.log(`\n\x1b[31msession-claim self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
    console.log(`\n\x1b[32m✓ session-claim: ${ran} прошло, 0 упало\x1b[0m`);
    process.exit(0);
  }
  main();
}
