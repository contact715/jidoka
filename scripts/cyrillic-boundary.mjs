#!/usr/bin/env node
// cyrillic-boundary — \b и \w считают буквой только латиницу и молча теряют русский текст.
//
// @closes-class: ascii-word-boundary-blind-in-cyrillic, ascii-word-class-blind-in-cyrillic
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
// ВТОРОЙ КЛАСС: `\w` (2026-10-10). Тот же дефект без `\b`: `\w` это тоже [A-Za-z0-9_].
// research-audit не засчитывал адрес `CORP_структура_компании.md:15`, потому что имя файла
// бралось через `[\w./@-]+`: пять честных строк замера краснели. Прежний детектор этого не
// видел — в той регулярке нет ни одной русской буквы, русский текст приходит на ВХОД.
// Опись дерева в тот день: 1691 регулярка, 307 с `\w` или `\b`; десять русских правил не
// срабатывали ни разу («составь план», «нужна оценка», «незнакомый флаг»), а разборщики
// кода не видели русских имён функций, хотя в движке их 197.
// Флаг `u` `\w` НЕ лечит: /\w/u.test('ж') === false. Лечение:
//   буква или цифра    [\p{L}\p{N}_]   (+ \p{M} для имён в NFD, как их хранит macOS)
//   имя в JavaScript   [\p{ID_Start}$_][\p{ID_Continue}$]*
//
// Детектор разбирает код как JavaScript (lib/regex-literals.mjs, сверен с acorn), находит
// каждую регулярку и каждому `\w` `\W` `\b` `\B` даёт вердикт:
//   рядом записана кириллица        — сломано наверняка, метка не спасает;
//   `\b` у латинской буквы шаблона  — латинский якорь (/\bgit\s+push\b/), это норма;
//   остальное                        — решает человек: переписать на \p{L} или поставить
//                                      `// @ascii-ok: <почему вход не бывает русским>`
//                                      на той же строке или в комментарии прямо над ней.
// Регулярку, собранную из переменных (new RegExp(x)), разобрать нельзя — она не видна.
//
// Использование:
//   node scripts/cyrillic-boundary.mjs <файлы...>
//   node scripts/cyrillic-boundary.mjs --all
//   node scripts/cyrillic-boundary.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/cli.mjs';
import { extractRegexes, analyzePattern, tokenize } from './lib/regex-literals.mjs';

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

/** Метка с причиной: «// @ascii-ok: session_id это UUID». Без причины не считается. */
const ASCII_OK = /@ascii-ok:\s*(\S.{7,})/u;

/** Метка на самой строке или в сплошном комментарии прямо над ней (до 8 строк). */
function markedAt(lines, idx) {
  if (ASCII_OK.test(lines[idx] || '')) return true;
  for (let k = idx - 1; k >= 0 && k >= idx - 8; k--) {
    const t = lines[k].trim();
    if (!(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))) return false;
    if (ASCII_OK.test(t)) return true;
  }
  return false;
}

/**
 * Чистая: все `\w` `\W` `\b` `\B` в регулярках исходника, которые могут потерять кириллицу.
 *
 * @param {string} src исходник
 * @returns {{ findings: Array<{line:number, text:string, tok:string, verdict:'definite'|'decide', why:string}>,
 *             stats: {regexes:number, dynamic:number, word:number, safe:number, marked:number} }}
 */
export function findAsciiWordClasses(src = '') {
  const lines = String(src).split('\n');
  const stats = { regexes: 0, dynamic: 0, word: 0, safe: 0, marked: 0 };
  const findings = [];
  for (const r of extractRegexes(src)) {
    stats.regexes++;
    if (r.pattern == null) { stats.dynamic++; continue; }
    const verdicts = analyzePattern(r.pattern);
    if (!verdicts.length) continue;
    stats.word++;
    const bad = verdicts.filter((v) => v.verdict !== 'safe');
    if (!bad.length) { stats.safe++; continue; }
    const definite = bad.find((v) => v.verdict === 'definite');
    if (!definite && markedAt(lines, r.line - 1)) { stats.marked++; continue; }
    const v = definite || bad[0];
    findings.push({ line: r.line, text: (lines[r.line - 1] || '').trim().slice(0, 120), tok: v.tok, verdict: v.verdict, why: v.why });
  }
  return { findings, stats };
}

/**
 * Строки тела `function selfTest…() { … }`: там образцы сломанных правил — это их работа,
 * как и в __tests__. Без этого прибор краснел на собственной самопроверке.
 * @param {string} src
 */
