#!/usr/bin/env node
// control-red-gate — «проверено» про поведение, зависящее от среды, требует КОНТРОЛЬНОГО
// КРАСНОГО: исполненного прогона scripts/control-red.mjs с вердиктом proven, который
// охватывает те же предметы, что и заявление.
//
// @closes-class: verified-where-failure-cannot-show
// @scope: all
// @scope-ok: вход — текст последнего хода и хвост транскрипта сессии, а не репозиторий
// @divergence: "РАСХОЖДЕНИЕ: прогон был, но прибор оказался слеп" — мера «control-red
//              запускался» говорит «доказано», а правило требует вердикта proven: слепой
//              прогон и есть тот случай, ради которого механизм построен
//
// ПОЧЕМУ ПОЯВИЛСЯ. 2026-09-25, сайт A+ Heating & Air: за одну сессию три проверки были
// зелёными там, где проверяемый сбой не мог проявиться. Локальный Lighthouse показал CLS 0,
// потому что шрифты приходили раньше первого кадра. Запасной шрифт проверили на Mac, где
// Arial установлен. Прокрутку проверяли в скрытой панели, где плавная прокрутка не идёт.
// На бою нашёлся сдвиг 0,019. Прибор каждый раз был исправен, слепой была среда.
//
// ЧТО ДЕЛАЕТ. На остановке читает СОБСТВЕННЫЙ текст последнего хода и ищет предложение, где
// есть вердикт («проверил», «работает», «закрыто», «сдвига нет») и предмет, зависящий от
// среды (шрифты, сдвиги, прокрутка, мобильная вёрстка, сеть, кеш, часовой пояс, платформа).
// Заявление закрыто, если последний исполненный прогон control-red.mjs, охватывающий ВСЕ
// его предметы, дал proven. Иначе сторож возвращает ход с требованием.
//
// ПОЧЕМУ ПРИВЯЗКА ПО ПРЕДМЕТУ, А НЕ «ОДИН РАЗ ЗА СЕССИЮ». Первая версия срабатывала один
// раз за сессию и снималась любым доказанным прогоном. Прогон на родной сессии класса
// (2026-09-29) показал дыру: сторож потратил бы свой единственный раз на раннюю слабую фразу
// про повторный замер, а заявление «проверил на Mac (Arial) и в режиме Android» прошло бы
// молча. И доказанный прогон про задержку шрифтов снимал бы вопрос с заявления про
// прокрутку. Поэтому: предметы заявления ⊆ предметов прогона, и напоминание даётся один раз
// на каждый ВИД среды. Второй прогон той же сессии показал, почему не «не больше трёх за
// сессию»: три напоминания ушли на мобильную вёрстку, ленивую загрузку и сдвиги, и заявление
// про Arial снова прошло бы молча. Видов восемь, это и есть потолок.
//
// ДОКАЗАТЕЛЬСТВО — ИСПОЛНЕННАЯ КОМАНДА, А НЕ ФРАЗА. Слова «контрольный красный» в ответе
// сторожа не успокаивают: фразу пишет тот же, кто пишет заявление (правило 2026-08-11
// «символ, а не комментарий»). Засчитывается только результат Bash, чья команда зовёт
// control-red.mjs. Текст вердикта в выводе `cat` или самопроверки прогоном не считается:
// это упоминание, а не действие (класс guard-fires-on-mention-not-action).
//
// ЧЕГО ОН НЕ УМЕЕТ, СКАЗАНО ЗАРАНЕЕ.
//   · Предметы прогона определяются по словам в его команде. Прогон, названный словами
//     «про шрифты», но создавший другое условие, сторож не отличит. Условие печатается в
//     вердикте инструмента, и заявление ограничено им.
//   · Словарь предметов конечен. Заявление о зависящем от среды поведении, названном
//     иначе, он не увидит. Словарь расширяется по живым промахам, а не заранее.
//
// ЖЁСТКОСТЬ. Код 2 на остановке — это не запрет, а возвращённый ход: Claude получает текст и
// продолжает (так документировано событие Stop, code.claude.com/docs/en/hooks, раздел
// «Exit code 2 behavior per event»). Fail-open на всём. Точность меряется журналом
// срабатываний (~/.claude/jidoka/gate-trips.jsonl): строка несёт само заявление, чтобы долю
// ложных можно было посчитать глазами, а не угадать. Замер на 282 сессиях за 30 дней
// (2026-09-29): 17 сессий со срабатыванием, среди первых срабатываний настоящих 11–12 из 17.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { хвостТранскрипта, началоХода } from './lib/transcript-tail.mjs';
import { loadCli } from './lib/load-cli.mjs';

