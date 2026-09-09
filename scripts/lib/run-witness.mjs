#!/usr/bin/env node
// @closes-class: run-cannot-prove-what-it-touched
// @scope: all
// @scope-ok: вход это ФИКСИРОВАННЫЙ короткий список машинных каталогов движка (около 300 файлов, доли секунды), а не дерево репозитория; сузить до правки нельзя — смысл ровно в том, чтобы увидеть запись ВНЕ правки
//
// run-witness — свидетель прогона: что он тронул ВНЕ своей рабочей папки.
//
// ПРОБЛЕМА. Прогону бывает предписано «пиши только в свой клон», и у него нет способа это
// ДОКАЗАТЬ. Ограничение живёт в тексте задания, а не в среде. За две недели это дало два
// незамеченных нарушения подряд: scripts/memory-consolidate.mjs, запущенный из клона,
// перезаписал ~/.claude/jidoka/memory-consolidated.md, и ни один из 65 гейтов этого не увидел.
//
// ПОЧЕМУ НАБЛЮДЕНИЕ, А НЕ ЗАПРЕТ. Соблазн — завернуть прогон в sandbox-run и запретить запись
// наружу. Это сломало бы законное: memory-consolidate ПО ЗАМЫСЛУ держит одну сводку на машину,
// а не одну на клон. Запрет наказал бы правильный инструмент за правильное поведение. Поэтому
// здесь наблюдение: прогон получает возможность сказать, что он тронул, а человек решает,
// законно это или нет. Гейт с зубами — следующий шаг, и он делается ПОСЛЕ того, как на реальных
// данных станет видно, что трогается штатно. Сначала замер, потом механизм.
//
// ЧЕГО ЭТО НЕ ЗАКРЫВАЕТ, сказано вслух: намеренную подделку (слепок можно снять после записи),
// запись вне наблюдаемых корней и правку с сохранением размера и времени. Закрываются спешка и
// невнимательность — ровно та форма, в которой это дважды и случилось.
//
// Usage:
//   node scripts/lib/run-witness.mjs --snapshot <файл>            # слепок ДО работы
//   node scripts/lib/run-witness.mjs --verdict  <файл>            # сравнить с текущим состоянием
//   node scripts/lib/run-witness.mjs --verdict  <файл> --strict   # ненулевой код, если тронуто
//   node scripts/lib/run-witness.mjs --self-test

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Наблюдаемые корни: машинное состояние движка ВНЕ любого клона. Список короткий и явный —
// «всё, что вне папки» не перечислимо, а честный прибор не притворяется, что видит всё.
export const WATCHED = [
  join(homedir(), '.claude', 'jidoka'),
  join(homedir(), '.claude', 'hooks'),
  join(homedir(), '.claude', 'settings.json'),
  join(homedir(), '.jidoka'),
];

const SKIP = new Set(['node_modules', '.git', '.DS_Store']);

