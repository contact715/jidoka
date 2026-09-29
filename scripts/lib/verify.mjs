#!/usr/bin/env node
// verify — проверка, которая не может сказать «да» по пустому месту.
//
// Зачем (2026-09-25, класс green-check-that-checks-nothing, сайт A+ Heating & Air). За одну
// сессию дважды зелёный вердикт ничего не проверил:
//   1) репетиция сверяла две базы через [ "$(q a)" = "$(q b)" ]; оба запроса упали на
//      неверном имени колонки и вернули пустые строки. Пусто равно пусту — «совпадает»;
//   2) скрипт правки конфига доказывал себя через s.count('include ...') == 6. Число сошлось
//      за счёт другой замены, а нужные правила (страницы 404, редиректы 301) так и не встали.
// Обе проверки мерили не то свойство, о котором был вопрос. Здесь два способа мерить то:
//
//   sameNonEmpty(a, b)         'equal' | 'different' | 'unverified'. Пустое, «значения нет» и
//                              похожее на ошибку дают 'unverified' и никогда не дают 'equal'.
//   requirePresent(text, ns)   список НЕДОСТАЮЩИХ фрагментов. Правка доказана, когда нужное
//                              содержимое на месте, а не когда сошёлся счёт.
//
// Из bash:
//   node ~/.claude/jidoka/scripts/lib/verify.mjs same --a "$A" --b "$B"
//   node ~/.claude/jidoka/scripts/lib/verify.mjs present --file site.conf --needle 'error_page 404' --needle 'return 301'
//
// Это средство, а не сторож: его не зовёт ни хук, ни CI, поэтому метки @closes-class здесь
// нет (решение владельца 2026-09-29; класс закреплён за oracle-divergence.mjs). Правило:
// docs/VERIFY_PROVES_THE_PROPERTY.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCli, formatUsage, EXIT_USAGE } from './cli.mjs';

export const EXIT_UNVERIFIED = 3;

// Непустая строка, которая всё равно означает «значения нет».
const NO_VALUE = new Set(['undefined', 'null', 'none', 'nan', '(null)', '<null>', '(0 rows)']);

// Следы упавшей команды. Привязка к началу строки: слово error ВНУТРИ значения
// («error_count=0», «error_page 404», «no errors») ошибкой не считается.
const ERROR_SHAPES = [
  [/^\s*(?:ERROR|FATAL|PANIC)\b/m, 'строка ERROR/FATAL (psql, mysql)'],
  [/^\s*(?:[\w.-]+:\s*)?(?:\w+\s+)?(?:error|fatal|panic)\s*:/im, 'строка «error:»'],
  [/^\s*[\w.]*(?:Error|Exception)\s*:/m, 'исключение «…Error:»'],
  [/Traceback \(most recent call last\)/, 'Traceback Python'],
  [/^\s*curl: \(\d+\)/m, 'ошибка curl'],
  [/\bcommand not found\b/, 'command not found'],
  [/No such file or directory|Permission denied/, 'ошибка файловой системы'],
];

