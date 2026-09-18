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
 *   node research-audit.mjs --help
 *
 * Коды выхода: 0 — чисто, 1 — есть нарушения, 2 — ошибка вызова,
 * 3 — проверять было нечего (0 источников и 0 строк замера, а в документе есть признаки
 *     сравнения или замера: голый домен, таблица «Статус», слова о конкурентах или замере).
 * «Соблюдена» печатается только тогда, когда было что проверять: 2026-09-16 прибор дал
 * зелёный при нуле источников и нуле строк замера (класс green-check-that-checks-nothing).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseCli, runCli } from './lib/cli.mjs';
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

/**
 * @divergence: "обещание доделать без токена" — прокси у этой проверки это СПИСОК СЛОВ,
 * а правило шире: «в сданном документе нет незаконченных мест». Вход, где они расходятся:
 * строка «этот раздел будет дополнен позже» — ни одного токена из списка нет, прибор
 * говорит «чисто», а правило нарушено. Граница известна и зафиксирована проверкой ниже,
 * а не закрыта расширением списка: слова «будет», «позже», «дополнить» живут в законной
 * прозе, и добавление их в список вернуло бы срабатывание на упоминание вместо действия
 * (класс guard-fires-on-mention-not-action, из-за которого отсюда уже убрали «дописать»).
 * Эту дыру закрывает человек на вычитке, прибор её НЕ ловит и не притворяется, что ловит.
 */

/** Экранирует токен для подстановки в RegExp. */
export function escapeForRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/g;
/**
 * Ссылка без схемы: хост с путём, «help.getjobber.com/hc/...». Случай 2026-09-16: такие
 * ссылки прибор не видел вовсе и выдал зелёный при нуле источников.
 * Хост только строчными: «ASP.NET/Core» ссылкой не считается. Перед хостом не должно быть
 * буквы, «@», «/», «.», «:», «=», «&», «?», «#» — иначе это почта, хвост пути или параметр
 * ссылки. Ссылки со схемой и текст markdown-ссылок вырезаются до поиска (extractSources).
 */
const BARE_URL_RE = /(?<![\p{L}\p{N}_@/.:=&?#%+~-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24}))(\/[^\s<>()\[\]"'`]*)/gu;
/** «Next.js/React», «schema.json/…»: расширение файла доменом не считается. */
const FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'rb', 'php', 'css', 'scss',
  'json', 'yml', 'yaml', 'md', 'mdx', 'sql', 'sh', 'html', 'txt', 'toml', 'xml', 'svg', 'png', 'jpg', 'lock', 'env',
  'pl', 'cs', 'db',
]);
/**
 * Зоны, которые засчитываются у хоста без схемы. Два списка, оба закрытые, потому что
 * «любая двухбуквенная зона» и «любое слово» ловят код: замер 2026-09-16 по 1590 документам
 * нашёл «store.approve/decline», «payment.send/refund», «task.create/complete»,
 * «company.name/address», а ревью добавило «lead.id/deal.id», «fs.rm/unlink»,
 * «messages.en/ru». Поэтому здесь нет ни глаголов, ни имён полей (name, id, email, link,
 * page, group…), ни коротких зон, совпадающих с частыми словами (id, en, is, in, it, at,
 * to, me, no, do, my).
 * @divergence: "редкая зона вне списка" — ссылка без схемы на хосте с зоной, которой здесь
 * нет (скажем, example.travel/x или calendar.app.google/x), источником не считается.
 * Граница выбрана сознательно: ложный источник хуже пропущенного, потому что пропущенный
 * при нуле источников всё равно поднимает предупреждение о пустоте, а ложный прячет её.
 */
const GENERIC_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'info', 'biz', 'pro', 'app', 'dev', 'xyz', 'blog', 'news',
  'media', 'agency', 'marketing', 'digital', 'studio', 'software', 'systems', 'solutions',
  'services', 'consulting', 'academy', 'capital', 'finance', 'health', 'energy', 'legal',
  'partners', 'reviews', 'tech', 'cloud', 'online', 'website', 'site', 'global',
]);
const COUNTRY_TLDS = new Set([
  'ai', 'io', 'co', 'us', 'uk', 'ca', 'au', 'nz', 'ie', 'de', 'fr', 'es', 'nl', 'be', 'ch', 'se',
  'fi', 'dk', 'cz', 'sk', 'hu', 'ro', 'bg', 'gr', 'pt', 'ee', 'lv', 'lt', 'ua', 'ru', 'by', 'kz',
  'jp', 'cn', 'kr', 'tw', 'hk', 'sg', 'th', 'vn', 'ph', 'br', 'mx', 'ar', 'cl', 'za', 'il', 'tr',
  'ae', 'eu', 'tv', 'fm', 'gg', 'ly', 'so', 'cc', 'ws', 'la', 'gl',
]);
/**
 * Похоже ли окончание хоста на доменную зону. Расширения файлов исключаются заранее:
 * «Next.js/React», «schema.json/…» ссылками не считаются.
 * @param {string} tld
 */
