#!/usr/bin/env node
// closing-summary-gate — работа не закрывается без итога.
//
// @closes-class: work-reported-without-a-closing-verdict
// @scope: all
// @scope-ok: вход это текст ПОСЛЕДНЕГО хода сессии, несколько килобайт
// @divergence: "РАСХОЖДЕНИЕ: девять инструментов и фраза «готово» — итога нет" —
//              измеряемая величина «ответ написан» говорит «отчитался», а правило
//              «видно, что сделано и чем доказано» не выполнено
//
// ПОЧЕМУ. Владелец 2026-08-26 увидел итог одной из сессий и попросил делать так ВСЕГДА:
// «если он делает какую то задачу, и он написал что сделал или остановился по какой то
// причине, то в конце всегда показывает какой то такого рода итог».
//
// Сверху уже стоит строка пайплайна (где мы в плане), снизу подпись состояния (где мы в
// системе). Между ними не было РЕЗУЛЬТАТА: сколько сделано, чем доказано, что осталось.
//
// ПОРОГ. Три и более вызова инструментов за ход — значит была работа. Разговорная реплика
// итога не требует: итог на «да, понял» это шум, а шум учит пролистывать всё подряд,
// включая настоящие итоги.
//
// ОН МЯГКИЙ. Долю ложных на живых репликах не мерил. Блокирующий сторож с неизвестной
// долей ложных учится пролистываться в первый же день — вывод сделан 2026-08-24 на
// negative-claim-gate, и повторять ту ошибку осознанно не буду.
// Условие выпуска в жёсткий режим: 30 срабатываний при не более чем 3 ложных.
//
// Fail-open на всём: нет транскрипта, нечитаемый JSON, любая ошибка — выход 0.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { хвостТранскрипта } from "./lib/transcript-tail.mjs";

/** Порог «была работа». Ниже — разговор. */
export const WORK_THRESHOLD = 3;

/**
 * Признаки итога. Проверяются лексически по СОБСТВЕННОМУ формату, поэтому ложных мало:
 * либо блок есть, либо его нет.
 */
// ГРАНИЦА СЛОВА НЕ \b: в JavaScript она определена по ASCII, поэтому после кириллицы её
// нет и правило молча не срабатывает. Этот класс встретился ЧЕТВЁРТЫЙ раз за три дня
// (property-vs-method, negative-claim-gate, запись о нём самом, теперь здесь), и ровно
// поэтому рядом появился прибор scripts/cyrillic-boundary.mjs.
const E = '(?![\\p{L}\\p{N}])';
const MARKERS = [
  /[▰▱]{4,}/,                                                        // шкала
  new RegExp('(^|\\n)#{1,4}\\s*Итог' + E, 'iu'),                       // заголовок
  // Общие слова якорим на начало строки или ячейку таблицы: «в работе» встречается в
  // обычной речи, и без якоря сторож считал бы итогом любой рассказ о ходе работы.
  new RegExp('(^|\\n)\\s*\\|?\\s*(закрыто|в работе|не начато|отклонено)' + E, 'iu'),
  // «ждёт вас» якоря не требует: оборот редкий и означает ровно границу вашего решения.
  new RegExp('ждёт вас' + E, 'iu'),
  /(^|\n).*(почему остановился|что разблокирует)/iu,                // остановка
];

/**
 * Чистая: нужен ли итог и есть ли он.
 * @param {{toolCalls:number, text:string}} o
 * @returns {{needed:boolean, present:boolean, missing:boolean}}
 */
export function summaryVerdict({ toolCalls = 0, text = '' }) {
  const needed = toolCalls >= WORK_THRESHOLD;
  const present = MARKERS.some((r) => r.test(String(text)));
  return { needed, present, missing: needed && !present };
}

// ── непрозрачная часть ──────────────────────────────────────────────────────
/** Последний ход: всё после последней реплики человека. */
function lastTurn(transcriptPath) {
  let parsed = [];
  try {
    // Хвост, а не весь файл: 158-МБ сессия стоила 0.7с на гейт (замер 2026-08-31).
    parsed = хвостТранскрипта(transcriptPath).split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return { toolCalls: 0, text: '' }; }
  let start = 0;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (parsed[i]?.message?.role === 'user') { start = i + 1; break; }
  }
  let toolCalls = 0;
  const chunks = [];
  for (let i = start; i < parsed.length; i++) {
    const m = parsed[i]?.message;
    if (!m || m.role !== 'assistant') continue;
    const c = m.content;
    if (typeof c === 'string') { chunks.push(c); continue; }
    if (!Array.isArray(c)) continue;
    for (const p of c) {
      if (!p) continue;
      if (p.type === 'tool_use') toolCalls++;
      else if (p.type === 'text' && p.text) chunks.push(p.text);
    }
  }
  return { toolCalls, text: chunks.join('\n') };
}

