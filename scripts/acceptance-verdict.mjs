#!/usr/bin/env node
// acceptance-verdict — the independent acceptance check that turns "done" into a PROVEN fact.
//
// THE GAP IT CLOSES: declaration-over-implementation (the single 🔴 Active lesson, recidivist).
// run-state.mjs refuses to close a wave without docs/runs/<wave>/verdict.json. This script PRODUCES
// that verdict by RE-RUNNING the proof command of every acceptance criterion in a fresh check and
// recording each exit code. It is meant to be dispatched by /jidoka-verify as a FRESH subagent (the
// existing reflexion-critic dispatch pattern) — a different context from the one that wrote the code,
// re-executing the proof rather than trusting prior output. Verdict and journal entry then land in
// one act, so the journal cannot lie by omission.
//
// CONTRACT — docs/runs/<wave>/acceptance.json:
//   { "acs": [ { "id": "AC1", "command": "node scripts/foo.mjs --self-test", "note": "…" }, … ] }
//   Optional: { "allowEmpty": true, "emptyJustification": "no testable AC (docs-only wave)" }
//
// OUTPUT — docs/runs/<wave>/verdict.json:
//   { wave, pass, acs:[{id,command,exitCode,executedAt,output}], producedBy, executedAt }
//
// A passing verdict requires pass===true AND every AC exit code 0. An empty AC list is a FAIL
// unless allowEmpty is set with a justification — so "nothing to prove" stays a deliberate act,
// not an accidental green. FULL & self-tested (deterministic, injected runner). Usage:
//   node scripts/acceptance-verdict.mjs --self-test
//   node scripts/acceptance-verdict.mjs <wave>            # uses docs/runs/<wave>/acceptance.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// ── pure core ──────────────────────────────────────────────────────
// Build a verdict from a list of ACs and an injectable runner (command -> { exitCode, output }).
// `now` is injected so the verdict is deterministic in tests.
export function buildVerdict(wave, spec, runner, now) {
  const acs = Array.isArray(spec?.acs) ? spec.acs : [];
  const results = acs.map(ac => {
    const r = runner(ac.command) || { exitCode: 1, output: 'runner returned nothing' };
    return { id: ac.id ?? '?', command: ac.command ?? '', exitCode: r.exitCode, executedAt: now, output: String(r.output ?? '').slice(-1500) };
  });
  let pass;
  if (results.length === 0) {
    pass = spec?.allowEmpty === true && typeof spec?.emptyJustification === 'string' && spec.emptyJustification.length > 0;
  } else {
    pass = results.every(r => r.exitCode === 0);
  }
  const verdict = { wave, pass, acs: results, producedBy: 'acceptance-verdict', executedAt: now };
  if (results.length === 0 && spec?.allowEmpty) verdict.emptyJustification = spec.emptyJustification;
  return verdict;
}

