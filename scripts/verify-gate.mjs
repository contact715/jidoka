#!/usr/bin/env node
/**
 * verify-gate.mjs — Blocking verification gate (the enforcement lever).
 *
 * Turns the previously-optional / async / non-blocking verification into a
 * HARD gate so broken code cannot reach the remote. Closes the hole that let
 * a broken prod build and 14 red tests get committed in the 2026-05-28 session.
 *
 * Checks (selected by flags):
 *   --tsc     tsc --noEmit --skipLibCheck   (fast — used in pre-commit)
 *   --tests   vitest run                     (medium — used in pre-push)
 *   --build   next build                     (heavy — used in pre-push)
 *
 * Config gate (.sdd-config.json → verificationGate):
 *   enabled         — master switch; if false, exit 0 immediately
 *   hardBlockEnabled — true = exit 1 on failure (block); false = warn + exit 0
 *   runTsc / runTests / runBuild — per-check enable
 *
 * Usage:
 *   node scripts/verify-gate.mjs --tsc                 # pre-commit
 *   node scripts/verify-gate.mjs --tsc --tests --build # pre-push
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.sdd-config.json'), 'utf8'));
    return cfg.verificationGate ?? {};
  } catch {
    return {};
  }
}

function run(label, cmd) {
  process.stderr.write(`[verify-gate] ${label} …\n`);
  const start = Date.now();
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    process.stderr.write(`[verify-gate] ${label} ✓ (${((Date.now() - start) / 1000).toFixed(1)}s)\n`);
    return true;
  } catch {
    process.stderr.write(`[verify-gate] ${label} ✗ (${((Date.now() - start) / 1000).toFixed(1)}s)\n`);
    return false;
  }
}

const args = process.argv.slice(2);
const want = {
  tsc: args.includes('--tsc'),
  tests: args.includes('--tests'),
  build: args.includes('--build'),
};

const cfg = readConfig();
if (cfg.enabled === false) {
  process.stderr.write('[verify-gate] disabled (verificationGate.enabled: false) — skipping.\n');
  process.exit(0);
}
const hardBlock = cfg.hardBlockEnabled !== false; // default to blocking

const failures = [];

if (want.tsc && cfg.runTsc !== false) {
  if (!run('tsc --noEmit', 'npx tsc --noEmit --skipLibCheck')) failures.push('tsc');
}
if (want.tests && cfg.runTests !== false) {
  if (!run('vitest run', 'npx vitest run --reporter=dot')) failures.push('tests');
}
if (want.build && cfg.runBuild !== false) {
  if (!run('next build', 'npm run build')) failures.push('build');
}

if (failures.length === 0) {
  process.stderr.write('[verify-gate] PASS — all gated checks green.\n');
  process.exit(0);
}

const msg = `[verify-gate] FAIL — ${failures.join(', ')} did not pass.`;
if (hardBlock) {
  process.stderr.write(`${msg} BLOCKED (verificationGate.hardBlockEnabled: true).\n`);
  process.stderr.write('  Fix the failures, or set verificationGate.hardBlockEnabled: false to soft-warn.\n');
  process.exit(1);
}
process.stderr.write(`${msg} Soft mode — commit/push continues (set hardBlockEnabled: true to block).\n`);
process.exit(0);
