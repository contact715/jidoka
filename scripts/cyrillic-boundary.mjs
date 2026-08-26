#!/usr/bin/env node
// cyrillic-boundary — \b рядом с кириллицей молча не работает.
//
// @closes-class: ascii-word-boundary-blind-in-cyrillic
// @scope: staged
// @divergence: "РАСХОЖДЕНИЕ: правило корректно, а совпадений не будет никогда" —
//              измеряемая величина «регулярка синтаксически корректна» говорит «работает»,
//              а правило «находит русское слово» нарушено: границы там нет
//
// ЧТО ЗА ДЕФЕКТ. В JavaScript `\b` определена через `\w`, то есть [A-Za-z0-9_]. Между
// пробелом и русской буквой границы слова НЕТ, поэтому /\bитог\b/ не находит «итог»
// никогда. Ошибки при этом не возникает: правило просто молчит.
//
// ПОЧЕМУ ПРИБОР. Класс встретился ЧЕТЫРЕ раза за три дня, все четыре у меня:
//   2026-08-24  property-vs-method       5 проверок из 17 молча не срабатывали
//   2026-08-24  negative-claim-gate      5 из 14
//   2026-08-24  запись в реестр о нём же
//   2026-08-26  closing-summary-gate     3 из 11
// Каждый раз ловилось ПРОГОНОМ, ни разу чтением: глазами `\b` выглядит правильно.
// Четыре повтора это не невнимательность, это отсутствие прибора.
//
// ЛЕЧЕНИЕ, которое надо писать вместо `\b`:
//   начало слова   (?<![\p{L}\p{N}])
//   конец слова    (?![\p{L}\p{N}])
//   флаг `u` обязателен, иначе \p{...} не работает
//
// Использование:
//   node scripts/cyrillic-boundary.mjs <файлы...>
//   node scripts/cyrillic-boundary.mjs --all
//   node scripts/cyrillic-boundary.mjs --self-test

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CYR = 'а-яёА-ЯЁ';

/**
 * Чистая: найти `\b`, стоящую вплотную к кириллице.
 *
 * Между `\b` и буквой допускаются только служебные символы регулярки — скобки, черта
 * выбора, квантификаторы. Пробел или латинская буква разрывают соседство: там `\b`
 * работает штатно и трогать её незачем.
 *
 * @param {string} src исходник
 * @returns {Array<{line:number, text:string, side:'до'|'после'}>}
 */
export function findAsciiBoundaries(src = '') {
  const out = [];
  const lines = String(src).split('\n');
  // \b, за которой (через служебные символы) идёт кириллица
  // Косая удваивается в строковом литерале ('нет\\b') и не удваивается в литерале
  // регулярки (/нет\b/). Оба написания настоящие, поэтому \\+ , а не одна косая.
  // ЧЕРТА ВЫБОРА РАЗРЫВАЕТ СОСЕДСТВО, и это не мелочь. В /\b(git|data)\b|истори/ граница
  // относится к ЛАТИНСКИМ вариантам, а у кириллических её нет — код правильный. Замер по
  // движку с чертой в списке разрешённых дал 44 находки, почти все такого вида. Прибор,
  // который краснеет на здоровом коде, учит пролистывать себя за один день.
  const after = new RegExp(String.raw`\\+b[(\[]*[${CYR}]`);
  // кириллица, за которой вплотную идёт \b
  const before = new RegExp(String.raw`[${CYR}][)\]]*\\+b`);
  lines.forEach((raw, i) => {
    const line = raw;
    // строки-комментарии, объясняющие сам дефект, находкой не считаются: иначе прибор
    // краснеет на собственной документации и учит себя игнорировать
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*')) return;
    if (after.test(line)) out.push({ line: i + 1, text: line.trim().slice(0, 120), side: 'после' });
    else if (before.test(line)) out.push({ line: i + 1, text: line.trim().slice(0, 120), side: 'до' });
  });
  return out;
}

function walk(dir, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let es = [];
  try { es = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc, depth + 1);
    else if (/\.mjs$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function selfTest() {
  const fails = [];
  let ran = 0;
  const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('РАСХОЖДЕНИЕ: правило корректно, а совпадений не будет никогда',
    findAsciiBoundaries('const r = /\\bитог\\b/i;').length === 1);
  ok('\\b перед кириллицей ловится', findAsciiBoundaries('/\\bтакого\\s+нет/').length === 1);
  ok('\\b после кириллицы ловится', findAsciiBoundaries("rx('нет\\\\b')").length === 1);
  ok('через скобку и черту выбора тоже видно', findAsciiBoundaries('/\\b(идёт|шёл)/u').length === 1);
  ok('\\b с латиницей это норма', findAsciiBoundaries('/\\bbypass\\b/i').length === 0);
  ok('юникодный предпросмотр находкой не считается',
    findAsciiBoundaries("new RegExp('(?<![\\\\p{L}])итог', 'u')").length === 0);
  ok('кириллица без \\b это норма', findAsciiBoundaries('/такого\\s+нет/iu').length === 0);
  ok('комментарий про сам дефект не краснеет',
    findAsciiBoundaries('// не пиши /\\bитог\\b/, она не сработает').length === 0);
  ok('черта выбора РАЗРЫВАЕТ соседство: \\b относится к латинским вариантам',
    findAsciiBoundaries('/\\b(history|git)\\b|истори|данны/').length === 0);
  ok('второй настоящий случай из движка тоже не краснеет',
    findAsciiBoundaries('/\\bdebug|\\bbug|не работает|сломал/i').length === 0);
  ok('пустой вход не притворяется проверкой', findAsciiBoundaries('').length === 0);
  ok('находка называет строку и сторону',
    (() => { const r = findAsciiBoundaries('\nconst x = /\\bитог/;')[0]; return r.line === 2 && r.side === 'после'; })());

  if (fails.length) { console.log(`\n\x1b[31mcyrillic-boundary self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ cyrillic-boundary: ${ran} прошло, 0 упало\x1b[0m`);
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const root = process.cwd();
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const files = process.argv.includes('--all') ? walk(root) : args;
  if (!files.length) { console.log('cyrillic-boundary: файлов не передано — нечего проверять.'); process.exit(0); }

  let total = 0;
  for (const f of files) {
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const hits = findAsciiBoundaries(src);
    if (!hits.length) continue;
    total += hits.length;
    console.log(`\n\x1b[31m✗ ${relative(root, f)}\x1b[0m`);
    for (const h of hits) console.log(`    ${h.line}: ${h.text}`);
  }
  if (total) {
    console.error(`\n\x1b[31m✗ ${total} правил(о) с \\b рядом с кириллицей — они молча не срабатывают.\x1b[0m`);
    console.error('  \\b в JavaScript определена через \\w = [A-Za-z0-9_]. Между пробелом и русской');
    console.error('  буквой границы нет, ошибки тоже нет: правило просто ничего не находит.');
    console.error('  Пиши вместо неё:  начало (?<![\\p{L}\\p{N}])   конец (?![\\p{L}\\p{N}])   флаг u');
    process.exit(1);
  }
  console.log(`\x1b[32m✓ cyrillic-boundary: проверено файлов ${files.length}, \\b рядом с кириллицей нет\x1b[0m`);
  process.exit(0);
}
