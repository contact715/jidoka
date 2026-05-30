#!/usr/bin/env node
// @ts-check
/**
 * Wave-138 — TLA+ model-check runner (graceful-degrade)
 *
 * Checks whether Java + tla2tools.jar are present. If both are available,
 * runs TLC against docs/formal/AndonHalt.cfg and reports the real result.
 * If either is absent, surfaces TLC_UNAVAILABLE and exits 0 — explicitly
 * NOT a clean pass (mirrors run-container-scan.mjs:391-417 SCANNER_UNAVAILABLE pattern).
 *
 * Usage:
 *   node scripts/run-tla.mjs
 *   npm run tla:check
 *
 * Exit codes:
 *   0  — TLC_UNAVAILABLE (tooling absent, not a clean pass) OR TLC ran and invariants hold
 *   1  — TLC ran and found a counterexample (real safety finding — do not suppress)
 *
 * Node built-ins only. No npm dependencies. (D7)
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TLA_SPEC   = path.join(ROOT, 'docs', 'formal', 'AndonHalt.tla');
const TLA_CFG    = path.join(ROOT, 'docs', 'formal', 'AndonHalt.cfg');
const JAR_PATH   = path.join(ROOT, 'tools', 'tla', 'tla2tools.jar');

// Allow overriding jar path via env var for CI
const jarPath = process.env.TLA_JAR_PATH ?? JAR_PATH;

// ── Helper: print check-style line (mirrors run-container-scan.mjs style) ────
function log(msg) {
  process.stdout.write(msg + '\n');
}

function printCheck(status, id, detail) {
  const pad = status.padEnd(4);
  process.stdout.write(`  [${pad}] ${id}: ${detail}\n`);
}

// ── Check 1: Java in PATH ─────────────────────────────────────────────────────
function javaInPath() {
  try {
    execSync('command -v java', { stdio: 'ignore', shell: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── Check 2: tla2tools.jar exists at configured path ─────────────────────────
function jarExists() {
  return fs.existsSync(jarPath);
}

// ── Parse TLC output for result ──────────────────────────────────────────────
/**
 * @param {string} output
 * @returns {{ verified: boolean, counterexample: boolean, raw: string }}
 */
function parseTLCOutput(output) {
  const verified    = output.includes('No error has been found');
  const counterex   = /Error: Invariant .+ is violated|Error: Property .+ is violated|Temporal properties were violated/i.test(output);
  return { verified, counterexample: counterex, raw: output };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  log('');
  log('=== Wave-138 TLA+ Formal Model Check (AndonHalt) ===');
  log(`  Spec:   ${TLA_SPEC}`);
  log(`  Config: ${TLA_CFG}`);
  log(`  Jar:    ${jarPath}`);
  log('');

  const hasJava = javaInPath();
  const hasJar  = jarExists();

  // ── Graceful-degrade path ────────────────────────────────────────────────
  if (!hasJava || !hasJar) {
    log('TLC check — AndonHalt formal model');
    log('');

    if (!hasJava) {
      printCheck('SKIP', 'TLC', 'java not in PATH — TLC_UNAVAILABLE');
    } else {
      printCheck('SKIP', 'TLC', `tla2tools.jar not found at ${jarPath} — TLC_UNAVAILABLE`);
    }

    log('');
    log('  TLC_UNAVAILABLE: The TLA+ model checker could not run.');
    log('  The formal spec (docs/formal/AndonHalt.tla) is present and syntactically');
    log('  complete, but its invariants have NOT been machine-checked.');
    log('  This is NOT a clean pass.');
    log('');
    log('  Enable-condition (local):');
    log('    1. Install Java: brew install openjdk  (or https://adoptium.net)');
    log('    2. Download tla2tools.jar:');
    log('         mkdir -p tools/tla');
    log('         curl -L -o tools/tla/tla2tools.jar \\');
    log('           https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar');
    log('    3. Re-run: npm run tla:check');
    log('');
    log('  Enable-condition (CI):');
    log('    Add a step to download tla2tools.jar before running npm run tla:check.');
    log('    See docs/formal/README.md for the recommended CI setup.');
    log('');
    log('  Invariants (NOT yet machine-checked):');
    log('    - NoAutoResume       : active clears only via Resume or ForceResume');
    log('    - ExitBlocksWhenEnabled: HALTED blocks pipeline when andonCord.enabled=TRUE');
    log('  Property (NOT yet machine-checked):');
    log('    - AlwaysEventuallyResumable: halted machine can always reach RUNNING');
    log('');
    log('  See: docs/formal/README.md');
    log('');
    log('=== TLA+ check SKIPPED — TLC_UNAVAILABLE (exit 0, not a clean pass) ===');
    log('');

    process.exit(0);
  }

  // ── TLC is available — run real model check ──────────────────────────────
  log('  Java found in PATH');
  log(`  tla2tools.jar found at: ${jarPath}`);
  log('  Running TLC ...');
  log('');

  // TLC command: raw TLA+ spec (not PlusCal — no pcal translate step needed)
  // -config flag points to the .cfg file
  // -deadlock flag checks for deadlock states
  const result = spawnSync(
    'java',
    [
      '-cp', jarPath,
      'tlc2.TLC',
      '-config', TLA_CFG,
      '-deadlock',
      TLA_SPEC,
    ],
    {
      cwd: ROOT,
      timeout: 120000, // 2 minutes
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  const stdout = result.stdout ? result.stdout.toString() : '';
  const stderr = result.stderr ? result.stderr.toString() : '';
  const combined = stdout + stderr;

  log('--- TLC output ---');
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  log('--- end TLC output ---');
  log('');

  if (result.status === null || (result.error && result.error.code !== undefined)) {
    process.stderr.write(`[run-tla] TLC process error: ${result.error?.message ?? 'unknown'}\n`);
    process.exit(1);
  }

  const { verified, counterexample } = parseTLCOutput(combined);

  if (verified && !counterexample) {
    log('=== TLA+ VERIFIED — No error has been found ===');
    log('  Invariants hold across all reachable states:');
    log('    - NoAutoResume       : HOLDS');
    log('    - ExitBlocksWhenEnabled: HOLDS');
    log('  Liveness property:');
    log('    - AlwaysEventuallyResumable: HOLDS (with fairness assumptions)');
    log('');
    process.exit(0);
  }

  if (counterexample) {
    log('');
    log('=== TLA+ COUNTEREXAMPLE FOUND — safety property VIOLATED ===');
    log('');
    log('  A reachable state exists where an invariant or property does not hold.');
    log('  This is a REAL SAFETY FINDING in the andon halt machine.');
    log('  Review the counterexample trace above before continuing.');
    log('');
    log('  Steps:');
    log('    1. Read the full TLC trace above to identify the violating state.');
    log('    2. Locate the corresponding code in andon-halt-helpers.mjs or andon-resume.mjs.');
    log('    3. Either fix the implementation or update the spec if the invariant was wrong.');
    log('    4. Re-run: npm run tla:check');
    log('');
    log('  See: docs/formal/README.md — "Interpreting a counterexample"');
    log('');
    process.exit(1);
  }

  // TLC ran but output was unrecognised — surface as not-verified (honest)
  log('=== TLA+ result UNCLEAR — could not parse TLC output ===');
  log('  TLC ran but output did not match known result patterns.');
  log('  Review the raw output above. Do not assume invariants hold.');
  log('');
  process.exit(1);
}

main();
