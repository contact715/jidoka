#!/usr/bin/env node
// horizon-length — how long a stretch of work the system finishes WITHOUT a human.
//
// THE GAP (2026-W33-Q1, from Stanford CS329A lecture 17 / the METR long-task line of work).
// Every number this engine publishes measures DISCIPLINE: adoption rate, gate coverage, eval pass
// rate, regression rate. All of them can be perfect while the system still cannot be left alone
// for ten minutes. Nothing measures AUTONOMY — the length of task the machine carries to the end
// by itself — and autonomy is the axis the owner actually feels.
//
// DEFINITION, deliberately narrow and deterministic. A HUMAN TOUCHPOINT is an `interrupt` event:
// the run parked and waited for a person (checkpoint.mjs records these). A HORIZON is the run of
// work between two touchpoints. Its length is measured two ways, because either alone misleads:
//   nodes   — how many steps were carried
//   minutes — how much wall-clock they spanned
// Ten trivial nodes in one minute is not the same autonomy as one node over an hour, and a single
// number would hide whichever half is inconvenient.
//
// WHAT THIS IS NOT. It does not judge whether the work was GOOD — `agent-benchmark` does that.
// A long horizon of wrong work is a long horizon; the two metrics are meant to be read together,
// and collapsing them into one "autonomy score" would let each hide the other's failure.
//
// HONEST STATE: with no interrupt-bearing logs on disk this reports DORMANT, never zero and never
// "infinite autonomy". No data is not a measurement.
//
// FULL & self-tested. Usage:
//   node scripts/horizon-length.mjs --self-test
//   node scripts/horizon-length.mjs [--wave <id>]

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEvents } from './checkpoint.mjs';

const STORE = process.env.CHECKPOINT_LOG || join(homedir(), '.jidoka', 'checkpoints');
const MS_PER_MIN = 60_000;

/**
 * Split an event stream into horizons at every human touchpoint. Pure.
 * Events are expected in the order they were appended.
 * @returns {Array<{nodes:number, minutes:number|null, endedBy:'interrupt'|'end'}>}
 */
export function horizons(events = []) {
  const out = [];
  let run = [];
  const close = (endedBy) => {
    if (!run.length) return;
    const stamps = run.map((e) => Date.parse(e.ts)).filter((n) => Number.isFinite(n));
    const minutes = stamps.length >= 2
      ? Math.round(((Math.max(...stamps) - Math.min(...stamps)) / MS_PER_MIN) * 10) / 10
      : null;
    out.push({ nodes: run.length, minutes, endedBy });
    run = [];
  };
  for (const e of events) {
    if (e.status === 'interrupt') { close('interrupt'); continue; }  // the touchpoint itself is not work
    run.push(e);
  }
  close('end');
  return out;
}

const median = (xs) => {
  const v = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
};

/**
 * Summarise autonomy across runs. Pure.
 * An empty input is DORMANT: no data is not "infinite autonomy" and not zero either.
 */
export function summarise(allEvents = []) {
  const hs = allEvents.flatMap((events) => horizons(events));
  if (!hs.length) {
    return { state: 'dormant', horizons: 0, maxNodes: null, medianNodes: null, maxMinutes: null, medianMinutes: null,
      reason: 'журналов с событиями нет: это НЕ «бесконечная автономия» и НЕ ноль, это «не измерено»' };
  }
  const touchpoints = hs.filter((h) => h.endedBy === 'interrupt').length;
  return {
    state: 'measured',
    horizons: hs.length,
    touchpoints,
    maxNodes: Math.max(...hs.map((h) => h.nodes)),
    medianNodes: median(hs.map((h) => h.nodes)),
    maxMinutes: median([]) === undefined ? null : Math.max(...hs.map((h) => h.minutes ?? 0)) || null,
    medianMinutes: median(hs.map((h) => h.minutes)),
    reason: `отрезков автономной работы: ${hs.length}, из них прерваны человеком ${touchpoints}`,
  };
}

function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const at = (min) => new Date(Date.UTC(2026, 7, 15, 10, min)).toISOString();
  const done = (node, min) => ({ node, status: 'done', ts: at(min) });
  const stop = (node, min) => ({ node, status: 'interrupt', ts: at(min) });

  ok('a run with no touchpoint is ONE horizon', horizons([done('a', 0), done('b', 5)]).length === 1);
  ok('its length counts the nodes carried', horizons([done('a', 0), done('b', 5)])[0].nodes === 2);
  ok('and the wall-clock it spanned', horizons([done('a', 0), done('b', 5)])[0].minutes === 5);
  ok('an interrupt splits the stream in two',
    horizons([done('a', 0), stop('b', 5), done('c', 10)]).length === 2);
  // the touchpoint is the boundary, not work the machine did alone
  ok('the interrupt event itself is not counted as autonomous work',
    horizons([done('a', 0), stop('b', 5), done('c', 10)])[0].nodes === 1);
  ok('the horizon that was interrupted says so',
    horizons([done('a', 0), stop('b', 5), done('c', 10)])[0].endedBy === 'interrupt');
  ok('the final stretch is marked as simply ended, not interrupted',
    horizons([done('a', 0), stop('b', 5), done('c', 10)])[1].endedBy === 'end');
  ok('back-to-back interrupts do not invent empty horizons',
    horizons([stop('a', 0), stop('b', 1)]).length === 0);
  ok('a single event has no span, and that is null rather than 0',
    horizons([done('a', 0)])[0].minutes === null);

  const s = summarise([[done('a', 0), done('b', 10)], [done('c', 0), stop('d', 3), done('e', 9)]]);
  ok('summary counts every horizon across runs', s.horizons === 3);
  ok('it reports the LONGEST stretch in nodes', s.maxNodes === 2);
  ok('it counts how often a human had to step in', s.touchpoints === 1);
  // both axes are kept: ten trivial nodes in a minute is not one node over an hour
  ok('nodes and minutes are reported separately, never merged',
    typeof s.medianNodes === 'number' && 'medianMinutes' in s);

  const empty = summarise([]);
  ok('no logs → DORMANT, never zero and never infinite', empty.state === 'dormant' && empty.maxNodes === null);
  ok('the dormant reason says it is unmeasured', /не измерено/.test(empty.reason));

  if (fails) { console.log(`\n\x1b[31mhorizon-length self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ horizon-length: autonomy measured in nodes AND minutes; no data reads as DORMANT\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const waves = existsSync(STORE)
    ? readdirSync(STORE).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''))
    : [];
  const all = waves.map((w) => loadEvents(w, STORE).events).filter((e) => e.length);
  const s = summarise(all);
  console.log('horizon-length — сколько система проходит БЕЗ человека\n');
  if (s.state === 'dormant') {
    console.log(`  \x1b[33mDORMANT\x1b[0m — ${s.reason}`);
    console.log('  Метрика оживает сама, как только прогоны начнут писать события через checkpoint.mjs.');
    console.log('  Ноль здесь печатать нельзя: он читался бы как «автономии нет», а на деле её просто не мерили.');
    process.exit(0);
  }
  console.log(`  отрезков: ${s.horizons} · вмешательств человека: ${s.touchpoints}`);
  console.log(`  самый длинный: ${s.maxNodes} узл(ов), ${s.maxMinutes ?? '?'} мин · медиана: ${s.medianNodes} узл(ов), ${s.medianMinutes ?? '?'} мин`);
  console.log('\n  \x1b[2mЭто мера ДЛИНЫ, а не качества. Смотреть вместе с agent-benchmark: длинный отрезок неверной работы остаётся длинным.\x1b[0m');
  process.exit(0);
}
