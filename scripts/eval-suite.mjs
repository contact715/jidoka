#!/usr/bin/env node
// Agent eval suite — DETERMINISTIC track. The fitness signal for the whole framework.
//
// The engine's script-agents (meta-audit, meta-honesty, instantiation-audit, judge-panel,
// budget-gate, policy-sandbox) have deterministic input→output behaviour. This suite drives
// them against golden cases with machine-checkable assertions (exit code + stdout contains/
// absent) — NO LLM required, runs on a clean clone. A drop vs the baseline pass-rate fails.
//
// This is what turns "self-improvement" into evolution and meta-engine's "better" into a
// machine-checked claim: it measures OUTCOME quality, not just process. (Gap #1 from the
// frontier analysis — see docs/specs/wave-frontier_MASTER_SPEC.md §2 Module 1.)
//
// LLM-agent evals (constitutional-reviewer etc.) live in docs/evals/<agent>/golden-cases.jsonl
// and run via run-evals.mjs WITH a model — DORMANT until a model is wired. Honest split.
//
// Usage:
//   node scripts/eval-suite.mjs                 # run, exit 1 on regression vs baseline
//   node scripts/eval-suite.mjs --update-baseline
//   npm run eval

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CASES = 'docs/evals/_cases.jsonl';
const BASELINE = 'docs/evals/_baseline.json';
const REGRESSION_DROP = 0.05; // >5% pass-rate drop = regression
const update = process.argv.includes('--update-baseline');

if (!existsSync(CASES)) { console.error(`eval-suite: ${CASES} missing`); process.exit(2); }

const cases = readFileSync(CASES, 'utf8').split('\n').filter(Boolean).map((l, i) => {
  try { return JSON.parse(l); } catch { console.error(`bad case line ${i + 1}`); return null; }
}).filter(Boolean);

function runCase(c) {
  const dir = mkdtempSync(join(tmpdir(), 'eval-'));
  const env = { ...process.env, ...(c.env || {}) };
  // If the case ships a ledger, write it to a temp file and point META_LEDGER at it.
  if (c.ledger) {
    const lp = join(dir, 'ledger.jsonl');
    writeFileSync(lp, c.ledger.map(r => JSON.stringify(r)).join('\n') + '\n');
    env.META_LEDGER = lp;
  }
  if (c.file) writeFileSync(join(dir, c.file.name), c.file.content);
  let out = '', code = 0;
  try { out = execSync(c.cmd, { encoding: 'utf8', env, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status ?? -1; out = (e.stdout || '') + (e.stderr || ''); }
  const a = c.assert || {};
  const fails = [];
  if (a.exit !== undefined && code !== a.exit) fails.push(`exit ${code}≠${a.exit}`);
  for (const s of (a.contains || [])) if (!out.includes(s)) fails.push(`missing "${s}"`);
  for (const s of (a.absent || [])) if (out.includes(s)) fails.push(`unexpected "${s}"`);
  return { id: c.id, pass: fails.length === 0, fails };
}

const results = cases.map(runCase);
const passed = results.filter(r => r.pass).length;
const rate = cases.length ? passed / cases.length : 1;

console.log(`eval-suite: ${passed}/${cases.length} deterministic cases passed (${(rate * 100).toFixed(1)}%)\n`);
for (const r of results) {
  if (r.pass) console.log(`  \x1b[32m✓\x1b[0m ${r.id}`);
  else console.log(`  \x1b[31m✗ ${r.id}\x1b[0m — ${r.fails.join(', ')}`);
}

if (update) {
  writeFileSync(BASELINE, JSON.stringify({ pass_rate: rate, passed, total: cases.length, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  console.log(`\n\x1b[36mbaseline updated → ${(rate * 100).toFixed(1)}%\x1b[0m`);
  process.exit(0);
}

// Regression check vs baseline
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
console.log('\n\x1b[1m— eval summary —\x1b[0m');
if (base) {
  const drop = base.pass_rate - rate;
  console.log(`  baseline: ${(base.pass_rate * 100).toFixed(1)}%   now: ${(rate * 100).toFixed(1)}%   delta: ${(drop <= 0 ? '+' : '-')}${Math.abs(drop * 100).toFixed(1)}%`);
  if (drop > REGRESSION_DROP) {
    console.log(`\n\x1b[31m✗ REGRESSION — pass-rate dropped >${REGRESSION_DROP * 100}%. The framework's mechanisms got worse.\x1b[0m`);
    process.exit(1);
  }
}
if (passed < cases.length) {
  console.log(`\n\x1b[31m✗ ${cases.length - passed} eval case(s) failing — fix before merge (or --update-baseline if intended).\x1b[0m`);
  process.exit(1);
}
console.log('\n\x1b[32m✓ all eval cases pass — engine mechanisms behave to spec.\x1b[0m');
process.exit(0);
