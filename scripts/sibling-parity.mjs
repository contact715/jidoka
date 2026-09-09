#!/usr/bin/env node
// @closes-class: rule-reached-one-branch-of-three
// @scope: changed
//
// sibling-parity — правило, применённое к ОДНОМУ месту из нескольких похожих.
//
// ПРОБЛЕМА, замеренная а не предполагаемая. Класс rule-reached-one-branch-of-three
// рецидивировал дважды за двое суток, оба раза его поймал человек:
//   2026-09-08 — минимум цели пальца закрыл одну ветку разметки из трёх, ссылка и
//                призрачная кнопка остались 165x32;
//   2026-09-09 — правило про мёртвые кнопки применено к Import CSV и НЕ применено к
//                Import contacts и Import companies В ТОМ ЖЕ ФАЙЛЕ.
// Режим отказа FM-2.2 покрыт нулём механизмов при восьми именах класса.
//
// ПОЧЕМУ БЕЗ РАЗМЕТКИ. Первый замысел требовал, чтобы автор объявлял инвариант и его
// двери. Такой механизм был бы спящим: размечать надо в продуктовых репозиториях, а
// разметки там нет и не появится сама. Форма выше видна СТРУКТУРНО: несколько строк
// одинаковой формы в одном файле, и различающий признак только у одной.
//
// ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ. Отключить одну кнопку из трёх бывает правильно. Прибор
// не знает замысла и не притворяется, что знает: он называет соседей и спрашивает, так
// ли задумано. Запрет здесь означал бы ложные срабатывания на законной работе, а гейт,
// который мешает законному, обходят на второй день.
//
// ЧЕГО НЕ ЛОВИТ, сказано вслух: соседей в ДРУГИХ файлах, различие в форме записи при
// одинаковом смысле, и случай, когда похожих мест меньше двух. Закрывается ровно то, в
// чём это дважды и случилось: правка одного из нескольких одинаковых мест рядом.
//
// Usage:
//   node scripts/sibling-parity.mjs --file <файл> --lines 12,40      # разбор конкретных строк
//   node scripts/sibling-parity.mjs --staged                          # по индексу git
//   node scripts/sibling-parity.mjs --self-test

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Слова длиной от двух символов. Односимвольные отбрасываются: они шумят и различают
// строки там, где смысл одинаков (индексы, координаты).
//
// Две детали, каждая из которых была ошибкой в первой версии и поймана собственной
// самопроверкой:
//   1. разбор идёт по \p{L}, а не по [a-zA-Z] и \w. Класс ascii-word-boundary-blind-in-cyrillic
//      в этом же движке уже записан, и я въехал в него ровно здесь: «кнопка Добавить позже»
//      давало ноль слов, потому что \w в JavaScript кириллицу не считает буквой;
//   2. camelCase разбивается. Без этого importCsv и importContacts не пересекаются НИ ОДНИМ
//      словом, то есть настоящий случай, ради которого прибор написан, не находился вовсе.
export function tokenize(line = '') {
  const raw = String(line).match(/[\p{L}_][\p{L}\p{N}_-]*/gu) || [];
  const out = [];
  for (const word of raw) {
    for (const part of word.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})/u)) {
      const t = part.toLowerCase();
      if (t.length >= 2) out.push(t);
    }
  }
  return out;
}