// Строгий разбор аргументов. Код отказа 1, а не 2: для Claude Code код 2 у Stop значит
// «не останавливаться», и опечатка в settings.json возвращала бы ход на каждом стопе.
const HOOK_BAD_CALL_EXIT = 1;

// Граница слова не \b: в JavaScript она определена по ASCII, и перед кириллицей её нет
// (класс ascii-word-boundary-blind-in-cyrillic).
const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
const rx = (body, flags = 'iu') => new RegExp(B + '(?:' + body + ')' + E, flags);

/** Глагол проверки. Только он делает голое название платформы заявлением. */
const VERIFY = [
  rx('(?:пере)?провер(?:ил|ила|или|ено|ена|ены|ен)'),
  rx('подтвер(?:дил|дила|дили|ждено|ждена|ждены|ждаю|ждает)'),
  rx('убедил(?:ся|ась|ись)'),
  rx('verified|confirmed'),
];

/** Вердикт «зелёный»: заявление, что проверено и сбоя нет. Прошедшее «работал» — рассказ, не вердикт. */
const GREEN = [
  ...VERIFY,
  // «работает так: …» — описание устройства, а не вердикт
  rx('(?:(?:с|от)?рабатыва(?:ет|ют)|работа(?:ет|ют))(?!\\s+так(?![\\p{L}]))'),
  rx('закрыт[оаы]?'),
  rx('совпада(?:ет|ют)'),
  rx('(?:такого|того)\\s+же\\s+размера|одинаков\\p{L}*\\s+(?:размер|ширин|высот)\\p{L}*'),
  rx('нет\\s+сдвиг\\p{L}*|сдвиг\\p{L}*\\s+нет|без\\s+сдвиг\\p{L}*|не\\s+(?:прыга\\p{L}*|скач(?:ет|ут)|дёрга\\p{L}*)'),
  rx('ошибок\\s+нет|без\\s+ошибок'),
  new RegExp(B + 'CLS\\s*[=:]?\\s*0(?:[.,]0+)?(?![.,]?\\d)', 'u'),
  rx('works|working|passes|passed|no\\s+(?:layout\\s+)?shifts?|no\\s+errors'),
];

// Предметы, зависящие от среды: сбой в них виден не везде, где их проверяют.
//
// Словарь сужен ЗАМЕРОМ, а не на глаз (2026-09-29, 282 сессии за 30 дней по всем проектам).
// Первая версия сработала бы в 60 сессиях; в случайной выборке из 60 срабатываний настоящих
// заявлений было 18. Ложные шли от многозначных слов: «телефон» как номер («сбор телефона»),
// «якорь» доказательства в движке, Mac и Windows как товар («Mac Studio»), «гонка веток»,
// «запасной способ», «таймаут», имя компонента ScrollFloat.
//
// Платформа стоит отдельно. «Все десять игр работают на macOS» — факт о совместимости, а
// «проверил на Mac» — заявление о проверке. Поэтому платформа засчитывается только с
// глаголом проверки (VERIFY), а остальные предметы — с любым вердиктом.
export const PLATFORM = 'платформа';
export const TOPICS = {
  'сдвиги и скорость': [
    rx('CLS|LCP|INP|TTFB|FCP', 'u'),
    rx('Lighthouse|PageSpeed|web\\s+vitals|layout\\s+shifts?|сдвиг\\p{L}*|скач\\p{L}*\\s+в[её]рстк\\p{L}*'),
  ],
  'шрифты': [rx('шрифт\\p{L}*|fonts?|Arial|Roboto|Helvetica|FOUT|FOIT|size-adjust')],
  'прокрутка и анимация': [rx('прокрутк\\p{L}*|скролл\\p{L}*|scroll(?:ing|s|ed)?|анимаци\\p{L}*|animations?')],
  'ленивая загрузка': [rx('IntersectionObserver|lazy|ленив\\p{L}*')],
  // «на телефоне» — место вёрстки; «в телефоне мастера» и «ссылка на телефон» — нет
  'мобильная вёрстка': [rx('на\\s+(?:телефон(?:е|ах)|планшет(?:е|ах))|on\\s+(?:phones?|mobile)|мобильн\\p{L}*|retina|DPR')],
  'сеть и кеш': [rx('холодн\\p{L}*\\s+к[еэ]ш\\p{L}*|без\\s+к[еэ]ш\\p{L}*|cold\\s+cache|в\\s+офлайн\\p{L}*|офлайн-режим\\p{L}*|offline|throttl\\p{L}*|медленн\\p{L}*\\s+(?:сет|интернет|соединен)\\p{L}*|3G')],
  'время и язык': [rx('часов\\p{L}*\\s+пояс\\p{L}*|timezones?|locales?|RTL|гидрат\\p{L}*|hydration|race\\s+conditions?')],
  [PLATFORM]: [rx('(?:на|в|под|on|in)\\s+(?:режиме\\s+)?(?:Mac|macOS|Linux|Windows|Android|iOS|iPhone|iPad|Safari|Firefox)')],
};

