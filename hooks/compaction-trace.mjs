#!/usr/bin/env node
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

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

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

  if (fails) { console.log(`\n\x1b[31mcompaction-trace self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ compaction-trace: сжатие контекста перестаёт быть невидимым\x1b[0m');
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const event = process.argv[2] || input.hook_event_name || 'PreCompact';
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, `${JSON.stringify(traceRecord(input, event))}\n`);
  } catch { /* fail-open: a missing trace line must never break compaction */ }
  process.exit(0);
});
setTimeout(() => process.exit(0), 3000);
