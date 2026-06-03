#!/usr/bin/env node
// phase-gate-runner — the missing mechanical glue for the wave executor (see
// docs/specs/JIDOKA_WAVE_EXECUTOR_SPEC.md). Given a phase + the plan from orchestration-planner,
// it RUNS that phase's PHASE_GATES script-gates and reports pass/fail, so the executor can gate
// each phase MECHANICALLY instead of "the gates are listed somewhere and run by hand".
//
// Invocation rules are GROUNDED in each gate's REAL CLI (verified, not assumed — the first draft
// false-RED'd mutation-test by running it bare when it needs --file). Modes:
//   • project    — scans cwd with no args (dead-code, contract-check, dependency-audit, …)
//   • file       — needs the wave's changed files; scans each with the gate's flag (resource/precision: --code)
//   • needs-input — needs an input the runner does not have generically (mutation-test: --file+--test;
//                   spec-size-check: --spec; plan-check: --task). REPORTED with the exact need, never
//                   run wrong, never fake-passed, never fake-failed. The executor feeds the input.
//   • dormant    — needs runtime infra/data absent at gate time (load-test/e2e/canary). Reported.
//   • unknown    — no rule → phase NOT ok (a gap to close, never ignored).
// LLM-judge gates (reflexion-critic, …) live in the phase's agents[] and are dispatched by the
// ORCHESTRATOR, not here.
//
// FULL & self-tested. Usage:
//   node scripts/phase-gate-runner.mjs --self-test
//   node scripts/phase-gate-runner.mjs --phase gate --plan plan.json [--changed "a.ts,b.ts"]

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

// per-gate invocation, grounded in the real CLI of each script
export const GATES = {
  // project-scoped: scan cwd with no args (verified: run bare → green)
  'dead-code': { mode: 'project' }, 'contract-check': { mode: 'project' }, 'dependency-audit': { mode: 'project' },
  'coverage-gate': { mode: 'project' }, 'cross-layer-dup': { mode: 'project' }, 'type-coverage': { mode: 'project' },
  'property-test': { mode: 'project' }, 'req-trace': { mode: 'project' }, 'prod-harvest': { mode: 'project' },
  // file-scoped: need the wave's changed files, scan each with the gate's flag
  'resource-guard': { mode: 'file', flag: '--code' }, 'precision-guard': { mode: 'file', flag: '--code' },
  // needs-input: require an input the runner has no generic way to supply — report the exact need
  'mutation-test': { mode: 'needs-input', need: '--file <target> --test "<cmd>" per changed file' },
  'spec-size-check': { mode: 'needs-input', need: '--spec <spec-file>' },
  'plan-check': { mode: 'needs-input', need: '--task <json>' },
  // dormant: need runtime infra/data not present at gate time
  'load-test-gate': { mode: 'dormant' }, 'e2e-run-gate': { mode: 'dormant' },
  'canary-gate': { mode: 'dormant' }, 'verify-goal-backward': { mode: 'dormant' },
};

// classify a phase's gates into run / needs-input / dormant / unknown — the honest action plan
export function classifyGates(gates = []) {
  const run = [], needsInput = [], dormant = [], unknown = [];
  for (const g of gates) {
    const spec = GATES[g];
    if (!spec) unknown.push(g);
    else if (spec.mode === 'dormant') dormant.push(g);
    else if (spec.mode === 'needs-input') needsInput.push({ gate: g, need: spec.need });
    else run.push({ gate: g, ...spec });
  }
  return { run, needsInput, dormant, unknown };
}

function runGate(g, { changed, root }) {
  const script = join(HERE, `${g.gate}.mjs`);
  if (!existsSync(script)) return { gate: g.gate, mode: g.mode, ran: false, pass: false, detail: 'script not on disk' };
  try {
    if (g.mode === 'file') {
      if (!changed.length) return { gate: g.gate, mode: g.mode, ran: false, pass: null, detail: `file-scoped (${g.flag}) — no --changed given` };
      for (const f of changed) execSync(`node ${JSON.stringify(script)} ${g.flag} ${JSON.stringify(f)}`, { cwd: root, stdio: 'pipe' });
      return { gate: g.gate, mode: g.mode, ran: true, pass: true, detail: `${g.flag} scanned ${changed.length} file(s) clean` };
    }
    execSync(`node ${JSON.stringify(script)}`, { cwd: root, stdio: 'pipe' });
    return { gate: g.gate, mode: g.mode, ran: true, pass: true, detail: 'ok' };
  } catch (e) {
    return { gate: g.gate, mode: g.mode, ran: true, pass: false, detail: String(e.stdout || e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 200) };
  }
}

