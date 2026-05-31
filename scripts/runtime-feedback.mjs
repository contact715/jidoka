#!/usr/bin/env node
// runtime-feedback — closes the Product Kaizen loop on REALITY. A deployed product emits runtime
// events (metric readings + incidents); this routes them:
//   • metric events  → append the value to the matching kaizen-targets series, so kaizen-loop can
//                       finally assess trend-vs-North-Star on REAL numbers (not synthetic).
//   • incident events → a lesson candidate for the meta-engine (production incident → meta-log).
// This is what turns "the product improves every day" from a document into a data loop.
//
// HONEST SPLIT: the routing/ingest logic is FULL & self-tested. The DATA — the real event stream
// from production — is DORMANT until the product's data-analyst wires its analytics/error tracker
// to emit events.jsonl. Mechanism here; the stream comes from the running product.
//
// FULL logic / DORMANT data. Usage:
//   node scripts/runtime-feedback.mjs --self-test
//   node scripts/runtime-feedback.mjs --events <events.jsonl> --targets <kaizen-targets.json>

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// append a real reading to the matching metric's series
export function applyMetric(targets, metric, value) {
  const t = targets.find(x => x.metric === metric);
  if (!t) return { applied: false, targets };
  return { applied: true, targets: targets.map(x => x.metric === metric ? { ...x, series: [...(x.series || []), value] } : x) };
}

// a production incident becomes a meta-engine lesson candidate
export function incidentToLesson(inc) {
  return { class: inc.class || 'runtime-incident', claimed: 'the product ran correctly in production', real: inc.summary || '(no summary)', caught_by: 'runtime' };
}

// route one event
export function ingest(event, targets) {
  if (event.type === 'metric') return { kind: 'metric', ...applyMetric(targets, event.metric, event.value) };
  if (event.type === 'incident') return { kind: 'incident', lesson: incidentToLesson(event) };
  return { kind: 'unknown' };
}

function selfTest() {
  const targets = [{ metric: 'missed_leads', direction: 'down', target: 0, series: [30] }];
  const m = ingest({ type: 'metric', metric: 'missed_leads', value: 22 }, targets);
  const unknown = ingest({ type: 'metric', metric: 'nope', value: 1 }, targets);
  const inc = ingest({ type: 'incident', class: 'payment-fail', summary: 'checkout 500ed for 12m' }, targets);
  const T = [
    ['metric event appends to the series', JSON.stringify(m.targets[0].series) === JSON.stringify([30, 22])],
    ['metric event is marked applied', m.applied === true],
    ['unknown metric is not applied (no silent create)', unknown.applied === false],
    ['incident routes to a lesson', inc.kind === 'incident' && inc.lesson.class === 'payment-fail'],
    ['incident summary becomes the real-vs-claimed', inc.lesson.real.includes('checkout 500')],
    ['lesson is attributed to runtime', inc.lesson.caught_by === 'runtime'],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mruntime-feedback self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ runtime-feedback: event routing correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const eventsPath = arg('--events'), targetsPath = arg('--targets');
  if (!eventsPath || !existsSync(eventsPath)) {
    console.error('usage: --events <events.jsonl> --targets <kaizen-targets.json>');
    console.error('  DORMANT until the product emits events. Wire its analytics/error tracker to append events.jsonl');
    console.error('  ({"type":"metric","metric":"...","value":N} or {"type":"incident","class":"...","summary":"..."}).');
    process.exit(2);
  }
  const events = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  let targets = targetsPath && existsSync(targetsPath) ? JSON.parse(readFileSync(targetsPath, 'utf8')) : { targets: [] };
  let applied = 0, lessons = [];
  for (const e of events) {
    const r = ingest(e, targets.targets || []);
    if (r.kind === 'metric' && r.applied) { targets.targets = r.targets; applied++; }
    if (r.kind === 'incident') lessons.push(r.lesson);
  }
  if (targetsPath) { targets.data_status = `live — ${applied} reading(s) ingested from runtime`; writeFileSync(targetsPath, JSON.stringify(targets, null, 2) + '\n'); }
  console.log(`runtime-feedback: ${applied} metric reading(s) → ${targetsPath || '(no targets)'}, ${lessons.length} incident(s) → lessons`);
  for (const l of lessons) console.log(`  · incident → node scripts/meta-log.mjs ${l.class} "${l.claimed}" "${l.real}" runtime`);
  if (applied) console.log('  → now run kaizen-loop on the targets to assess trend-vs-North-Star on real data.');
  process.exit(0);
}