/** Чистая: мера похожести двух строк как доля общих слов (Жаккар). */
export function similarity(a = '', b = '') {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/**
 * Чистая: ГЛАВНАЯ проверка. Для каждой изменённой строки ищет в том же файле строки
 * похожей формы и смотрит, есть ли у изменённой признак, которого нет НИ У ОДНОГО соседа.
 *
 * Порог соседства подобран ЗАМЕРОМ на двух настоящих инцидентах, а не на глаз: при 0,6
 * случай с тремя кнопками импорта не находился (идентификаторы importCsv и importContacts
 * дают мало общего), при пороге ниже 0,4 соседями становятся любые две строки на одном
 * языке и прибор превращается в шум, который перестают читать.
 *
 * @param {string[]} lines все строки файла
 * @param {number[]} changed номера изменённых строк, с единицы
 * @returns {Array<{line:number, siblings:number[], distinguishing:string[]}>}
 */
export function oddOneOut(lines = [], changed = [], { minSim = 0.5, minSiblings = 2 } = {}) {
  const out = [];
  for (const n of changed) {
    const idx = n - 1;
    const subject = lines[idx];
    if (!subject || tokenize(subject).length < 3) continue;

    const siblings = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === idx) continue;
      if (similarity(subject, lines[i]) >= minSim) siblings.push(i + 1);
    }
    if (siblings.length < minSiblings) continue;

    // Признак различия сам по себе НИЧЕГО не значит: у каждой кнопки есть своё имя
    // (csv, contacts, companies), поэтому «есть слово, которого нет у соседей» верно
    // всегда и прибор кричал бы на любой правке. Первая версия ровно так и делала, и
    // это поймало собственное красное плечо «все соседи получили признак — молчит».
    //
    // Настоящий признак — не различие, а ЛИШНЕЕ: у изменённой строки БОЛЬШЕ отдельных
    // слов, чем у любого соседа, то есть она несёт довесок, которого нет ни у кого.
    // Когда правило накрыло всех, длины равны и прибор молчит.
    const mine = new Set(tokenize(subject));
    const maxSibling = Math.max(...siblings.map((sl) => new Set(tokenize(lines[sl - 1])).size));
    if (mine.size <= maxSibling) continue;

    const theirs = new Set();
    for (const s of siblings) for (const t of tokenize(lines[s - 1])) theirs.add(t);
    const distinguishing = [...mine].filter((t) => !theirs.has(t));
    if (distinguishing.length) out.push({ line: n, siblings, distinguishing });
  }
  return out;
}

/**
 * Чистая: как это сказать человеку. Пустой список — это «похожих мест не нашлось»,
 * а НЕ «всё хорошо»: прибор, который ничего не осмотрел, обязан говорить об этом, иначе
 * повторяет класс green-check-that-checks-nothing.
 */
export function parityReport(findings, examinedLines) {
  if (!examinedLines) return { verdict: 'nothing-examined', text: 'изменённых строк не найдено — проверка НЕ состоялась' };
  if (!findings.length) return { verdict: 'even', text: `осмотрено изменённых строк: ${examinedLines}; мест «одно из нескольких» не найдено` };
  const lines = [`осмотрено изменённых строк: ${examinedLines}; правка коснулась ОДНОГО из нескольких похожих мест:`];
  for (const f of findings.slice(0, 10)) {
    lines.push(`  строка ${f.line}: признак ${f.distinguishing.slice(0, 4).map((x) => `«${x}»`).join(', ')} есть тут и НЕТ у соседей ${f.siblings.slice(0, 6).join(', ')}`);
  }
  lines.push('  Так задумано — ничего делать не надо. Не задумано — правило накрыло одну дверь из трёх.');
  return { verdict: 'odd', text: lines.join('\n') };
}

