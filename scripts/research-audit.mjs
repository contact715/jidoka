#!/usr/bin/env node
// @ts-check
/**
 * research-audit.mjs — проверяет ДИСЦИПЛИНУ ДОКАЗАТЕЛЬСТВ внутри документа-ресёрча.
 *
 * Ось этого прибора: смотрит ВНУТРЬ документа — есть ли у утверждений адреса и
 * помечена ли сила источников. Он НЕ сравнивает документ с источниками; это делает
 * synthesis-coverage-audit.mjs. Две разные оси, обе нужны.
 *
 * @closes-class: research-claim-without-evidence
 * @scope: changed
 *
 *   node research-audit.mjs --doc <файл.md> --tier light|deep
 *   node research-audit.mjs --self-test
 *
 * Коды выхода: 0 — чисто, 1 — есть нарушения, 2 — ошибка вызова.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** Метки силы источника. */
export const STRENGTH_TOKENS = ['первоисточник', 'сторонний', 'вывод', 'primary', 'secondary', 'inferred'];

/** Статусы замера, которые ОБЯЗАНЫ нести адрес файла со строкой. */
export const STATUSES_NEEDING_EVIDENCE = ['есть', 'частично'];

/** Заглушки, которых не должно быть в сданном документе. */
/**
 * Заглушки. Слова здесь обязаны быть ОДНОЗНАЧНЫМИ маркерами незаконченности.
 * Инфинитив «дописать» из списка убран сознательно: он живёт в законной прозе
 * («что дописать в задачу», «осталось дописать раздел»), и на нём прибор
 * срабатывал на УПОМИНАНИЕ, а не на действие — класс guard-fires-on-mention-not-action.
 * «допишу» первым лицом остаётся: это всегда обещание доделать позже.
 */
export const PLACEHOLDER_TOKENS = ['TODO', 'TBD', 'XXX', 'FIXME', 'допишу', 'lorem ipsum'];

const URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/g;
/** путь/до/файла.ext:НОМЕР — адрес с точностью до строки. */
const PATH_WITH_LINE_RE = /[\w./@-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|rb|php|css|scss|json|ya?ml|md|sql|sh)\s*:\s*\d+/i;

/** Раздел «чего не проверил» — принимаем любую из живых формулировок. */
const NOT_CHECKED_RE = /(не\s+\S*\s*провер|не\s+провер|непровер|not\s+(checked|covered|verified))/i;

/** Признаки того, что в документе вынесены приговоры. */
const VERDICT_RE = /(приговор|вердикт|verdict|берём|отклоня|отклад)/i;
/** Признаки того, что назван первый шаг. */
const FIRST_STEP_RE = /(первый\s+шаг|first\s+step|с\s+чего\s+начать)/i;
/** Признаки того, что названа стоимость решения. */
const COST_RE = /(стоимост|усили|effort|трудо|часы|день|неделя|только\s+фронт|требует\s+бэкенд|frontendonly)/i;

/**
 * Строка похожа на строку таблицы Markdown.
 * @param {string} line
 */
export function isTableRow(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  // Разделитель шапки |---|---| строкой данных не считается.
  if (/^\|[\s:|-]+\|$/.test(t)) return false;
  return t.split('|').length >= 3;
}

/**
 * Ячейка строки таблицы содержит статус, требующий доказательства.
 * Сравнение по ЯЧЕЙКЕ целиком, а не по вхождению подстроки: иначе «нет» внутри
 * слова «нет данных» и «есть» внутри «есть риск» дают ложные срабатывания.
 * @param {string} line
 */