const MARK_DIR = path.join(os.homedir(), '.claude', 'session-env');

async function main() {
  let raw = '';
  try { for await (const chunk of process.stdin) raw += chunk; } catch { process.exit(0); }
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
  if (!payload.transcript_path) process.exit(0);

  const turn = lastTurn(payload.transcript_path);
  const v = summaryVerdict(turn);
  if (!v.missing) process.exit(0);

  // Напоминать раз в сессию: повторное напоминание это не защита, а фон.
  const sid = String(payload.session_id || 'unknown').replace(/[^\w-]/g, '');
  const mark = path.join(MARK_DIR, `closing-summary-${sid}.mark`);
  if (fs.existsSync(mark)) process.exit(0);
  try { fs.mkdirSync(MARK_DIR, { recursive: true }); fs.writeFileSync(mark, String(Date.now())); } catch { /* пометка не обязательна */ }

  console.error([
    `ВНИМАНИЕ: ход из ${turn.toolCalls} вызовов инструментов закончился без итога.`,
    '',
    'Сверху стоит строка пайплайна (где мы в плане), снизу подпись состояния (где мы в',
    'системе). Между ними должен быть РЕЗУЛЬТАТ. Три свойства обязательны:',
    '',
    '  1. шкала с АБСОЛЮТНЫМИ числами   ▰▰▰▱▱▱▱▱▱▱  30%   34 из 722',
    '     процент без знаменателя это впечатление, а не замер',
    '',
    '  2. таблица «пункт → состояние»   закрыто / в работе N% / не начато / отклонено / ждёт вас',
    '     «закрыто» только с доказательством: адрес, отпечаток, код возврата',
    '',
    '  3. честная оговорка о числе, которое льстит',
    '     число, которое читается лучше, чем обстоит дело, объясняется ПОД собой',
    '',
    'Если работа ОСТАНОВЛЕНА — итог тем более обязателен, плюс «почему остановился» и',
    '«что разблокирует». Молчаливая остановка неотличима от продолжающейся работы.',
    '',
    'Канон: docs/CLOSING_SUMMARY.md. Это предупреждение, не блокировка.',
  ].join('\n'));
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    const fails = [];
    let ran = 0;
    const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

    ok('РАСХОЖДЕНИЕ: девять инструментов и фраза «готово» — итога нет',
      summaryVerdict({ toolCalls: 9, text: 'Готово, всё работает.' }).missing === true);
    ok('шкала засчитывается как итог',
      summaryVerdict({ toolCalls: 9, text: '▰▰▰▱▱▱▱▱▱▱ 30% · 34 из 722' }).missing === false);
    ok('заголовок «Итог» засчитывается',
      summaryVerdict({ toolCalls: 5, text: '## Итог\nСделано три вещи.' }).missing === false);
    ok('таблица состояний засчитывается',
      summaryVerdict({ toolCalls: 5, text: '| закрыто | коммит 90520fd |' }).missing === false);
    ok('остановка с причиной засчитывается',
      summaryVerdict({ toolCalls: 4, text: 'Почему остановился: упёрся в ваше решение.' }).missing === false);
    ok('разговорная реплика итога не требует',
      summaryVerdict({ toolCalls: 0, text: 'Да, понял.' }).missing === false);
    ok('порог: два вызова это ещё не работа',
      summaryVerdict({ toolCalls: 2, text: 'Посмотрел, всё на месте.' }).missing === false);
    ok('порог: три вызова это уже работа',
      summaryVerdict({ toolCalls: 3, text: 'Посмотрел, всё на месте.' }).missing === true);
    ok('needed и present считаются раздельно',
      (() => { const v = summaryVerdict({ toolCalls: 1, text: '▰▰▰▱▱▱▱▱▱▱' }); return v.needed === false && v.present === true; })());
    ok('пустой ход не притворяется работой',
      summaryVerdict({ toolCalls: 0, text: '' }).missing === false);
    ok('кириллические состояния распознаются (не \\b по ASCII)',
      summaryVerdict({ toolCalls: 7, text: 'Пункт 3 — ждёт вас: нужна ваша строка в реестре.' }).missing === false);

    if (fails.length) { console.log(`\n\x1b[31mclosing-summary-gate self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
    console.log(`\n\x1b[32m✓ closing-summary-gate: ${ran} прошло, 0 упало\x1b[0m`);
    process.exit(0);
  }
  main();
}