export function selfTestLines(src = '') {
  const toks = tokenize(src);
  const lines = new Set();
  for (let k = 0; k < toks.length; k++) {
    if (!(toks[k].t === 'id' && toks[k].v === 'function' && toks[k + 1]?.t === 'id' && /^selfTest/.test(toks[k + 1].v))) continue;
    let j = k + 2;
    while (j < toks.length && toks[j].v !== '{') j++;
    let depth = 0;
    const from = toks[j]?.line ?? 0;
    for (; j < toks.length; j++) {
      if (toks[j].v === '{') depth++;
      else if (toks[j].v === '}' && --depth === 0) break;
    }
    const to = toks[j]?.line ?? from;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return lines;
}

/** Обе проверки по одному файлу, по одной находке на строку, без образцов из самопроверки. */
export function checkSource(src = '') {
  const { findings: all, stats } = findAsciiWordClasses(src);
  const fixture = selfTestLines(src);
  const findings = all.filter((f) => !fixture.has(f.line));
  const seen = new Set(findings.map((f) => f.line));
  for (const h of findAsciiBoundaries(src)) {
    if (seen.has(h.line) || fixture.has(h.line)) continue;
    seen.add(h.line);
    findings.push({ line: h.line, text: h.text, tok: '\\b', verdict: 'definite', why: `\\b ${h.side} кириллицы: граница считается по латинице` });
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, stats };
}

/**
 * Имя файла движка — только латиница. Разборщики движка (gate-audit, install-into,
 * cli-callsites, red-team) ищут файлы по `[\w.-]+\.mjs`, и русское имя они бы молча не
 * увидели. Соглашение сделано проверкой, чтобы метки `@ascii-ok` у тех регулярок
 * опирались на правило, а не на привычку.
 * @param {string} rel путь от корня проверки
 */
export const nonAsciiPath = (rel) => !String(rel).startsWith('..') && /[^\x20-\x7E]/.test(String(rel));

// Тесты и примеры нарочно держат сломанные регулярки — это их работа. Скрытые папки
// (.claude/worktrees — рабочие копии других сессий) не обходятся: это чужая работа.
// docs/proposals — копии реестра классов на решение владельца, они правятся вместе с ним.
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'fixtures', 'chaos-fixtures', '_case_tmp', 'proposals']);

