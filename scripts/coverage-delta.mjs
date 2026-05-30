#!/usr/bin/env node
/**
 * Coverage delta tracker.
 *
 * Reads coverage/lcov.info (output of @vitest/coverage-v8), extracts
 * per-file line coverage percentages, and compares against the committed
 * baseline at docs/metrics/coverage-baseline.json.
 *
 * Behavior:
 *   - WARN at > 2% drop per file (logged, non-blocking)
 *   - FAIL (exit 1) at > 5% drop per file (BLOCK condition)
 *   - First run or empty baseline: write current as baseline, exit 0
 *   - --update: write current coverage as new baseline, exit 0
 *   - No lcov.info: print SKIP, exit 0
 *
 * Usage:
 *   node scripts/coverage-delta.mjs           # check
 *   node scripts/coverage-delta.mjs --update  # accept current as baseline
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LCOV_FILE = path.join(ROOT, 'coverage', 'lcov.info');
const BASELINE_FILE = path.join(ROOT, 'docs', 'metrics', 'coverage-baseline.json');

const WARN_DROP = 2;  // warn at > 2% drop
const FAIL_DROP = 5;  // fail (exit 1) at > 5% drop

// ── lcov parser ───────────────────────────────────────────────────────────
/**
 * Parse lcov.info into a map of { [filePath]: { hit, found, pct } }
 * lcov format:
 *   SF:<source file>
 *   LH:<lines hit>
 *   LF:<lines found>
 *   end_of_record
 */
function parseLcov(lcovContent) {
  const result = {};
  let currentFile = null;
  let lh = 0;
  let lf = 0;

  for (const raw of lcovContent.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3);
      lh = 0;
      lf = 0;
    } else if (line.startsWith('LH:')) {
      lh = parseInt(line.slice(3), 10) || 0;
    } else if (line.startsWith('LF:')) {
      lf = parseInt(line.slice(3), 10) || 0;
    } else if (line === 'end_of_record' && currentFile) {
      const pct = lf === 0 ? 100 : Math.round((lh / lf) * 100 * 10) / 10;
      // Normalize path: strip ROOT prefix for readability
      const rel = currentFile.startsWith(ROOT)
        ? currentFile.slice(ROOT.length + 1)
        : currentFile;
      result[rel] = { hit: lh, found: lf, pct };
      currentFile = null;
    }
  }
  return result;
}

// ── Baseline I/O ─────────────────────────────────────────────────────────
function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { _comment: '', lastUpdated: '', files: {} };
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
}

function writeBaseline(fileCoverage) {
  const today = new Date().toISOString().slice(0, 10);
  const files = {};
  for (const [file, { pct }] of Object.entries(fileCoverage)) {
    files[file] = pct;
  }
  const next = {
    _comment: "Coverage baseline. Update via 'node scripts/coverage-delta.mjs --update' after intentional changes.",
    lastUpdated: today,
    files,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  console.log(`INIT/UPDATE: Wrote coverage baseline for ${Object.keys(files).length} file(s) to ${path.relative(ROOT, BASELINE_FILE)}`);
}

// ── Format helpers ────────────────────────────────────────────────────────
function fmt(pct) {
  return `${pct.toFixed(1)}%`;
}

function sign(delta) {
  return delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
}

// ── Main ─────────────────────────────────────────────────────────────────
function main() {
  const updateMode = process.argv.includes('--update');

  if (!fs.existsSync(LCOV_FILE)) {
    console.log('SKIP: coverage/lcov.info not found.');
    console.log('      Run: npx vitest run --coverage (requires @vitest/coverage-v8)');
    process.exit(0);
  }

  const lcovContent = fs.readFileSync(LCOV_FILE, 'utf-8');
  const current = parseLcov(lcovContent);

  if (Object.keys(current).length === 0) {
    console.log('SKIP: coverage/lcov.info exists but contains no file entries.');
    process.exit(0);
  }

  const baseline = readBaseline();
  const baselineFiles = baseline.files || {};
  const baselineEmpty = Object.keys(baselineFiles).length === 0;

  if (updateMode || baselineEmpty) {
    writeBaseline(current);
    process.exit(0);
  }

  let warnings = 0;
  let failures = 0;
  const newFiles = [];

  console.log('\nCoverage delta report:\n');

  for (const [file, { pct }] of Object.entries(current)) {
    const base = baselineFiles[file];
    if (base === undefined) {
      newFiles.push({ file, pct });
      continue;
    }
    const delta = pct - base;
    if (delta <= -FAIL_DROP) {
      console.log(`[FAIL] ${file}: baseline ${fmt(base)} → current ${fmt(pct)} (${sign(delta)}%)`);
      failures++;
    } else if (delta <= -WARN_DROP) {
      console.log(`[WARN] ${file}: baseline ${fmt(base)} → current ${fmt(pct)} (${sign(delta)}%)`);
      warnings++;
    } else {
      console.log(`[OK]   ${file}: baseline ${fmt(base)} → current ${fmt(pct)} (${sign(delta)}%)`);
    }
  }

  if (newFiles.length > 0) {
    console.log(`\nINFO: ${newFiles.length} new file(s) not yet in baseline (run --update to register):`);
    for (const { file, pct } of newFiles.slice(0, 10)) {
      console.log(`  + ${file} (${fmt(pct)})`);
    }
  }

  if (failures > 0) {
    console.log(`\nFAIL: ${failures} file(s) dropped > ${FAIL_DROP}% coverage. BLOCK condition.`);
    process.exit(1);
  }
  if (warnings > 0) {
    console.log(`\nWARN: ${warnings} file(s) dropped ${WARN_DROP}-${FAIL_DROP}% coverage (non-blocking).`);
  } else {
    console.log('\nOK: Coverage within baseline thresholds.');
  }
  process.exit(0);
}

main();
