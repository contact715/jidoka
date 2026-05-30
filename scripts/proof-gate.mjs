#!/usr/bin/env node
// Proof-gate — the remedy for declaration-over-implementation.
//
// A claim of "done / implemented / wired / fixed" must come with an EXECUTABLE
// proof. This gate runs the proof command: if it passes, the claim is accepted;
// if it fails or is absent, the claim is REJECTED (exit 1). You cannot mark done
// what you cannot demonstrate.
//
// Usage: node scripts/proof-gate.mjs "<claim>" "<proof shell command>"
//   e.g. node scripts/proof-gate.mjs "guard blocks leaks" "node scripts/pre-publish-guard.mjs"

import { execSync } from 'node:child_process';

const [, , claim, proof] = process.argv;
if (!claim || !proof) {
  console.error('usage: proof-gate.mjs "<claim>" "<proof shell command>"');
  console.error('A claim without a runnable proof is, by definition, not done.');
  process.exit(2);
}

console.log(`claim: ${claim}`);
console.log(`proof: ${proof}\n`);

try {
  const out = execSync(proof, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (out) process.stdout.write(out.endsWith('\n') ? out : out + '\n');
  console.log('\x1b[32m✓ PROVEN — claim accepted as done\x1b[0m');
  process.exit(0);
} catch (e) {
  if (e.stdout) process.stdout.write(e.stdout);
  if (e.stderr) process.stderr.write(e.stderr);
  console.error('\n\x1b[31m✗ PROOF FAILED — claim REJECTED, status is NOT done\x1b[0m');
  process.exit(1);
}