// run all runnable gates of a phase; ok requires zero FAILURES and zero UNKNOWNs.
// needs-input + dormant are reported (transparent), not counted as pass or fail — the executor
// supplies inputs (changed files / spec / task) in a real wave; here they are surfaced, never faked.
export function runPhaseGates(phase, plan, opts = {}) {
  const root = opts.root || process.cwd();
  const changed = opts.changed || [];
  const p = (plan.phases || []).find((x) => x.phase === phase);
  if (!p) return { phase, ok: false, error: `phase "${phase}" not in plan`, results: [], needsInput: [], dormant: [], unknown: [] };
  const { run, needsInput, dormant, unknown } = classifyGates(p.gates || []);
  const results = opts.dryRun ? run.map((g) => ({ gate: g.gate, mode: g.mode, ran: false, pass: null, detail: 'dry-run' })) : run.map((g) => runGate(g, { changed, root }));
  const failed = results.filter((r) => r.ran && r.pass === false);
  return {
    phase,
    ok: failed.length === 0 && unknown.length === 0,
    results, needsInput, dormant, unknown,
    failed: failed.map((r) => r.gate),
    summary: `${results.filter((r) => r.pass === true).length} green · ${failed.length} failed · ${results.filter((r) => r.pass === null).length} skipped · ${needsInput.length} needs-input · ${dormant.length} dormant · ${unknown.length} unknown`,
  };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const c = classifyGates(['dead-code', 'resource-guard', 'mutation-test', 'load-test-gate', 'totally-bogus']);
  ok('project gate → run', c.run.some((x) => x.gate === 'dead-code' && x.mode === 'project'));
  ok('file gate → run with its flag (--code)', c.run.some((x) => x.gate === 'resource-guard' && x.flag === '--code'));
  ok('mutation-test → needs-input (NOT run bare — the first-draft false-red)', c.needsInput.some((x) => x.gate === 'mutation-test'));
  ok('dormant gate → dormant', c.dormant.includes('load-test-gate'));
  ok('unknown gate → unknown (gap surfaced)', c.unknown.includes('totally-bogus'));

  const plan = { phases: [
    { phase: 'gate', gates: ['dead-code', 'mutation-test', 'load-test-gate'] },
    { phase: 'build', gates: ['resource-guard', 'precision-guard'] },
    { phase: 'memory', gates: ['totally-bogus'] },
  ] };
  const g = runPhaseGates('gate', plan, { dryRun: true });
  ok('needs-input + dormant are reported, not failures (ok stays true)', g.ok === true && g.needsInput.length === 1 && g.dormant.length === 1);
  const b = runPhaseGates('build', plan);
  ok('file gates with no --changed → skipped (pass:null), not green/red', b.results.every((r) => r.pass === null && r.ran === false));
  const m = runPhaseGates('memory', plan);
  ok('unknown gate → phase NOT ok', m.ok === false && m.unknown.length === 1);
  ok('phase not in plan → error + not ok', runPhaseGates('nope', plan).error?.includes('not in plan'));
  ok('dry-run executes nothing real', runPhaseGates('build', plan, { dryRun: true, changed: ['x.ts'] }).results.every((r) => r.detail === 'dry-run'));

  if (fails.length) { console.log(`\n\x1b[31mphase-gate-runner self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ phase-gate-runner: per-phase gate execution + honest classification correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const phase = arg('--phase'), planPath = arg('--plan');
  if (!phase || !planPath) { console.error('usage: --phase <name> --plan <plan.json> [--changed "a,b"] | --self-test'); process.exit(2); }
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const changed = (arg('--changed') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const r = runPhaseGates(phase, plan, { changed });
  console.log(`phase-gate-runner — phase "${phase}"\n`);
  for (const x of r.results) console.log(`  ${x.pass === true ? '\x1b[32m✓\x1b[0m' : x.pass === false ? '\x1b[31m✗\x1b[0m' : '\x1b[33m○\x1b[0m'} ${x.gate} (${x.mode}) — ${x.detail}`);
  for (const n of r.needsInput) console.log(`  \x1b[33m◇\x1b[0m ${n.gate} (needs-input) — executor must pass: ${n.need}`);
  if (r.dormant.length) console.log(`  \x1b[33m○ dormant (need infra/data): ${r.dormant.join(', ')}\x1b[0m`);
  if (r.unknown.length) console.log(`  \x1b[31m✗ unknown (no invocation rule — close this gap): ${r.unknown.join(', ')}\x1b[0m`);
  console.log(`\n  ${r.summary}`);
  console.log(r.ok ? '  \x1b[32m✓ phase gates green — executor may advance\x1b[0m' : '  \x1b[31m✗ phase gates NOT green — executor must HALT, not advance\x1b[0m');
  process.exit(r.ok ? 0 : 1);
}
