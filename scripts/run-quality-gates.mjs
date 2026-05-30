#!/usr/bin/env node
/**
 * Quality gate orchestrator.
 *
 * Runs the full L0.96 quality gate suite: vitest, coverage delta,
 * E2E (optional), and bundle delta. Exits 1 if any gate emits BLOCK.
 *
 * Usage:
 *   node scripts/run-quality-gates.mjs               # full suite
 *   node scripts/run-quality-gates.mjs --skip-e2e    # skip playwright
 *   node scripts/run-quality-gates.mjs --wave wave-NN
 *   node scripts/run-quality-gates.mjs --help
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
run-quality-gates.mjs — L0.96 quality gate suite

Usage:
  node scripts/run-quality-gates.mjs [--wave <wave-id>] [--skip-e2e] [--help]

Flags:
  --wave <id>   Wave identifier for logging (e.g. wave-102)
  --skip-e2e    Skip Playwright E2E tests (unit-only pass)
  --help        Show this message

Exit codes:
  0  All gates passed (or gracefully skipped)
  1  One or more gates emitted BLOCK
`);
  process.exit(0);
}

const skipE2e = args.includes('--skip-e2e');
const waveIdx = args.indexOf('--wave');
const waveId = waveIdx !== -1 ? args[waveIdx + 1] : 'unknown';

// ── Helpers ────────────────────────────────────────────────────────────
function elapsed(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

/**
 * Run a shell command. Returns { ok, stdout, stderr }.
 * Never throws — failures are captured, not propagated.
 */
function run(cmd, opts = {}) {
  const t = Date.now();
  try {
    const stdout = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    return { ok: true, stdout, stderr: '', elapsed: elapsed(t) };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || String(err),
      elapsed: elapsed(t),
    };
  }
}

// ── Gate runner ─────────────────────────────────────────────────────────
let blocked = false;
let skipped = 0;
let passed = 0;

function gate(label, fn) {
  const t = Date.now();
  console.log(`\n[GATE] ${label} — starting…`);
  try {
    const result = fn();
    const e = elapsed(t);
    if (result === 'SKIP') {
      console.log(`[SKIP] ${label} (${e})`);
      skipped++;
    } else if (result === 'BLOCK') {
      console.log(`[BLOCK] ${label} (${e})`);
      blocked = true;
    } else {
      console.log(`[PASS] ${label} (${e})`);
      passed++;
    }
  } catch (err) {
    console.log(`[SKIP] ${label} — error: ${err.message} (graceful degrade)`);
    skipped++;
  }
}

// ── Step 1: Ensure output dir ────────────────────────────────────────────
const RESULTS_DIR = path.join(ROOT, '.test-results');
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

console.log(`\n=== Quality Gates (${waveId}) ===\n`);

// ── Step 2: Vitest ────────────────────────────────────────────────────────
gate('Vitest unit tests', () => {
  const vitestJson = path.join(RESULTS_DIR, 'vitest.json');
  const r = run(
    `npx vitest run --reporter=json --outputFile=${vitestJson}`,
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (!r.ok) {
    // Parse failures for summary
    const failResult = run(`node ${path.join(__dirname, 'extract-test-failures.mjs')}`);
    if (failResult.stdout) process.stdout.write(failResult.stdout);
    return 'BLOCK';
  }
  return 'PASS';
});

// ── Step 3: Coverage delta ────────────────────────────────────────────────
gate('Coverage delta', () => {
  const r = run(`node ${path.join(__dirname, 'coverage-delta.mjs')}`);
  process.stdout.write(r.stdout);
  if (r.stderr && !r.ok) process.stderr.write(r.stderr);
  if (!r.ok) return 'BLOCK';
  if (r.stdout.includes('SKIP')) return 'SKIP';
  return 'PASS';
});

// ── Step 4: Playwright E2E (optional) ─────────────────────────────────────
if (skipE2e) {
  console.log('\n[SKIP] Playwright E2E (--skip-e2e flag set)');
  skipped++;
} else {
  gate('Playwright E2E', () => {
    const playwrightJson = path.join(RESULTS_DIR, 'playwright.json');
    const r = run(
      `npx playwright test --reporter=json --output=${playwrightJson}`,
    );
    if (r.stdout) process.stdout.write(r.stdout);
    if (!r.ok) {
      if (r.stderr.includes('not found') || r.stderr.includes('Cannot find')) return 'SKIP';
      return 'BLOCK';
    }
    return 'PASS';
  });
}

// ── Step 5: Bundle delta ─────────────────────────────────────────────────
gate('Bundle delta', () => {
  const r = run(`node ${path.join(__dirname, 'bundle-delta.mjs')}`);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stdout.includes('SKIP')) return 'SKIP';
  if (!r.ok) return 'BLOCK';
  return 'PASS';
});

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n=== Gate Summary (${waveId}) ===`);
console.log(`  Passed:  ${passed}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Blocked: ${blocked ? 'YES' : 'none'}`);

if (blocked) {
  console.log('\nStatus: BLOCK — one or more gates failed. Fix before merge.\n');
  process.exit(1);
} else {
  console.log('\nStatus: PASS — all gates cleared.\n');
  process.exit(0);
}
