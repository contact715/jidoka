#!/usr/bin/env node
// sleep-consolidate — between-wave "sleep-time" memory consolidation (2026-W27 quick win #4,
// after Letta's sleep-time idea). When a wave closes, the agent is idle for a moment; use it to
// turn the wave's raw episodic traces into learned context that is READY before the next
// session-start — instead of paying that cost on the next session's critical path.
//
// It COMPOSES existing scripts (no new memory logic):
//   1. memory-consolidate.mjs  — rebuild memory-consolidated.md from the mistake ledger.
//   2. reasoning-distill.mjs    — distill captured best-of-N/reflexion contrast into gated
//                                 strategy candidates (private until judges are calibrated).
//
// Runnable as `npm run routine:sleep` (same class as routine:weekly/monthly) and safe to call at
// wave close. Best-effort: a failing step is reported, never fatal — a sleep routine must not
// block the pipeline that triggered it.
//
// FULL & self-tested. Usage:
//   node scripts/sleep-consolidate.mjs           # run the consolidation steps
//   node scripts/sleep-consolidate.mjs --dry     # print the plan, run nothing
//   node scripts/sleep-consolidate.mjs --self-test

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** The ordered consolidation steps. Pure — each maps to a real script under scripts/. */
export function consolidationPlan() {
  return [
    { name: 'memory-consolidate', script: 'memory-consolidate.mjs', args: [], purpose: 'rebuild memory-consolidated.md from the mistake ledger' },
    { name: 'reasoning-distill', script: 'reasoning-distill.mjs', args: [], purpose: 'distill captured contrast into gated strategy candidates' },
  ];
}

function runStep(step) {
  const abs = path.join(ROOT, 'scripts', step.script);
  if (!existsSync(abs)) return { ...step, ok: false, note: 'script missing (skipped)' };
  try {
    const out = execFileSync('node', [abs, ...step.args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ...step, ok: true, note: (out.trim().split('\n').pop() || '').slice(0, 120) };
  } catch (err) {
    // best-effort: a sleep routine never fails the wave that triggered it.
    return { ...step, ok: false, note: `non-fatal error: ${(err.stderr || err.message || '').toString().slice(0, 100)}` };
  }
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const steps = consolidationPlan();
  ok('plan has the two consolidation steps', steps.length === 2);
  ok('step 1 is memory-consolidate', steps[0].name === 'memory-consolidate');
  ok('step 2 is reasoning-distill (runs AFTER consolidate)', steps[1].name === 'reasoning-distill');
  ok('every step maps to a real script on disk (no ghost step)', steps.every((s) => existsSync(path.join(ROOT, 'scripts', s.script))));
  ok('every step has a stated purpose', steps.every((s) => typeof s.purpose === 'string' && s.purpose.length > 0));
  if (fails) { console.log('\n\x1b[31msleep-consolidate self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ sleep-consolidate: between-wave consolidation plan is real and ordered\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const steps = consolidationPlan();
  if (process.argv.includes('--dry')) {
    console.log('[sleep-consolidate] plan (--dry, nothing run):');
    for (const s of steps) console.log(`  • ${s.name} — ${s.purpose}`);
    process.exit(0);
  }
  console.log('[sleep-consolidate] between-wave consolidation:');
  let anyFail = false;
  for (const s of steps) {
    const r = runStep(s);
    if (!r.ok) anyFail = true;
    console.log(`  ${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[33m•\x1b[0m'} ${r.name} — ${r.note}`);
  }
  console.log(anyFail ? '[sleep-consolidate] done (some steps non-fatal-skipped).' : '[sleep-consolidate] done — learned context refreshed for next session-start.');
  process.exit(0); // never fail the wave that triggered the sleep
}
