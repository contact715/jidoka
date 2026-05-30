#!/usr/bin/env node
/**
 * Wave-53 — outcome-driven dispatch wrapper.
 *
 * Anthropic's "Outcomes" pattern (Code with Claude 2026): specify a goal,
 * agent loops until achieved or budget exhausted. Without an outcome
 * gate, dispatches exit on "best effort" and incomplete work sits
 * forever (wave-48 stopped at 1619 raw heights, not 0 — exactly the
 * pattern Outcomes solves).
 *
 * This script is the outcome-checker half. Reads `outcomes-registry.json`,
 * runs the `check` command for the named outcome, exits 0 if met,
 * non-zero otherwise. The dispatcher (orchestrator) wraps a dispatch
 * with this check to decide whether to iterate.
 *
 * Usage:
 *   node scripts/outcome-check.mjs                       # check all, print report
 *   node scripts/outcome-check.mjs --name=design-drift-zero-heights
 *   node scripts/outcome-check.mjs --json                # machine-readable
 *
 * Exit code:
 *   0 — all checked outcomes met (or single named outcome met)
 *   1 — at least one outcome not met (or named outcome not met)
 *   2 — registry / config error
 *
 * Loop pattern (orchestrator side):
 *   while ! npm run outcome:check -- --name=X; do
 *     dispatch_sweep_agent_for_X
 *     ((iter++)); [ $iter -ge $BUDGET ] && break
 *   done
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'scripts', 'outcomes-registry.json');

// ── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const nameArg = args.find((a) => a.startsWith('--name='))?.slice(7) ?? null;
const isJson = args.includes('--json');

// ── load registry ────────────────────────────────────────────────────
if (!fs.existsSync(REGISTRY_PATH)) {
  console.error(`✗ Registry not found: ${REGISTRY_PATH}`);
  process.exit(2);
}
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
if (!Array.isArray(registry.outcomes)) {
  console.error('✗ Registry malformed: outcomes array missing');
  process.exit(2);
}

// ── filter ───────────────────────────────────────────────────────────
const targets = nameArg
  ? registry.outcomes.filter((o) => o.name === nameArg)
  : registry.outcomes;

if (nameArg && targets.length === 0) {
  console.error(`✗ Unknown outcome: ${nameArg}`);
  console.error('Available:');
  for (const o of registry.outcomes) console.error(`  - ${o.name}`);
  process.exit(2);
}

// ── run checks ───────────────────────────────────────────────────────
const results = [];
for (const outcome of targets) {
  let met = false;
  let error = null;
  try {
    execSync(outcome.check, { cwd: ROOT, stdio: 'pipe' });
    met = true;
  } catch (e) {
    met = false;
    error = (e.stderr?.toString() ?? e.message ?? '').slice(0, 200);
  }
  results.push({ name: outcome.name, met, description: outcome.description, error });
}

// ── output ───────────────────────────────────────────────────────────
const anyUnmet = results.some((r) => !r.met);

if (isJson) {
  process.stdout.write(JSON.stringify({ results, allMet: !anyUnmet }, null, 2) + '\n');
  process.exit(anyUnmet ? 1 : 0);
}

const banner = '─'.repeat(70);
process.stdout.write(`\n${banner}\n`);
process.stdout.write(`Outcome check — ${nameArg ? `single: ${nameArg}` : `all (${results.length})`}\n`);
process.stdout.write(`${banner}\n\n`);
for (const r of results) {
  const mark = r.met ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  process.stdout.write(`  ${mark}  ${r.name}\n`);
  process.stdout.write(`     ${r.description}\n`);
  if (!r.met && r.error) {
    process.stdout.write(`     reason: ${r.error.split('\n')[0]}\n`);
  }
  process.stdout.write('\n');
}

const met = results.filter((r) => r.met).length;
process.stdout.write(`${banner}\n`);
process.stdout.write(`${met} of ${results.length} outcomes met.\n`);
if (anyUnmet) {
  process.stdout.write(`\nDispatch loop pattern (for orchestrator):\n`);
  process.stdout.write(`  while ! npm run outcome:check -- --name=<unmet>; do\n`);
  process.stdout.write(`    dispatch_agent_for_<unmet>\n`);
  process.stdout.write(`    ((iter++)); [ "$iter" -ge "$BUDGET" ] && break\n`);
  process.stdout.write(`  done\n`);
}
process.stdout.write(`${banner}\n\n`);

process.exit(anyUnmet ? 1 : 0);
