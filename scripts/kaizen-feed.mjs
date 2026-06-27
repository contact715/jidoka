#!/usr/bin/env node
// kaizen-feed — feeds the framework's OWN dev-system metrics into the (until now data-starved)
// kaizen-loop. kaizen-loop has FULL logic but DORMANT data: nothing ever fed it the framework's
// numbers. This adapter reads the run-state journals (docs/runs/*/state.json) — real data that
// already exists — and appends one weekly reading per metric to docs/metrics/kaizen-targets.json,
// which kaizen-loop then assesses against its goal.
//
// METRICS (dev-system Kaizen, all "lower is better"):
//   rework_rounds          — # of phases that went to 'failed' in the latest wave (re-work signal)
//   completion_span_hours  — wall-clock from wave start to last journal update (latest complete wave)
//   journaling_lag_hours   — the documented pain made measurable: gap between the wave's LAST journal
//                            event and the LAST git commit touching the wave dir. If commits landed
//                            after the journal went quiet, the journal lagged reality ("lied by
//                            omission"). Needs git; 0 when git is unavailable or the journal is current.
//
// HONEST BOUNDARY: pure metric math is self-tested; journaling_lag uses git in the CLI only.
// Run weekly (routine-weekly.sh), not per-commit — weekly is the granularity kaizen-loop trends on.
//
// Usage:
//   node scripts/kaizen-feed.mjs --self-test
//   node scripts/kaizen-feed.mjs            # compute latest-wave readings, append, assess

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assessOne } from './kaizen-loop.mjs';

const TARGETS_PATH = join('docs', 'metrics', 'kaizen-targets.json');
const DEFAULT_TARGETS = [
  { metric: 'rework_rounds', target: 0, direction: 'down', series: [] },
  { metric: 'completion_span_hours', target: 4, direction: 'down', series: [] },
  { metric: 'journaling_lag_hours', target: 1, direction: 'down', series: [] },
];

// ── pure core ──────────────────────────────────────────────────────
export function reworkRounds(events = []) {
  return events.filter(e => e.status === 'failed').length;
}
export function completionSpanHours(state) {
  const a = Date.parse(state?.createdAt), b = Date.parse(state?.updatedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round(((b - a) / 3.6e6) * 100) / 100;
}
// lag = lastCommitMs − lastEventMs, in hours, floored at 0 (commits before the last journal event
// are not "lag"). Inputs in ms so the math is pure and testable; the CLI supplies real timestamps.
export function journalingLagHours(lastEventMs, lastCommitMs) {
  if (!Number.isFinite(lastEventMs) || !Number.isFinite(lastCommitMs)) return 0;
  return Math.max(0, Math.round(((lastCommitMs - lastEventMs) / 3.6e6) * 100) / 100);
}
// append a reading to a metric's series (find-or-create), capped to the last `cap` readings.
export function appendReading(targets, metric, value, cap = 26) {
  const out = targets.map(t => ({ ...t, series: [...(t.series || [])] }));
  let t = out.find(x => x.metric === metric);
  if (!t) { t = { metric, target: 0, direction: 'down', series: [] }; out.push(t); }
  if (value != null) t.series = [...t.series, value].slice(-cap);
  return out;
}

// ── self-test (deterministic) ──────────────────────────────────────
function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('reworkRounds counts failed events', reworkRounds([{ status: 'done' }, { status: 'failed' }, { status: 'failed' }]) === 2);
  ok('reworkRounds: none → 0', reworkRounds([{ status: 'done' }]) === 0);
  const span = completionSpanHours({ createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T05:30:00Z' });
  ok('completionSpanHours computes wall-clock', span === 5.5);
  ok('completionSpanHours: missing → null', completionSpanHours({}) === null);
  const day = 24 * 3.6e6;
  ok('journalingLagHours: commit after last event → positive lag', journalingLagHours(1000, 1000 + day) === 24);
  ok('journalingLagHours: commit before last event → 0 (not lag)', journalingLagHours(1000 + day, 1000) === 0);
  ok('journalingLagHours: bad input → 0', journalingLagHours(NaN, 5) === 0);
  let t = appendReading(DEFAULT_TARGETS, 'rework_rounds', 2);
  ok('appendReading adds to the right series', t.find(x => x.metric === 'rework_rounds').series.at(-1) === 2);
  ok('appendReading does not mutate the input', DEFAULT_TARGETS.find(x => x.metric === 'rework_rounds').series.length === 0);
  ok('appendReading creates a missing metric', appendReading([], 'new_metric', 1).find(x => x.metric === 'new_metric').series.length === 1);
  ok('appendReading caps the series length', appendReading([{ metric: 'm', series: Array(30).fill(1) }], 'm', 9, 26).find(x => x.metric === 'm').series.length === 26);
  if (fails.length) { console.log(`\n\x1b[31mkaizen-feed self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-feed: metric math + series feed correct\x1b[0m');
  process.exit(0);
}

// ── CLI ────────────────────────────────────────────────────────────
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const ROOT = process.cwd();
  const runsDir = join(ROOT, 'docs', 'runs');
  if (!existsSync(runsDir)) { console.log('no docs/runs — nothing to feed'); process.exit(0); }

  // latest wave journal by updatedAt
  const waves = readdirSync(runsDir).filter(d => existsSync(join(runsDir, d, 'state.json')))
    .map(d => ({ d, s: JSON.parse(readFileSync(join(runsDir, d, 'state.json'), 'utf8')) }))
    .sort((a, b) => (a.s.updatedAt < b.s.updatedAt ? 1 : -1));
  if (!waves.length) { console.log('no run-state journals — nothing to feed'); process.exit(0); }
  const { d: wave, s: state } = waves[0];
  const events = state.events || [];

  // journaling lag via git: last commit touching the wave dir vs last journal event
  let lastCommitMs = NaN;
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', join('docs', 'runs', wave)], { cwd: ROOT, encoding: 'utf8' }).trim();
    lastCommitMs = Date.parse(iso);
  } catch { /* no git / no commits — lag stays 0 */ }
  const lastEventMs = Date.parse(events.at(-1)?.at) || Date.parse(state.updatedAt);

  const readings = {
    rework_rounds: reworkRounds(events),
    completion_span_hours: completionSpanHours(state),
    journaling_lag_hours: journalingLagHours(lastEventMs, lastCommitMs),
  };

  let targets = existsSync(join(ROOT, TARGETS_PATH))
    ? (JSON.parse(readFileSync(join(ROOT, TARGETS_PATH), 'utf8')).targets || DEFAULT_TARGETS)
    : DEFAULT_TARGETS;
  for (const [m, v] of Object.entries(readings)) targets = appendReading(targets, m, v);

  mkdirSync(join(ROOT, 'docs', 'metrics'), { recursive: true });
  writeFileSync(join(ROOT, TARGETS_PATH), JSON.stringify({ targets, updatedAt: new Date().toISOString(), source: 'kaizen-feed (run-state journals)' }, null, 2) + '\n');

  console.log(`kaizen-feed · latest wave: ${wave}`);
  for (const [m, v] of Object.entries(readings)) console.log(`  ${m}: ${v}`);
  console.log('\n  kaizen-loop verdict:');
  for (const t of targets) {
    const a = assessOne(t);
    console.log(`   · ${a.metric}: ${a.status} (${a.trend}) — ${a.recommendation}`);
  }
  process.exit(0);
}