export function statusNeedingEvidence(line) {
  const cells = line.split('|').map((c) => c.trim().toLowerCase().replace(/[*_`]/g, ''));
  for (const cell of cells) {
    if (STATUSES_NEEDING_EVIDENCE.includes(cell)) return cell;
  }
  return null;
}

/**
 * Разбор документа на находки.
 * @param {string} text
 * @param {'light'|'deep'} tier
 * @returns {{violations: Array<{code: string, line: number, detail: string}>, stats: Record<string, number>}}
 */
export function auditText(text, tier) {
  const lines = text.split('\n');
  /** @type {Array<{code: string, line: number, detail: string}>} */
  const violations = [];

  // --- Источники без метки силы ---
  /** @type {Map<string, number[]>} */
  const urlLines = new Map();
  lines.forEach((line, i) => {
    const found = line.match(URL_RE);
    if (!found) return;
    for (const raw of found) {
      const url = raw.replace(/[.,;:)\]]+$/, '');
      if (!urlLines.has(url)) urlLines.set(url, []);
      // @ts-ignore — ключ только что заведён
      urlLines.get(url).push(i);
    }
  });

  const lower = lines.map((l) => l.toLowerCase());
  const hasStrength = (i) => STRENGTH_TOKENS.some((t) => lower[i].includes(t));

  let urlsWithoutStrength = 0;
  for (const [url, idxs] of urlLines) {
    if (idxs.some((i) => hasStrength(i))) continue;
    urlsWithoutStrength += 1;
    violations.push({
      code: 'SOURCE-NO-STRENGTH',
      line: idxs[0] + 1,
      detail: `источник без метки силы (${STRENGTH_TOKENS.slice(0, 3).join('/')}): ${url}`,
    });
  }

  // --- Статус замера без адреса файла ---
  let rowsChecked = 0;
  let rowsWithoutEvidence = 0;
  lines.forEach((line, i) => {
    if (!isTableRow(line)) return;
    const status = statusNeedingEvidence(line);
    if (!status) return;
    rowsChecked += 1;
    if (PATH_WITH_LINE_RE.test(line)) return;
    rowsWithoutEvidence += 1;
    violations.push({
      code: 'STATUS-NO-EVIDENCE',
      line: i + 1,
      detail: `статус «${status}» без адреса вида путь/файл.tsx:строка`,
    });
  });

  // --- Обязательный раздел «чего не проверил» ---
  const hasNotChecked = lines.some((l) => NOT_CHECKED_RE.test(l));
  if (!hasNotChecked) {
    violations.push({
      code: 'NO-UNCHECKED-SECTION',
      line: 0,
      detail: 'нет раздела «чего не проверил и почему» — молчание читается как «проверено всё»',
    });
  }

  // --- Заглушки ---
  lines.forEach((line, i) => {
    for (const tok of PLACEHOLDER_TOKENS) {
      if (line.toLowerCase().includes(tok.toLowerCase())) {
        violations.push({ code: 'PLACEHOLDER', line: i + 1, detail: `заглушка «${tok}» в сданном документе` });
        break;
      }
    }
  });

  // --- Требования тяжёлого уровня ---
  if (tier === 'deep') {
    if (!lines.some((l) => VERDICT_RE.test(l))) {
      violations.push({ code: 'DEEP-NO-VERDICTS', line: 0, detail: 'дип-ресёрч без приговоров: разбор без решения не результат' });
    }
    if (!lines.some((l) => FIRST_STEP_RE.test(l))) {
      violations.push({ code: 'DEEP-NO-FIRST-STEP', line: 0, detail: 'нет первого шага — приговор без первого шага невыполним' });
    }
    if (!lines.some((l) => COST_RE.test(l))) {
      violations.push({ code: 'DEEP-NO-COST', line: 0, detail: 'нет стоимости решений — приговор без стоимости это пожелание' });
    }
  }

  return {
    violations,
    stats: {
      строк: lines.length,
      источников: urlLines.size,
      'источников без метки': urlsWithoutStrength,
      'строк замера': rowsChecked,
      'строк замера без адреса': rowsWithoutEvidence,
    },
  };
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{doc: string|null, tier: 'light'|'deep', selfTest: boolean}} */
  const out = { doc: null, tier: 'light', selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--doc') out.doc = argv[++i] ?? null;
    else if (a === '--tier') {
      const v = argv[++i];
      if (v !== 'light' && v !== 'deep') throw new Error(`--tier принимает light или deep, получено: ${v}`);
      out.tier = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------- самопроверка

function selfTest() {
  let pass = 0;
  let fail = 0;
  /** @param {string} name @param {boolean} ok @param {string} [note] */
  const check = (name, ok, note = '') => {
    if (ok) { pass += 1; } else { fail += 1; console.log(`  ✗ ${name}${note ? ` — ${note}` : ''}`); }
  };
  const codes = (text, tier = 'light') => auditText(text, /** @type {'light'|'deep'} */ (tier)).violations.map((v) => v.code);

  const CLEAN = [
    '# Разбор',
    '',
    '| Возможность | Статус | Доказательство |',
    '|---|---|---|',
    '| Теги | есть | components/inbox/Tags.tsx:42 |',
    '| Snooze | нет | — |',
    '',
    '## Источники',
    '- https://docs.example.com/api — первоисточник',
    '',
    '## Чего не проверил и почему',
    '- тарифы: страница за логином',
  ].join('\n');

  check('чистый документ проходит', codes(CLEAN).length === 0, codes(CLEAN).join(','));

  // Источники
  check('URL без метки силы ловится',
    codes(CLEAN.replace(' — первоисточник', '')).includes('SOURCE-NO-STRENGTH'));
  check('метка на той же строке засчитывается',
    !codes(CLEAN).includes('SOURCE-NO-STRENGTH'));
  check('один URL дважды даёт одно нарушение',
    auditText(CLEAN.replace('## Источники', '## Источники\n- https://docs.example.com/api'), 'light')
      .violations.filter((v) => v.code === 'SOURCE-NO-STRENGTH').length === 0);
  check('хвостовая точка не ломает URL',
    codes(CLEAN.replace('/api — первоисточник', '/api. — первоисточник')).length === 0);
  check('английская метка засчитывается',
    codes(CLEAN.replace('первоисточник', 'primary')).length === 0);

  // Замер
  check('статус «есть» без адреса ловится',
    codes(CLEAN.replace('components/inbox/Tags.tsx:42', 'да, реализовано')).includes('STATUS-NO-EVIDENCE'));
  check('статус «частично» без адреса ловится',
    codes(CLEAN.replace('| есть |', '| частично |').replace('components/inbox/Tags.tsx:42', 'вроде бы')).includes('STATUS-NO-EVIDENCE'));
  check('статус «нет» адреса не требует',
    !codes(CLEAN).includes('STATUS-NO-EVIDENCE'));
  check('путь без номера строки не засчитывается',
    codes(CLEAN.replace('Tags.tsx:42', 'Tags.tsx')).includes('STATUS-NO-EVIDENCE'));
  check('«есть» внутри фразы не считается статусом',
    statusNeedingEvidence('| Теги | есть риск дублирования | — |') === null);
  check('разделитель шапки строкой данных не считается',
    isTableRow('|---|---|---|') === false);
  check('строка не из таблицы игнорируется',
    isTableRow('у нас это есть') === false);
  check('пробелы вокруг двоеточия допускаются',
    PATH_WITH_LINE_RE.test('lib/api/client.ts : 848'));
  check('.mjs распознаётся как путь',
    PATH_WITH_LINE_RE.test('scripts/gate.mjs:12'));

  // Раздел непроверенного
  check('отсутствие раздела ловится',
    codes(CLEAN.replace('## Чего не проверил и почему', '## Итоги')).includes('NO-UNCHECKED-SECTION'));
  check('формулировка «не проверено» тоже засчитывается',
    !codes(CLEAN.replace('Чего не проверил и почему', 'Что не проверено')).includes('NO-UNCHECKED-SECTION'));
  check('«чего эта волна не проверила» засчитывается',
    !codes(CLEAN.replace('Чего не проверил и почему', 'Чего эта волна не проверила')).includes('NO-UNCHECKED-SECTION'),
    'форма глагола не должна решать');
  check('раздела нет вовсе — по-прежнему ловится',
    codes(CLEAN.replace('## Чего не проверил и почему', '## Выводы')).includes('NO-UNCHECKED-SECTION'));
  check('английская формулировка засчитывается',
    !codes(CLEAN.replace('Чего не проверил и почему', 'Not checked')).includes('NO-UNCHECKED-SECTION'));

  // Заглушки
  check('TODO ловится', codes(`${CLEAN}\n\nTODO: заполнить`).includes('PLACEHOLDER'));
  check('«допишу» ловится', codes(`${CLEAN}\n\nэто допишу завтра`).includes('PLACEHOLDER'));
  check('инфинитив «дописать» в прозе НЕ ловится',
    !codes(`${CLEAN}\n\n| Задача | Что дописать |`).includes('PLACEHOLDER'),
    'заголовок столбца это не заглушка');
  check('одна строка с двумя заглушками даёт одно нарушение',
    auditText(`${CLEAN}\n\nTODO TBD`, 'light').violations.filter((v) => v.code === 'PLACEHOLDER').length === 1);

  // Тяжёлый уровень
  const DEEP_OK = `${CLEAN}\n\n## Приговоры\n| Пункт | Вердикт | Первый шаг | Стоимость |\n|---|---|---|---|\n| Теги | берём | правка в Tags.tsx | день, только фронт |`;
  check('дип-документ с приговорами проходит', codes(DEEP_OK, 'deep').length === 0, codes(DEEP_OK, 'deep').join(','));
  check('дип без приговоров ловится', codes(CLEAN, 'deep').includes('DEEP-NO-VERDICTS'));
  check('дип без первого шага ловится', codes(CLEAN, 'deep').includes('DEEP-NO-FIRST-STEP'));
  check('дип без стоимости ловится', codes(CLEAN, 'deep').includes('DEEP-NO-COST'));
  check('лёгкий уровень приговоров не требует', !codes(CLEAN, 'light').some((c) => c.startsWith('DEEP-')));

  // Разбор аргументов
  check('--tier deep разбирается', parseArgs(['--tier', 'deep']).tier === 'deep');
  check('умолчание уровня — light', parseArgs([]).tier === 'light');
  check('--doc разбирается', parseArgs(['--doc', 'a.md']).doc === 'a.md');
  check('неверный --tier падает', (() => { try { parseArgs(['--tier', 'medium']); return false; } catch { return true; } })());

  // Работа с файлом
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-audit-'));
  try {
    const f = path.join(tmp, 'doc.md');
    fs.writeFileSync(f, CLEAN);
    check('чистый файл с диска проходит', runFile(f, 'light') === 0);
    fs.writeFileSync(f, CLEAN.replace('components/inbox/Tags.tsx:42', 'да'));
    check('грязный файл с диска падает', runFile(f, 'light') === 1);
    check('отсутствующий файл даёт код 2', runFile(path.join(tmp, 'нет.md'), 'light') === 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nresearch-audit самопроверка: ${pass} прошло, ${fail} упало`);
  return fail === 0 ? 0 : 1;
}

/**
 * @param {string} file
 * @param {'light'|'deep'} tier
 * @param {boolean} [quiet]
 */
export function runFile(file, tier, quiet = true) {
  if (!fs.existsSync(file)) {
    if (!quiet) console.error(`нет такого файла: ${file}`);
    return 2;
  }
  const text = fs.readFileSync(file, 'utf8');
  const { violations, stats } = auditText(text, tier);
  if (!quiet) {
    console.log(`\nresearch-audit — ${file} (уровень: ${tier})`);
    console.log(Object.entries(stats).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
    if (violations.length === 0) {
      console.log('\n  ✓ дисциплина доказательств соблюдена');
    } else {
      console.log(`\n  ✗ нарушений: ${violations.length}\n`);
      for (const v of violations) {
        console.log(`  ${v.line ? `${file}:${v.line}` : '(документ целиком)'} [${v.code}] ${v.detail}`);
      }
      console.log('\n  Чинится правкой документа, а не объяснением, почему так вышло.');
    }
  }
  return violations.length === 0 ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(2);
  }
  if (args.selfTest) {
    process.exit(selfTest());
  } else if (!args.doc) {
    console.error('Использование: research-audit.mjs --doc <файл.md> --tier light|deep');
    console.error('               research-audit.mjs --self-test');
    process.exit(2);
  } else {
    process.exit(runFile(args.doc, args.tier, false));
  }
}
