#!/usr/bin/env node
// negative-claim-gate — утверждение об ОТСУТСТВИИ требует исчерпывающей проверки.
//
// @closes-class: research-claim-without-evidence
// @scope: all
// @scope-ok: вход это текст ПОСЛЕДНЕГО хода сессии, несколько килобайт
// @divergence: "РАСХОЖДЕНИЕ: проверил один уровень, заявил про всю цепочку" — измеряемая
//              величина «я посмотрел и вижу» говорит «проверено», а правило «проверено ВСЁ
//              пространство» нарушено: у процесса есть предки выше непосредственного
//
// ПОЧЕМУ ПОЯВИЛСЯ. Класс research-claim-without-evidence протёк 2026-08-24, через шесть дней
// после того, как гейт встал. Разбор причины: research-audit читает ДОКУМЕНТ, а утверждение
// прозвучало в разговоре. Гейт не мог его увидеть по построению, а не по недосмотру.
//
// Сам случай: «проверил, что npm exec next build идёт мимо сторожа очереди». Проверки не
// было. Был взгляд на список процессов и на НЕПОСРЕДСТВЕННОГО родителя. Полная цепочка
// предков доказывала обратное: сторож сам так зовёт next. На этой ошибке в реестр классов
// ушла ложная запись, а в очередь — задача чинить несуществующую дыру.
//
// ПОЧЕМУ ИМЕННО ОТРИЦАНИЯ. Утверждение о наличии доказывается одним примером: вот он.
// Утверждение об отсутствии одним примером не доказывается никогда, для него нужно
// перебрать пространство. Это же правило у нас записано про репозитории («такого нет» —
// только после проверки ВСЕХ копий кода) и про домены. Здесь оно становится механизмом.
//
// ЧТО ГЕЙТ ДЕЛАЕТ. Читает СОБСТВЕННЫЙ текст последнего хода, ищет утверждения об отсутствии
// без признака исчерпывающей проверки и НАЗЫВАЕТ фразу. Он не спорит с выводом, он
// спрашивает, чем тот доказан.
//
// ОН МЯГКИЙ, И ЭТО НЕ РОБОСТЬ, А ЗАМЕР. Долю ложных я мерил на десяти недельных отчётах:
// 12 срабатываний, почти все на прозе О дырах, а не на заявлениях. Но отчёт это НЕ его
// корпус: он читает реплику сессии. Настоящего корпуса у меня сейчас нет, значит доля
// ложных неизвестна, а блокирующий сторож с неизвестной долей ложных учится пролистываться
// в первый же день. Поэтому он печатает и пропускает.
//
// УСЛОВИЕ ВЫПУСКА В ЖЁСТКИЙ РЕЖИМ: тридцать срабатываний на живых репликах, из которых не
// более трёх ложных. Считает gate-graduation по журналу, как для остальных мягких гейтов.
// До тех пор жёсткий режим включать нельзя, даже если очень хочется.
//
// Fail-open на всём: нет транскрипта, нечитаемый JSON, любая ошибка — выход 0.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Утверждение об ОТСУТСТВИИ или о НЕДОСТИЖИМОСТИ. */
// ГРАНИЦА СЛОВА НЕ \b. В JavaScript она определена по ASCII, поэтому перед кириллицей её
// нет и правило молча не срабатывает. Сегодня я наступил на это ДВАЖДЫ: сначала в
// property-vs-method, потом здесь. Класс ascii-word-boundary-blind-in-cyrillic.
const B = '(?<![\\p{L}\\p{N}])';   // начало слова, юникодное
const E = '(?![\\p{L}\\p{N}])';    // конец слова, юникодный
const rx = (body) => new RegExp(B + body + E, 'iu');
const NEGATIVE = [
  rx('идёт\\s+мимо'), rx('проход(ит|ят)\\s+мимо'), rx('в\\s+обход'), rx('обход[ае]?\\s+нет'),
  rx('такого\\s+нет'), rx('не\\s+существует'), rx('не\\s+вызывается'), rx('никто\\s+не\\s+(зовёт|вызывает)'),
  rx('не\\s+запускается'), rx('не\\s+срабатывает'), rx('нигде\\s+не'),
  rx('bypass(es|ed)?'), rx('never\\s+(called|runs?|fires?)'), rx('does\\s+not\\s+(run|exist|fire)'),
  rx('no\\s+(caller|such)'),
];

/**
 * Признак того, что проверено ПРОСТРАНСТВО, а не один случай.
 * Слово «проверил» сюда НЕ входит намеренно: именно оно и стояло в протёкшем утверждении.
 */
