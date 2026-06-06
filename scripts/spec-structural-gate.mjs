#!/usr/bin/env node
// spec-structural-gate — a RATCHET gate over the spec tree's structural health.
//
// The problem it solves: the tree carries legacy debt (broken refs in old docs,
// orphan docs with no frontmatter) that we cannot fix in one wave. A plain hard
// gate would block every commit on pre-existing debt; a plain soft gate never
// stops the debt from GROWING. The ratchet does both: it locks the CURRENT level
// as a ceiling — new breakage blocks, old debt stays soft, and when you fix some,
// the ceiling tightens so it can never regress back.
//
// Three metrics, all from existing tools (no re-implementation):
//   brokenRefs   — spec-drift-check.mjs missing references
//   orphans      — build-lineage-graph.mjs specs with no parent/child edge
//   missingMeta  — build-lineage-graph.mjs specs missing level/version
//
// Baseline: docs/metrics/spec-structural-baseline.json (committed).
//   - any metric ABOVE baseline → BLOCK (exit 1): new breakage introduced
//   - any metric BELOW baseline → auto-tighten the baseline (debt paid down, locked in)
//   - all equal → PASS
//
// Usage:
//   node scripts/spec-structural-gate.mjs            # gate (ratchet)
//   node scripts/spec-structural-gate.mjs --update   # force-rewrite baseline to current
//   node scripts/spec-structural-gate.mjs --self-test
//   node scripts/spec-structural-gate.mjs --json

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'docs/metrics/spec-structural-baseline.json');
const METRICS = ['brokenRefs', 'orphans', 'missingMeta'];

// ── pure: compare current vs baseline → verdict ──────────────────────────────
// Returns { regressions:[{metric,baseline,current}], improvements:[...], verdict }
export function ratchet(baseline, current) {
  const regressions = [];
  const improvements = [];
  for (const m of METRICS) {
    const b = baseline?.[m] ?? Infinity; // no baseline yet → nothing is a regression (first run seeds)
    const c = current[m] ?? 0;
    if (c > b) regressions.push({ metric: m, baseline: b, current: c });
    else if (c < b) improvements.push({ metric: m, baseline: b, current: c });
  }
  const verdict = regressions.length ? 'BLOCK' : (improvements.length ? 'TIGHTEN' : 'PASS');
  return { regressions, improvements, verdict };
}

// ── pure: parse the metric numbers out of the two tools' stdout ──────────────
export function parseDrift(text) {
  const m = String(text).match(/scanned\s+\d+\s+spec\(s\)\s+—\s+(\d+)\s+drift finding/);
  return m ? Number(m[1]) : null;
}
export function parseLineage(text) {
  const o = String(text).match(/orphans:\s*(\d+)/);
  const mm = String(text).match(/missing-meta:\s*(\d+)/);
  return { orphans: o ? Number(o[1]) : null, missingMeta: mm ? Number(mm[1]) : null };
}

// ── impure: run the two tools and collect current metrics ────────────────────
function measure() {
  let driftOut = '';
  try { driftOut = execFileSync('node', [join(ROOT, 'scripts/spec-drift-check.mjs')], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { driftOut = (e.stdout || '') + (e.stderr || ''); } // soft mode exits 0, but be safe
  let lineageOut = '';
  try { lineageOut = execFileSync('node', [join(ROOT, 'scripts/build-lineage-graph.mjs')], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { lineageOut = (e.stdout || '') + (e.stderr || ''); }

  const brokenRefs = parseDrift(driftOut);
  const { orphans, missingMeta } = parseLineage(lineageOut);
  if (brokenRefs === null || orphans === null || missingMeta === null) {
    throw new Error(`could not parse metrics (brokenRefs=${brokenRefs}, orphans=${orphans}, missingMeta=${missingMeta})`);
  }
  return { brokenRefs, orphans, missingMeta };
}

function readBaseline() {
  try { return JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { return null; }
}
function writeBaseline(metrics, note) {
  writeFileSync(BASELINE, JSON.stringify({ ...metrics, _note: note }, null, 2) + '\n');
}

function selfTest() {
  const T = [
    ['no regression when equal', ratchet({ brokenRefs: 5, orphans: 5, missingMeta: 5 }, { brokenRefs: 5, orphans: 5, missingMeta: 5 }).verdict === 'PASS'],
    ['BLOCK when a metric rises', ratchet({ brokenRefs: 5, orphans: 5, missingMeta: 5 }, { brokenRefs: 6, orphans: 5, missingMeta: 5 }).verdict === 'BLOCK'],
    ['TIGHTEN when a metric falls', ratchet({ brokenRefs: 5, orphans: 5, missingMeta: 5 }, { brokenRefs: 4, orphans: 5, missingMeta: 5 }).verdict === 'TIGHTEN'],
    ['regression names the metric', ratchet({ orphans: 1 }, { orphans: 2, brokenRefs: 0, missingMeta: 0 }).regressions[0].metric === 'orphans'],
    ['no baseline → first run never blocks', ratchet(null, { brokenRefs: 99, orphans: 99, missingMeta: 99 }).verdict !== 'BLOCK'],
    ['parseDrift reads the count', parseDrift('spec-drift-check: scanned 147 spec(s) — 143 drift finding(s) [mode: soft/warn]') === 143],
    ['parseLineage reads orphans + missing-meta', (() => { const r = parseLineage('[lineage-graph] orphans: 50, missing-meta: 53'); return r.orphans === 50 && r.missingMeta === 53; })()],
    ['mixed rise+fall still BLOCKs (a regression dominates)', ratchet({ brokenRefs: 5, orphans: 5, missingMeta: 5 }, { brokenRefs: 4, orphans: 6, missingMeta: 5 }).verdict === 'BLOCK'],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log(`\n\x1b[31mspec-structural-gate self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ spec-structural-gate self-test passes — ratchet logic correct\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) selfTest();

const current = measure();
const baseline = readBaseline();

if (process.argv.includes('--update')) {
  writeBaseline(current, 'Spec-tree structural ceiling. Lower is better; the gate blocks any increase. Auto-tightens when a metric drops.');
  console.log(`[spec-structural] baseline updated → ${JSON.stringify(current)}`);
  process.exit(0);
}

const { regressions, improvements, verdict } = ratchet(baseline, current);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ baseline, current, regressions, improvements, verdict }, null, 2));
}

if (!baseline) {
  writeBaseline(current, 'Spec-tree structural ceiling. Lower is better; the gate blocks any increase. Auto-tightens when a metric drops.');
  console.log(`[spec-structural] seeded baseline → ${JSON.stringify(current)} (first run, not blocking)`);
  process.exit(0);
}

if (verdict === 'BLOCK') {
  console.error('\x1b[31m✗ spec-structural-gate BLOCK — new spec-tree breakage:\x1b[0m');
  for (const r of regressions) console.error(`    ${r.metric}: ${r.baseline} → ${r.current} (must not increase)`);
  console.error('  Fix the new breakage, or if intentional debt, justify and run --update.');
  process.exit(1);
}

if (verdict === 'TIGHTEN') {
  writeBaseline(current, 'Spec-tree structural ceiling. Lower is better; the gate blocks any increase. Auto-tightens when a metric drops.');
  console.log('\x1b[32m✓ spec-structural-gate — debt paid down, baseline tightened:\x1b[0m');
  for (const i of improvements) console.log(`    ${i.metric}: ${i.baseline} → ${i.current}`);
  process.exit(0);
}

console.log(`\x1b[32m✓ spec-structural-gate PASS — no regression (${JSON.stringify(current)})\x1b[0m`);
process.exit(0);
