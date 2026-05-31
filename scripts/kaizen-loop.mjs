#!/usr/bin/env node
// kaizen-loop — closes the Product Kaizen loop: a real metric's trend → compared to the North Star
// goal → verdict (on-track / stalled / diverging / achieved) → recommendation. "Diverging" is a
// product-level andon: either the feature is not serving the North Star, or the goal needs a
// deliberate revisit. This is the data-driven counterpart to the North Star prose: the prose says
// where we are going, this says whether the numbers are actually getting there.
//
// HONEST SPLIT: the LOGIC (trend vs goal direction) is FULL & self-tested. The DATA — a product's
// real metric series — is DORMANT here: it is wired in the product (data-analyst feeds the
// measurements from the product's analytics into a kaizen-targets.json). This script is the
// mechanism; the product supplies the numbers. Without numbers it has nothing to assess, by design.
//
// FULL logic / DORMANT data. Usage:
//   node scripts/kaizen-loop.mjs --self-test
//   node scripts/kaizen-loop.mjs --targets <product>/docs/kaizen-targets.json

import { readFileSync, existsSync } from 'node:fs';

// trend of a numeric series: 'up' | 'down' | 'flat' (5% tolerance band → flat)
export function trend(series) {
  if (!Array.isArray(series) || series.length < 2) return 'flat';
  const first = series[0], last = series[series.length - 1];
  const scale = Math.max(Math.abs(first), 1);
  if (Math.abs(last - first) / scale < 0.05) return 'flat';
  return last - first > 0 ? 'up' : 'down';
}

// assess one target. `direction` is the DESIRED trend: 'down' to reduce a metric, 'up' to grow it.
export function assessOne(t) {
  if (!Array.isArray(t.series) || t.series.length === 0) return { metric: t.metric, status: 'no-data', trend: 'n/a', recommendation: "no measurements yet — the product's data-analyst must feed the series before this can be assessed (DORMANT)" };
  if (t.series.length === 1) return { metric: t.metric, status: 'baseline', trend: 'first reading', recommendation: `baseline recorded (${t.series[0]}) — feed a 2nd reading to assess the trend toward ${t.target}` };
  const tr = trend(t.series);
  const last = t.series.at(-1);
  const reached = t.direction === 'down' ? last <= t.target : last >= t.target;
  if (reached) return { metric: t.metric, status: 'achieved', trend: tr, recommendation: 'hold the gain; consider raising the bar' };
  if (tr === 'flat') return { metric: t.metric, status: 'stalled', trend: tr, recommendation: 'investigate — no movement toward the goal' };
  return tr === t.direction
    ? { metric: t.metric, status: 'on-track', trend: tr, recommendation: 'continue' }
    : { metric: t.metric, status: 'diverging', trend: tr, recommendation: 'product-andon: the feature is not serving the North Star, or the goal needs a deliberate revisit (logged, not silent)' };
}

export function assess(targets) {
  const results = (targets || []).map(assessOne);
  const diverging = results.filter(r => r.status === 'diverging').length;
  return { results, diverging, anyAndon: diverging > 0 };
}

function selfTest() {
  const targets = [
    { metric: 'missed_leads', direction: 'down', target: 0, series: [30, 25, 18] },   // on-track
    { metric: 'revenue', direction: 'up', target: 200, series: [100, 120, 150] },      // on-track
    { metric: 'conversion', direction: 'up', target: 30, series: [20, 15, 10] },       // diverging
    { metric: 'response_time', direction: 'down', target: 1, series: [50, 50, 50] },   // stalled
    { metric: 'nps', direction: 'up', target: 50, series: [40, 48, 55] },              // achieved
    { metric: 'unmeasured', direction: 'up', target: 10, series: [] },                 // no-data (DORMANT)
    { metric: 'firstrun', direction: 'up', target: 100, series: [96] },                // baseline (1 reading)
  ];
  const a = assess(targets);
  const by = Object.fromEntries(a.results.map(r => [r.metric, r.status]));
  const T = [
    ['trend detects down', trend([30, 18]) === 'down'],
    ['trend detects up', trend([100, 150]) === 'up'],
    ['trend detects flat', trend([50, 50, 50]) === 'flat'],
    ['metric improving toward goal → on-track', by.missed_leads === 'on-track'],
    ['growth metric rising → on-track', by.revenue === 'on-track'],
    ['metric moving AWAY from goal → diverging', by.conversion === 'diverging'],
    ['no movement → stalled', by.response_time === 'stalled'],
    ['target reached → achieved', by.nps === 'achieved'],
    ['empty series → no-data (not a false stall)', by.unmeasured === 'no-data'],
    ['single reading → baseline (not a false stall)', by.firstrun === 'baseline'],
    ['a diverging metric raises a product-andon', a.anyAndon === true],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mkaizen-loop self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-loop: metric-vs-goal assessment correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const tp = arg('--targets');
  if (!tp || !existsSync(tp)) {
    console.error('usage: --targets <kaizen-targets.json>  { "product": "...", "targets": [ { "metric","direction":"up|down","target",series:[...] } ] }');
    console.error('  (DORMANT until a product supplies real measurements — the product\'s data-analyst writes this file)');
    process.exit(2);
  }
  const cfg = JSON.parse(readFileSync(tp, 'utf8'));
  const a = assess(cfg.targets);
  console.log(`kaizen-loop: ${cfg.product || 'product'} — ${a.results.length} metric(s) vs North Star goal`);
  for (const r of a.results) {
    const icon = { 'on-track': '🟢', achieved: '✅', stalled: '🟡', diverging: '🔴' }[r.status] || '·';
    console.log(`  ${icon} ${r.metric}: ${r.status} (trend ${r.trend}) → ${r.recommendation}`);
  }
  if (a.anyAndon) { console.error(`\n\x1b[31m✗ product-andon: ${a.diverging} metric(s) diverging from the North Star — revisit the feature or the goal (do not ignore).\x1b[0m`); process.exit(1); }
  const noData = a.results.filter(r => r.status === 'no-data').length;
  if (noData === a.results.length && noData > 0) { console.log('\n\x1b[33m○ no measurements yet for any metric (DORMANT) — the mechanism is ready; wire the product data to start assessing.\x1b[0m'); process.exit(0); }
  if (noData) console.log(`\n\x1b[33m○ ${noData}/${a.results.length} metric(s) have no data yet (DORMANT).\x1b[0m`);
  console.log('\x1b[32m✓ measured metrics are moving toward the North Star (or already there).\x1b[0m');
  process.exit(0);
}
