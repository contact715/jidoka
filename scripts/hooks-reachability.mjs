#!/usr/bin/env node
// hooks-reachability — доказывает, что git-хуки РЕАЛЬНО достижимы из каждой рабочей
// копии репозитория, а не только выглядят настроенными в общем конфиге.
//
// @closes-class: hooks-resolved-outside-the-pushing-tree
// @scope: all
// @scope-ok: вход это список рабочих копий репозитория и один конфиг, доли секунды;
//            «весь» здесь не дерево файлов, а несколько путей
//
// ЗАЧЕМ. `core.hooksPath` живёт в .git/config, а он у git ОБЩИЙ для всех рабочих копий.
// Поэтому настройка выглядит сделанной из любой копии, а сработает она не везде. Замерено
// экспериментом 2026-08-24 на одноразовом репозитории, не по документации:
//
//   • относительный путь (`.githooks`) в копии, где этот каталог ЕСТЬ  → хук запускается;
//   • относительный путь в копии на ветке, где каталога НЕТ            → git молча не
//     запускает НИЧЕГО: ни хука, ни предупреждения, коммит проходит;
//   • абсолютный путь                                                  → из любой копии
//     исполняются скрипты ЧУЖОГО дерева, то есть чужой версии.
//
// Второй случай и есть та дыра, из-за которой «4 дерева из 6 пушили без гейта»
// (инцидент 2026-08-23). Отсутствие хука неотличимо от прохождения хука: и там и там
// тишина и нулевой код возврата.
//
// ЧЕГО ЭТОТ СТОРОЖ НЕ МОЖЕТ, и это надо знать. Хук не в состоянии обнаружить собственное
// отсутствие: в копии БЕЗ хуков pre-push не запустится и предупредить не сможет. Поэтому
// проверка живёт в ежедневной рутине и в npm, а не только на пуше. С пуша она видит
// СОСЕДНИЕ копии (та, из которой пушат, по определению с хуками), и этого достаточно,
// чтобы дыра всплыла в течение суток, а не через месяц.
//
// Использование:
//   node scripts/hooks-reachability.mjs              # отчёт по всем копиям, выход 1 при дыре
//   node scripts/hooks-reachability.mjs --repo <путь>
//   node scripts/hooks-reachability.mjs --json
//   node scripts/hooks-reachability.mjs --self-test

import { existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Хуки, без которых защита пуша не работает. */
export const REQUIRED_HOOKS = ['pre-commit', 'pre-push'];

/**
 * Чистая: куда РАЗРЕШИТСЯ путь к хукам, если git позовут из этой рабочей копии.
 *
 * Именно здесь ломается интуиция: конфиг один на репозиторий, а ответ на вопрос
 * «какой каталог» зависит от того, из какой копии спросили.
 *
 * @param {{hooksPath?:string, worktreeRoot:string}} o
 * @returns {{kind:'relative'|'absolute'|'default', dir:string|null, sharedAcrossWorktrees:boolean}}
 */
export function resolveFromWorktree({ hooksPath, worktreeRoot }) {
  const p = String(hooksPath || '').trim();
  if (!p) {
    // Настройки нет: git берёт хуки из служебного каталога репозитория. Он общий,
    // поэтому копии делят одни и те же хуки — но версии скриптов при этом ничьи.
    return { kind: 'default', dir: null, sharedAcrossWorktrees: true };
  }
  if (isAbsolute(p)) {
    // Один и тот же каталог для ВСЕХ копий. Из чужой копии это чужая версия скриптов.
    return { kind: 'absolute', dir: p, sharedAcrossWorktrees: true };
  }
  // Относительный путь считается от корня ТОЙ копии, из которой позвали git.
  return { kind: 'relative', dir: join(worktreeRoot, p), sharedAcrossWorktrees: false };
}

/**
 * Чистая: вердикт по одной рабочей копии.
 *
 * `unconfigured` и `no-hooks-dir` это ДЫРА, а не предупреждение: в обоих случаях
 * коммит и пуш проходят молча, и молчание неотличимо от успешной проверки.
 *
 * @param {{hooksPath?:string, worktreeRoot:string, dirExists:boolean,
 *          presentHooks?:string[], requiredHooks?:string[], canonRoot?:string}} o
 * @returns {{verdict:'ok'|'no-hooks-dir'|'missing-hook'|'foreign-tree'|'unconfigured',
 *           kind:string, dir:string|null, missing:string[]}}
 */
export function worktreeVerdict({
  hooksPath, worktreeRoot, dirExists, presentHooks = [], requiredHooks = REQUIRED_HOOKS, canonRoot = null,
}) {
  const r = resolveFromWorktree({ hooksPath, worktreeRoot });
  const base = { kind: r.kind, dir: r.dir, missing: [] };
  if (r.kind === 'default') return { ...base, verdict: 'unconfigured' };
  if (!dirExists) return { ...base, verdict: 'no-hooks-dir' };
  const missing = requiredHooks.filter((h) => !presentHooks.includes(h));
  if (missing.length) return { ...base, verdict: 'missing-hook', missing };
  // Абсолютный путь, указывающий НЕ внутрь этой копии: скрипты возьмутся из чужого
  // дерева. Хук при этом запустится, поэтому тишины не будет — будет чужая версия.
  if (r.kind === 'absolute') {
    const owner = canonRoot || worktreeRoot;
    if (resolve(r.dir).startsWith(resolve(owner)) === false) return { ...base, verdict: 'foreign-tree' };
    if (resolve(worktreeRoot) !== resolve(owner)) return { ...base, verdict: 'foreign-tree' };
  }
  return { ...base, verdict: 'ok' };
}

/** Чистая: дыра ли это. Только `ok` и `foreign-tree` не оставляют копию без проверки. */
export function isHole(verdict) {
  return verdict === 'no-hooks-dir' || verdict === 'missing-hook' || verdict === 'unconfigured';
}

// ── непрозрачная часть: спросить git о копиях ───────────────────────────────
function gitWorktrees(repo) {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  const roots = [];
  for (const line of out.split('\n')) if (line.startsWith('worktree ')) roots.push(line.slice('worktree '.length).trim());
  return roots;
}

function gitHooksPath(repo) {
  try { return execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

function listHooks(dir) {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => { try { return statSync(join(dir, f)).isFile(); } catch { return false; } });
  } catch { return []; }
}

export function auditRepo(repo) {
  const hooksPath = gitHooksPath(repo);
  const rows = [];
  for (const root of gitWorktrees(repo)) {
    const r = resolveFromWorktree({ hooksPath, worktreeRoot: root });
    const present = r.dir ? listHooks(r.dir) : [];
    const v = worktreeVerdict({
      hooksPath, worktreeRoot: root, dirExists: Boolean(r.dir) && existsSync(r.dir),
      presentHooks: present, canonRoot: gitWorktrees(repo)[0],
    });
    rows.push({ worktree: root, ...v });
  }
  return { hooksPath, rows, holes: rows.filter((x) => isHole(x.verdict)) };
}

function selfTest() {
  const fails = [];
  // Счётчик СЧИТАЕТ, а не повторяет число из комментария: жёстко вписанная сводка
  // расходится с реальностью на первой же добавленной проверке и печатает зелёную ложь
  // (класс baseline-count-stale-while-rate-green, 2026-08-18).
  let ran = 0;
  const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const WT = '/repo/wt', MAIN = '/repo/main';

  // разрешение пути — то, что было измерено экспериментом
  ok('относительный путь считается от КОПИИ, а не от главного дерева',
    resolveFromWorktree({ hooksPath: '.githooks', worktreeRoot: WT }).dir === join(WT, '.githooks'));
  ok('относительный путь НЕ общий для копий',
    resolveFromWorktree({ hooksPath: '.githooks', worktreeRoot: WT }).sharedAcrossWorktrees === false);
  ok('абсолютный путь один и тот же для всех копий',
    resolveFromWorktree({ hooksPath: '/repo/main/.githooks', worktreeRoot: WT }).dir === '/repo/main/.githooks');
  ok('пустая настройка это служебный каталог, а не относительный путь',
    resolveFromWorktree({ hooksPath: '', worktreeRoot: WT }).kind === 'default');

  // вердикты
  ok('каталог есть и оба хука на месте → ok',
    worktreeVerdict({ hooksPath: '.githooks', worktreeRoot: WT, dirExists: true, presentHooks: ['pre-commit', 'pre-push'] }).verdict === 'ok');
  ok('КАТАЛОГА НЕТ в этой копии → дыра, а не предупреждение (измеренный случай)',
    worktreeVerdict({ hooksPath: '.githooks', worktreeRoot: WT, dirExists: false, presentHooks: [] }).verdict === 'no-hooks-dir');
  ok('каталог есть, pre-push отсутствует → дыра',
    worktreeVerdict({ hooksPath: '.githooks', worktreeRoot: WT, dirExists: true, presentHooks: ['pre-commit'] }).verdict === 'missing-hook');
  ok('отсутствующий хук назван поимённо',
    worktreeVerdict({ hooksPath: '.githooks', worktreeRoot: WT, dirExists: true, presentHooks: ['pre-commit'] }).missing.join() === 'pre-push');
  ok('настройки нет вовсе → unconfigured',
    worktreeVerdict({ hooksPath: '', worktreeRoot: WT, dirExists: false }).verdict === 'unconfigured');
  ok('абсолютный путь чужого дерева → foreign-tree',
    worktreeVerdict({ hooksPath: '/repo/main/.githooks', worktreeRoot: WT, dirExists: true, presentHooks: ['pre-commit', 'pre-push'], canonRoot: MAIN }).verdict === 'foreign-tree');
  ok('абсолютный путь СВОЕГО дерева это не дыра',
    worktreeVerdict({ hooksPath: '/repo/main/.githooks', worktreeRoot: MAIN, dirExists: true, presentHooks: ['pre-commit', 'pre-push'], canonRoot: MAIN }).verdict === 'ok');

  // что считать дырой
  ok('дыра: копия без каталога хуков', isHole('no-hooks-dir') === true);
  ok('дыра: не хватает обязательного хука', isHole('missing-hook') === true);
  ok('дыра: настройки нет', isHole('unconfigured') === true);
  ok('НЕ дыра: чужое дерево (хук всё-таки запускается, но версия чужая)', isHole('foreign-tree') === false);
  ok('НЕ дыра: всё на месте', isHole('ok') === false);

  // кейс РАСХОЖДЕНИЯ: настройка выглядит сделанной, а защиты нет.
  // Ровно этот вход отличает «конфиг задан» от «хуки работают».
  ok('РАСХОЖДЕНИЕ: core.hooksPath задан, но копия остаётся без защиты',
    (() => {
      const v = worktreeVerdict({ hooksPath: '.githooks', worktreeRoot: WT, dirExists: false, presentHooks: [] });
      return Boolean(String('.githooks')) === true && isHole(v.verdict) === true;
    })());

  if (fails.length) { console.log(`\n\x1b[31mhooks-reachability self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ hooks-reachability: ${ran} прошло, 0 упало\x1b[0m`);
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const argAfter = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const repo = argAfter('--repo') || dirname(dirname(fileURLToPath(import.meta.url)));
  let audit;
  try { audit = auditRepo(repo); }
  catch (e) {
    // Не git-репозиторий или git недоступен — сказать прямо и пропустить. Fail-open:
    // сторож достижимости не должен блокировать работу там, где хуков и быть не может.
    console.log(`hooks-reachability: не git-репозиторий или git недоступен (${repo}) — пропуск.`);
    process.exit(0);
  }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(audit, null, 2)); process.exit(audit.holes.length ? 1 : 0); }

  console.log(`hooks-reachability — core.hooksPath: ${audit.hooksPath || '(не задан)'}`);
  for (const r of audit.rows) {
    const mark = r.verdict === 'ok' ? '\x1b[32m✓\x1b[0m' : (isHole(r.verdict) ? '\x1b[31m✗\x1b[0m' : '\x1b[33m!\x1b[0m');
    const why = {
      ok: 'хуки на месте',
      'no-hooks-dir': `каталога ${r.dir} в этой копии НЕТ — коммит и пуш проходят молча`,
      'missing-hook': `нет обязательных хуков: ${r.missing.join(', ')}`,
      'foreign-tree': `исполняются скрипты ЧУЖОГО дерева (${r.dir}) — версия не та`,
      unconfigured: 'core.hooksPath не задан — репозиторий полагается на служебный каталог',
    }[r.verdict];
    console.log(`  ${mark} ${r.worktree}\n      ${why}`);
  }
  if (audit.holes.length) {
    console.error(`\n\x1b[31m✗ ${audit.holes.length} рабоч(их) копи(й) из ${audit.rows.length} без защиты хуками.\x1b[0m`);
    console.error('  Настройка общая для репозитория, поэтому она ВЫГЛЯДИТ сделанной из любой копии.');
    console.error('  Почини так: держи каталог хуков ОТСЛЕЖИВАЕМЫМ в git и относительным в core.hooksPath,');
    console.error('  тогда он приезжает вместе с веткой в каждую копию.');
    process.exit(1);
  }
  console.log(`\n\x1b[32m✓ все ${audit.rows.length} рабоч(их) копи(й) реально защищены хуками\x1b[0m`);
  process.exit(0);
}
