#!/usr/bin/env node
// kaizen-dispatch — the missing step between "the owner said yes" and "the work happened".
//
// approved-to-work-bridge (2026-W32-K2)
//
// THE MEASURED PROBLEM. Adoption of the weekly plan, per cohort, on 2026-08-03:
//
//   W27  8 recommendations  6 shipped   75%
//   W28 13                  4           33%
//   W29 10                  5           50%
//   W30 10                  0            0%
//   W31 18                  1            6%
//
// Two consecutive weeks at effectively zero, 26 open items from those two cohorts alone. The
// engine is not short of ideas; it is short of the step that turns an approved idea into work
// somebody actually pulls. A plan lived in a markdown report, the approval lived in a chat
// message, and the queue that drives autonomous sessions stayed empty.
//
// THE BRIDGE. Three registries already existed and were never connected:
//   _KAIZEN_LEDGER.jsonl  what was recommended and what happened to it
//   approval-queue.mjs    the human decides, with a decision log
//   task-queue.mjs        strictly serial work, one task in flight
// This script is the adapter, not a fourth registry. Approved recommendations become queued
// tasks carrying the prompt and the repo, so the next autonomous session pulls them one at a
// time. Nothing here decides anything: the owner's approval is the input.
//
// Zero dependencies. Usage:
//   node scripts/kaizen-dispatch.mjs --self-test
//   node scripts/kaizen-dispatch.mjs plan --week 2026-W32            # what WOULD be dispatched
//   node scripts/kaizen-dispatch.mjs dispatch --ids W32-K1,W32-R6    # queue those, by owner's yes
//   node scripts/kaizen-dispatch.mjs dispatch --week 2026-W32 --all  # queue every open item of a week
//   node scripts/kaizen-dispatch.mjs status                          # queued vs open, per week

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'docs/research/weekly/_KAIZEN_LEDGER.jsonl');

// ── pure core ────────────────────────────────────────────────────────────────

export const isDispatchable = (e) => !!e && e.status !== 'shipped' && e.status !== 'rejected';

/** Match an id loosely: "W32-K1" finds "2026-W32-K1". Pure. */
export const idMatches = (entry, wanted) => {
  const a = String(entry.id || '');
  const b = String(wanted || '').trim();
  return a === b || a.endsWith(`-${b}`) || a.endsWith(b);
};

/**
 * Turn a ledger entry into a queue task. The prompt has to stand alone: the session that pulls
 * it will not have this conversation, so it carries the id, the point of integration and the
 * standing rules that decide whether the work counts as done. Pure.
 */
export function taskFromEntry(entry, { repo = ROOT } = {}) {
  const poi = entry.pointOfIntegration || '(не указана)';
  const [file, anchor] = String(poi).split('#');
  const prompt = [
    `Внедрить пункт плана Kaizen ${entry.id}: ${entry.title}`,
    '',
    `Точка встройки: ${poi}`,
    anchor
      ? `Это форма путь#якорь. После внедрения файл ${file} обязан СОДЕРЖАТЬ строку "${anchor}" — по ней kaizen-audit проверяет способность, а не наличие файла. Без якоря пункт останется открытым, даже если код написан.`
      : 'Точка встройки задана путём. Если правка меняет СОДЕРЖИМОЕ существующего файла, переведи её в форму путь#якорь, иначе аудит зачтёт пункт отгруженным до написания кода.',
    '',
    'Обязательные условия приёмки:',
    '- исполняемое доказательство в том же ходе: самотест или живой прогон с показанным выводом;',
    '- негативный случай: показать, что механизм ЛОВИТ то, ради чего сделан, а не только пропускает;',
    '- гейты проходятся честно, обход запрещён;',
    '- если это меняет то, КАК мы работаем, запись идёт в оба места: движок и ~/.claude;',
    '- после внедрения прогнать: node scripts/kaizen-audit.mjs --repo . и убедиться, что пункт стал shipped.',
    '',
    `Приоритет: ${entry.priority || 'не задан'}. Оценка усилий: ${entry.effort || 'не задана'}.`,
  ].join('\n');
  return { title: `[${entry.id}] ${entry.title}`, prompt, repo };
}

/** What a dispatch would do, without doing it. Pure. */
export function planDispatch(entries, { week = null, ids = null, all = false } = {}) {
  let pool = entries.filter(isDispatchable);
  if (week) pool = pool.filter(e => e.week === week);
  if (ids && ids.length) pool = pool.filter(e => ids.some(w => idMatches(e, w)));
  else if (!all) pool = [];
  // P0 first, then P1, then the rest; stable within a priority
  const rank = (p) => ({ P0: 0, P1: 1, P2: 2 }[p] ?? 3);
  return [...pool].sort((a, b) => rank(a.priority) - rank(b.priority));
}

// ── I/O ──────────────────────────────────────────────────────────────────────
const readLedger = (file = LEDGER) => (existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : []);

