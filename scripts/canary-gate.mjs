#!/usr/bin/env node
// canary-gate — promote, hold, or auto-rollback a canary deployment by comparing its
// key metrics against a baseline. Uses compute-slos.mjs concepts but generalized to any
// metric: errorRate, p95ms, throughput, etc. A regression beyond maxRegressionPct triggers
// ROLLBACK; within a tolerance window → HOLD (gather more data); otherwise → PROMOTE.
//
// decision: { action: 'PROMOTE'|'HOLD'|'ROLLBACK', reasons, regressions }
//
// Usage:
//   node scripts/canary-gate.mjs --self-test
//   node scripts/canary-gate.mjs --baseline '{"errorRate":0.01,"p95ms":200}' --canary '{"errorRate":0.05,"p95ms":210}'

export function decide(baseline = {}, canary = {}, { maxRegressionPct = 20, holdBand = 5 } = {}) {
  const regressions = [];
  for (const [k, bv] of Object.entries(baseline)) {
    const cv = canary[k];
    if (cv === undefined || bv === 0) continue;
    const pct = ((cv - bv) / Math.abs(bv)) * 100;
    const isHigherWorse = !['rps', 'throughput', 'successRate'].includes(k); // lower is worse for perf/error metrics
    const regressed = isHigherWorse ? pct > holdBand : pct < -holdBand;
    if (regressed) {
      regressions.push({ metric: k, baseline: bv, canary: cv, changePct: +pct.toFixed(1) });
    }
  }
  const maxReg = Math.max(0, ...regressions.map((r) => Math.abs(r.changePct)));
  if (regressions.length === 0) return { action: 'PROMOTE', regressions, reasons: ['all metrics within hold band'] };
  if (maxReg > maxRegressionPct) return { action: 'ROLLBACK', regressions, reasons: [`regression ${maxReg.toFixed(1)}% > threshold ${maxRegressionPct}%`] };
  return { action: 'HOLD', regressions, reasons: [`regression ${maxReg.toFixed(1)}% is within [${holdBand}%, ${maxRegressionPct}%] — gather more data`] };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('identical metrics → PROMOTE', decide({ errorRate: 0.01 }, { errorRate: 0.01 }).action === 'PROMOTE');
  ok('tiny improvement → PROMOTE', decide({ errorRate: 0.01 }, { errorRate: 0.009 }).action === 'PROMOTE');
  ok('large error regression → ROLLBACK', decide({ errorRate: 0.01 }, { errorRate: 0.05 }).action === 'ROLLBACK');
  ok('small regression in hold band → HOLD', decide({ errorRate: 0.01 }, { errorRate: 0.012 }).action === 'HOLD');
  ok('ROLLBACK carries the regression detail', (() => {
    const r = decide({ errorRate: 0.01, p95ms: 200 }, { errorRate: 0.05, p95ms: 300 });
    return r.action === 'ROLLBACK' && r.regressions.length >= 1;
  })());
  ok('throughput drop triggers ROLLBACK (lower is worse)', decide({ rps: 1000 }, { rps: 500 }, { maxRegressionPct: 20 }).action === 'ROLLBACK');
  // 0.04/0.01 = 300% change, maxReg=50% → ROLLBACK (300 > 50)
  // test HOLD: 15% change with maxReg=20%, holdBand=5% → in [5,20] → HOLD
  ok('custom threshold respected (15% change, maxReg=20% → HOLD)', decide({ errorRate: 0.01 }, { errorRate: 0.0115 }, { maxRegressionPct: 20, holdBand: 5 }).action === 'HOLD');
  ok('missing canary metric is skipped (no false rollback)', decide({ errorRate: 0.01, p95ms: 200 }, { errorRate: 0.01 }).action === 'PROMOTE');

  if (fails.length) { console.log(`\n\x1b[31mcanary-gate self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ canary-gate: promote/hold/rollback decision correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const baseline = JSON.parse(arg('--baseline') || '{}');
  const canary = JSON.parse(arg('--canary') || '{}');
  const maxReg = arg('--max-regression') ? parseInt(arg('--max-regression'), 10) : 20;
  const r = decide(baseline, canary, { maxRegressionPct: maxReg });
  const colour = { PROMOTE: '\x1b[32m', HOLD: '\x1b[33m', ROLLBACK: '\x1b[31m' }[r.action];
  console.log(`${colour}${r.action}\x1b[0m — ${r.reasons.join('; ')}`);
  if (r.regressions.length) r.regressions.forEach((reg) => console.log(`  ${reg.metric}: baseline=${reg.baseline} canary=${reg.canary} (${reg.changePct > 0 ? '+' : ''}${reg.changePct}%)`));
  process.exit(r.action === 'ROLLBACK' ? 1 : 0);
}
