#!/usr/bin/env node
// execution-gate — "verification by execution". reflexion-critic checks STATICS (spec match + tsc +
// lint). That proves the code is shaped right, not that it RUNS. This gate answers: what command
// actually exercises this change at runtime, and does the project even HAVE a runtime proof?
//
// It detects the project's real verify command (npm test / pytest / cargo test / go test / build),
// and flags when there is NO runtime proof available (a change with only static checks is "looks
// right", not "works"). The orchestrator then RUNS the detected command (via the run/verify skill or
// CI) and observes the result — lifting "no done without proof" from statics to runtime.
//
// HONEST SPLIT: detection of the verify command = FULL (here, self-tested). The actual run + observe
// happens in the target project (jidoka itself: `npm run eval` / `npm run test:engine`). --run will
// execute the detected commands when invoked in a project that has them.
//
// FULL & self-tested. Usage:
//   node scripts/execution-gate.mjs --self-test
//   node scripts/execution-gate.mjs --dir <project>        # detect runtime-verify commands
//   node scripts/execution-gate.mjs --dir <project> --run  # detect AND run them, observe result

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// pure: given package.json + a file listing, what RUNS this project?
export function detectVerify(pkg, files) {
  const cmds = [];
  const s = (pkg && pkg.scripts) || {};
  const realTest = s.test && !/no test specified/i.test(s.test);
  if (realTest) cmds.push({ kind: 'test', cmd: 'npm test', why: 'package.json test script' });
  if (s['test:engine']) cmds.push({ kind: 'test', cmd: 'npm run test:engine', why: 'zero-dep engine tests' });
  if (s.eval) cmds.push({ kind: 'test', cmd: 'npm run eval', why: 'deterministic eval suite' });
  if (s.e2e) cmds.push({ kind: 'e2e', cmd: 'npm run e2e', why: 'package.json e2e script' });
  if (s.build) cmds.push({ kind: 'build', cmd: 'npm run build', why: 'package.json build script' });
  if (files.some(f => /(^|\/)(conftest\.py|pytest\.ini)$/.test(f) || /(_test|test_).*\.py$/.test(f))) cmds.push({ kind: 'test', cmd: 'pytest -q', why: 'pytest files present' });
  if (files.includes('Cargo.toml')) cmds.push({ kind: 'test', cmd: 'cargo test', why: 'Cargo.toml' });
  if (files.includes('go.mod')) cmds.push({ kind: 'test', cmd: 'go test ./...', why: 'go.mod' });
  return cmds;
}

// a build alone is NOT runtime proof — it compiles, it doesn't run behaviour
export function hasRuntimeProof(cmds) { return cmds.some(c => c.kind === 'test' || c.kind === 'e2e'); }

function selfTest() {
  const T = [
    ['npm test detected', detectVerify({ scripts: { test: 'vitest' } }, [])[0].cmd === 'npm test'],
    ['placeholder test skipped', detectVerify({ scripts: { test: 'echo "Error: no test specified"' } }, []).length === 0],
    ['pytest detected from files', detectVerify({}, ['app_test.py', 'conftest.py']).some(c => c.cmd === 'pytest -q')],
    ['cargo detected', detectVerify({}, ['Cargo.toml']).some(c => c.cmd === 'cargo test')],
    ['go detected', detectVerify({}, ['go.mod']).some(c => c.cmd === 'go test ./...')],
    ['test counts as runtime proof', hasRuntimeProof([{ kind: 'test' }]) === true],
    ['build alone is NOT runtime proof', hasRuntimeProof([{ kind: 'build' }]) === false],
    ['no verify → no runtime proof', hasRuntimeProof(detectVerify({}, ['README.md'])) === false],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mexecution-gate self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ execution-gate: verify-command detection correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const dir = arg('--dir') || process.cwd();
  const doRun = process.argv.includes('--run');
  const pkg = existsSync(join(dir, 'package.json')) ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) : null;
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const cmds = detectVerify(pkg, files);
  console.log(`execution-gate: runtime-verify for ${dir}\n`);
  if (!cmds.length) { console.error('\x1b[31m✗ NO runtime verify detected — this project has no test/e2e/build command. A change here can only be checked statically (looks-right), not run (works). Add a test.\x1b[0m'); process.exit(1); }
  for (const c of cmds) console.log(`  • [${c.kind}] ${c.cmd}   (${c.why})`);
  if (!hasRuntimeProof(cmds)) { console.error('\n\x1b[33m⚠ only a build command — compiles but does not exercise behaviour. Add a test/e2e for real runtime proof.\x1b[0m'); process.exit(1); }
  if (!doRun) { console.log('\n  \x1b[2mrun these to prove the change works at runtime (or pass --run). Statics (tsc/lint) are not enough.\x1b[0m'); process.exit(0); }
  for (const c of cmds.filter(x => x.kind === 'test' || x.kind === 'e2e')) {
    console.log(`\n▶ ${c.cmd}`);
    try { execSync(c.cmd, { cwd: dir, stdio: 'inherit' }); } catch { console.error(`\x1b[31m✗ runtime verify FAILED: ${c.cmd} — the change does not work, regardless of statics.\x1b[0m`); process.exit(1); }
  }
  console.log('\n\x1b[32m✓ runtime verify passed — the change actually runs.\x1b[0m');
  process.exit(0);
}