function queueAdd(task) {
  const args = ['scripts/task-queue.mjs', 'add', task.title, '--prompt', task.prompt, '--repo', task.repo];
  return execFileSync('node', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const E = [
    { id: '2026-W32-K1', week: '2026-W32', title: 'a', status: 'shipped', priority: 'P1', pointOfIntegration: 'scripts/a.mjs#x' },
    { id: '2026-W32-R6', week: '2026-W32', title: 'b', status: 'open', priority: 'P0', pointOfIntegration: 'scripts/b.mjs#y' },
    { id: '2026-W32-R9', week: '2026-W32', title: 'c', status: 'proposed', priority: 'P1', pointOfIntegration: 'scripts/c.mjs' },
    { id: '2026-W31-P1', week: '2026-W31', title: 'd', status: 'rejected', priority: 'P2', pointOfIntegration: 'scripts/d.mjs' },
    { id: '2026-W31-R2', week: '2026-W31', title: 'e', status: 'open', priority: 'P2', pointOfIntegration: 'scripts/e.mjs' },
  ];

  ok('shipped is not dispatchable', isDispatchable(E[0]) === false);
  ok('rejected is not dispatchable', isDispatchable(E[3]) === false);
  ok('open is dispatchable', isDispatchable(E[1]) === true);
  ok('proposed is dispatchable', isDispatchable(E[2]) === true);

  ok('nothing is dispatched without --ids or --all', planDispatch(E, { week: '2026-W32' }).length === 0);
  const wk = planDispatch(E, { week: '2026-W32', all: true });
  ok('--all takes only the open ones of that week', wk.length === 2);
  ok('P0 is ordered first', wk[0].id === '2026-W32-R6');
  ok('week filter excludes other weeks', wk.every(e => e.week === '2026-W32'));

  ok('short id matches the full one', planDispatch(E, { ids: ['W32-R6'] })[0].id === '2026-W32-R6');
  ok('full id matches too', planDispatch(E, { ids: ['2026-W32-R6'] }).length === 1);
  ok('an already-shipped id dispatches nothing', planDispatch(E, { ids: ['W32-K1'] }).length === 0);
  ok('an unknown id dispatches nothing', planDispatch(E, { ids: ['W99-Z9'] }).length === 0);

  const t = taskFromEntry(E[1], { repo: '/repo' });
  ok('task title carries the id', t.title.startsWith('[2026-W32-R6]'));
  ok('prompt stands alone: names the point of integration', t.prompt.includes('scripts/b.mjs#y'));
  ok('prompt demands the anchor literally', t.prompt.includes('"y"'));
  ok('prompt demands executable proof', /исполняемое доказательство/.test(t.prompt));
  ok('prompt demands a negative case', /негативный случай/.test(t.prompt));
  ok('prompt forbids bypassing gates', /обход запрещён/.test(t.prompt));
  ok('task carries the repo', t.repo === '/repo');

  const t2 = taskFromEntry(E[2], { repo: '/repo' });
  ok('a bare-path entry is told to convert to path#anchor', /переведи её в форму путь#якорь/.test(t2.prompt));
  ok('bare-path prompt warns about premature shipped', /зачтёт пункт отгруженным до написания кода/.test(t2.prompt));

  if (fails) { console.log(`\n\x1b[31mkaizen-dispatch self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-dispatch: approved recommendations become standalone serial tasks\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('kaizen-dispatch.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const arg = (f, d = null) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d; };
  const cmd = argv[0] || 'status';
  const entries = readLedger();
  const week = arg('--week');
  const ids = arg('--ids') ? arg('--ids').split(',').map(s => s.trim()).filter(Boolean) : null;
  const all = argv.includes('--all');

  if (cmd === 'status') {
    const byWeek = {};
    for (const e of entries.filter(isDispatchable)) (byWeek[e.week] ??= []).push(e);
    const weeks = Object.keys(byWeek).sort();
    if (!weeks.length) { console.log('открытых рекомендаций нет'); process.exit(0); }
    console.log('открытые рекомендации по когортам (кандидаты в очередь):');
    for (const w of weeks) console.log(`  ${w}: ${byWeek[w].length}`);
    console.log('\nчтобы поставить в работу: kaizen-dispatch.mjs dispatch --ids <id,id> | --week <неделя> --all');
    process.exit(0);
  }

  const selected = planDispatch(entries, { week, ids, all });
  if (cmd === 'plan') {
    if (!selected.length) { console.log('нечего ставить в очередь по этому отбору'); process.exit(0); }
    console.log(`будет поставлено в очередь: ${selected.length}`);
    for (const e of selected) console.log(`  ${(e.priority || '--').padEnd(3)} ${e.id}  ${e.title.slice(0, 70)}`);
    process.exit(0);
  }

  if (cmd === 'dispatch') {
    if (!ids && !all) { console.error('отказ: нужен явный --ids <список> или --week <неделя> --all. Одобрение владельца это ВХОД, а не догадка.'); process.exit(2); }
    if (!selected.length) { console.log('нечего ставить в очередь по этому отбору'); process.exit(0); }
    let n = 0;
    for (const e of selected) {
      try { queueAdd(taskFromEntry(e)); n++; console.log(`  → в очередь: ${e.id} ${e.title.slice(0, 60)}`); }
      catch (err) { console.error(`  ✗ ${e.id}: ${err.message.split('\n')[0]}`); }
    }
    console.log(`\nпоставлено задач: ${n}. Веди их по одной: task-queue.mjs next → сделал → safe-commit → done <id>.`);
    process.exit(0);
  }

  console.log('usage: kaizen-dispatch.mjs status | plan | dispatch [--ids a,b | --week W --all]  |  --self-test');
}