export function isLikelyTld(tld) {
  if (FILE_EXTENSIONS.has(tld)) return false;
  return GENERIC_TLDS.has(tld) || COUNTRY_TLDS.has(tld);
}
/** Голый домен без пути — только ПОДСКАЗКА, почему источников ноль. Зона сверяется через isLikelyTld. */
const BARE_HOST_RE = /(?<![\p{L}\p{N}_@/.:=&?#%+~-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24})(?![\p{L}\p{N}_/-])/gu;
/** Текст говорит о сравнении с чужими продуктами. */
const EXTERNAL_WORDS_RE = /\p{L}*(?:конкурент|референс|рын(?:ок|к|оч)|competitor|benchmark)\p{L}*/iu;
/** Текст говорит о замере. */
const MEASURE_WORDS_RE = /\p{L}*(?:замер|измер|measured|measurement)\p{L}*/iu;
/** путь/до/файла.ext:НОМЕР — адрес с точностью до строки. */
const PATH_WITH_LINE_RE = /[\w./@-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|rb|php|css|scss|json|ya?ml|md|sql|sh)\s*:\s*\d+/i;

/**
 * Слова заголовка раздела «чего не проверил», в любом порядке. Прямой: «не проверил»,
 * «не удалось проверить», «непроверенное», «нельзя проверить». Обратный: «проверить не
 * удалось», «проверено не было», «проверить нельзя» — его предписывает сам скилл research,
 * а прибор его не принимал (2026-09-18, класс measurement-tool-error-read-as-product-defect).
 * Глаголы после «не» перечислены: иначе «Проверка не нужна» стала бы разделом непроверенного.
 * «не» слева отделено от буквы: «в зоне проверки» отрицанием не является.
 * Применяется ТОЛЬКО к тексту заголовка (findUncheckedSection), не к строкам текста.
 */
export const NOT_CHECKED_RE = new RegExp([
  '(?<!\\p{L})не\\s+\\S*\\s*провер',
  '(?<!\\p{L})непровер',
  '(?<!\\p{L})нельзя\\s+\\S*\\s*провер',
  'провер\\S*\\s+(?:не\\s+(?:удал|был|смог|успел|получ|вышл|провод)|нельзя)',
  "(?:not|n['’]t)\\s+(?:been\\s+|be\\s+)?(?:check|cover|verif)",
  'unverif',
  'unchecked',
].join('|'), 'iu');

/**
 * Текст заголовка или null. Заголовок это «# …» … «###### …» или строка, которая
 * НАЧИНАЕТСЯ с жирного «**…**» (можно после номера или маркера списка). У жирной строки
 * заголовком считается только жирная часть: «- **Тарифы** — не проверили» разделом не станет.
 * @param {string} line
 */
export function headingText(line) {
  const atx = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
  if (atx) return atx[1];
  const bold = /^\s{0,3}(?:(?:\d+[.)]|[-*+])\s+)?\*\*([^*]+)\*\*/.exec(line);
  return bold ? bold[1] : null;
}

/**
 * Номер строки заголовка раздела непроверенного или -1.
 * Раздел это ЗАГОЛОВОК: до 2026-09-18 засчитывалась любая строка, и фраза «цены мы не
 * проверили» посреди абзаца давала зелёный документу без раздела (замер: 23 из 122 живых
 * документов проходили только по фразе в тексте). Строки внутри блока кода не смотрятся:
 * шаблон раздела в примере разделом не является.
 * @divergence: "заголовок без корня провер/check/verif" — «Куда мы не смогли дотянуться»,
 * «Чего нет и почему» по смыслу тот же раздел, но прибор его не узнаёт: список синонимов
 * без общего корня ловил бы и чужие заголовки. Setext-заголовки (текст, под ним ===) тоже
 * не узнаются. Лечение одно и дешёвое: назвать раздел словами из NOT_CHECKED_RE.
 * @param {string[]} lines
 */
export function findUncheckedSection(lines) {
  // Открытый блок кода: его забор. Закрывает только забор из тех же знаков, не короче
  // открывающего и без подписи языка — иначе «```js» внутри «````» закрыл бы внешний блок.
  /** @type {string|null} */
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const f = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence === null) {
      if (f) { fence = f[1]; continue; }
    } else {
      const closes = f !== null && f[1][0] === fence[0] && f[1].length >= fence.length && f[2].trim() === '';
      if (closes) fence = null;
      continue;
    }
    const h = headingText(lines[i]);
    if (h !== null && NOT_CHECKED_RE.test(h)) return i;
  }
  return -1;
}

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

