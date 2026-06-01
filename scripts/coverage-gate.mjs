#!/usr/bin/env node
// coverage-gate — deterministic coverage ratchet. The coverage-auditor AGENT gives an opinion; this
// is the hard number: it reads a coverage summary (vitest/c8 coverage-summary.json), compares the
// total line-% to a committed baseline, and FAILS if it dropped more than maxDrop. The baseline can
// only go UP (ratchet) — a passing run with higher coverage updates it. Portable; ships to products
// via install-into (the framework itself uses node:test, so here it honestly skips with no summary).
//
// FULL & self-tested: assess() is pure + tested; the CLI reads the real report.
// Usage:
//   node scripts/coverage-gate.mjs --self-test
//   node scripts/coverage-gate.mjs [--summary coverage/coverage-summary.json] [--baseline docs/metrics/coverage-baseline.json] [--update]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// pure: a drop beyond maxDrop fails; equal or improved passes
export function assess(currentPct, baselinePct, maxDrop = 5) {
  const drop = Math.round((baselinePct - currentPct) * 100) / 100;
  return { currentPct, baselinePct, drop, fail: drop > maxDrop };
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

function readTotalPct(summaryPath) {
  const d = JSON.parse(readFileSync(summaryPath, 'utf8'));
  // vitest/c8 coverage-summary.json: { total: { lines: { pct } } }
  return d.total?.lines?.pct ?? d.total?.statements?.pct ?? null;
}

function selfTest() {
  const T = [
    ['equal coverage passes', assess(85, 85).fail === false],
    ['within maxDrop (5) passes', assess(80, 85).fail === false],
    ['drop beyond maxDrop fails', assess(70, 85).fail === true],
    ['improvement passes (negative drop)', assess(92, 85).fail === false && assess(92, 85).drop === -7],
    ['custom maxDrop tightens', assess(83, 85, 1).fail === true],
    ['drop is computed', assess(70, 85).drop === 15],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mcoverage-gate self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ coverage-gate: ratchet logic correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const summary = arg('--summary') || 'coverage/coverage-summary.json';
  const baselineP = arg('--baseline') || 'docs/metrics/coverage-baseline.json';
  if (!existsSync(summary)) { console.log(`coverage-gate: no coverage summary at ${summary} — run tests with --coverage first (honest skip, not a pass).`); process.exit(0); }
  const current = readTotalPct(summary);
  if (current == null) { console.error('coverage-gate: could not read total pct from summary.'); process.exit(0); }
  const baseline = existsSync(baselineP) ? (JSON.parse(readFileSync(baselineP, 'utf8')).total_pct ?? current) : current;
  const r = assess(current, baseline);
  console.log(`coverage-gate: ${current}% (baseline ${baseline}%, drop ${r.drop}%)`);
  if (process.argv.includes('--update') && !r.fail) { writeFileSync(baselineP, JSON.stringify({ total_pct: Math.max(current, baseline), updated: process.env.META_TODAY || new Date().toISOString().slice(0, 10) }, null, 2) + '\n'); console.log(`  baseline ratcheted → ${Math.max(current, baseline)}%`); }
  if (r.fail) { console.error(`\x1b[31m✗ coverage dropped ${r.drop}% (> 5%) — add tests before merge.\x1b[0m`); process.exit(1); }
  console.log('\x1b[32m✓ coverage held (no >5% drop).\x1b[0m');
  process.exit(0);
}
