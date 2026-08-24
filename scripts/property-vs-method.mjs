#!/usr/bin/env node
// property-vs-method — отличает проверку СВОЙСТВА от проверки СПОСОБА.
//
// @closes-class: guard-fires-on-mention-not-action
// @scope: all
// @scope-ok: дерево движка небольшое (286 файлов), полный проход занимает доли секунды,
//            а находок сегодня ноль. Сужать до правки нечего: подозрение живёт в файле
//            целиком, а не в изменённой строке, и пропуск соседнего теста ничего не даст.
// @divergence: "РАСХОЖДЕНИЕ: сторож читает текст коммита, где флаг лишь УПОМЯНУТ" —
//              измеряемая величина «подстрока найдена» говорит «нарушение», а правило
//              «действие совершено» не выполнено: во фразе про флаг флага нет
//
// СВОЙСТВО это то, что обязано быть верным. СПОСОБ это то, как оно сегодня достигается
// или как оно пишется буквами. Проверка способа выглядит как проверка свойства и ведёт
// себя иначе: она краснеет на правильной работе и зеленеет на сломанной.
//
// Два класса из нашего реестра ошибок — одна форма:
//
//   guard-fires-on-mention-not-action (2026-08-08)
//     детектор совпал на упоминании флага ВНУТРИ текста коммита и заблокировал
//     собственный коммит. Мерилась ПОДСТРОКА, а правило было про ДЕЙСТВИЕ.
//
//   test-encodes-the-defect (2026-08-20)
//     утверждение теста оказалось ШИРЕ его замысла: тест назывался «не роняет
//     компонент», а сверял конкретную строку. Мерился СПОСОБ отрисовки, а свойство
//     было «не падает».
//
// Третья форма пришла из живой сессии продукта 2026-08-24: тест сам засевал сломанный
// контур и проверял ровно то, что засеял. Такой тест ТРЕБУЕТ дефекта: почини поведение,
// и он покраснеет.
//
// ЧЕСТНАЯ ГРАНИЦА. Это грубый текстовый разбор, а не понимание кода. Он ошибается в
// СТРОГУЮ сторону намеренно: сомнительное считает нормальным, потому что ложное
// обвинение приборов учит пролистывать вывод (и это ровно тот вред, который мы лечим).
// Поэтому находки называются подозрениями и требуют человеческого взгляда.
//
// ЧТО ПОКАЗЫВАЕТСЯ, А ЧТО НЕТ. Формы 1 и 2 печатаются: они точны. Форма 3 по умолчанию
// НЕ печатается — на живом продукте она дала 51 находку, почти все законные, потому что
// тест-проводка обязана засеять литерал и его же проверить. Отличить её от теста,
// засеявшего СЛОМАННЫЙ контур, текстом нельзя, и это названо здесь, а не спрятано.
//
// Использование:
//   node scripts/property-vs-method.mjs --repo <путь>              # формы 1 и 2
//   node scripts/property-vs-method.mjs --repo <путь> --tautology  # плюс слабая форма 3
//   node scripts/property-vs-method.mjs --repo <путь> --ratchet    # выход 1 при находках
//   node scripts/property-vs-method.mjs --self-test

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── словари ──────────────────────────────────────────────────────────────────
// ПОВЕСТВОВАТЕЛЬНОЕ поле: человек рассказывает о работе. Здесь слово про действие
// это слово, а не действие.
export const NARRATIVE_FIELDS = [
  'message', 'msg', 'body', 'text', 'prompt', 'description', 'transcript',
  'comment', 'reason', 'title', 'note', 'summary', 'content', 'log', 'output',
];
// ОПЕРАЦИОННОЕ поле: машина сообщает, что произойдёт. Здесь слово про действие
// и есть действие.
export const OPERATIONAL_FIELDS = [
  'command', 'cmd', 'argv', 'args', 'file_path', 'filepath', 'path', 'paths',
  'tool_name', 'toolname', 'files', 'staged', 'target',
];
// Токен, обозначающий ДЕЙСТВИЕ: флаг, подкоманда, опасный вызов.
// Слеш в списке разделителей не случаен: `/--force/.test(prompt)` это ровно тот случай,
// ради которого прибор написан, и без него сторож на регулярке проходил бы мимо.
const ACTION_TOKEN = /(^|[\s'"`(/])(--[a-z][a-z0-9-]{2,}|rm\s+-rf|git\s+(push|commit|reset)|sudo\b)/i;

// ДВА РОДА глаголов, и смешивать их нельзя.
//
// «Не падает» обещает ОТСУТСТВИЕ отказа и никогда не обещает значения. Поэтому сверка
// конкретной строки в таком тесте шире замысла ВСЕГДА, сколько бы уточнений ни стояло
// в имени: «не падает на пустых данных» это по-прежнему обещание не упасть.
// ГРАНИЦА СЛОВА ЗДЕСЬ НЕ \b, И ЭТО НЕ ПРИДИРКА. В JavaScript \b определена по ASCII,
// поэтому после кириллического «падает» границы нет и правило молча не срабатывает.
// Наступил на это прямо здесь: проверка «не падает на пустых данных» не ловилась, пока
// стояла \b. Это наш собственный класс ascii-word-boundary-blind-in-cyrillic (2026-08-08).
const NO_CRASH_VERB = /^(не\s*падает|не\s*роняет|не\s*ломает|не\s*кидает|does\s*not\s*(crash|throw|break)|should\s*not\s*(crash|throw))(?![\p{L}\p{N}])/iu;
// «Отрисовывает» обещает результат. Оно расплывчато, только если не сказано, ЧТО именно:
// «renders» само по себе не обещает ничего, а «renders the KPI row» обещает строку KPI.
const RENDERS_VERB = /^(renders?|отрисов[\p{L}]*|монтируется|mounts?|works?|работает)(?![\p{L}\p{N}])/iu;
// Слова, которые ничего не добавляют к замыслу.
const FILLER = /^(correctly|properly|fine|ok|without\s+errors?|как\s+надо|правильно|нормально|the|a|an|it)$/i;

/**
 * Чистая: РАСПЛЫВЧАТ ли замысел теста.
 *
 * Первая версия просто искала слово `renders` в любом месте имени и на живом продукте
 * дала 179 находок, из которых почти все ложные: «renders exactly one arrow-right
 * connector for a 2-step chain» это КОНКРЕТНЫЙ замысел, и точная сверка в нём уместна.
 * Прибор мерил способ написания имени вместо расплывчатости замысла — та же подмена, ради
 * которой он написан, только внутри него самого.
 *
 * Замысел считается расплывчатым, если имя НАЧИНАЕТСЯ с такого глагола и дальше не
 * называет, что именно проверяется: остаток состоит из слов-пустышек либо пуст.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isVagueIntent(name = '') {
  const n = String(name).trim();
  // род 1: обещано только отсутствие отказа — уточнения этого не меняют
  if (NO_CRASH_VERB.test(n)) return true;
  // род 2: обещан результат — расплывчато, только если не сказано какой
  if (!RENDERS_VERB.test(n)) return false;
  const rest = n.replace(RENDERS_VERB, '').trim().replace(/[.,!—-]+$/, '');
  if (!rest) return true;
  return rest.split(/\s+/).filter(Boolean).every((w) => FILLER.test(w));
}
// Утверждение, пиньгующее КОНКРЕТНОЕ значение.
const EXACT_ASSERT = /\.(toBe|toEqual|toStrictEqual)\(\s*(['"`][^'"`]{3,}['"`]|\d+)\s*\)|assert\.(equal|strictEqual|deepEqual)\(/;

const isTestFile = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

/**
 * ФОРМА 1. Сторож читает повествовательное поле и ищет там действие.
 *
 * Возвращает подозрения: строка, поле, найденный токен. Пусто значит «не нашёл»,
 * а не «чисто»: разбор текстовый и видит не всё.
 *
 * @param {string} src исходник сторожа
 * @returns {Array<{line:number, field:string, token:string, text:string}>}
 */
export function mentionNotAction(src = '') {
  const out = [];
  const lines = String(src).split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('#')) return;
    // ищем ЧТЕНИЕ подстроки из переменной
    const reads = [...line.matchAll(/([A-Za-z_$][\w$.]*)\s*\.\s*(includes|indexOf|match|search)\s*\(/g)];
    const tests = [...line.matchAll(/\.test\s*\(\s*([A-Za-z_$][\w$.]*)\s*\)/g)];
    const names = [...reads.map((m) => m[1]), ...tests.map((m) => m[1])];
    if (!names.length) return;
    const tok = line.match(ACTION_TOKEN);
    if (!tok) return;
    for (const full of names) {
      const leaf = full.split('.').pop().toLowerCase();
      // операционное поле — это правильный вход, не находка
      if (OPERATIONAL_FIELDS.some((f) => leaf === f || leaf.endsWith(f))) continue;
      if (!NARRATIVE_FIELDS.some((f) => leaf === f || leaf.includes(f))) continue;
      out.push({ line: i + 1, field: full, token: tok[2] || tok[0].trim(), text: line.slice(0, 120) });
    }
  });
  return out;
}

