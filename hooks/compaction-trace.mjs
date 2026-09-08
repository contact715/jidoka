#!/usr/bin/env node
// @closes-class: fixture-diverges-from-real-shape
// @scope: changed
// @divergence: "запись без compactMetadata не выдумывает числа" — самопроверка была зелёной
// на выдуманной форме {summary:'x'.repeat(1234)}, а в настоящем событии поля summary нет вовсе,
// поэтому в 124 записях из 124 стояло null и прибор считался работающим
// compaction-trace — records that a session's context was compacted, and what it was doing.
//
// compaction-leaves-a-trace (2026-W31-R12)
//
// THE GAP. When context fills mid-task, the conversation is summarised and the detail is gone.
// Nothing recorded that this happened. So a retro, a hand-off, or a later reader sees a session
// that appears continuous, and cannot tell that the middle of it was replaced by a summary. The
// tell-tale symptoms of a post-compaction session — re-reading files it already read, re-deriving
// a decision it already made, contradicting its own earlier choice — read as carelessness rather
// than as the mechanical consequence they are.
//
// This writes one line per compaction. It never blocks, never edits the transcript, and never
// delays the compaction: it appends and exits.
//
// PreCompact fires before the summary exists, PostCompact after. Both are recorded, so the pair
// brackets exactly what was lost and, on PostCompact, how long the summary is.
//
// Fail-open by construction: any error at all exits 0. Losing a trace line is a nuisance; a hook
// that breaks compaction would break the session.

import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { хвостТранскрипта } from './lib/transcript-tail.mjs';

const LOG = process.env.JIDOKA_COMPACTION_LOG || join(homedir(), '.jidoka', 'compaction-events.jsonl');

/** Pure: the record we keep for one compaction event. */
export function traceRecord(input = {}, event = 'PreCompact', now = new Date().toISOString()) {
  const summary = String(input.summary || '');
  return {
    at: now,
    event,
    session: input.session_id || null,
    // "manual" (the user asked) vs "auto" (the window filled). Auto is the interesting one:
    // nobody chose it, so nobody knows it happened.
    trigger: input.trigger || input.matcher || 'unknown',
    cwd: input.cwd || null,
    // present only on PostCompact; a length is enough to see how much survived
    summaryChars: summary ? summary.length : null,
  };
}

/**
 * Чистая: вытащить ПРАВДУ о сжатии из транскрипта, а не из поля, которого не бывает.
 *
 * Прежняя запись брала длину из `input.summary`. Такого поля в событии нет: самопроверка
 * подкладывала его себе сама, была зелёной, и в 124 записях из 124 стоял null. Форма ниже
 * снята с настоящего транскрипта 2026-09-07 и проверена на нём же.
 *
 * Возвращает null, когда метаданных нет. Null здесь означает «не нашёл», и он НИКОГДА не
 * подменяется нулём: нуль читался бы как «сжатия не было».
 *
 * @param {string} text содержимое транскрипта (достаточно хвоста)
 * @returns {null|{preTokens:number|null, postTokens:number|null, droppedTokens:number|null,
 *   durationMs:number|null, headUuid:string|null, anchorUuid:string|null, tailUuid:string|null,
 *   logicalParentUuid:string|null}}
 */
