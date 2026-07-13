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
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
// REUSE the EARS/AC label primitives (do not reimplement the parser). ac-coverage-check owns the
// "AC label -> test" axis; this script adds the complementary "declared AC -> proof present" axis.
import { extractAcLabels, testReferencesLabel } from './ac-coverage-check.mjs';

// ── AC-completeness (W29-R1) ───────────────────────────────────────
// The gap: buildVerdict only ever runs the ACs LISTED in acceptance.json. If the spec DECLARES an
// acceptance criterion (an EARS/AC label) but it is silently dropped from acceptance.json, every
// remaining proof exits 0 and the verdict is green — declaration-over-implementation at the verdict
// layer. completenessGaps returns the declared labels that have NO matching proof in acs[]: a label
// is "covered" when it appears (as a token: AC-x, [x], EARS-3) in an AC's id or note. Pure + injectable.
export function completenessGaps(declaredLabels, acs) {
  const list = Array.isArray(acs) ? acs : [];
  const decl = Array.isArray(declaredLabels) ? [...new Set(declaredLabels)] : [];
  return decl.filter(label => !list.some(ac => testReferencesLabel(`${ac?.id ?? ''} ${ac?.note ?? ''}`, label)));
}

// ── pure core ──────────────────────────────────────────────────────
// Build a verdict from a list of ACs and an injectable runner (command -> { exitCode, output }).
// `now` is injected so the verdict is deterministic in tests. `spec.declaredAcs` (optional) is the
// set of AC labels the SPEC declares must be proven; any declared label with no matching proof in
// acs[] forces pass=false (recorded as verdict.missingDeclaredAcs) — a wave cannot go green while a
// declared criterion is silently absent from the evidence set.
export function buildVerdict(wave, spec, runner, now) {
  const acs = Array.isArray(spec?.acs) ? spec.acs : [];
  const results = acs.map(ac => {
    const r = runner(ac.command) || { exitCode: 1, output: 'runner returned nothing' };
    return { id: ac.id ?? '?', command: ac.command ?? '', exitCode: r.exitCode, executedAt: now, output: String(r.output ?? '').slice(-1500) };
  });
  const missingDeclaredAcs = completenessGaps(spec?.declaredAcs, acs);
  let pass;
  if (results.length === 0) {
    pass = spec?.allowEmpty === true && typeof spec?.emptyJustification === 'string' && spec.emptyJustification.length > 0;
  } else {
    pass = results.every(r => r.exitCode === 0);
  }
  if (missingDeclaredAcs.length > 0) pass = false; // declared-but-unproven AC blocks the verdict
  const verdict = { wave, pass, acs: results, producedBy: 'acceptance-verdict', executedAt: now };
  if (missingDeclaredAcs.length > 0) verdict.missingDeclaredAcs = missingDeclaredAcs;
  if (results.length === 0 && spec?.allowEmpty) verdict.emptyJustification = spec.emptyJustification;
  return verdict;
}

// Load the AC labels DECLARED in a wave's spec file(s). acceptance.json may carry
// `specPath` (string) or `specPaths` (string[]) — the spec(s) its ACs are derived from. Returns the
// deduped label set; missing/unreadable files are skipped (the check simply has nothing to enforce).
export function loadDeclaredAcs(root, spec) {
  const paths = spec?.specPaths ?? (spec?.specPath ? [spec.specPath] : []);
  const labels = new Set();
  for (const p of paths) {
    try { for (const l of extractAcLabels(readFileSync(resolve(root, p), 'utf8'))) labels.add(l); }
    catch { /* unreadable spec → nothing to enforce from it */ }
  }
  return [...labels];
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

  // ── AC-completeness (W29-R1): a declared AC absent from the proof set blocks a green verdict ──
  ok('completenessGaps: declared label with a matching AC id → no gap',
    completenessGaps(['EARS-3'], [{ id: 'EARS-3', command: 'true' }]).length === 0);
  ok('completenessGaps: declared label matched via note token → no gap',
    completenessGaps(['A1'], [{ id: 'AC2', command: 'true', note: 'covers AC-A1' }]).length === 0);
  ok('completenessGaps: declared label with NO matching proof → reported as a gap',
    JSON.stringify(completenessGaps(['EARS-3', 'A1'], [{ id: 'A1', command: 'true' }])) === '["EARS-3"]');
  const dropped = buildVerdict('wv', { acs: [{ id: 'A1', command: 'true' }], declaredAcs: ['A1', 'EARS-9'] }, runner, now);
  ok('all proofs green BUT a declared AC is silently dropped → pass false', dropped.pass === false);
  ok('dropped declared AC is named in verdict.missingDeclaredAcs', JSON.stringify(dropped.missingDeclaredAcs) === '["EARS-9"]');
  const fullyCovered = buildVerdict('wv', { acs: [{ id: 'A1', command: 'true' }, { id: 'EARS-9', command: 'true x' }], declaredAcs: ['A1', 'EARS-9'] }, runner, now);
  ok('every declared AC has a green proof → pass true, no missing list', fullyCovered.pass === true && fullyCovered.missingDeclaredAcs === undefined);
  ok('no declaredAcs field → completeness is a no-op (back-compat)', buildVerdict('wv', { acs: [{ id: 'A', command: 'true' }] }, runner, now).pass === true);

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

  // W29-R1: pull the AC labels the spec DECLARES (from spec.specPath[s]) so a declared-but-dropped
  // criterion cannot pass. When no specPath is declared this is a no-op — additive, never retroactive.
  const declaredAcs = loadDeclaredAcs(ROOT, spec);
  if (declaredAcs.length > 0) console.log(`  · completeness: ${declaredAcs.length} AC label(s) declared in spec — checking all are proven`);

  console.log(`▶ acceptance-verdict ${wave}: re-running ${spec.acs?.length ?? 0} proof command(s) in a fresh check…`);
  const verdict = buildVerdict(wave, { ...spec, declaredAcs }, shellRunner(ROOT), new Date().toISOString());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');

  for (const ac of verdict.acs) console.log(`  ${ac.exitCode === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${ac.id} · exit ${ac.exitCode} · ${ac.command}`);
  if (verdict.missingDeclaredAcs?.length) {
    console.log(`  \x1b[31m✗ declared but NOT proven: ${verdict.missingDeclaredAcs.join(', ')}\x1b[0m — add a proof command for each, or the wave stays open.`);
  }
  if (verdict.pass) {
    console.log(`\n\x1b[32m✓ ${wave}: PASS — verdict.json written. The wave may now be closed.\x1b[0m`);
    process.exit(0);
  }
  console.log(`\n\x1b[31m✗ ${wave}: FAIL — verdict.json records the failing proof(s). The wave stays open until they pass.\x1b[0m`);
  process.exit(1);
}