/**
 * ФОРМА 2. Утверждение ШИРЕ замысла: имя теста обещает свойство «не падает /
 * отрисовывается», а тело сверяет конкретное значение.
 *
 * @param {string} src исходник теста
 * @returns {Array<{line:number, name:string, text:string}>}
 */
export function assertionWiderThanIntent(src = '') {
  const out = [];
  const lines = String(src).split('\n');
  let open = null; // {name, line, depth}
  let depth = 0;
  lines.forEach((raw, i) => {
    const line = raw;
    // Закрывать имя обязана ТА ЖЕ кавычка, что открыла. Первая версия брала любую из
    // трёх, и имя «renders `code` as a code element» обрывалось на обратной кавычке до
    // «renders », после чего замысел выглядел расплывчатым. Прибор мерил способ
    // цитирования вместо структуры строки и дал ложную находку на живом продукте.
    const start = line.match(/\b(it|test)\s*\(\s*(['"`])((?:(?!\2).)*)\2/);
    if (start) { open = { name: start[3], line: i + 1, hit: false }; depth = 0; }
    if (!open) return;
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (!open.hit && isVagueIntent(open.name) && EXACT_ASSERT.test(line)) {
      out.push({ line: i + 1, name: open.name, text: line.trim().slice(0, 120) });
      open.hit = true; // одно подозрение на тест, а не на каждую строку
    }
    if (depth <= 0 && i > open.line - 1) open = null;
  });
  return out;
}

/**
 * ФОРМА 3. Тест засевает то, что потом проверяет: один и тот же литерал стоит и в
 * подготовке, и в утверждении. Такой тест не проверяет поведение, он повторяет вход,
 * а если вход был сломанным — ТРЕБУЕТ дефекта.
 *
 * @param {string} src
 * @returns {Array<{line:number, name:string, literal:string}>}
 */
export function seedsWhatItAsserts(src = '') {
  const out = [];
  const blocks = [];
  const lines = String(src).split('\n');
  let cur = null, depth = 0;
  lines.forEach((raw, i) => {
    const start = raw.match(/\b(it|test)\s*\(\s*(['"`])((?:(?!\2).)*)\2/);
    if (start) { cur = { name: start[3], line: i + 1, lines: [] }; depth = 0; }
    if (!cur) return;
    cur.lines.push({ i: i + 1, s: raw });
    depth += (raw.match(/\{/g) || []).length - (raw.match(/\}/g) || []).length;
    if (depth <= 0 && cur.lines.length > 1) { blocks.push(cur); cur = null; }
  });
  const SEED = /(mockReturnValue|mockResolvedValue|\bseed\w*\(|\bgiven\w*\(|=\s*\{|\bsetup\w*\()/;
  for (const b of blocks) {
    const seeded = new Set();
    for (const { s } of b.lines) {
      if (!SEED.test(s)) continue;
      for (const m of s.matchAll(/['"`]([^'"`\n]{4,})['"`]/g)) seeded.add(m[1]);
    }
    for (const { i, s } of b.lines) {
      if (!EXACT_ASSERT.test(s)) continue;
      for (const m of s.matchAll(/['"`]([^'"`\n]{4,})['"`]/g)) {
        if (seeded.has(m[1])) { out.push({ line: i, name: b.name, literal: m[1] }); break; }
      }
    }
  }
  return out;
}

// ── обход дерева ─────────────────────────────────────────────────────────────
// КОПИИ ИСКЛЮЧЕНЫ, и это не оптимизация. Замер 2026-08-24 на projectx-app: в
// .claude/worktrees лежит 14678 файлов против 9167 настоящих, то есть рабочие копии
// репозитория содержат полные дубликаты дерева. Обход по ним считал бы одну находку
// за пять и печатал уверенное завышенное число — та же подмена предмета счётом его
// копий, ради которой этот прибор и написан.
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.turbo', '.cache', 'vendor', '.venv', '__pycache__',
  'worktrees', // .claude/worktrees — полные копии репозитория
]);
/** Каталоги вывода сборки: имя начинается так. Внутри минифицированные бандлы. */
export const SKIP_PREFIXES = ['.next'];
/**
 * Порог размера файла. Прибор смотрит РУКОПИСНЫЕ проверки; минифицированный бандл это
 * одна строка в мегабайты, на которой построчный разбор захлёбывается, а находок в нём
 * не бывает по определению. Замер 2026-08-24: без порога скан projectx-app не уложился
 * в десять минут, с порогом занимает секунды.
 */
export const MAX_FILE_BYTES = 400 * 1024;

/** Чистая: пропускать ли каталог. */
export function skipDir(name = '') {
  return SKIP_DIRS.has(name) || SKIP_PREFIXES.some((p) => name.startsWith(p));
}

function walk(dir, acc = [], depth = 0) {
  if (depth > 10) return acc;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (skipDir(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc, depth + 1);
    else if (/\.[cm]?[jt]sx?$/.test(e.name)) {
      // минифицированный бандл это не рукописная проверка
      try { if (statSync(p).size <= MAX_FILE_BYTES) acc.push(p); } catch { /* исчез между обходом и чтением */ }
    }
  }
  return acc;
}

export function auditTree(root) {
  const files = walk(root);
  const guards = [], wider = [], seeds = [];
  for (const f of files) {
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const rel = relative(root, f);
    if (isTestFile(f)) {
      for (const r of assertionWiderThanIntent(src)) wider.push({ file: rel, ...r });
      for (const r of seedsWhatItAsserts(src)) seeds.push({ file: rel, ...r });
    } else if (/hook|guard|gate|check/i.test(rel)) {
      for (const r of mentionNotAction(src)) guards.push({ file: rel, ...r });
    }
  }
  return { scanned: files.length, guards, wider, seeds };
}

function selfTest() {
  const fails = [];
  let ran = 0;
  const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  // ── ФОРМА 1 ────────────────────────────────────────────────────────────────
  // Собственный кейс расхождения прибора: подстрока найдена, а действия нет.
  ok('РАСХОЖДЕНИЕ: сторож читает текст коммита, где флаг лишь УПОМЯНУТ',
    mentionNotAction("if (commitMessage.includes('--no-verify')) block();").length === 1);
  ok('тот же токен в ОПЕРАЦИОННОМ поле находкой не считается',
    mentionNotAction("if (toolInput.command.includes('--no-verify')) block();").length === 0);
  ok('проверка пути это операционное поле',
    mentionNotAction("if (file_path.includes('--force')) block();").length === 0);
  ok('регулярка по промпту тоже ловится',
    mentionNotAction('if (/--force/.test(prompt)) deny();').length === 1);
  ok('повествовательное поле БЕЗ токена действия не находка',
    mentionNotAction("if (description.includes('привет')) log();").length === 0);
  ok('строка-комментарий не считается кодом',
    mentionNotAction("// if (message.includes('--no-verify')) block();").length === 0);
  ok('находка называет поле и токен',
    (() => { const r = mentionNotAction("if (body.includes('--force')) x();")[0]; return r.field === 'body' && /--force/.test(r.token); })());

  // ── ФОРМА 2 ────────────────────────────────────────────────────────────────
  ok('замысел «не падает», а сверяется точная строка — шире замысла',
    assertionWiderThanIntent("it('не падает на пустых данных', () => {\n  expect(x).toBe('Нет данных');\n});").length === 1);
  ok('замысел «не падает» и проверка на отсутствие исключения — норма',
    assertionWiderThanIntent("it('не падает на пустых данных', () => {\n  expect(() => render()).not.toThrow();\n});").length === 0);
  ok('узкий замысел с точной сверкой это норма',
    assertionWiderThanIntent("it('показывает заголовок счёта', () => {\n  expect(x).toBe('Счёт 42');\n});").length === 0);
  ok('«не падает» остаётся расплывчатым, сколько ни уточняй',
    isVagueIntent('не падает на пустых данных') && isVagueIntent('does not crash when list is empty'));
  ok('«renders» без объекта расплывчато', isVagueIntent('renders') && isVagueIntent('renders correctly'));
  ok('РАСХОЖДЕНИЕ: «renders» С ОБЪЕКТОМ это конкретный замысел, а не расплывчатый',
    isVagueIntent('renders exactly one arrow-right connector for a 2-step chain') === false);
  ok('обычное имя теста расплывчатым не считается',
    isVagueIntent('показывает заголовок счёта') === false);
  ok('РАСХОЖДЕНИЕ: обратная кавычка ВНУТРИ имени не обрывает имя',
    assertionWiderThanIntent('it("renders `code` as a code element", () => {\n  expect(x.tagName).toBe("CODE");\n});').length === 0);
  ok('одно подозрение на тест, а не на каждую строку',
    assertionWiderThanIntent("it('renders', () => {\n  expect(a).toBe('Первая строка');\n  expect(b).toBe('Вторая строка');\n});").length === 1);
  ok('литерал короче порога это шум, а не находка',
    assertionWiderThanIntent("it('renders', () => {\n  expect(a).toBe('ok');\n});").length === 0);

  // ── ФОРМА 3 ────────────────────────────────────────────────────────────────
  ok('тест засевает литерал и его же проверяет — тавтология',
    seedsWhatItAsserts("it('кладёт поле', () => {\n  api.mockReturnValue('СЛОМАННОЕ');\n  expect(store.value).toBe('СЛОМАННОЕ');\n});").length === 1);
  ok('засеял одно, проверил другое — настоящая проверка',
    seedsWhatItAsserts("it('переводит в верхний регистр', () => {\n  api.mockReturnValue('тихо');\n  expect(out).toBe('ТИХО');\n});").length === 0);
  ok('короткие литералы не считаются (шум)',
    seedsWhatItAsserts("it('x', () => {\n  m.mockReturnValue('ab');\n  expect(y).toBe('ab');\n});").length === 0);
  ok('находка называет литерал',
    seedsWhatItAsserts("it('кладёт', () => {\n  m.mockReturnValue('ЗНАЧЕНИЕ');\n  expect(v).toBe('ЗНАЧЕНИЕ');\n});")[0].literal === 'ЗНАЧЕНИЕ');

  // ── границы ────────────────────────────────────────────────────────────────
  ok('пустой вход не притворяется измерением',
    mentionNotAction('').length === 0 && assertionWiderThanIntent('').length === 0 && seedsWhatItAsserts('').length === 0);
  ok('копии репозитория в обход не попадают (иначе одна находка считалась бы пятью)',
    skipDir('worktrees') && skipDir('node_modules') && skipDir('coverage'));
  ok('вывод сборки пропускается по префиксу, а не по точному имени',
    skipDir('.next') && skipDir('.next-verify') && skipDir('.next-prod'));
  ok('обычный каталог исходников НЕ пропускается',
    skipDir('components') === false && skipDir('scripts') === false);

  if (fails.length) { console.log(`\n\x1b[31mproperty-vs-method self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ property-vs-method: ${ran} прошло, 0 упало\x1b[0m`);
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const argAfter = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const root = argAfter('--repo');
  if (!root || !existsSync(root)) { console.error('usage: --repo <путь>  (или --self-test)'); process.exit(2); }
  const r = auditTree(root);
  console.log(`property-vs-method — просмотрено файлов: ${r.scanned}  (${root})`);
  console.log(`  сторож читает повествовательное поле: ${r.guards.length}`);
  for (const g of r.guards.slice(0, 15)) console.log(`      ${g.file}:${g.line}  поле "${g.field}", токен ${g.token}`);
  console.log(`  утверждение шире замысла: ${r.wider.length}`);
  for (const w of r.wider.slice(0, 15)) console.log(`      ${w.file}:${w.line}  «${w.name}»`);
  // ФОРМА 3 по умолчанию НЕ печатается. Замер на живом продукте дал 51 находку, и почти
  // все законные: тест-проводка («параметр доезжает до компонента») обязан засеять литерал
  // и его же проверить — это и есть проверяемое свойство. Отличить её от теста, который
  // засеял СЛОМАННЫЙ контур, текстом нельзя. Печатать 51 подозрение с долей правды около
  // нуля значит научить пролистывать вывод, а это ровно тот вред, который прибор лечит.
  if (process.argv.includes('--tautology')) {
    console.log(`  [слабый сигнал] тест засевает то, что проверяет: ${r.seeds.length}`);
    console.log('      Много ложных: законная проводка выглядит так же. Смотреть глазами.');
    for (const x of r.seeds.slice(0, 15)) console.log(`      ${x.file}:${x.line}  «${x.name}» литерал ${JSON.stringify(x.literal)}`);
  } else {
    console.log(`  тест засевает то, что проверяет: ${r.seeds.length} — НЕ показано (--tautology), слабый сигнал`);
  }
  const total = r.guards.length + r.wider.length;
  console.log(`\n  подозрений всего: ${total}`);
  console.log('  Это ПОДОЗРЕНИЯ, а не приговор: разбор текстовый и ошибается в строгую сторону.');
  // Храповик: блокирует только когда его позвали с --ratchet по изменённым файлам.
  // Всё дерево он не блокирует никогда: старый долг виден, но не держит работу.
  if (process.argv.includes('--ratchet') && total > 0) process.exit(1);
  process.exit(0);
}