function walk(dir, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let es = [];
  try { es = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
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

  // ── второй класс: \w (и \b рядом с «любой буквой»), разбор кода как JavaScript ──
  const F = (src) => findAsciiWordClasses(src).findings;
  const verdictOf = (src) => (F(src)[0] || {}).verdict || 'нет';
  // Настоящий случай 2026-10-10: регулярка компилируется, латинский путь находит,
  // а адрес с русским именем файла теряет. В ней нет ни одной русской буквы.
  const OLD_PATH = String.raw`const PATH_WITH_LINE_RE = /[\w./@-]+\.(?:md|csv)\s*:\s*\d+/i;`;
  const oldRe = /[\w./@-]+\.(?:md|csv)\s*:\s*\d+/i; // @ascii-ok: это сам дефект-образец, его и ловим
  ok('РАСХОЖДЕНИЕ: регулярка находит латинский путь, а русский теряет — прибор это видит',
    oldRe.test('docs/a.md:3') && !oldRe.test('CORP_структура_компании.md:15') && verdictOf(OLD_PATH) === 'decide');
  ok('флаг u \\w не лечит: /\\w/u всё равно требует решения', verdictOf('const r = /[\\w-]+/u;') === 'decide');
  ok('\\w после русской основы — сломано наверняка («жёсткий гейт» не найдётся)',
    verdictOf('const r = /жёстк\\w* гейт/i;') === 'definite');
  ok('то же в строке для new RegExp', verdictOf("const r = new RegExp('общ\\\\w+ класс', 'i');") === 'definite');
  ok('\\b у русского варианта внутри группы — сломано наверняка', verdictOf('const r = /\\b(git|данные)\\b/;') === 'definite');
  ok('латинский якорь не краснеет', F('const r = /\\bgit\\s+push\\b/; const s = /(?:fix|feat)\\b/;').length === 0);
  ok('необязательная группа перед \\b: якорь берётся из соседней буквы', F('const r = /rate[ _-]?limit(ed)?\\b/i;').length === 0);
  ok('\\b перед цифрой после русской основы — якорь цифра, не находка',
    F('const r = /(\\d+)\\s*(?:прошл\\p{L}*|проверок)\\D{0,20}\\b(\\d+)/iu;').length === 0);
  ok('\\b рядом со вставкой ${…} требует решения: имя может быть русским',
    verdictOf('const r = new RegExp(`\\\\b${name}\\\\b`);') === 'decide');
  ok('регулярка на \\p{L} с флагом u не краснеет',
    F('const r = /[\\p{L}\\p{N}_./@-]+\\.md/u; const s = /(?<![\\p{L}\\p{N}])итог(?![\\p{L}\\p{N}])/u;').length === 0);
  ok('кириллица в том же классе с \\w — автор её учёл', F('const r = /[а-яё\\w]+/i;').length === 0);
  ok('метка с причиной снимает находку', F('// @ascii-ok: session_id это UUID\nconst sid = s.replace(/[^\\w-]/g, "");').length === 0);
  ok('метка без причины не считается', F('// @ascii-ok:\nconst sid = s.replace(/[^\\w-]/g, "");').length === 1);
  ok('метка не спасает правило, сломанное наверняка', F('const r = /мок\\b/; // @ascii-ok: так задумано').length === 1);
  ok('деление не принимается за регулярку', F('const x = a / b / c; const y = (n) / 2;').length === 0);
  ok('регулярка в комментарии и в тексте сообщения не считается',
    F("// /\\w+/ пример\nconsole.log('пиши \\\\w осторожно');").length === 0);
  ok('регулярка внутри ${…} шаблона видна', verdictOf('const m = `${/\\bитог/.test(s)}`;') === 'definite');
  ok('находка называет строку', (F('\n\nconst r = /[\\w.-]+\\.mjs/;')[0] || {}).line === 3);
  ok('пустой вход: ноль регулярок, а не «чисто»', (() => { const r = findAsciiWordClasses(''); return r.stats.regexes === 0 && r.findings.length === 0; })());
  ok('обе проверки дают одну находку на строку, а не две', checkSource('const r = /\\bитог\\b/i;').findings.length === 1);
  ok('русское имя файла движка — находка, латинское и путь вне корня — нет',
    nonAsciiPath('scripts/проверка.mjs') && nonAsciiPath('scripts/проверйка.mjs'.normalize('NFD'))
      && !nonAsciiPath('scripts/cyrillic-boundary.mjs') && !nonAsciiPath('../Митя/x.mjs'));
  ok('образец в самопроверке не находка, то же правило в коде — находка',
    (() => {
      const src = "function selfTest() {\n  ok('x', f('/\\\\bитог/'));\n  const r = /мок\\b/;\n}\nconst real = /мок\\b/;";
      const f = checkSource(src).findings;
      return f.length === 1 && f[0].line === 5;
    })());

  if (fails.length) { console.log(`\n\x1b[31mcyrillic-boundary self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ cyrillic-boundary: ${ran} прошло, 0 упало\x1b[0m`);
  process.exit(0);
}

// Разбор строгий (2026-09-16): раньше любое слово с `--` молча отбрасывалось, и `--al` давал
// «файлов не передано — нечего проверять» с кодом 0.
export const CLI = {
  name: 'cyrillic-boundary',
  summary: 'Найти \\b и \\w, которые молча теряют русский текст: граница и «буква» у них только латинские.',
  selfTest: true,
  options: {
    all: { type: 'boolean', desc: 'проверить всё дерево от текущего каталога (файлы-аргументы тогда не читаются)' },
  },
  positionals: { min: 0, max: Infinity, name: 'файл' },
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { values, positionals, selfTest: wantsSelfTest } = runCli(CLI);
  if (wantsSelfTest) selfTest();
  const root = process.cwd();
  const files = values.all ? walk(root) : positionals;
  if (!files.length) { console.log('cyrillic-boundary: файлов не передано — нечего проверять.'); process.exit(0); }

  let total = 0, definite = 0;
  const unread = [];
  const sum = { regexes: 0, dynamic: 0, word: 0, safe: 0, marked: 0 };
  for (const f of files) {
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { unread.push(f); continue; }
    const { findings, stats } = checkSource(src);
    if (nonAsciiPath(relative(root, f))) {
      findings.unshift({ line: 0, text: relative(root, f), tok: 'имя', verdict: 'definite', why: 'имя файла движка не латиницей: разборщики движка ищут файлы по [\\w.-]+ и его не увидят' });
    }
    for (const k of Object.keys(sum)) sum[k] += stats[k];
    if (!findings.length) continue;
    total += findings.length;
    definite += findings.filter((h) => h.verdict === 'definite').length;
    console.log(`\n\x1b[31m✗ ${relative(root, f)}\x1b[0m`);
    for (const h of findings) console.log(`    ${h.line}: ${h.text}\n         ${h.verdict === 'definite' ? 'сломано' : 'решить'}: ${h.why}`);
  }
  // Непрочитанный файл — не «чисто»: опечатка в пути давала бы зелёный прогон по пустоте.
  for (const f of unread) console.error(`\x1b[31m✗ не прочитан: ${f}\x1b[0m`);
  if (total) {
    console.error(`\n\x1b[31m✗ ${total} правил(о) теряют русский текст (сломано наверняка: ${definite}).\x1b[0m`);
    console.error('  \\w и \\b в JavaScript считают буквой только [A-Za-z0-9_], и флаг u этого не меняет.');
    console.error('  Ошибки нет: на русском слове правило просто молчит.');
    console.error('  Пиши вместо них:  буква [\\p{L}\\p{N}_]   имя в коде [\\p{ID_Start}$_][\\p{ID_Continue}$]*');
    console.error('                    начало слова (?<![\\p{L}\\p{N}])   конец (?![\\p{L}\\p{N}])   флаг u');
    console.error('  Вход правда не бывает русским (UUID, имя репозитория GitHub)? На строке или прямо над ней:');
    console.error('    // @ascii-ok: <почему>    — сломанное наверняка метка не снимает.');
    process.exit(1);
  }
  if (unread.length) process.exit(1);
  console.log(`\x1b[32m✓ cyrillic-boundary: файлов ${files.length}, регулярок ${sum.regexes}, с \\w или \\b ${sum.word}: латинский якорь ${sum.safe}, с меткой @ascii-ok ${sum.marked}; из переменных (не видны) ${sum.dynamic}\x1b[0m`);
  process.exit(0);
}
