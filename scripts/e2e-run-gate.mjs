#!/usr/bin/env node
// e2e-run-gate — score a set of E2E / integration-test results and gate on failures.
// HONEST split: the scoring + gating logic is FULL & self-tested. The actual Playwright/Cypress
// run is the product's CI job (DORMANT here) — same pattern as load-test-gate and agent-benchmark.
//
// results: [{ flow, passed, durationMs?, error? }]
// A flow is a named user journey ("user can sign in", "checkout completes", etc.)
//
// Usage:
//   node scripts/e2e-run-gate.mjs --self-test
//   node scripts/e2e-run-gate.mjs --results '[{"flow":"checkout","passed":true}]'

export function assess(results = [], { maxFailedFlows = 0 } = {}) {
  const failed = results.filter((r) => !r.passed);
  const passed = results.length - failed.length;
  const passPct = results.length ? Math.round((100 * passed) / results.length) : 100;
  return {
    total: results.length, passed, failed: failed.length,
    passPct, failedFlows: failed.map((r) => ({ flow: r.flow, error: r.error || 'failed' })),
    ok: failed.length <= maxFailedFlows,
  };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('all passing → ok', assess([{ flow: 'login', passed: true }, { flow: 'checkout', passed: true }]).ok === true);
  ok('one failure → not ok (default maxFailedFlows=0)', assess([{ flow: 'login', passed: false }]).ok === false);
  ok('failure details captured', assess([{ flow: 'login', passed: false, error: 'timeout' }]).failedFlows[0]?.error === 'timeout');
  ok('passPct calculated correctly (2 of 3)', assess([{ flow: 'a', passed: true }, { flow: 'b', passed: true }, { flow: 'c', passed: false }]).passPct === 67);
  ok('maxFailedFlows=1 allows one failure', assess([{ flow: 'flaky', passed: false }], { maxFailedFlows: 1 }).ok === true);
  ok('empty results → ok', assess([]).ok === true && assess([]).passPct === 100);

  if (fails.length) { console.log(`\n\x1b[31me2e-run-gate self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ e2e-run-gate: E2E flow scoring correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const results = JSON.parse(arg('--results') || '[]');
  const max = parseInt(arg('--max-failed') || '0', 10);
  const r = assess(results, { maxFailedFlows: max });
  console.log(`e2e-run-gate: ${r.passed}/${r.total} flows passed (${r.passPct}%)`);
  if (!r.ok) {
    console.error(`\x1b[31m✗ ${r.failed} flow(s) failed:\x1b[0m`);
    r.failedFlows.forEach((f) => console.error(`  [FAIL] ${f.flow}: ${f.error}`));
    console.log('\nNOTE: this gate scores results you provide. Live E2E runs (Playwright/Cypress) run in your product CI — see DORMANT boundary in file header.');
    process.exit(1);
  }
  console.log('\x1b[32m✓ e2e-run-gate: all flows passed\x1b[0m');
  process.exit(0);
}
