#!/usr/bin/env node
// judge-calibration — beyond a judge's ACCURACY: are the judges in AGREEMENT, and is any judge DRIFTING?
// Anthropic's agent-evals guide calibrates LLM judges. Accuracy alone hides two failure modes: a panel
// that is split (low inter-judge agreement → the verdict is a coin-flip), and a judge whose accuracy is
// falling run over run (drift → silent degradation). This measures both.
//
//   verdictRows: [{ case, judge, verdict }]   (multiple judges over shared cases → inter-judge agreement)
//   accuracySeries: { judge: [acc_run1, acc_run2, ...] }   (per-judge accuracy over runs → drift)
//
// HONEST boundary: agreement is mean pairwise exact-match over shared cases (a simple, transparent
// metric, not Cohen's kappa); drift is the sign of latest-minus-earliest beyond a 5pt band.
//
// FULL & self-tested. Usage:
//   node scripts/judge-calibration.mjs --self-test
//   node scripts/judge-calibration.mjs --verdicts <rows.json> --accuracy <series.json>

import { readFileSync, existsSync } from 'node:fs';

// pure: mean pairwise exact-match agreement across judges, over cases they BOTH judged
export function agreement(verdictRows = []) {
  const byCase = {};
  for (const r of verdictRows) (byCase[r.case] ??= {})[r.judge] = r.verdict;
  let pairs = 0, agree = 0;
  for (const verdicts of Object.values(byCase)) {
    const judges = Object.keys(verdicts);
    for (let i = 0; i < judges.length; i++) for (let j = i + 1; j < judges.length; j++) {
      pairs++;
      if (verdicts[judges[i]] === verdicts[judges[j]]) agree++;
    }
  }
  return pairs ? +(agree / pairs).toFixed(2) : 1; // no pairs (single judge) → vacuously 1
}

// pure: per-judge drift direction from an accuracy series (5pt band = stable)
export function drift(accuracySeries = {}) {
  const out = {};
  for (const [judge, series] of Object.entries(accuracySeries)) {
    if (!Array.isArray(series) || series.length < 2) { out[judge] = 'baseline'; continue; }
    const d = series[series.length - 1] - series[0];
    out[judge] = Math.abs(d) < 5 ? 'stable' : d > 0 ? 'improving' : 'DRIFTING';
  }
  return out;
}

// pure: calibration report + alerts (low agreement OR any drifting judge)
export function calibrate({ verdictRows = [], accuracySeries = {} } = {}, { minAgreement = 0.7 } = {}) {
  const agr = agreement(verdictRows);
  const dr = drift(accuracySeries);
  const drifting = Object.entries(dr).filter(([, v]) => v === 'DRIFTING').map(([j]) => j);
  const alerts = [];
  if (agr < minAgreement) alerts.push(`inter-judge agreement ${agr} < ${minAgreement} — the panel is split`);
  for (const j of drifting) alerts.push(`judge "${j}" is DRIFTING (accuracy falling)`);
  return { agreement: agr, drift: dr, alerts, ok: alerts.length === 0 };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const fullAgree = [{ case: '1', judge: 'a', verdict: 'PASS' }, { case: '1', judge: 'b', verdict: 'PASS' }, { case: '2', judge: 'a', verdict: 'FAIL' }, { case: '2', judge: 'b', verdict: 'FAIL' }];
  const split = [{ case: '1', judge: 'a', verdict: 'PASS' }, { case: '1', judge: 'b', verdict: 'FAIL' }, { case: '2', judge: 'a', verdict: 'PASS' }, { case: '2', judge: 'b', verdict: 'FAIL' }];

  ok('agreement: judges always agree → 1', agreement(fullAgree) === 1);
  ok('agreement: judges always split → 0', agreement(split) === 0);
  ok('agreement: single judge → 1 (vacuous, no false split)', agreement([{ case: '1', judge: 'a', verdict: 'PASS' }]) === 1);
  ok('drift: rising accuracy → improving', drift({ j: [60, 80] }).j === 'improving');
  ok('drift: falling accuracy → DRIFTING', drift({ j: [90, 70] }).j === 'DRIFTING');
  ok('drift: within 5pt → stable', drift({ j: [88, 90] }).j === 'stable');
  ok('drift: single reading → baseline', drift({ j: [90] }).j === 'baseline');
  ok('calibrate: split panel raises an alert', calibrate({ verdictRows: split }).ok === false && calibrate({ verdictRows: split }).alerts.some((a) => /split/.test(a)));
  ok('calibrate: a drifting judge raises an alert', calibrate({ accuracySeries: { x: [90, 70] } }).alerts.some((a) => /DRIFTING/.test(a)));
  ok('calibrate: agreeing panel + stable judges → ok', calibrate({ verdictRows: fullAgree, accuracySeries: { x: [88, 90] } }).ok === true);

  if (fails.length) { console.log(`\n\x1b[31mjudge-calibration self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ judge-calibration: agreement + drift detection correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const load = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const verdictRows = load(arg('--verdicts')) || [];
  const accuracySeries = load(arg('--accuracy')) || {};
  if (!verdictRows.length && !Object.keys(accuracySeries).length) { console.error('usage: --verdicts <rows.json> --accuracy <series.json>  (or --self-test)'); process.exit(2); }
  const r = calibrate({ verdictRows, accuracySeries });
  console.log(`judge-calibration: inter-judge agreement ${r.agreement}\n  drift: ${JSON.stringify(r.drift)}`);
  if (!r.ok) { console.error(`\n\x1b[31m✗ ${r.alerts.length} calibration alert(s):\x1b[0m`); for (const a of r.alerts) console.error(`    ${a}`); process.exit(1); }
  console.log('\x1b[32m✓ judges are calibrated (agreeing + not drifting).\x1b[0m');
  process.exit(0);
}