/** Хвост, который к ссылке не относится: пунктуация, закрывающие кавычки, разметка. */
const TRAILING_PUNCT_RE = /[.,;:!?)\]»"'*_]+$/u;
/** Подпись markdown-ссылки, за которой идёт адрес со схемой: «[текст](https://…)». */
const MD_LINK_TEXT_RE = /\[[^\]]*\](?=\(\s*https?:)/g;

/**
 * Ключ источника: без схемы, без хвостовых слешей, хост строчными. Так одна ссылка,
 * записанная по-разному, остаётся одним источником.
 * @param {string} url
 */
export function sourceKey(url) {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/^[^/?#]+/, (host) => host.toLowerCase());
}

/**
 * @typedef {{shown: string, lines: number[], bareLines: number[]}} Source
 * @typedef {{code: string, line: number, detail: string}} Finding
 * @typedef {{violations: Finding[], warnings: Finding[], stats: Record<string, number>}} AuditResult
 */

/**
 * Источники документа. Ключ — ссылка без схемы, чтобы одна и та же ссылка, записанная
 * со схемой и без неё, считалась одним источником.
 * @param {string[]} lines
 * @returns {Map<string, Source>}
 */
export function extractSources(lines) {
  /** @type {Map<string, Source>} */
  const out = new Map();
  /** @param {string} raw @param {number} i @param {boolean} bare */
  const add = (raw, i, bare) => {
    const shown = raw.replace(TRAILING_PUNCT_RE, '');
    const key = sourceKey(shown);
    let src = out.get(key);
    if (!src) { src = { shown, lines: [], bareLines: [] }; out.set(key, src); }
    src.lines.push(i);
    if (bare) src.bareLines.push(i);
  };
  const blank = (/** @type {string} */ m) => ' '.repeat(m.length);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(URL_RE)) add(m[0], i, false);
    // Ссылка со схемой и подпись markdown-ссылки, ведущей на неё, уже учтены: вырезаем их,
    // чтобы домен в параметрах («?u=foo.com/bar») и подпись «[a.com/x](https://a.com/x)»
    // не стали вторым источником без схемы. Длина строки сохраняется.
    const rest = line.replace(MD_LINK_TEXT_RE, blank).replace(URL_RE, blank);
    for (const m of rest.matchAll(BARE_URL_RE)) {
      if (isLikelyTld(m[2])) add(m[0], i, true);
    }
  });
  return out;
}