const EXHAUSTIVE = [
  rx('вс[еехй]'), rx('кажд(ый|ую|ое|ой)'), rx('полн(ая|ую|ый|ой)\\s+цепочк[а-я]*'), rx('цепочк[аиу]\\s+предк[а-я]*'),
  rx('перебрал'), rx('перечислил'), rx('ни\\s+одного'), rx('по\\s+всем'),
  rx('all\\s+(of\\s+)?(them|repos|callers|parents)'), rx('exhaustive'), rx('every'),
  /grep\s+-r/i, /pstree/i, /ps\s+-\w*ax/i,
];

/**
 * Чистая: найти утверждения об отсутствии, у которых рядом нет признака исчерпывающей
 * проверки. Окно — ОДНО предложение: доказательство, стоящее абзацем ниже, читателю ещё
 * может помочь, а вот через страницу это уже не доказательство, а надежда.
 *
 * @param {string} text
 * @returns {Array<{claim:string}>}
 */
/**
 * Строка, которая НЕ является утверждением: замер на двух настоящих отчётах дал 9
 * срабатываний, и почти все пришлись на прозу О механизмах, а не на заявления.
 *   строка таблицы          `| P0 | Гейт блокирует пуш ... |`
 *   имя класса              `guard-bypassed-via-alternate-path`
 *   цитата чужого текста    `> ...` и `«...»`
 * Блокирующий сторож с такой долей ложных учится пролистываться в первый же день.
 */
function isProseNotClaim(s) {
  const t = s.trim();
  if (t.startsWith('|') || t.startsWith('>') || t.startsWith('```')) return true;
  // строка целиком это идентификатор (имя класса, слаг, путь)
  if (/^[a-z0-9]+(-[a-z0-9]+){2,}$/.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s+[a-z0-9-]+$/.test(t)) return true;
  return false;
}

