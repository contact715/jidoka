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

// ── step-outcome-taxonomy (2026-W33-R2) ─────────────────────────────────────
// Six realities used to be squeezed into two bits (`ran`, `pass`), and the squeeze hid the worst
// one: a gate whose script is absent returned {ran:false, pass:false}, while the failure filter
// asked for `r.ran && r.pass === false`. The missing gate fell out of the list and the phase went
// green. A gate that is not on disk protects nothing; reporting that as "not a failure" is the
// same shape as the incident of 2026-08-04, where a step killed on time printed PASS.
//
//   passed   — ran, exit 0
//   failed   — ran, non-zero exit: the thing it guards is broken
//   missing  — the gate script is not on disk: it guards nothing, and that FAILS the phase
//   timeout  — killed on the clock: NOT proof of anything, neither green nor red
//   skipped  — legitimately not applicable (file-scoped gate, nothing changed)
//   dry-run  — execution was not requested
// `ok` needs zero failed, zero missing, zero timeout and zero unknown. Only skipped and dry-run
// are free, because only they mean "there was nothing here to check".
export const STEP_OUTCOMES = ['passed', 'failed', 'missing', 'timeout', 'skipped', 'dry-run'];
const BLOCKING = new Set(['failed', 'missing', 'timeout']);
/** Outcomes that did not produce evidence — "не проверено", reported apart from real failures. */
const NOT_RUN = new Set(['missing', 'timeout']);

// how long a single gate may run before it is killed and reported as `timeout` rather than hanging
// the whole phase forever (the quick win named in the W33 report alongside this taxonomy)
export const GATE_TIMEOUT_MS = Number(process.env.PHASE_GATE_TIMEOUT_MS || 120_000);

/** Derive the typed outcome from a raw result. Kept pure so both new and legacy shapes map. */
export function outcomeOf(r = {}) {
  if (r.outcome) return r.outcome;
  if (r.timedOut) return 'timeout';
  if (r.detail === 'dry-run') return 'dry-run';
  if (r.ran === false && r.pass === false) return 'missing';
  if (r.ran === false) return 'skipped';
  return r.pass === true ? 'passed' : 'failed';
}