/**
 * Почему при пустых осях документ, вероятно, размечен мимо прибора.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function evidenceHints(lines) {
  /** @type {string[]} */
  const hints = [];
  const at = (/** @type {number} */ i) => `строка ${i + 1}`;
  for (let i = 0; i < lines.length; i += 1) {
    const host = [...lines[i].matchAll(BARE_HOST_RE)].find((m) => isLikelyTld(m[1]))?.[0];
    if (!host) continue;
    hints.push(`голый домен ${host} (${at(i)}) — впиши ссылку целиком, со схемой https://`);
    break;
  }
  const headerLine = lines.findIndex((l) => isTableRow(l)
    && l.split('|').some((c) => /^(статус|status)/.test(c.trim().toLowerCase().replace(/[*_`]/g, ''))));
  if (headerLine >= 0) {
    hints.push(`таблица со столбцом «Статус» (${at(headerLine)}), но ни одной ячейки «${STATUSES_NEEDING_EVIDENCE.join('»/«')}» — другие слова прибор статусом не считает`);
  }
  const extLine = lines.findIndex((l) => EXTERNAL_WORDS_RE.test(l));
  if (extLine >= 0) {
    hints.push(`текст говорит о сравнении («${lines[extLine].match(EXTERNAL_WORDS_RE)?.[0]}», ${at(extLine)}), а источников ноль`);
  }
  const measureLine = lines.findIndex((l) => MEASURE_WORDS_RE.test(l));
  if (measureLine >= 0) {
    hints.push(`текст говорит о замере («${lines[measureLine].match(MEASURE_WORDS_RE)?.[0]}», ${at(measureLine)}), а строк замера ноль`);
  }
  return hints;
}

/**
 * Итоговая строка и код выхода. «Соблюдена» говорится только тогда, когда было что
 * проверять: зелёный при нуле проверенного — класс green-check-that-checks-nothing.
 * @divergence: "deep с источниками и без строк замера" — пустота ловится только на ОБЕИХ
 * осях сразу. Дип-ресёрч, где источники есть, а строк замера ноль, проходит, хотя тяжёлый
 * уровень требует замера: по заголовку «Статус» таблицу замера не отличить от таблицы итога.
 * @param {AuditResult} result
 */
export function summarize(result) {
  const { violations, warnings, stats } = result;
  if (violations.length > 0) return { exit: 1, line: `✗ нарушений: ${violations.length}` };
  if (warnings.some((w) => w.code === 'EMPTY-EVIDENCE')) {
    return { exit: 3, line: '⚠ проверять было нечего: источников 0 и строк замера 0, а признаки ниже говорят, что проверять было что — проверь разметку' };
  }
  if (warnings.length > 0) return { exit: 3, line: `⚠ предупреждений: ${warnings.length}` };
  if (stats['источников'] === 0 && stats['строк замера'] === 0) {
    return { exit: 0, line: '○ нарушений нет, но источников и строк замера в документе ноль: проверены только раздел непроверенного и заглушки' };
  }
  return { exit: 0, line: '✓ дисциплина доказательств соблюдена' };
}

/**
 * Разбор документа на находки.
 * @param {string} text
 * @param {'light'|'deep'} tier
 * @returns {AuditResult}
 */
export function auditText(text, tier) {
  const lines = text.split('\n');
  /** @type {Finding[]} */
  const violations = [];

  // --- Источники без метки силы ---
  const urlLines = extractSources(lines);

  const lower = lines.map((l) => l.toLowerCase());
  const hasStrength = (i) => STRENGTH_TOKENS.some((t) => lower[i].includes(t));

  let urlsWithoutStrength = 0;
  for (const [key, src] of urlLines) {
    if (src.bareLines.length > 0) {
      violations.push({
        code: 'SOURCE-NO-SCHEME',
        line: src.bareLines[0] + 1,
        detail: `ссылка без схемы: в разметке не кликается и машиной не проверяется, впиши https://${key}`,
      });
    }
    if (src.lines.some((i) => hasStrength(i))) continue;
    urlsWithoutStrength += 1;
    violations.push({
      code: 'SOURCE-NO-STRENGTH',
      line: src.lines[0] + 1,
      detail: `источник без метки силы (${STRENGTH_TOKENS.slice(0, 3).join('/')}): ${src.shown}`,
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
  if (findUncheckedSection(lines) === -1) {
    violations.push({
      code: 'NO-UNCHECKED-SECTION',
      line: 0,
      detail: 'нет раздела «чего не проверил и почему» — молчание читается как «проверено всё». '
        + 'Засчитывается ЗАГОЛОВОК («## Чего не проверил и почему», «## Чего проверить не удалось»'
        + ' или строка с жирного «**Не проверено:**»), фраза в тексте разделом не считается',
    });
  }

  // --- Заглушки ---
  lines.forEach((line, i) => {
    for (const tok of PLACEHOLDER_TOKENS) {
      // Границы слова обязательны: без них «TBD» срабатывал внутри «JTBD»,
      // а «XXX» — внутри любого маскированного числа. Класс: guard-fires-on-mention-not-action.
      // \b не годится: он работает только для латиницы, а среди токенов есть «допишу».
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeForRegExp(tok)}(?![\\p{L}\\p{N}])`, 'iu');
      if (re.test(line)) {
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

  // --- Пусто на обеих осях: прибору нечего было проверять ---
  /** @type {Finding[]} */
  const warnings = [];
  if (urlLines.size === 0 && rowsChecked === 0) {
    const hints = evidenceHints(lines);
    const why = hints.length ? `; проверь разметку: ${hints.join('; ')}` : '';
    if (tier === 'deep') {
      violations.push({
        code: 'EMPTY-EVIDENCE',
        line: 0,
        detail: `дип-ресёрч без единого источника и без единой строки замера — проверять было нечего${why}`,
      });
    } else if (hints.length) {
      warnings.push({
        code: 'EMPTY-EVIDENCE',
        line: 0,
        detail: `проверять было нечего: источников 0, строк замера 0${why}`,
      });
    }
  }

  return {
    violations,
    warnings,
    stats: {
      строк: lines.length,
      источников: urlLines.size,
      'источников без метки': urlsWithoutStrength,
      'строк замера': rowsChecked,
      'строк замера без адреса': rowsWithoutEvidence,
    },
  };
}

export const USAGE = [
  'Использование: research-audit.mjs --doc <файл.md> [--tier light|deep]',
  '               research-audit.mjs --self-test',
  '               research-audit.mjs --help',
  '',
  'Коды выхода: 0 — чисто; 1 — нарушения; 2 — ошибка вызова;',
  '             3 — проверять было нечего: 0 источников и 0 строк замера, а в документе есть признаки',
  '                 сравнения или замера (голый домен, таблица «Статус», слова о конкурентах или замере).',
].join('\n');

// Строгий разбор: незнакомый флаг, лишнее слово или флаг без значения — ошибка ДО любой
// работы. Прежний разбор молча пропускал незнакомое, и «--bogus --self-test» шёл работать.
// Спецификация экспортирована: по ней сверяются места вызова (scripts/lib/cli-replay.mjs).
export const CLI = {
  name: 'research-audit',
  usage: USAGE,
  selfTest: true,
  options: {
    doc: { type: 'string' },
    tier: { type: 'string', choices: ['light', 'deep'], default: 'light' },
  },
};

/**
 * Чистая обёртка для самопроверки: бросает на неверном вызове.
 * @param {string[]} argv
 * @returns {{doc: string|null, tier: 'light'|'deep', selfTest: boolean, help: boolean}}
 */
export function parseArgs(argv) {
  const r = parseCli(argv, CLI);
  if (r.error) throw new Error(r.error);
  return { doc: r.values.doc ?? null, tier: r.values.tier, selfTest: r.selfTest, help: r.help };
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
  // Обратный порядок слов. «Чего проверить не удалось» предписывает сам скилл research,
  // а прибор его не принимал: 16 из 122 живых документов получали ложный красный (2026-09-18).
  const withHeading = (h) => CLEAN.replace('## Чего не проверил и почему', h);
  const hasSection = (h) => !codes(withHeading(h)).includes('NO-UNCHECKED-SECTION');
  check('«чего проверить не удалось и почему» засчитывается',
    hasSection('## Чего проверить не удалось и почему'), 'формулировка скилла research');
  check('«проверить нельзя и почему» засчитывается', hasSection('### Проверить нельзя и почему'));
  check('«проверено не было» засчитывается', hasSection('## Проверено не было'));
  check('«нельзя проверить» засчитывается', hasSection('## Что нельзя проверить'));
  check('«unverified» засчитывается', hasSection('## Unverified claims'));
  check('«could not verify» засчитывается', hasSection('## What we could not verify'));
  check('«couldn\'t check» засчитывается', hasSection("## What we couldn't check"));
  check('жирная строка-заголовок засчитывается', hasSection('**Чего проверить не удалось и почему**'));
  check('жирный заголовок с пояснением в той же строке засчитывается',
    hasSection('**Не проверено:** тарифы, страница за логином'));
  // Раздел это ЗАГОЛОВОК. Фраза в тексте раньше засчитывалась за раздел: «цены мы не
  // проверили» посреди абзаца давало зелёный документу без раздела (ложный зелёный).
  check('фраза «не проверили» в тексте разделом не считается',
    !hasSection('## Итоги\n\nЦены конкурента мы не проверили, но это неважно.'));
  check('фраза «проверить не удалось» в тексте разделом не считается',
    !hasSection('## Итоги\n\nЦены конкурента проверить не удалось.'));
  check('жирное слово внутри пункта разделом не считается',
    !hasSection('## Итоги\n\n- **Тарифы** — их мы не проверили'));
  check('заголовок внутри блока кода разделом не считается',
    !hasSection('## Шаблон\n\n```md\n## Чего не проверил и почему\n```'));
  check('вложенный блок кода не закрывает внешний раньше времени',
    !hasSection('````md\n```md\n## Чего не проверил и почему\n```\n````'), 'закрывает забор не короче открывающего');
  check('строка «```js» внутри блока его не закрывает',
    !hasSection('```\n```js\n## Чего не проверил и почему\n```'), 'у закрывающего забора нет подписи языка');
  check('заголовок после блока кода засчитывается',
    hasSection('```md\n## пример\n```\n\n## Чего проверить не удалось и почему'));
  check('«проверка не нужна» в заголовке разделом не считается',
    !hasSection('## Проверка не нужна'), 'отрицание относится не к проверке');
  check('«в зоне проверки» разделом не считается',
    !hasSection('## Что в зоне проверки'), '«не» на конце другого слова — не отрицание');
  // Пара из отчёта 2026-09-18: тот же документ с разделом и без него.
  const REPRO = '# Т\n\nТекст.\n\n- https://a.example.com/x · первоисточник\n\n## Чего проверить не удалось и почему\n\n1. Ничего.\n';
  check('документ из отчёта 2026-09-18 проходит', summarize(auditText(REPRO, 'light')).exit === 0,
    summarize(auditText(REPRO, 'light')).line);
  check('тот же документ без раздела даёт NO-UNCHECKED-SECTION',
    codes(REPRO.replace('## Чего проверить не удалось и почему\n\n1. Ничего.\n', '## Выводы\n\n1. Ничего.\n'))
      .includes('NO-UNCHECKED-SECTION'));

  // Заглушки
  check('TODO ловится', codes(`${CLEAN}\n\nTODO: заполнить`).includes('PLACEHOLDER'));
  check('«допишу» ловится', codes(`${CLEAN}\n\nэто допишу завтра`).includes('PLACEHOLDER'));
  check('инфинитив «дописать» в прозе НЕ ловится',
    !codes(`${CLEAN}\n\n| Задача | Что дописать |`).includes('PLACEHOLDER'),
    'заголовок столбца это не заглушка');
  check('одна строка с двумя заглушками даёт одно нарушение',
    auditText(`${CLEAN}\n\nTODO TBD`, 'light').violations.filter((v) => v.code === 'PLACEHOLDER').length === 1);
  check('«TBD» внутри «JTBD» НЕ ловится',
    !codes(`${CLEAN}\n\nJTBD: работа, на которую нанимают продукт`).includes('PLACEHOLDER'),
    'подстрока в законном термине это упоминание, а не заглушка');
  check('«XXX» внутри «XXXL» НЕ ловится',
    !codes(`${CLEAN}\n\nразмер XXXL в каталоге`).includes('PLACEHOLDER'));
  check('«TBD» отдельным словом по-прежнему ловится',
    codes(`${CLEAN}\n\nцена TBD`).includes('PLACEHOLDER'));
  check('«TBD» в скобках ловится',
    codes(`${CLEAN}\n\nцена (TBD)`).includes('PLACEHOLDER'));
  // @divergence: "обещание доделать без токена"
  check('РАСХОЖДЕНИЕ: обещание доделать без токена прибор НЕ ловит',
    !codes(`${CLEAN}\n\nэтот раздел будет дополнен позже`).includes('PLACEHOLDER'),
    'известная и намеренная граница: список слов уже правила, ловит человек на вычитке');

  // Тяжёлый уровень
  const DEEP_OK = `${CLEAN}\n\n## Приговоры\n| Пункт | Вердикт | Первый шаг | Стоимость |\n|---|---|---|---|\n| Теги | берём | правка в Tags.tsx | день, только фронт |`;
  check('дип-документ с приговорами проходит', codes(DEEP_OK, 'deep').length === 0, codes(DEEP_OK, 'deep').join(','));
  check('дип без приговоров ловится', codes(CLEAN, 'deep').includes('DEEP-NO-VERDICTS'));
  check('дип без первого шага ловится', codes(CLEAN, 'deep').includes('DEEP-NO-FIRST-STEP'));
  check('дип без стоимости ловится', codes(CLEAN, 'deep').includes('DEEP-NO-COST'));
  check('лёгкий уровень приговоров не требует', !codes(CLEAN, 'light').some((c) => c.startsWith('DEEP-')));

  // Ссылки без схемы (случай 2026-09-16: help.getjobber.com/... прибор не видел вовсе)
  const BARE = CLEAN.replace('https://docs.example.com/api', 'docs.example.com/api');
  const statOf = (text, key) => auditText(text, 'light').stats[key];
  check('ссылка без схемы засчитывается источником', statOf(BARE, 'источников') === 1, String(statOf(BARE, 'источников')));
  check('ссылка без схемы ловится отдельным нарушением', codes(BARE).includes('SOURCE-NO-SCHEME'));
  check('ссылка без схемы и без метки силы ловится и по метке',
    codes(BARE.replace(' — первоисточник', '')).includes('SOURCE-NO-STRENGTH'));
  check('одна ссылка со схемой и без неё — один источник',
    statOf(`${CLEAN}\n- docs.example.com/api — первоисточник`, 'источников') === 1);
  check('ссылка со схемой нарушения схемы не даёт', !codes(CLEAN).includes('SOURCE-NO-SCHEME'));
  check('путь к файлу ссылкой не считается',
    extractSources(['| X | есть | lib/api/client.ts:848, app/(dashboard)/page.tsx:3, docs/specs/a.md |']).size === 0);
  check('«Next.js/React» ссылкой не считается', extractSources(['стек Next.js/React и Node.js/Deno']).size === 0);
  check('имя с заглавными («ASP.NET/Core») ссылкой не считается', extractSources(['на ASP.NET/Core']).size === 0);
  check('почта ссылкой не считается', extractSources(['пишите user@example.com/x']).size === 0);
  check('имена методов («webhooks.list/create», «automations.create/update») ссылкой не считаются',
    extractSources(['методы webhooks.list/create/delete/test и automations.create/update']).size === 0,
    'найдено в корпусе 2026-09-16: зона .list и .create формально есть, но это запись вызовов API');
  check('редкие общие зоны (.agency, .marketing) и зоны стран засчитываются',
    extractSources(['hvac-seo.agency/blog/x, netpartners.marketing/y, pulse-uk.pabau.com/f/index.php, example.de/z']).size === 4);
  check('голый домен с расширением файла подсказкой не считается', evidenceHints(['см. readme.md и node.js']).length === 0);
  // Пусто на обеих осях: прибор не имеет права говорить «соблюдена»
  const NOTHING = '# Заметка\n\nКоманда договорилась писать короче.\n\n## Чего не проверил и почему\n- время ответа';
  const EMPTY_EXT = '# Главная против референса\n\nУ конкурента главная без графиков, у нас с графиками.\n\n## Чего не проверил и почему\n- тарифы';
  const warns = (text, tier = 'light') => auditText(text, /** @type {'light'|'deep'} */ (tier)).warnings.map((w) => w.code);
  check('сравнение с конкурентом без источников и замера — предупреждение',
    warns(EMPTY_EXT).includes('EMPTY-EVIDENCE') && codes(EMPTY_EXT).length === 0);
  check('то же на deep — нарушение', codes(EMPTY_EXT, 'deep').includes('EMPTY-EVIDENCE'));
  check('deep с пустыми осями — нарушение даже без слов-признаков', codes(NOTHING, 'deep').includes('EMPTY-EVIDENCE'));
  check('таблица со столбцом «Статус» без словарных статусов — предупреждение',
    warns(`${NOTHING}\n\n| Блок | Статус |\n|---|---|\n| Теги | реализовано |`).includes('EMPTY-EVIDENCE'));
  check('голый домен без пути — предупреждение', warns(`${NOTHING}\n\nсмотрели getjobber.com`).includes('EMPTY-EVIDENCE'));
  check('слово «замер» без строк замера — предупреждение', warns(`${NOTHING}\n\nзамер показал ноль`).includes('EMPTY-EVIDENCE'));
  check('внутренняя заметка без признаков — не предупреждение', warns(NOTHING).length === 0);
  check('есть источник — пустоты нет', warns(EMPTY_EXT.replace('у нас с графиками.', 'https://a.example.com/x первоисточник')).length === 0);
  check('есть строка замера — пустоты нет',
    warns(`${EMPTY_EXT}\n\n| Блок | Статус | Где |\n|---|---|---|\n| Теги | есть | lib/tags.ts:4 |`).length === 0);
  check('предупреждение называет, что проверить',
    auditText(`${NOTHING}\n\nсмотрели getjobber.com`, 'light').warnings[0]?.detail.includes('getjobber.com') === true);
  check('вердикт пустоты не содержит «соблюдена»', !summarize(auditText(NOTHING, 'light')).line.includes('соблюдена'));
  check('вердикт пустоты с признаками — код 3', summarize(auditText(EMPTY_EXT, 'light')).exit === 3);
  check('вердикт внутренней заметки — код 0', summarize(auditText(NOTHING, 'light')).exit === 0);
  check('вердикт чистого документа — «соблюдена», код 0',
    summarize(auditText(CLEAN, 'light')).exit === 0 && summarize(auditText(CLEAN, 'light')).line.includes('соблюдена'));

  // Находки ревью 2026-09-16
  check('текст markdown-ссылки со схемой ссылкой без схемы не считается',
    !codes(CLEAN.replace('https://docs.example.com/api', '[docs.example.com/api](https://docs.example.com/api/)')).includes('SOURCE-NO-SCHEME')
      && statOf(CLEAN.replace('https://docs.example.com/api', '[docs.example.com/api](https://docs.example.com/api/)'), 'источников') === 1);
  check('имена из кода с короткой «зоной» ссылкой не считаются',
    extractSources(['поля lead.id/deal.id, вызов fs.rm/unlink, словари messages.en/ru, файл main.kt/x']).size === 0);
  check('имена полей и глаголы («company.name/address», «store.approve/decline») ссылкой не считаются',
    extractSources(['company.name/address, store.approve/decline, payment.send/refund, task.create/complete']).size === 0);
  check('домен в параметрах ссылки со схемой вторым источником не считается',
    extractSources(['https://www.google.com/search?q=x&amp;u=foo.com/bar']).size === 1);
  check('обрамление «**…**», «…»» и хвостовой слеш ключ не меняют',
    statOf(`${CLEAN}\n- **docs.example.com/api/** «docs.example.com/api» первоисточник`, 'источников') === 1);
  check('заглавные в хосте ключ не меняют',
    extractSources(['https://Docs.Example.com/api и https://docs.example.com/api']).size === 1);
  check('поле с короткой «зоной» подсказкой о домене не считается', warns(`${NOTHING}\n\nключ \`deal.id\``).length === 0);
  check('зоны стран из списка засчитываются', extractSources(['bbc.co.uk/news, yandex.ru/q, site.fr/a, dora.dev/x']).size === 4);
  // @divergence: "редкая зона вне списка"
  check('РАСХОЖДЕНИЕ: редкая зона вне списка источником не считается',
    extractSources(['см. example.travel/guide и calendar.app.google/abc']).size === 0,
    'известная и намеренная граница: ложный источник спрятал бы пустоту, пропущенный её не прячет');
  // @divergence: "deep с источниками и без строк замера"
  check('РАСХОЖДЕНИЕ: deep с источниками и без строк замера прибор НЕ ловит',
    summarize(auditText(`${NOTHING.replace('Команда договорилась писать короче.', 'https://a.example.com/x первоисточник')}\n\n## Приговоры\nберём, первый шаг: правка, стоимость: день`, 'deep')).exit === 0,
    'известная граница: столбец «Статус» бывает и в таблице итога, отличить замер по заголовку нельзя; ловит критик полноты');
  check('итог кода 3 не приписывает документу сравнение, если сработал другой признак',
    !summarize(auditText(`${NOTHING}\n\nсмотрели getjobber.com`, 'light')).line.includes('о сравнении или замере'));
  check('подсказка называет слово целиком, а не обрубок',
    (evidenceHints(['мы измерили время, Рыночный обзор'])).join(' ').includes('«измерили»')
      && evidenceHints(['мы измерили время, Рыночный обзор']).join(' ').includes('«Рыночный»'),
    evidenceHints(['мы измерили время, Рыночный обзор']).join(' | '));
  check('хвост ссылки без схемы не цепляет скобку и точку',
    [...extractSources(['(см. help.getjobber.com/hc/Home).']).keys()][0] === 'help.getjobber.com/hc/Home');

  // Форма случая 2026-09-16 целиком: ссылки без схемы, статусов нет, уровень deep
  const INCIDENT = [
    '# Главная против референс-дашборда',
    '| Паттерн | Источник |', '|---|---|',
    '| Главная отвечает на «что делать сейчас» | Jobber `первоисточник` help.getjobber.com/hc/en-us/articles/23846836592023-Home |',
    '| Блок | Статус данных | Где у нас |', '|---|---|---|',
    '| Выручка и план | реализовано | lib/api/routers/pipeline.ts:872 |',
    '## Приговоры', '| Пункт | Вердикт | Первый шаг | Стоимость |', '|---|---|---|---|', '| V1 | берём | правка хука | 1 день |',
    '## Чего не проверил и почему', '- тарифы',
  ].join('\n');
  check('форма случая 2026-09-16 не даёт зелёного', summarize(auditText(INCIDENT, 'deep')).exit !== 0);
  check('в форме случая источник найден', auditText(INCIDENT, 'deep').stats['источников'] === 1);

  // Разбор аргументов
  check('--tier deep разбирается', parseArgs(['--tier', 'deep']).tier === 'deep');
  check('умолчание уровня — light', parseArgs([]).tier === 'light');
  check('--doc разбирается', parseArgs(['--doc', 'a.md']).doc === 'a.md');
  check('неверный --tier падает', (() => { try { parseArgs(['--tier', 'medium']); return false; } catch { return true; } })());
  const throws = (argv) => { try { parseArgs(argv); return false; } catch { return true; } };
  check('--help разбирается', parseArgs(['--help']).help === true && parseArgs(['-h']).help === true);
  check('неизвестный флаг падает', throws(['--bogus']));
  check('неизвестный флаг рядом с --self-test падает', throws(['--bogus', '--self-test']));
  check('--doc без значения падает', throws(['--doc']));
  check('--doc, за которым флаг, падает', throws(['--doc', '--tier', 'deep']));
  check('лишнее слово без флага падает', throws(['doc.md']));
  const self = fileURLToPath(import.meta.url);
  const cli = (...a) => spawnSync(process.execPath, [self, ...a], { encoding: 'utf8', cwd: os.tmpdir() });
  const helpRun = cli('--help');
  check('--help из командной строки: код 0 и справка', helpRun.status === 0 && helpRun.stdout.includes('--tier'), `код ${helpRun.status}`);
  const bogusRun = cli('--bogus', '--doc', 'нет.md');
  check('неизвестный флаг из командной строки: код 2 до всякой работы',
    bogusRun.status === 2 && bogusRun.stderr.includes('--bogus') && !bogusRun.stderr.includes('нет такого файла'),
    `код ${bogusRun.status}`);

  // Работа с файлом
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-audit-'));
  try {
    const f = path.join(tmp, 'doc.md');
    fs.writeFileSync(f, CLEAN);
    check('чистый файл с диска проходит', runFile(f, 'light') === 0);
    fs.writeFileSync(f, CLEAN.replace('components/inbox/Tags.tsx:42', 'да'));
    check('грязный файл с диска падает', runFile(f, 'light') === 1);
    check('отсутствующий файл даёт код 2', runFile(path.join(tmp, 'нет.md'), 'light') === 2);
    fs.writeFileSync(f, EMPTY_EXT);
    check('файл, где проверять было нечего, даёт код 3', runFile(f, 'light') === 3);
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
  const result = auditText(text, tier);
  const verdict = summarize(result);
  if (!quiet) {
    console.log(`\nresearch-audit — ${file} (уровень: ${tier})`);
    console.log(Object.entries(result.stats).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
    console.log(`\n  ${verdict.line}`);
    const where = (/** @type {Finding} */ f) => (f.line ? `${file}:${f.line}` : '(документ целиком)');
    if (result.violations.length) console.log('');
    for (const v of result.violations) console.log(`  ${where(v)} [${v.code}] ${v.detail}`);
    for (const w of result.warnings) console.log(`  ${where(w)} [${w.code}] предупреждение: ${w.detail}`);
    if (verdict.exit !== 0) console.log('\n  Чинится правкой документа, а не объяснением, почему так вышло.');
  }
  return verdict.exit;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const r = runCli(CLI);
  if (r.selfTest) {
    process.exit(selfTest());
  } else if (!r.values.doc) {
    console.error(USAGE);
    process.exit(2);
  } else {
    process.exit(runFile(r.values.doc, r.values.tier, false));
  }
}