/** Предложение, которое сообщает о СБОЕ: это отчёт о красном, а не ложный зелёный. */
const RED_REPORT = [
  rx('не\\s+(?:с|от)?(?:рабатыва|работа)\\p{L}*|не\\s+совпада\\p{L}*|слома\\p{L}*|лома(?:ет|ют)|пада(?:ет|ют|л|ла|ли)|broken|fails?|failed|doesn\\W?t\\s+work'),
];

/**
 * Не заявление, а условие, план, предложение помочь или честная граница:
 *   «если отключение работает, вариант без кеша обязан быть медленнее»,
 *   «теперь докажу, что она работает», «хочешь, чтобы я… проверил мобильный вид»,
 *   «не проверено: машину Google напрямую (стенд совпадает с ней по составу)».
 * Последнее — ровно то поведение, которого правило добивается; ругать его нельзя.
 */
const NOT_A_CLAIM = [
  /^[-*•\s]*(?:если|when|if)(?![\p{L}\p{N}])/iu,
  /^[-*•\s]*(?:\*\*)?(?:не\s+провер\p{L}*|не\s+смог\p{L}*|честно\s+про\s+границ\p{L}*|чего\s+не\s+провер\p{L}*|not\s+verified)/iu,
  /^[-*•\s]*(?:хочешь|хотите|могу|можем|want\s+me|shall\s+i)(?![\p{L}\p{N}])/iu,
  rx('докажу|проверю|проверим|убедимся|will\\s+verify|to\\s+verify'),
];

/** Слева от вердикта: отрицание («не проверено») или обстоятельство времени («пока агенты работают»). */
const BEFORE_GUARD = [
  /(?:^|[^\p{L}])(?:не|ни|нельзя|not|never)\s+$/iu,
  /(?:^|[^\p{L}])пока\s+[\p{L}-]+\s+$/iu,
];