export function parseCompactMetadata(text = '') {
  let found = null;
  for (const line of String(text).split('\n')) {
    if (!line.includes('"compactMetadata"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const cm = o && o.compactMetadata;
    if (!cm || typeof cm !== 'object') continue;
    const seg = cm.preservedSegment || {};
    found = {
      preTokens: Number.isFinite(cm.preTokens) ? cm.preTokens : null,
      postTokens: Number.isFinite(cm.postTokens) ? cm.postTokens : null,
      droppedTokens: Number.isFinite(cm.cumulativeDroppedTokens) ? cm.cumulativeDroppedTokens : null,
      durationMs: Number.isFinite(cm.durationMs) ? cm.durationMs : null,
      headUuid: seg.headUuid || null,
      anchorUuid: seg.anchorUuid || null,
      tailUuid: seg.tailUuid || null,
      logicalParentUuid: o.logicalParentUuid || null,
    };
  }
  return found;   // последняя встреченная: сжатий за сессию бывает несколько
}

function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const NOW = '2026-08-08T12:00:00.000Z';

  const pre = traceRecord({ session_id: 's1', trigger: 'auto', cwd: '/repo' }, 'PreCompact', NOW);
  ok('запись помнит сессию', pre.session === 's1');
  ok('запись помнит, кто инициировал сжатие', pre.trigger === 'auto');
  ok('до сжатия длины сводки ещё нет', pre.summaryChars === null);
  ok('событие названо', pre.event === 'PreCompact');
  ok('время проставлено', pre.at === NOW);

  const post = traceRecord({ session_id: 's1', trigger: 'auto', summary: 'x'.repeat(1234) }, 'PostCompact', NOW);
  ok('после сжатия видно, сколько осталось', post.summaryChars === 1234);
  ok('ручное сжатие отличается от автоматического', traceRecord({ trigger: 'manual' }).trigger === 'manual');
  ok('неизвестный повод не выдаётся за ручной', traceRecord({}).trigger === 'unknown');
  ok('matcher принимается как повод, если trigger не передан', traceRecord({ matcher: 'auto' }).trigger === 'auto');
  ok('пустой вход не роняет запись', typeof traceRecord().at === 'string');

  // ── настоящая форма, а не выдуманная ───────────────────────────────────────
  // Фикстура ниже снята с живого транскрипта 2026-09-07. Прежняя самопроверка
  // подкладывала себе поле summary, которого в событии не бывает, была зелёной,
  // и в 124 записях из 124 стоял null. Кейс, написанный по собственной догадке
  // о форме входа, доказывает только собственную догадку.
  const REAL = JSON.stringify({
    type: 'system', subtype: 'compact_boundary',
    logicalParentUuid: 'tail-1',
    compactMetadata: {
      trigger: 'auto', preTokens: 998460, postTokens: 30122,
      durationMs: 166348, cumulativeDroppedTokens: 968338,
      preservedSegment: { headUuid: 'head-1', anchorUuid: 'anch-1', tailUuid: 'tail-1' },
    },
  });

  const meta = parseCompactMetadata(REAL);
  ok('числа сжатия читаются из транскрипта, а не из несуществующего поля',
    meta && meta.preTokens === 998460 && meta.postTokens === 30122);
  ok('видно, сколько выброшено',
    meta && meta.droppedTokens === 968338);
  ok('якорь забытого куска сохранён — есть ГДЕ искать, а не только ЧТО забыто',
    meta && meta.headUuid === 'head-1' && meta.anchorUuid === 'anch-1' && meta.tailUuid === 'tail-1');
  ok('длительность сжатия записана', meta && meta.durationMs === 166348);

  // КРАСНОЕ ПЛЕЧО: без метаданных прибор обязан сказать «не нашёл», а не подставить ноль.
  // Ноль читался бы как «сжатия не было» — это ровно та подмена, из-за которой
  // прежняя запись выглядела рабочей.
  ok('запись без compactMetadata не выдумывает числа',
    parseCompactMetadata('{"type":"user","message":{}}') === null);
  ok('битая строка не роняет разбор и не выдаёт мусор за данные',
    parseCompactMetadata('не json\n{"compactMetadata":') === null);
  const two = parseCompactMetadata(
    JSON.stringify({ compactMetadata: { preTokens: 1 } }) + '\n' +
    JSON.stringify({ compactMetadata: { preTokens: 2 } }));
  ok('из нескольких сжатий берётся последнее', !!two && two.preTokens === 2);

  if (fails) { console.log(`\n\x1b[31mcompaction-trace self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ compaction-trace: сжатие контекста перестаёт быть невидимым\x1b[0m');
  process.exit(0);
}


// Запасное сравнение по РЕАЛЬНОМУ пути. Сравнение строк врёт: на macOS mktemp -d
// выдаёт путь через симлинк (/var → /private/var), argv[1] несёт путь как набран, а
// import.meta.url — реальный. Сторож молча не срабатывал, скрипт ничего не делал и
// выходил с нулём, поэтому механизм нельзя было прогнать из временной копии — а
// именно этого требует правило красного плеча. Запасная ветка только читает путь:
// ни записи, ни запуска, импорт по-прежнему без последствий.
function sameFileByRealPath(a, b) {
  try { return !!a && realpathSync(a) === realpathSync(b); } catch { return false; }
}
const isMain = process.argv[1] === fileURLToPath(import.meta.url) || sameFileByRealPath(process.argv[1], fileURLToPath(import.meta.url));

if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw || '{}');
      // Умолчание 'PreCompact' было ложью: неизвестное событие записывалось как сжатие.
      // Честное умолчание это 'unknown', а решает не оно, а фильтр ниже.
      const event = process.argv[2] || input.hook_event_name || 'unknown';

      // Журнал сжатий принимает ТОЛЬКО события сжатия. 15 августа сюда попали 6 PreToolUse
      // и 3 Stop от чужой регистрации; с тех пор чужих нет, но защита от повторения стоит
      // здесь, в самом писателе, а не в чужом конфиге, который может смениться снова.
      if (event !== 'PreCompact' && event !== 'PostCompact') { process.exit(0); }

      let record = traceRecord(input, event);
      // Правда о сжатии лежит в ТРАНСКРИПТЕ, а не в событии. Читаем хвост: полный файл
      // бывает на сотни мегабайт, а метаданные последнего сжатия всегда в конце.
      if (event === 'PostCompact' && input.transcript_path) {
        try {
          const meta = parseCompactMetadata(хвостТранскрипта(input.transcript_path));
          if (meta) record = { ...record, ...meta, metaSource: 'transcript' };
          else record = { ...record, metaSource: 'not-found' };
        } catch { record = { ...record, metaSource: 'unreadable' }; }
      }
      mkdirSync(dirname(LOG), { recursive: true });
      appendFileSync(LOG, `${JSON.stringify(record)}\n`);
    } catch { /* fail-open: a missing trace line must never break compaction */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}