/** Совпадение внутри обратных кавычек или внутри кебаб-слага это НЕ заявление. */
function matchIsIdentifier(sentence, re) {
  const m = sentence.match(re);
  if (!m) return false;
  const i = m.index ?? 0;
  const before = sentence.slice(Math.max(0, i - 30), i);
  const after = sentence.slice(i, i + 40);
  // внутри `...`
  const ticksBefore = (before.match(/`/g) || []).length;
  if (ticksBefore % 2 === 1) return true;
  // часть кебаб-имени: слева или справа дефис вплотную к слову
  if (/[a-z0-9]-$/.test(before) || /^[a-z-]*-[a-z]/.test(after.replace(/\s.*/, ''))) return true;
  return false;
}

/** Перечисление пространства это и есть перебор: «ни git-хук, ни CI, ни npm». */
const ENUMERATED = /(^|[\s,:])ни\s+[^,]+,\s*ни\s+/iu;

export function unprovenNegatives(text = '') {
  const out = [];
  // Предложение как единица: точка, восклицательный, вопросительный, перевод строки.
  const sentences = String(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (isProseNotClaim(s)) continue;
    const hit = NEGATIVE.find((r) => r.test(s));
    if (!hit) continue;
    if (matchIsIdentifier(s, hit)) continue;
    if (ENUMERATED.test(s)) continue;
    if (EXHAUSTIVE.some((r) => r.test(s))) continue;
    out.push({ claim: s.slice(0, 200) });
  }
  return out;
}

/** Чистая: блокировать ли. Один раз за сессию: повторная блокировка это не защита, а тупик. */
export function shouldBlock({ findings = [], alreadyBlocked = false }) {
  return findings.length > 0 && !alreadyBlocked;
}

// ── непрозрачная часть ──────────────────────────────────────────────────────
function collectLastTurn(transcriptPath) {
  let parsed = [];
  try {
    parsed = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return ''; }
  let start = 0;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (parsed[i]?.message?.role === 'user') { start = i + 1; break; }
  }
  const chunks = [];
  for (let i = start; i < parsed.length; i++) {
    const m = parsed[i]?.message;
    if (!m || m.role !== 'assistant') continue;
    const c = m.content;
    if (typeof c === 'string') chunks.push(c);
    else if (Array.isArray(c)) for (const p of c) if (p && p.type === 'text' && p.text) chunks.push(p.text);
  }
  return chunks.join('\n');
}

const MARK_DIR = path.join(os.homedir(), '.claude', 'session-env');

async function main() {
  let raw = '';
  try { for await (const chunk of process.stdin) raw += chunk; } catch { process.exit(0); }
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }

  const tp = payload.transcript_path;
  if (!tp) process.exit(0);
  const text = collectLastTurn(tp);
  if (!text) process.exit(0);

  const findings = unprovenNegatives(text);
  const sid = String(payload.session_id || 'unknown').replace(/[^\w-]/g, '');
  const mark = path.join(MARK_DIR, `negative-claim-${sid}.mark`);
  const alreadyBlocked = fs.existsSync(mark);

  if (!shouldBlock({ findings, alreadyBlocked })) process.exit(0);

  try { fs.mkdirSync(MARK_DIR, { recursive: true }); fs.writeFileSync(mark, String(Date.now())); } catch { /* пометка не обязательна */ }

  const list = findings.slice(0, 3).map((f) => `  «${f.claim}»`).join('\n');
  console.error([
    'ВНИМАНИЕ: утверждение об ОТСУТСТВИИ без исчерпывающей проверки.',
    '',
    list,
    '',
    'Наличие доказывается одним примером. Отсутствие одним примером не доказывается никогда:',
    'для него надо перебрать пространство. 2026-08-24 на этом сгорела запись в реестре классов:',
    '«идёт мимо сторожа» было сказано после взгляда на НЕПОСРЕДСТВЕННОГО родителя процесса,',
    'а полная цепочка предков доказывала обратное.',
    '',
    'Что сделать: назови пространство и покажи, что перебрал его целиком.',
    '  процессы   — полная цепочка предков, а не ps | grep',
    '  код        — все репозитории и копии, а не тот, что под рукой',
    '  вызовы     — grep -r по дереву, а не память о том, где смотрел',
    '',
    'Если проверить нельзя, скажи это прямо: «не проверял» честнее, чем «идёт мимо».',
    '',
    'Это ПРЕДУПРЕЖДЕНИЕ, не блокировка: доля ложных срабатываний ещё не измерена на живых',
    'репликах. Выпуск в жёсткий режим — после 30 срабатываний при не более чем 3 ложных.',
  ].join('\n'));
  // Мягкий режим: сказать и пропустить. Жёсткость без замера это не строгость, а лотерея.
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    const fails = [];
    let ran = 0;
    const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

    ok('РАСХОЖДЕНИЕ: проверил один уровень, заявил про всю цепочку',
      unprovenNegatives('Проверил, что npm exec next build идёт мимо сторожа очереди.').length === 1);
    ok('то же утверждение с полной цепочкой предков проходит',
      unprovenNegatives('Полная цепочка предков показывает, что build идёт мимо сторожа.').length === 0);
    ok('«такого нет» без перебора ловится',
      unprovenNegatives('В бэкенде такого нет.').length === 1);
    ok('«такого нет» после проверки ВСЕХ репозиториев проходит',
      unprovenNegatives('Проверил все репозитории организации: такого нет.').length === 0);
    ok('«никто не зовёт» без grep ловится',
      unprovenNegatives('Этот скрипт никто не зовёт.').length === 1);
    ok('«никто не зовёт» с grep -r проходит',
      unprovenNegatives('grep -r по дереву: этот скрипт никто не зовёт.').length === 0);
    ok('английское bypasses тоже ловится',
      unprovenNegatives('The build bypasses the queue guard.').length === 1);
    ok('обычный текст без отрицаний молчит',
      unprovenNegatives('Починил тест, прогон зелёный, 15 из 15.').length === 0);
    ok('утверждение о НАЛИЧИИ не трогается',
      unprovenNegatives('Сторож вызывается из pre-push, вот строка 42.').length === 0);
    ok('окно это предложение, а не абзац',
      unprovenNegatives('Такого нет.\nПотом я проверил все копии.').length === 1);
    ok('несколько отрицаний перечисляются',
      unprovenNegatives('Такого нет. Скрипт не вызывается.').length === 2);
    ok('блокировка ровно один раз за сессию',
      shouldBlock({ findings: [{ claim: 'x' }], alreadyBlocked: false }) === true
      && shouldBlock({ findings: [{ claim: 'x' }], alreadyBlocked: true }) === false);
    ok('без находок не блокирует', shouldBlock({ findings: [], alreadyBlocked: false }) === false);
    ok('пустой текст не притворяется проверкой', unprovenNegatives('').length === 0);
    ok('имя класса с bypass это не заявление',
      unprovenNegatives('2026-07-29  guard-bypassed-via-alternate-path').length === 0);
    ok('строка таблицы это проза о механизме, а не заявление',
      unprovenNegatives('| P0 | Гейт блокирует пуш, а лечение не срабатывает | ... |').length === 0);
    ok('ПЕРЕЧИСЛЕНИЕ пространства это перебор: «ни X, ни Y, ни Z»',
      unprovenNegatives('Его никто не зовёт: ни git-хук, ни CI, ни npm-команда.').length === 0);
    ok('слово в обратных кавычках заявлением не считается',
      unprovenNegatives('Класс `guard-bypassed-via-alternate-path` записан в реестр.').length === 0);
    ok('настоящее заявление всё ещё ловится после всех послаблений',
      unprovenNegatives('Проверил, что build идёт мимо сторожа очереди.').length === 1);

    if (fails.length) { console.log(`\n\x1b[31mnegative-claim-gate self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
    console.log(`\n\x1b[32m✓ negative-claim-gate: ${ran} прошло, 0 упало\x1b[0m`);
    process.exit(0);
  }
  main();
}