const asText = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)).trim();
const short = (s, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Чистая: почему значение нельзя сравнивать (строка) или null, если можно. */
export function unverifiedReason(value) {
  if (value === undefined || value === null) return 'значения нет';
  if (typeof value === 'function' || (typeof value === 'object' && !Buffer.isBuffer(value))) {
    return `не текст и не число (${Array.isArray(value) ? 'массив' : typeof value}): String() сравнил бы «[object Object]»`;
  }
  const s = asText(value);
  if (!s) return 'пусто';
  if (NO_VALUE.has(s.toLowerCase())) return `значение-заглушка «${s}»`;
  for (const [re, name] of ERROR_SHAPES) {
    const m = re.exec(s);
    if (m) {
      const line = s.slice(s.lastIndexOf('\n', m.index) + 1).split('\n')[0].trim();
      return `похоже на ошибку, ${name}: «${short(line)}»`;
    }
  }
  return null;
}

/** Чистая: вердикт сравнения с причиной. Края строки (пробелы, перевод строки) не считаются. */
export function compareValues(a, b) {
  const ra = unverifiedReason(a);
  const rb = unverifiedReason(b);
  if (ra || rb) {
    return { verdict: 'unverified', reason: [ra && `a: ${ra}`, rb && `b: ${rb}`].filter(Boolean).join('; ') };
  }
  const sa = asText(a);
  const sb = asText(b);
  if (sa === sb) return { verdict: 'equal', reason: '' };
  return { verdict: 'different', reason: `a=«${short(sa)}» b=«${short(sb)}»` };
}

/** Чистая: 'equal' | 'different' | 'unverified'. Пустое никогда не равно пустому. */
export function sameNonEmpty(a, b) {
  return compareValues(a, b).verdict;
}

/**
 * Чистая: какие из нужных фрагментов ОТСУТСТВУЮТ в тексте. Пустой список — всё на месте.
 * Пустой список искомого и пустой фрагмент — ошибка вызова: они «находятся» в любом тексте.
 */
export function requirePresent(text, needles) {
  if (!Array.isArray(needles) || needles.length === 0) {
    throw new TypeError('requirePresent: нужен хотя бы один искомый фрагмент, пустой список нашёлся бы в любом тексте');
  }
  if (needles.findIndex((n) => typeof n !== 'string' || n.trim() === '') !== -1) {
    throw new TypeError('requirePresent: пустой фрагмент находится в любом тексте, это не проверка');
  }
  const hay = text === undefined || text === null ? '' : Buffer.isBuffer(text) ? text.toString('utf8') : String(text);
  return needles.filter((n) => !hay.includes(n));
}

export const CLI = {
  name: 'verify',
  path: 'scripts/lib/verify.mjs',
  selfTest: true,
  usage: `Проверка, которая не говорит «да» по пустому месту.

Использование:
  node scripts/lib/verify.mjs same --a <значение> --b <значение> [--json]
      сравнить два значения; пусто, «null», текст ошибки — НЕ ПРОВЕРЕНО, а не «равно»
  node scripts/lib/verify.mjs present (--file <путь> | --text <текст>) --needle <фрагмент> [--needle …] [--json]
      доказать, что каждый нужный фрагмент есть в тексте; недостающие перечисляются

Флаги:
      --a, --b <значение>        значения для same; пустая строка допустима: --a ""
      --file <путь>              текст для present из файла
      --text <текст>             текст для present напрямую
      --needle <фрагмент> …      что обязано быть в тексте (можно несколько раз)
      --json                     вердикт в JSON (в stdout при любом исходе)
  -h, --help                     эта справка
      --self-test                самопроверка

Коды выхода: 0 — равно / всё на месте, 1 — различается / чего-то нет,
3 — НЕ ПРОВЕРЕНО (пусто, ошибка, файла нет), 2 — неверный вызов (ничего не выполнено).`,
  options: { json: { type: 'boolean', desc: 'вердикт в JSON' } },
  commands: {
    same: {
      desc: 'сравнить два значения',
      options: { a: { type: 'string', desc: 'первое значение' }, b: { type: 'string', desc: 'второе значение' } },
    },
    present: {
      desc: 'доказать, что нужные фрагменты есть в тексте',
      options: {
        file: { type: 'string', desc: 'текст из файла' },
        text: { type: 'string', desc: 'текст напрямую' },
        needle: { type: 'string', multiple: true, desc: 'нужный фрагмент' },
      },
    },
  },
};

function badCall(message) {
  process.stderr.write(`verify: неверный вызов — ${message}\nНичего не выполнено.\n\n${formatUsage(CLI)}\n`);
  process.exit(EXIT_USAGE);
}

const EXIT = { equal: 0, present: 0, different: 1, missing: 1, unverified: EXIT_UNVERIFIED };

function finish(result, json) {
  const { verdict, reason = '', missing } = result;
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (verdict === 'equal' || verdict === 'present') process.stdout.write(`${verdict === 'equal' ? 'равно' : 'на месте всё'}${reason ? `: ${reason}` : ''}\n`);
  else if (verdict === 'different') process.stderr.write(`РАЗЛИЧАЕТСЯ: ${reason}\n`);
  else if (verdict === 'missing') process.stderr.write(`НЕТ ${reason}:\n${missing.map((n) => `  - ${n}`).join('\n')}\n`);
  else process.stderr.write(`НЕ ПРОВЕРЕНО: ${reason}\n`);
  process.exit(EXIT[verdict]);
}

function runSame(values) {
  if (values.a === undefined || values.b === undefined) badCall('same: нужны оба значения, --a и --b (пустая строка допустима: --a "")');
  const r = compareValues(values.a, values.b);
  finish(r.verdict === 'equal' ? { ...r, reason: `«${short(asText(values.a))}»` } : r, values.json);
}

function runPresent(values) {
  const needles = values.needle || [];
  if ((values.file === undefined) === (values.text === undefined)) badCall('present: нужен ровно один источник текста, --file или --text');
  if (!needles.length) badCall('present: нужен хотя бы один --needle');
  if (needles.some((n) => n.trim() === '')) badCall('present: пустой --needle находится в любом тексте, это не проверка');
  let text = values.text;
  if (values.file !== undefined) {
    try {
      text = readFileSync(values.file, 'utf8');
    } catch (e) {
      finish({ verdict: 'unverified', reason: `файл не прочитан (${e.code || e.message}): ${values.file}` }, values.json);
    }
  }
  if (!text.trim()) finish({ verdict: 'unverified', reason: 'текст пуст, проверять нечего' }, values.json);
  const missing = requirePresent(text, needles);
  if (missing.length) finish({ verdict: 'missing', reason: `${missing.length} из ${needles.length}`, missing }, values.json);
  finish({ verdict: 'present', reason: `${needles.length} из ${needles.length}`, missing: [] }, values.json);
}

function selfTest() {
  let fails = 0;
  const ok = (name, cond) => {
    if (!cond) fails++;
    console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  };
  const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
  const pgError = 'ERROR:  column "slug" does not exist\nLINE 1: select slug from pages';

  ok('пустое против пустого — не проверено, а не равно', '' === '' && sameNonEmpty('', '') === 'unverified');
  ok('undefined против undefined — не проверено', sameNonEmpty(undefined, undefined) === 'unverified');
  ok('одна сторона пустая — не проверено, а не «различается»', sameNonEmpty('', '5') === 'unverified');
  ok('заглушки null / None / (0 rows) — не проверено', ['null', 'None', '(0 rows)'].every((v) => sameNonEmpty(v, v) === 'unverified'));
  ok('одинаковый текст ошибки psql с обеих сторон — не проверено', sameNonEmpty(pgError, pgError) === 'unverified');
  ok('Traceback — не проверено', sameNonEmpty('Traceback (most recent call last):\n  File "x.py"', 'x') === 'unverified');
  ok('«error:» и «psql: error:» в начале строки — не проверено',
    ['error: no such table', 'psql: error: connection refused', 'Parse error: near "x"'].every((v) => sameNonEmpty(v, v) === 'unverified'));
  ok('исключение Python «sqlite3.OperationalError:» — не проверено', sameNonEmpty('sqlite3.OperationalError: no such column', 'x') === 'unverified');
  ok('одинаковые непустые — равно', sameNonEmpty('42', '42') === 'equal');
  ok('разные непустые — различается', sameNonEmpty('42', '43') === 'different');
  ok('пробелы и перевод строки по краям не делают значения разными', sameNonEmpty(' 42\n', '42') === 'equal');
  ok('слово error ВНУТРИ значения ошибкой не считается',
    ['error_count=0', 'no errors', 'error_page 404 /404.html;'].every((v) => sameNonEmpty(v, v) === 'equal'));
  ok('объект не сравнивается по «[object Object]»', sameNonEmpty({ a: 1 }, { b: 2 }) === 'unverified');
  ok('Buffer из execSync читается как текст', sameNonEmpty(Buffer.from('7\n'), '7') === 'equal');
  ok('причина называет сторону и след ошибки', /a: похоже на ошибку.*ERROR:  column/.test(compareValues(pgError, '1').reason));

  const conf = 'include snippets/a.conf;\n'.repeat(6);
  ok('счёт сошёлся за счёт другой замены, а нужных правил нет — прибор это видит',
    conf.split('include ').length - 1 === 6 && requirePresent(conf, ['error_page 404', 'return 301']).length === 2);
  ok('недостающий фрагмент назван в списке', requirePresent('a b c', ['b', 'z']).join() === 'z');
  ok('всё на месте — пустой список', requirePresent('error_page 404; return 301;', ['error_page 404', 'return 301']).length === 0);
  ok('пустой текст — недостающие все', requirePresent('', ['x', 'y']).length === 2);
  ok('пустой список искомого — ошибка, а не зелёный', throws(() => requirePresent('abc', [])));
  ok('пустой фрагмент среди искомого — ошибка (он «находится» в любом тексте)', throws(() => requirePresent('abc', ['a', ''])));
  ok('undefined среди искомого — ошибка', throws(() => requirePresent('abc', [undefined])));

  if (fails) {
    console.log(`\n\x1b[31mverify self-test FAILED: ${fails}\x1b[0m`);
    process.exit(1);
  }
  console.log('\n\x1b[32m✓ verify: пусто и ошибка не равны ничему, наличие проверяется по содержимому\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { values, command, selfTest: wantsSelfTest } = runCli(CLI);
  if (wantsSelfTest) selfTest();
  else if (command === 'same') runSame(values);
  else runPresent(values);
}