// ── real shell runner ──────────────────────────────────────────────
function shellRunner(root) {
  return (command) => {
    if (!command) return { exitCode: 1, output: 'empty command' };
    try {
      const output = execSync(command, { cwd: root, shell: '/bin/bash', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      return { exitCode: 0, output };
    } catch (e) {
      // execSync throws on non-zero exit / timeout; status is the exit code (null on signal/timeout → 1)
      const out = `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message || '';
      return { exitCode: typeof e.status === 'number' ? e.status : 1, output: out };
    }
  };
}

// ── self-test (deterministic, injected runner) ─────────────────────
function selfTest() {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const now = '2026-06-10T00:00:00.000Z';
  // fake runner: "true*" → exit 0, anything else → exit 1
  const runner = (c) => /^true/.test(c) ? { exitCode: 0, output: 'ok' } : { exitCode: 1, output: 'boom' };

  const allGreen = buildVerdict('wv', { acs: [{ id: 'A', command: 'true' }, { id: 'B', command: 'true x' }] }, runner, now);
  ok('all proof commands exit 0 → pass true', allGreen.pass === true && allGreen.acs.length === 2);
  ok('records exit code + command per AC', allGreen.acs[0].exitCode === 0 && allGreen.acs[0].command === 'true');

  const oneRed = buildVerdict('wv', { acs: [{ id: 'A', command: 'true' }, { id: 'B', command: 'nope' }] }, runner, now);
  ok('one failing proof command → pass false', oneRed.pass === false);
  ok('failing AC carries its non-zero exit code', oneRed.acs.find(a => a.id === 'B').exitCode === 1);

  const emptyNoFlag = buildVerdict('wv', { acs: [] }, runner, now);
  ok('empty AC list without allowEmpty → pass false (no accidental green)', emptyNoFlag.pass === false);
  const emptyFlagged = buildVerdict('wv', { acs: [], allowEmpty: true, emptyJustification: 'docs-only wave' }, runner, now);
  ok('empty AC list with allowEmpty + justification → pass true', emptyFlagged.pass === true && emptyFlagged.emptyJustification === 'docs-only wave');
  ok('empty allowEmpty WITHOUT justification → pass false', buildVerdict('wv', { acs: [], allowEmpty: true }, runner, now).pass === false);

  ok('output is truncated to a tail, not unbounded', buildVerdict('wv', { acs: [{ id: 'A', command: 'true' }] }, () => ({ exitCode: 0, output: 'x'.repeat(5000) }), now).acs[0].output.length === 1500);
  ok('deterministic executedAt from injected now', allGreen.executedAt === now && allGreen.acs[0].executedAt === now);

  // real runner smoke: a true/false command actually round-trips through the shell
  const real = shellRunner(process.cwd());
  ok('real runner: `true` → exit 0', real('true').exitCode === 0);
  ok('real runner: `false` → non-zero', real('false').exitCode !== 0);

  if (fails.length) { console.log(`\n\x1b[31macceptance-verdict self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ acceptance-verdict: proof re-run + verdict shape correct\x1b[0m');
  process.exit(0);
}

// ── CLI ────────────────────────────────────────────────────────────
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const ROOT = process.cwd();
  const wave = process.argv[2];
  if (!wave || wave.startsWith('--')) { console.error('usage: acceptance-verdict.mjs <wave> | --self-test'); process.exit(1); }

  const dir = join(ROOT, 'docs', 'runs', wave);
  const accFile = join(dir, 'acceptance.json');
  if (!existsSync(accFile)) {
    console.error(`✗ ${wave}: no acceptance criteria declared (${join('docs', 'runs', wave, 'acceptance.json')} missing).`);
    console.error('  A wave cannot be proven without runnable acceptance criteria. Declare them:');
    console.error('    { "acs": [ { "id": "AC1", "command": "node scripts/…--self-test", "note": "…" } ] }');
    process.exit(1);
  }
  let spec;
  try { spec = JSON.parse(readFileSync(accFile, 'utf8')); }
  catch (e) { console.error(`✗ ${wave}: acceptance.json is not valid JSON — ${e.message}`); process.exit(1); }

  console.log(`▶ acceptance-verdict ${wave}: re-running ${spec.acs?.length ?? 0} proof command(s) in a fresh check…`);
  const verdict = buildVerdict(wave, spec, shellRunner(ROOT), new Date().toISOString());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');

  for (const ac of verdict.acs) console.log(`  ${ac.exitCode === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${ac.id} · exit ${ac.exitCode} · ${ac.command}`);
  if (verdict.pass) {
    console.log(`\n\x1b[32m✓ ${wave}: PASS — verdict.json written. The wave may now be closed.\x1b[0m`);
    process.exit(0);
  }
  console.log(`\n\x1b[31m✗ ${wave}: FAIL — verdict.json records the failing proof(s). The wave stays open until they pass.\x1b[0m`);
  process.exit(1);
}