function runGate(g, { changed, root }) {
  const script = join(HERE, `${g.gate}.mjs`);
  const base = { gate: g.gate, mode: g.mode };
  if (!existsSync(script)) return { ...base, outcome: 'missing', ran: false, pass: false, detail: 'script not on disk' };
  const exec = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe', timeout: GATE_TIMEOUT_MS });
  try {
    if (g.mode === 'file') {
      if (!changed.length) return { ...base, outcome: 'skipped', ran: false, pass: null, detail: `file-scoped (${g.flag}) — no --changed given` };
      for (const f of changed) exec(`node ${JSON.stringify(script)} ${g.flag} ${JSON.stringify(f)}`);
      return { ...base, outcome: 'passed', ran: true, pass: true, detail: `${g.flag} scanned ${changed.length} file(s) clean` };
    }
    exec(`node ${JSON.stringify(script)}`);
    return { ...base, outcome: 'passed', ran: true, pass: true, detail: 'ok' };
  } catch (e) {
    // A kill on the clock is not a verdict about the code. execSync surfaces it as SIGTERM/ETIMEDOUT.
    const timedOut = e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT' || e.killed === true;
    if (timedOut) return { ...base, outcome: 'timeout', ran: false, pass: null, timedOut: true, detail: `снят по времени после ${GATE_TIMEOUT_MS}мс — НЕ ПРОВЕРЕНО` };
    return { ...base, outcome: 'failed', ran: true, pass: false, detail: String(e.stdout || e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 200) };
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
  // runOne is injectable so the taxonomy can be tested without putting fake scripts on disk
  const runner = opts.runOne || ((g) => runGate(g, { changed, root }));
  const raw = opts.dryRun
    ? run.map((g) => ({ gate: g.gate, mode: g.mode, outcome: 'dry-run', ran: false, pass: null, detail: 'dry-run' }))
    : run.map((g) => runner(g, { changed, root }));
  const results = raw.map((r) => ({ ...r, outcome: outcomeOf(r) }));

  const failed = results.filter((r) => r.outcome === 'failed');
  const notRun = results.filter((r) => NOT_RUN.has(r.outcome));
  const blocking = results.filter((r) => BLOCKING.has(r.outcome));
  const count = (o) => results.filter((r) => r.outcome === o).length;

  return {
    phase,
    ok: blocking.length === 0 && unknown.length === 0,
    results, needsInput, dormant, unknown,
    // `failed` keeps its old meaning (a gate ran and said no) so existing callers do not shift
    // meaning under them; `notRun` is the new, separately-named bucket that used to vanish.
    failed: failed.map((r) => r.gate),
    notRun: notRun.map((r) => r.gate),
    summary: [
      `${count('passed')} green`,
      `${failed.length} failed`,
      // named in capitals because the incident was a truthful line losing to a cheerful one below it
      `НЕ ЗАПУСКАЛОСЬ: ${notRun.length}${notRun.length ? ` (${notRun.map((r) => `${r.gate}/${r.outcome}`).join(', ')})` : ''}`,
      `${count('skipped') + count('dry-run')} skipped`,
      `${needsInput.length} needs-input`,
      `${dormant.length} dormant`,
      `${unknown.length} unknown`,
    ].join(' · '),
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

  // ── step-outcome-taxonomy (2026-W33-R2) ──────────────────────────────────
  // A step used to have two bits, `ran` and `pass`, and three different realities were squeezed
  // into them. The worst squeeze: a gate whose script is NOT ON DISK returned {ran:false,
  // pass:false} and the failure filter read `r.ran && r.pass === false`, so the missing gate was
  // dropped from `failed` and the phase came out GREEN. A gate that does not exist protects
  // nothing, and the runner said everything was fine. The same collapse is why a step killed on
  // time could read as a plain failure, and why "не проверено" had nowhere to live.
  ok('a gate script that is NOT on disk is outcome "missing"', outcomeOf({ ran: false, pass: false, detail: 'script not on disk' }) === 'missing');
  ok('a missing gate BLOCKS the phase, and is named as not-run rather than as a failure', (() => {
    const r = runPhaseGates('gate', { phases: [{ phase: 'gate', gates: ['dead-code'] }] }, {
      root: process.cwd(), runOne: () => ({ gate: 'dead-code', mode: 'project', outcome: 'missing', detail: 'script not on disk' }),
    });
    // blocking, but NOT in `failed`: nothing ran, so nothing said no. Calling it a failure would be
    // as wrong as calling it a pass — that separation is the whole point of the taxonomy.
    return r.ok === false && r.notRun.includes('dead-code') && !r.failed.includes('dead-code');
  })());
  ok('a step killed on time is "timeout", not a pass and not a plain failure',
    outcomeOf({ ran: false, pass: false, timedOut: true }) === 'timeout');
  ok('a timeout FAILS the phase and is named separately from failures', (() => {
    const r = runPhaseGates('gate', { phases: [{ phase: 'gate', gates: ['dead-code'] }] }, {
      runOne: () => ({ gate: 'dead-code', mode: 'project', outcome: 'timeout', detail: 'killed after 120000ms' }),
    });
    return r.ok === false && r.notRun.includes('dead-code') && !r.failed.includes('dead-code');
  })());
  ok('a legitimately skipped file-gate still does NOT fail the phase', (() => {
    const r = runPhaseGates('build', plan, {});
    return r.ok === true && r.results.every((x) => x.outcome === 'skipped');
  })());
  ok('a real pass is outcome "passed"', outcomeOf({ ran: true, pass: true }) === 'passed');
  ok('a real failure is outcome "failed"', outcomeOf({ ran: true, pass: false }) === 'failed');
  ok('the summary names not-run steps out loud, never folded into green', (() => {
    const r = runPhaseGates('gate', { phases: [{ phase: 'gate', gates: ['dead-code'] }] }, {
      runOne: () => ({ gate: 'dead-code', mode: 'project', outcome: 'missing', detail: 'x' }),
    });
    return /НЕ ЗАПУСКАЛОСЬ: 1/.test(r.summary);
  })());

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
  // the mark is driven by the OUTCOME, not by a two-state guess: a step that never ran must not
  // wear the same symbol as one that ran and passed, nor the same as one that ran and failed
  const MARK = { passed: '\x1b[32m✓\x1b[0m', failed: '\x1b[31m✗\x1b[0m', missing: '\x1b[31m⌀ НЕ ЗАПУСКАЛСЯ\x1b[0m', timeout: '\x1b[31m⏱ НЕ ПРОВЕРЕНО\x1b[0m', skipped: '\x1b[33m○\x1b[0m', 'dry-run': '\x1b[33m○\x1b[0m' };
  for (const x of r.results) console.log(`  ${MARK[x.outcome] || '\x1b[33m○\x1b[0m'} ${x.gate} (${x.mode}) — ${x.detail}`);
  for (const n of r.needsInput) console.log(`  \x1b[33m◇\x1b[0m ${n.gate} (needs-input) — executor must pass: ${n.need}`);
  if (r.dormant.length) console.log(`  \x1b[33m○ dormant (need infra/data): ${r.dormant.join(', ')}\x1b[0m`);
  if (r.unknown.length) console.log(`  \x1b[31m✗ unknown (no invocation rule — close this gap): ${r.unknown.join(', ')}\x1b[0m`);
  console.log(`\n  ${r.summary}`);
  console.log(r.ok ? '  \x1b[32m✓ phase gates green — executor may advance\x1b[0m' : '  \x1b[31m✗ phase gates NOT green — executor must HALT, not advance\x1b[0m');
  process.exit(r.ok ? 0 : 1);
}