// @divergence: "все соседи получили признак — молчит" — прибор видит признак у изменённой
// строки и обязан НЕ жаловаться, когда он есть и у соседей; без этого плеча он краснел бы
// на любой правке любой повторяющейся строки и его перестали бы читать.
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log('  [32m✓[0m ' + n); } else { fail++; console.log('  [31m✗[0m ' + n); } };

  // Фикстура 1 — настоящий инцидент 2026-09-09: три кнопки импорта, disabled только у одной.
  const importFile = [
    '<Button onClick={importCsv} disabled>Import CSV</Button>',
    '<Button onClick={importContacts}>Import contacts</Button>',
    '<Button onClick={importCompanies}>Import companies</Button>',
  ];
  const r1 = oddOneOut(importFile, [1]);
  ok('настоящий случай: disabled у одной кнопки из трёх — найдено',
    r1.length === 1 && r1[0].siblings.length === 2);
  ok('и признак назван по имени, а не «что-то отличается»',
    r1.length === 1 && r1[0].distinguishing.includes('disabled'));

  // Фикстура 2 — настоящий инцидент 2026-09-08: минимум цели пальца в одной ветке из трёх.
  const emptyStates = [
    '<button className="empty-cta pointer-coarse:min-h-touch">Добавить</button>',
    '<button className="empty-cta">Добавить позже</button>',
    '<button className="empty-cta">Пропустить</button>',
  ];
  const r2 = oddOneOut(emptyStates, [1]);
  ok('настоящий случай: цель пальца в одной ветке разметки из трёх — найдено', r2.length === 1);

  // КРАСНОЕ ПЛЕЧО наоборот: правило накрыло ВСЕХ — прибор обязан молчать.
  const allCovered = [
    '<Button onClick={importCsv} disabled>Import CSV</Button>',
    '<Button onClick={importContacts} disabled>Import contacts</Button>',
    '<Button onClick={importCompanies} disabled>Import companies</Button>',
  ];
  ok('РАСХОЖДЕНИЕ: все соседи получили признак — молчит',
    oddOneOut(allCovered, [1]).length === 0);

  ok('один сосед это не «несколько» — молчит',
    oddOneOut(importFile.slice(0, 2), [1]).length === 0);
  ok('непохожие строки соседями не считаются',
    oddOneOut(['const a = readFile(path)', 'export function foo() {}', 'return 42;'], [1]).length === 0);
  ok('короткая строка не разбирается: слишком мало смысла',
    oddOneOut(['x++', 'y++', 'z++'], [1]).length === 0);

  ok('похожесть считается по общим словам',
    similarity('<Button disabled>Import CSV</Button>', '<Button>Import CSV</Button>') > 0.6);
  ok('разные строки непохожи', similarity('const a = 1', 'return render()') < 0.3);
  ok('пустая строка ни на что не похожа', similarity('', 'что-то') === 0);
  ok('слова выделяются и в кириллице', tokenize('кнопка Добавить позже').length === 3);

  ok('нечего осматривать — это НЕ «всё ровно»',
    parityReport([], 0).verdict === 'nothing-examined');
  ok('чистый разбор несёт знаменатель',
    /осмотрено изменённых строк: 5/.test(parityReport([], 5).text));
  ok('находка объясняет, что делать',
    /одну дверь из трёх/.test(parityReport(r1, 1).text));

  console.log(`\nsibling-parity self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

function stagedChanges() {
  // Номера добавленных строк по индексу git: разбираем заголовки кусков @@ -a,b +c,d @@
  let diff = '';
  try { diff = execFileSync('git', ['diff', '--cached', '-U0'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch { return new Map(); }
  const byFile = new Map();
  let file = null, next = 0;
  for (const line of diff.split('\n')) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { file = f[1]; continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h) { next = Number(h[1]); continue; }
    if (!file) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(next);
      next++;
    }
  }
  return byFile;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url) || sameRealPath(process.argv[1], fileURLToPath(import.meta.url));
function sameRealPath(a, b) { try { return !!a && realpathSync(a) === realpathSync(b); } catch { return false; } }

if (isMain && process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

if (isMain) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : null; };
  const targets = new Map();

  const one = arg('--file');
  if (one) {
    const ln = (arg('--lines') || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
    targets.set(one, ln);
  } else if (process.argv.includes('--staged')) {
    for (const [f, ln] of stagedChanges()) targets.set(f, ln);
  } else {
    console.log('usage: sibling-parity.mjs --file <файл> --lines 1,2 | --staged | --self-test');
    process.exit(0);
  }

  let examined = 0;
  const all = [];
  for (const [f, ln] of targets) {
    if (!existsSync(f) || !ln.length) continue;
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const found = oddOneOut(src.split('\n'), ln);
    examined += ln.length;
    for (const x of found) all.push({ ...x, file: f });
  }

  const rep = parityReport(all, examined);
  console.log(`sibling-parity: ${rep.text}`);
  for (const x of all.slice(0, 10)) console.log(`  ${x.file}:${x.line}`);
  process.exit(rep.verdict === 'odd' && process.argv.includes('--strict') ? 1 : 0);
}
