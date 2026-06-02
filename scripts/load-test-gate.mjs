#!/usr/bin/env node
// load-test-gate — assert latency/error/throughput SLOs against load-test results.
// HONEST split: threshold logic + result-scoring is FULL & self-tested here.
// The actual k6/artillery/wrk execution is the product's CI job (DORMANT here) — exactly
// like agent-benchmark (FULL scoring / DORMANT live agent run).
//
// results: { p50ms, p95ms, p99ms, errorRate (0..1), rps }
// thresholds: same shape — each is a MAX (except rps which is MIN)
//
// Usage:
//   node scripts/load-test-gate.mjs --self-test
//   node scripts/load-test-gate.mjs --results '{"p50ms":80,"p95ms":400,"errorRate":0.01,"rps":200}'

export const DEFAULTS = { p50ms: 100, p95ms: 500, p99ms: 1000, errorRate: 0.01, rps: 100 };

export function assess(results = {}, thresholds = DEFAULTS) {
  const violations = [];
  const check = (k, actual, max, isMin = false) => {
    if (actual === undefined) return;
    const breached = isMin ? actual < max : actual > max;
    if (breached) violations.push({ metric: k, actual, threshold: max, direction: isMin ? 'below_min' : 'above_max' });
  };
  check('p50ms', results.p50ms, thresholds.p50ms ?? DEFAULTS.p50ms);
  check('p95ms', results.p95ms, thresholds.p95ms ?? DEFAULTS.p95ms);
  check('p99ms', results.p99ms, thresholds.p99ms ?? DEFAULTS.p99ms);
  check('errorRate', results.errorRate, thresholds.errorRate ?? DEFAULTS.errorRate);
  check('rps', results.rps, thresholds.rps ?? DEFAULTS.rps, true); // rps: MIN threshold
  return { ok: violations.length === 0, violations };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('healthy results pass', assess({ p50ms: 50, p95ms: 200, p99ms: 400, errorRate: 0.005, rps: 300 }).ok === true);
  ok('p95 breach is caught', assess({ p95ms: 600 }).violations.some((v) => v.metric === 'p95ms'));
  ok('error rate breach is caught', assess({ errorRate: 0.05 }).violations.some((v) => v.metric === 'errorRate'));
  ok('rps below minimum is caught', assess({ rps: 50 }).violations.some((v) => v.metric === 'rps' && v.direction === 'below_min'));
  ok('multiple violations accumulate', assess({ p95ms: 1000, errorRate: 0.1, rps: 10 }).violations.length === 3);
  ok('missing metrics are skipped (not a false violation)', assess({}).ok === true);
  ok('custom thresholds override defaults', assess({ p95ms: 250 }, { p95ms: 200 }).violations.length === 1);

  if (fails.length) { console.log(`\n\x1b[31mload-test-gate self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ load-test-gate: latency/error/throughput assessment correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const results = JSON.parse(arg('--results') || '{}');
  const thr = arg('--thresholds') ? JSON.parse(arg('--thresholds')) : DEFAULTS;
  const r = assess(results, thr);
  if (!r.ok) {
    console.error(`\x1b[31m✗ load-test-gate: ${r.violations.length} SLO violation(s):\x1b[0m`);
    r.violations.forEach((v) => console.error(`  ${v.metric}: ${v.actual} (threshold ${v.direction === 'below_min' ? '>=' : '<='} ${v.threshold})`));
    console.log('\nNOTE: this gate scores results you provide. Live load runs (k6/artillery) run in your product CI — see DORMANT boundary in file header.');
    process.exit(1);
  }
  console.log('\x1b[32m✓ load-test-gate: all SLOs met\x1b[0m');
  process.exit(0);
}