/** Совпадение внутри «ёлочек», "кавычек" или `кода` — упоминание, а не заявление. */
function insideQuote(sentence, index) {
  const before = sentence.slice(0, index);
  const open = (before.match(/«/g) || []).length - (before.match(/»/g) || []).length;
  if (open > 0) return true;
  if ((before.match(/`/g) || []).length % 2 === 1) return true;
  if ((before.match(/"/g) || []).length % 2 === 1) return true;
  return false;
}

/** Есть ли в предложении совпадение из списка вне кавычек (и, если просили, без отрицания слева). */
function hasLive(sentence, list, guardLeft = false) {
  return list.some((r) => {
    const g = new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g');
    for (const m of sentence.matchAll(g)) {
      const i = m.index ?? 0;
      if (guardLeft && BEFORE_GUARD.some((b) => b.test(sentence.slice(Math.max(0, i - 24), i)))) continue;
      if (insideQuote(sentence, i)) continue;
      return true;
    }
    return false;
  });
}

/**
 * Чистая: предметы в тексте КОМАНДЫ прогона. Кавычки здесь не исключаются: условие и
 * команды плеч записаны именно в кавычках.
 * @param {string} text
 * @returns {string[]}
 */
export function topicsOfCommand(text = '') {
  return Object.keys(TOPICS).filter((t) => TOPICS[t].some((r) => r.test(String(text))));
}

/**
 * Чистая: заявления «проверено» про поведение, зависящее от среды, с их предметами.
 * Окно — одно предложение или одна строка таблицы: строки итоговой таблицы и есть
 * заявления (дословный случай 2026-09-25), поэтому таблицы здесь НЕ пропускаются.
 * @param {string} text
 * @returns {Array<{claim:string, topics:string[]}>}
 */
export function claimsIn(text = '') {
  const out = [];
  const withoutCode = String(text).replace(/```[\s\S]*?```/g, '\n');
  // «**Что мешало.** Главная…»: точка внутри жирного тоже конец предложения.
  const sentences = withoutCode.split(/(?<=[.!?](?:\*\*|__)?)\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (s.startsWith('>')) continue;
    if (NOT_A_CLAIM.some((r) => r.test(s))) continue;
    if (RED_REPORT.some((r) => r.test(s))) continue;
    const topics = Object.keys(TOPICS).filter((t) => hasLive(s, TOPICS[t]));
    const subjects = topics.filter((t) => t !== PLATFORM);
    const bySubject = subjects.length > 0 && hasLive(s, GREEN, true);
    const byPlace = topics.includes(PLATFORM) && hasLive(s, VERIFY, true);
    if (bySubject || byPlace) out.push({ claim: s.slice(0, 220), topics });
  }
  return out;
}

const CONTROL_CMD = /control-red\.mjs/;
const SERVICE_CMD = /--self-test|--help|(?:^|\s)-h(?:\s|$)/;
const VERDICT_LINE = /^ВЕРДИКТ control-red: ([a-z-]+)/m;

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
  return '';
}

/**
 * Чистая: ИСПОЛНЕННЫЕ прогоны control-red.mjs по порядку — вердикт и предметы команды.
 * Засчитывается результат Bash, чья команда зовёт инструмент; самопроверка и справка — нет.
 * @param {Array<object>} entries разобранные строки транскрипта
 * @returns {Array<{verdict:string, topics:string[]}>}
 */
export function controlRuns(entries = []) {
  const wanted = new Map();
  const out = [];
  for (const e of entries) {
    const content = e && e.message && e.message.content;
    if (!Array.isArray(content)) continue;
    for (const p of content) {
      if (!p || typeof p !== 'object') continue;
      if (p.type === 'tool_use' && p.name === 'Bash') {
        const cmd = String((p.input && p.input.command) || '');
        if (CONTROL_CMD.test(cmd) && !SERVICE_CMD.test(cmd)) wanted.set(p.id, cmd);
      } else if (p.type === 'tool_result' && wanted.has(p.tool_use_id)) {
        const m = resultText(p.content).match(VERDICT_LINE);
        if (m) out.push({ verdict: m[1], topics: topicsOfCommand(wanted.get(p.tool_use_id)) });
      }
    }
  }
  return out;
}

/** Ключ набора предметов — для сообщения и журнала. */
export const topicKey = (topics) => [...topics].sort().join(' + ');

/**
 * Чистая: какие заявления не закрыты и нужно ли вернуть ход.
 * Заявление закрыто, если ПОСЛЕДНИЙ прогон, чьи предметы охватывают все предметы
 * заявления, дал proven. Слепой прогон после доказанного значит, что последнее
 * «проверено» стоит на слепом приборе.
 *
 * Напоминание — один раз на вид среды: `nudged` — виды, о которых сессия уже слышала.
 * Заявление возвращает ход, если среди его видов есть ещё не упомянутый.
 *
 * @param {{claims:Array<{claim:string,topics:string[]}>, runs:Array<{verdict:string,topics:string[]}>, nudged?:string[]}} input
 * @returns {{fire:boolean, reason:'no-run'|'other-topic'|'last-not-proven'|null, open:Array<{claim:string,topics:string[],reason:string}>, key:string|null, fresh:string[]}}
 */
export function decide({ claims = [], runs = [], nudged = [] }) {
  const open = [];
  for (const c of claims) {
    const covering = runs.filter((r) => c.topics.every((t) => r.topics.includes(t)));
    if (covering.length && covering[covering.length - 1].verdict === 'proven') continue;
    const reason = covering.length ? 'last-not-proven' : runs.length ? 'other-topic' : 'no-run';
    open.push({ ...c, reason });
  }
  const seen = new Set(nudged);
  const first = open.find((c) => c.topics.some((t) => !seen.has(t)));
  if (!first) return { fire: false, reason: null, open, key: null, fresh: [] };
  return { fire: true, reason: first.reason, open, key: topicKey(first.topics), fresh: first.topics.filter((t) => !seen.has(t)) };
}

// ── непрозрачная часть ──────────────────────────────────────────────────────
function lastTurnText(entries) {
  const chunks = [];
  for (let i = началоХода(entries); i < entries.length; i++) {
    const m = entries[i] && entries[i].message;
    if (!m || m.role !== 'assistant') continue;
    const c = m.content;
    if (typeof c === 'string') chunks.push(c);
    else if (Array.isArray(c)) for (const p of c) if (p && p.type === 'text' && p.text) chunks.push(p.text);
  }
  return chunks.join('\n');
}

function recordTrip(reason, claim) {
  const log = process.env.META_TRIP_LOG || path.join(os.homedir(), '.claude', 'jidoka', 'gate-trips.jsonl');
  if (!fs.existsSync(path.dirname(log))) return;
  const row = {
    date: new Date().toISOString().slice(0, 10),
    class: 'verified-where-failure-cannot-show',
    mechanism: 'hooks/control-red-gate.mjs',
    reason,
    topics: claim.topics,
    claim: claim.claim,
  };
  try { fs.appendFileSync(log, JSON.stringify(row) + '\n'); } catch { /* журнал не обязателен */ }
}

const MARK_DIR = path.join(os.homedir(), '.claude', 'session-env');

function readNudged(mark) {
  try { const v = JSON.parse(fs.readFileSync(mark, 'utf8')); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

const WHY = {
  'no-run': 'в ответе есть «проверено» про поведение, которое зависит от среды, а контрольного прогона в сессии нет.',
  'other-topic': 'контрольный прогон в сессии был, но про другое: его команда не охватывает предметы этого заявления.',
  'last-not-proven': 'последний контрольный прогон по этим предметам НЕ дал proven (прибор слеп или не ответил), а в ответе стоит «проверено».',
};

async function main() {
  let raw = '';
  try { for await (const chunk of process.stdin) raw += chunk; } catch { process.exit(0); }
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
  if (payload.stop_hook_active) process.exit(0);

  const tp = payload.transcript_path;
  if (!tp || !fs.existsSync(tp)) process.exit(0);

  const sid = String(payload.session_id || path.basename(tp)).replace(/[^\w-]/g, '');
  const mark = path.join(MARK_DIR, `control-red-${sid}.json`);
  const nudged = readNudged(mark);

  let entries = [];
  try {
    entries = хвостТранскрипта(tp).split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { process.exit(0); }

  const claims = claimsIn(lastTurnText(entries));
  if (!claims.length) process.exit(0);
  const verdict = decide({ claims, runs: controlRuns(entries), nudged });
  if (!verdict.fire) process.exit(0);

  try { fs.mkdirSync(MARK_DIR, { recursive: true }); fs.writeFileSync(mark, JSON.stringify([...nudged, ...verdict.fresh])); } catch { process.exit(0); }
  const shown = verdict.open.filter((c) => c.topics.some((t) => verdict.fresh.includes(t))).slice(0, 3);
  recordTrip(verdict.reason, shown[0]);

  console.error([
    `CONTROL-RED-GATE (класс verified-where-failure-cannot-show): ${WHY[verdict.reason]}`,
    `Предметы: ${verdict.key}.`,
    '',
    ...shown.map((c) => `  «${c.claim}»`),
    '',
    'Зелёный что-то доказывает, только если в той же среде тот же прибор краснеет на заведомо',
    'сломанном варианте. 2026-09-25 три проверки были зелёными там, где сбой не мог проявиться:',
    'шрифты приходили мгновенно, Arial был установлен, панель браузера была скрыта. Сдвиг 0,019',
    'нашёлся только на бою.',
    '',
    'Что сделать:',
    '  1. назови условие, при котором сбой проявился бы (шрифты задержаны, Arial нет, вкладка видима, сеть медленная, кеш холодный);',
    '  2. прогони прибор на заведомо сломанном варианте и на цели, назвав в условии те же предметы:',
    '     node ~/.claude/jidoka/scripts/control-red.mjs --condition "…" --control "…" --target "…" --metric "…" --max N',
    '  3. proven — пиши «проверено при условии …»; blind — прибор слеп, создай условие и повтори.',
    '',
    'Если создать условие нельзя, скажи это прямо: «проверено только на Mac, на Linux не проверял»',
    'честнее, чем «проверено». Каталог слепых сред: ~/.claude/jidoka/docs/CONTROL_RED.md',
    'Сторож напоминает один раз на каждый вид среды за сессию.',
    'Если это не заявление о проверке, скажи так и заверши.',
  ].join('\n'));
  process.exit(2);
}

function selfTest() {
  const fails = [];
  let ran = 0;
  const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const one = (s) => claimsIn(s).length === 1;
  const none = (s) => claimsIn(s).length === 0;

  // Дословные фразы сессии 2026-09-25 (сайт A+ Heating & Air), в которой класс и родился.
  ok('живое заявление 1: «Проверил на Mac… и в режиме Android…» ловится',
    one('Проверил на Mac (там берётся Arial) и в режиме Android (там Roboto): заголовок в обоих случаях точно такого же размера, как с настоящим шрифтом.'));
  ok('живое заявление 2: строка итоговой таблицы «запасной шрифт | закрыто» ловится',
    one('| Подогнанный запасной шрифт | закрыто (8 тестов, во всех 218 местах, где задаётся шрифт) |'));
  ok('живое заявление 3: «Прокрутка | закрыто, проверено на живом сайте» ловится',
    one('| Прокрутка при открытии страницы | закрыто (4 теста, проверено на живом сайте) |'));
  ok('живое заявление 4: «прокрутка… работают, ошибок нет» ловится',
    one('Живой сайт: прокрутка, якоря и обновление страницы работают, ошибок в консоли нет.'));
  ok('соседняя фраза без вердикта (замер сбоя) молчит',
    none('первая версия встроенных стилей давала на компьютере сдвиг экрана 0,11.'));
  ok('соседняя фраза в прошедшем времени о дыре молчит',
    none('Запасной шрифт сначала работал только там, где есть Arial, то есть не на Android.'));
  ok('соседняя фраза об отброшенной проверке молчит',
    none('Единственную проверку в скрытой панели (прокрутку) я сам отбросил как ничего не доказывающую и повторил в обычном Chrome.'));
  ok('соседняя фраза о том, чего узнать нельзя, молчит',
    none('Сдвиг случается на тестовой машине Google, какие там шрифты, узнать нельзя.'));

  ok('проверка без зависимости от среды молчит', none('Починил тест, прогон зелёный, 15 из 15.'));
  ok('отрицание «не проверял» молчит', none('Прокрутку на телефоне не проверял.'));
  ok('отчёт о найденном сбое молчит', none('Проверил: на Android запасной шрифт не срабатывает.'));
  ok('упоминание в кавычках-ёлочках молчит', none('Сторож ловит фразу «шрифт проверен» без прогона.'));
  ok('блок кода молчит', none('```\nCLS 0 проверено на мобильном\n```'));
  ok('«CLS 0» с вердиктом ловится', one('CLS 0 на мобильном, проверено.'));
  ok('«CLS 0,019» это замер сбоя, а не зелёный', none('Lighthouse на бою: CLS 0,019.'));
  ok('английское заявление ловится', one('Verified the font fallback on Linux.'));

  // Дословные ложные срабатывания ранних версий на корпусе 30 дней (2026-09-29).
  ok('ложное 1: «телефон» как номер, а не устройство — молчит',
    none('Работает приветствие с фиксированной частью, и главное, агент перестал собирать телефон по цифрам.'));
  ok('ложное 2: Mac как товар — молчит', none('Решение закрыто: Mac Studio, M5 Max, 18 ядер CPU и 40 ядер GPU.'));
  ok('ложное 3: «якорь» доказательства — молчит',
    none('Скачок последних двух недель настоящий — я проверил все 18 якорей W32, каждый находится в живом файле.'));
  ok('ложное 4: имя компонента ScrollFloat — молчит',
    none('Подтвердил фактами: компоненты LightRays, ScrollFloat, CardSwap не используются нигде на сайте.'));
  ok('ложное 5: условие «если … работает» — молчит',
    none('Если отключение работает, вариант «без кэша» обязан быть заметно медленнее.'));
  ok('ложное 6: «работают, но … ломает» — отчёт о сбое, молчит',
    none('Скриншоты работают, но моя прокрутка через код ломает анимации появления.'));
  ok('ложное 7: честная граница «Не проверено: … совпадает …» — молчит',
    none('Не проверено: машину Google напрямую (стенд совпадает с ней по составу и разбросу, но это не она).'));
  ok('ложное 8: план «докажу, что работает» — молчит',
    none('Теперь докажу, что она работает: запущу сервер и вызову инструмент, он должен лениво подключиться.'));
  ok('ложное 9: «тест падал … на macOS» — отчёт о сбое, молчит',
    none('Сервер работает — тест падал из-за отсутствия команды timeout на macOS.'));
  ok('ложное 10: «ссылка на телефон» это звонок, а не устройство — молчит',
    none('**Блок работает ровно как задумано.** Обе кнопки со ссылкой на телефон.'));
  ok('ложное 11: совместимость «игры работают на macOS» это не проверка — молчит',
    none('Да, список выше как раз для Мака — все десять игр оттуда работают на macOS.'));
  ok('платформа с глаголом проверки — ловится', one('Проверил на Linux: всё на месте.'));
  ok('ложное 12: предложение помочь «Хочешь, чтобы я… проверил мобильный вид» — молчит',
    none('Хочешь, чтобы я прошёлся по сайту в твоём Chrome (покликал кнопки, проверил форму, мобильный вид) — скажи, сделаю.'));
  ok('ложное 13: «Пока агенты работают, снимаю… шрифты» — молчит',
    none('Пока агенты работают, снимаю дизайн-параметры конкурента — цвета и шрифты для раздела гайдлайна.'));
  ok('ложное 14: «диктофон в телефоне мастера» — молчит',
    none('Первая версия работает с обычным звуком: диктофон в телефоне мастера, экспорт из Zoom.'));
  ok('ложное 15: название в кавычках «ввод и мобильная» — молчит',
    none('Пакет 3 «ввод и мобильная» выложен, программа ресёрча воронок закрыта.'));
  ok('ложное 16: «ленивая загрузка работает так: …» описание, а не вердикт — молчит',
    none('Сейчас ленивая загрузка работает так: наставник в момент вызова говорит «дай мне чат».'));
  ok('ложное 17: «пока не скачаются шрифты» это загрузка, а не «вёрстка не скачет» — молчит',
    none('Главная на телефоне не показывала текст, пока не скачаются все 11 файлов шрифтов.'));
  ok('настоящее из корпуса: «не прыгают, когда приходит настоящий шрифт» ловится',
    one('Строки стоят на тех же местах и не прыгают, когда приходит настоящий шрифт.'));
  ok('настоящее из корпуса: «Прод на телефоне работает» ловится', one('Прод на телефоне работает.'));
  ok('настоящее из корпуса: «на телефоне одна колонка» ловится',
    one('Проверил на проде: на компьютере две колонки, на телефоне одна, ничего не уезжает вбок.'));
  ok('настоящее из корпуса: «проверено … на телефоне» ловится',
    one('Проверено в светлой и тёмной теме, на настольном экране и на телефоне.'));

  const arialClaim = claimsIn('Проверил на Mac (там берётся Arial) и в режиме Android (там Roboto): заголовок того же размера.')[0];
  ok('у заявления про Arial на Android два предмета: шрифты и платформа',
    !!arialClaim && arialClaim.topics.includes('шрифты') && arialClaim.topics.includes(PLATFORM));

  const bash = (id, command) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const result = (id, text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  const FONT_RUN = 'node ~/.claude/jidoka/scripts/control-red.mjs --condition "шрифты задержаны на 2,5 с" --control "node m.mjs old" --target "node m.mjs new" --metric "CLS=([0-9.]+)" --max 0.01';
  const runs = controlRuns([bash('t1', FONT_RUN), result('t1', 'контроль …\nВЕРДИКТ control-red: proven — прибор видит сбой')]);
  ok('исполненный прогон читается: вердикт proven и предметы команды',
    runs.length === 1 && runs[0].verdict === 'proven' && runs[0].topics.includes('шрифты') && runs[0].topics.includes('сдвиги и скорость'));
  ok('вердикт в результате-массиве тоже читается',
    controlRuns([bash('t2', FONT_RUN), result('t2', [{ type: 'text', text: 'ВЕРДИКТ control-red: blind — …' }])]).map((r) => r.verdict).join() === 'blind');
  ok('чтение исходника с текстом вердикта не считается прогоном',
    controlRuns([bash('t3', 'cat hooks/control-red-gate.mjs'), result('t3', 'ВЕРДИКТ control-red: proven')]).length === 0);
  ok('самопроверка инструмента не считается прогоном',
    controlRuns([bash('t4', 'node scripts/control-red.mjs --self-test'), result('t4', 'ВЕРДИКТ control-red: proven')]).length === 0);

  const fontClaim = { claim: 'CLS 0 при подменённых шрифтах', topics: ['сдвиги и скорость', 'шрифты'] };
  const scrollClaim = { claim: 'прокрутка работает', topics: ['прокрутка и анимация'] };
  const proven = (topics) => ({ verdict: 'proven', topics });
  const blind = (topics) => ({ verdict: 'blind', topics });
  const FONT = ['шрифты', 'сдвиги и скорость'];
  ok('заявление без прогона — сработать', decide({ claims: [fontClaim] }).fire === true && decide({ claims: [fontClaim] }).reason === 'no-run');
  ok('заявление после доказанного прогона по тем же предметам — молчать', decide({ claims: [fontClaim], runs: [proven(FONT)] }).fire === false);
  ok('РАСХОЖДЕНИЕ: прогон был, но прибор оказался слеп',
    decide({ claims: [fontClaim], runs: [proven(FONT), blind(FONT)] }).fire === true
    && decide({ claims: [fontClaim], runs: [proven(FONT), blind(FONT)] }).reason === 'last-not-proven');
  ok('доказанный прогон про шрифты не закрывает заявление про прокрутку',
    decide({ claims: [scrollClaim], runs: [proven(FONT)] }).reason === 'other-topic');
  ok('заявление про шрифт на Android не закрыто прогоном только про задержку шрифтов',
    decide({ claims: [arialClaim], runs: [proven(FONT)] }).fire === true);
  ok('…и закрыто прогоном, условие которого называет и шрифт, и платформу',
    decide({ claims: [arialClaim], runs: [proven(topicsOfCommand('--condition "Arial нет, как на Linux" --control "a" --target "b"'))] }).fire === false);
  ok('новый вид среды в той же сессии — сработать снова',
    decide({ claims: [arialClaim], nudged: ['сдвиги и скорость'] }).fire === true);
  ok('тот же вид среды второй раз — молчать',
    decide({ claims: [scrollClaim], nudged: ['прокрутка и анимация'] }).fire === false);
  ok('все виды заявления уже упомянуты — молчать',
    decide({ claims: [arialClaim], nudged: ['шрифты', PLATFORM] }).fire === false);
  ok('родная сессия: после трёх напоминаний о другом заявление про Arial и Android всё равно возвращает ход',
    decide({ claims: [arialClaim], nudged: ['мобильная вёрстка', 'ленивая загрузка', 'сдвиги и скорость'] }).fire === true);
  ok('возвратов за сессию не больше, чем видов среды',
    decide({ claims: [scrollClaim, arialClaim, fontClaim], nudged: Object.keys(TOPICS) }).fire === false);
  ok('без заявлений — молчать', decide({ claims: [] }).fire === false);

  if (fails.length) { console.log(`\n\x1b[31mcontrol-red-gate self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ control-red-gate: ${ran} прошло, 0 упало\x1b[0m`);
  process.exit(0);
}

// Разбор — первое, что делает хук: незнакомый флаг или лишнее слово — отказ до чтения stdin.
export const CLI = {
  name: 'control-red-gate',
  path: 'hooks/control-red-gate.mjs',
  summary: 'Хук Stop: «проверено» про поведение, зависящее от среды, без доказанного прогона control-red.mjs по тем же предметам — возврат хода (раз на вид среды за сессию). Данные события — в stdin.',
  selfTest: true,
  badCallExit: HOOK_BAD_CALL_EXIT,
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { selfTest: wantsSelfTest } = (await loadCli(import.meta.url)).runCli(CLI);
  if (wantsSelfTest) selfTest();
  main();
}