/** Чистая: снимок дерева как карта путь → отпечаток. Обход ограничен по глубине, чтобы прибор не стоил больше работы. */
export function inventory(roots = WATCHED, { maxDepth = 6, statOf = defaultStat, listOf = defaultList } = {}) {
  const out = {};
  const walk = (p, depth) => {
    const st = statOf(p);
    if (!st) return;
    if (st.isFile) { out[p] = `${st.size}:${st.mtimeMs}`; return; }
    if (depth >= maxDepth) return;
    for (const name of listOf(p)) {
      if (SKIP.has(name)) continue;
      walk(join(p, name), depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return out;
}

function defaultStat(p) {
  try { const s = statSync(p); return { isFile: s.isFile(), size: s.size, mtimeMs: Math.round(s.mtimeMs) }; }
  catch { return null; }
}
function defaultList(p) {
  try { return readdirSync(p); } catch { return []; }
}

/**
 * Чистая: что изменилось между двумя слепками.
 * Три исхода различаются намеренно: появившееся, исчезнувшее и изменённое лечатся по-разному,
 * а слитый счётчик «что-то поменялось» не даёт понять, что именно делать.
 */
export function diffInventory(before = {}, after = {}) {
  const added = [], removed = [], changed = [];
  for (const p of Object.keys(after)) {
    if (!(p in before)) added.push(p);
    else if (before[p] !== after[p]) changed.push(p);
  }
  for (const p of Object.keys(before)) if (!(p in after)) removed.push(p);
  added.sort(); removed.sort(); changed.sort();
  return { added, removed, changed, touched: added.length + removed.length + changed.length };
}

/**
 * Чистая: вердикт для человека. Нулевой знаменатель НЕ выдаётся за чистоту: если наблюдать было
 * нечего, так и говорится. Иначе прибор повторил бы ровно ту болезнь, ради которой написан —
 * «не нашёл» прочиталось бы как «чисто».
 */
export function witnessVerdict(diff, watchedCount) {
  if (!watchedCount) return { verdict: 'nothing-watched', why: 'наблюдаемых путей нет — проверка НЕ состоялась' };
  if (!diff || diff.touched === 0) return { verdict: 'clean', why: `вне рабочей папки не тронуто ничего (под наблюдением ${watchedCount} файлов)` };
  return { verdict: 'touched', why: `вне рабочей папки тронуто ${diff.touched}: добавлено ${diff.added.length}, изменено ${diff.changed.length}, удалено ${diff.removed.length}` };
}

// @divergence: "пустое наблюдение не выдаётся за чистоту" — слепок по несуществующим корням даёт
// ноль изменений, и вердикт «чисто» был бы правдой формально и ложью по смыслу.
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log('  [32m✓[0m ' + n); } else { fail++; console.log('  [31m✗[0m ' + n); } };

  const A = { '/a': '1:100', '/b': '2:200' };
  ok('без изменений — ничего не тронуто', diffInventory(A, A).touched === 0);
  ok('новый файл виден как добавленный', diffInventory(A, { ...A, '/c': '3:300' }).added[0] === '/c');
  ok('исчезнувший файл виден как удалённый', diffInventory(A, { '/a': '1:100' }).removed[0] === '/b');
  ok('перезапись видна как ИЗМЕНЕНИЕ, а не как новизна',
    (() => { const d = diffInventory(A, { ...A, '/b': '9:900' }); return d.changed[0] === '/b' && d.added.length === 0; })());
  ok('три исхода не смешиваются в одну кучу',
    (() => { const d = diffInventory(A, { '/a': '1:100', '/c': '3:300' }); return d.added.length === 1 && d.removed.length === 1 && d.changed.length === 0; })());

  ok('чистый прогон называется чистым и несёт знаменатель',
    witnessVerdict({ touched: 0, added: [], removed: [], changed: [] }, 42).verdict === 'clean');
  ok('тронутое названо числом', /тронуто 2/.test(witnessVerdict(diffInventory(A, { '/a': '9:9' }), 2).why));

  // КРАСНОЕ ПЛЕЧО: нечего наблюдать — это НЕ чистота.
  ok('РАСХОЖДЕНИЕ: пустое наблюдение не выдаётся за чистоту',
    witnessVerdict({ touched: 0, added: [], removed: [], changed: [] }, 0).verdict === 'nothing-watched');
  ok('и человеку сказано, что проверка не состоялась',
    /НЕ состоялась/.test(witnessVerdict({ touched: 0 }, 0).why));

  // обход проверяется подставными stat и list, чтобы логика не зависела от диска
  const tree = { '/r': ['x', 'node_modules'], '/r/x': [] };
  const stats = { '/r': { isFile: false }, '/r/x': { isFile: true, size: 5, mtimeMs: 7 }, '/r/node_modules': { isFile: false } };
  const inv = inventory(['/r'], { statOf: (p) => stats[p] || null, listOf: (p) => tree[p] || [] });
  ok('обход собирает файлы и пропускает node_modules',
    Object.keys(inv).length === 1 && inv['/r/x'] === '5:7');
  ok('несуществующий корень не роняет обход',
    Object.keys(inventory(['/нет-такого-корня'], { statOf: () => null, listOf: () => [] })).length === 0);

  console.log(`\nrun-witness self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url) || sameRealPath(process.argv[1], fileURLToPath(import.meta.url));
function sameRealPath(a, b) { try { return !!a && realpathSync(a) === realpathSync(b); } catch { return false; } }

if (isMain && process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

if (isMain) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : null; };
  const snap = arg('--snapshot');
  const verdictFile = arg('--verdict');

  if (snap) {
    const inv = inventory();
    writeFileSync(snap, JSON.stringify({ at: new Date().toISOString(), roots: WATCHED, inv }));
    console.log(`run-witness: слепок снят — под наблюдением ${Object.keys(inv).length} файлов в ${WATCHED.length} корнях`);
    process.exit(0);
  }

  if (verdictFile) {
    if (!existsSync(verdictFile)) {
      console.error(`run-witness: слепка нет (${verdictFile}) — сравнивать не с чем, проверка НЕ состоялась`);
      process.exit(2);
    }
    const before = JSON.parse(readFileSync(verdictFile, 'utf8'));
    const after = inventory();
    const d = diffInventory(before.inv || {}, after);
    const v = witnessVerdict(d, Object.keys(after).length);
    console.log(`run-witness: ${v.why}`);
    for (const p of d.changed.slice(0, 20)) console.log(`  изменено:  ${p}`);
    for (const p of d.added.slice(0, 20)) console.log(`  добавлено: ${p}`);
    for (const p of d.removed.slice(0, 20)) console.log(`  удалено:   ${p}`);
    if (v.verdict === 'nothing-watched') process.exit(2);
    if (v.verdict === 'touched' && process.argv.includes('--strict')) process.exit(1);
    process.exit(0);
  }

  console.log('usage: run-witness.mjs --snapshot <файл> | --verdict <файл> [--strict] | --self-test');
  process.exit(0);
}
