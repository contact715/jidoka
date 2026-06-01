#!/usr/bin/env node
// mutation-test — zero-dep mutation testing for the engine (GSD borrow D, jidoka idiom).
//
// GSD's one place ahead of us: gsd-core runs Stryker mutation testing on its engine (kills the
// "100% coverage, 0% assertions" illusion). jidoka prizes a zero-dep eval that runs on a clean clone,
// so instead of pulling Stryker we mutate in our own idiom: flip one operator at a time in a target
// file, run that file's OWN --self-test against the mutant, and see if the self-test CATCHES it.
// It mutation-tests the self-tests jidoka leans on — if a flip survives, that self-test has a hole.
//
// HONEST by construction:
//  - Syntax-error mutants are EXCLUDED via `node --check` (a parse failure is not a real test kill;
//    counting it would inflate the score). Score = killed / VALID(parseable) mutants.
//  - Curated operator set (comparison / logical / boolean flips), NOT Stryker's full AST catalog.
//    Stated boundary, like instantiation-audit's "curated manifest, not full auto-scan".
//  - The real source is never touched: every mutant is written to a temp copy and run from there.
//
// FULL & self-tested. Usage:
//   node scripts/mutation-test.mjs --self-test
//   node scripts/mutation-test.mjs --file scripts/coverage-gate.mjs [--threshold 0.5] [--max 60]
//   node scripts/mutation-test.mjs --file scripts/x.mjs --test 'node {file} --self-test'

import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync, copyFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const OPS = [
  { from: '===', to: '!==' }, { from: '!==', to: '===' },
  { from: '&&', to: '||' }, { from: '||', to: '&&' },
  { from: '>=', to: '<=' }, { from: '<=', to: '>=' },
  // spaced bare comparisons (negate the condition) — won't match `=>` (eq-gt, no leading space)
  { from: ' > ', to: ' <= ' }, { from: ' < ', to: ' >= ' },
  { from: 'true', to: 'false', word: true }, { from: 'false', to: 'true', word: true },
];

const mk = (src, index, from, to) => ({ index, from, to, line: src.slice(0, index).split('\n').length, mutated: src.slice(0, index) + to + src.slice(index + from.length) });

// pure: every single-point mutant of src (one operator flip each), in source order, capped at max
export function mutate(src, max = Infinity) {
  const mutants = [];
  for (const op of OPS) {
    if (op.word) {
      for (const m of src.matchAll(new RegExp(`\\b${op.from}\\b`, 'g'))) {
        mutants.push(mk(src, m.index, op.from, op.to));
        if (mutants.length >= max) return mutants;
      }
    } else {
      let i = src.indexOf(op.from);
      while (i !== -1) {
        mutants.push(mk(src, i, op.from, op.to));
        if (mutants.length >= max) return mutants;
        i = src.indexOf(op.from, i + op.from.length);
      }
    }
  }
  return mutants;
}

export const scoreOf = ({ killed, survived }) => (killed + survived ? killed / (killed + survived) : null);

export function runMutants(file, { max = 60, testCmd } = {}) {
  const src = readFileSync(file, 'utf8');
  // Only mutate the LIBRARY region (above the `const isMain` / import.meta CLI guard). The CLI block
  // is glue that --self-test never executes, so mutating it yields un-killable mutants that unfairly
  // depress the score. Stated boundary; the score reflects the tested logic, not the I/O wrapper.
  const guard = src.search(/\n(const isMain|if \(import\.meta|if \(process\.argv\[1\])/);
  const regionEnd = guard === -1 ? src.length : guard;
  const mutants = mutate(src).filter(m => m.index < regionEnd).slice(0, max);
  const tmp = mkdtempSync(join(tmpdir(), 'jidoka-mut-'));
  // copy the target's direct relative-.mjs imports so the mutated copy resolves them (else it would
  // fail on import and every mutant would falsely count as "killed").
  const srcDir = dirname(file);
  for (const dep of src.matchAll(/from '\.\/([\w-]+\.mjs)'/g)) {
    if (existsSync(join(srcDir, dep[1]))) copyFileSync(join(srcDir, dep[1]), join(tmp, dep[1]));
  }
  // realpath the temp dir: macOS tmpdir() is symlinked (/var → /private/var); without this,
  // `process.argv[1] === fileURLToPath(import.meta.url)` (the isMain guard) is FALSE in the copy, so
  // the file's --self-test never runs and EVERY mutant falsely "survives". This bug silently faked
  // scores until a manual check caught it — the realpath makes argv[1] match the resolved module URL.
  const tmpFile = join(realpathSync(tmp), basename(file));
  let killed = 0, survived = 0, invalid = 0;
  const survivors = [];
  try {
    for (const mu of mutants) {
      writeFileSync(tmpFile, mu.mutated);
      try { execSync(`node --check ${JSON.stringify(tmpFile)}`, { stdio: 'ignore' }); }
      catch { invalid++; continue; } // syntax-broken mutant — not a real kill, exclude
      const cmd = (testCmd || 'node {file} --self-test').replace('{file}', JSON.stringify(tmpFile));
      let testPassed = true;
      try { execSync(cmd, { stdio: 'ignore', timeout: 20000 }); } catch { testPassed = false; }
      if (testPassed) { survived++; survivors.push(mu); } else killed++;
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return { total: mutants.length, valid: killed + survived, invalid, killed, survived, score: scoreOf({ killed, survived }), survivors };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const ms = mutate('if (a === b && x) return true;');
  ok('mutate flips === to !==', ms.some(m => m.to === '!==' && m.from === '==='));
  ok('mutate flips && to ||', ms.some(m => m.from === '&&' && m.to === '||'));
  ok('mutate flips true to false', ms.some(m => m.from === 'true' && m.to === 'false'));
  ok('mutate respects max', mutate('a === b === c === d', 2).length === 2);
  ok('mutant carries a line number', ms.every(m => m.line >= 1));
  ok('score = killed/(killed+survived)', scoreOf({ killed: 3, survived: 1 }) === 0.75);
  ok('score null when no valid mutants', scoreOf({ killed: 0, survived: 0 }) === null);

  // end-to-end discrimination: a STRONG self-test kills mutants, a NO-OP self-test lets them survive
  const tmp = mkdtempSync(join(tmpdir(), 'jidoka-mut-st-'));
  try {
    const strong = join(tmp, 'strong.mjs');
    writeFileSync(strong, 'export function f(a){ return a >= 0; }\nif (process.argv.includes("--self-test")) { process.exit(f(1) === true && f(-1) === false ? 0 : 1); }\n');
    const weak = join(tmp, 'weak.mjs');
    writeFileSync(weak, 'export function f(a){ return a >= 0; }\nif (process.argv.includes("--self-test")) { process.exit(0); }\n');
    const guarded = join(tmp, 'guarded.mjs');
    writeFileSync(guarded, 'import { fileURLToPath } from "node:url";\nexport function g(a){ return a >= 0; }\nconst isMain = process.argv[1] === fileURLToPath(import.meta.url);\nif (isMain && process.argv.includes("--self-test")) { process.exit(g(1) === true && g(-1) === false ? 0 : 1); }\n');
    const sr = runMutants(strong, { max: 6 });
    const wr = runMutants(weak, { max: 6 });
    const grd = runMutants(guarded, { max: 6 });
    ok('isMain-guarded self-test runs in temp copy (realpath fix) + kills mutants', grd.killed > 0);
    ok('strong self-test KILLS mutants (score > 0)', sr.killed > 0 && sr.score > 0);
    ok('no-op self-test lets mutants SURVIVE (gap surfaced)', wr.survived > 0);
    ok('strong scores higher than no-op (discriminates)', sr.score > (wr.score ?? 0));
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  if (fails.length) { console.log(`\n\x1b[31mmutation-test self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ mutation-test: operator mutation + parse-filter + score discrimination correct\x1b[0m');
  process.exit(0);
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : d; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const file = arg('--file');
  if (!file) { console.error('usage: mutation-test.mjs --file <path> [--test "node {file} --self-test"] [--threshold 0.5] [--max 60]'); process.exit(2); }
  const threshold = parseFloat(arg('--threshold', '0.5'));
  const max = parseInt(arg('--max', '60'), 10);
  const testCmd = arg('--test');
  console.log(`mutation-test: ${file}  (max ${max} mutants, threshold ${threshold})\n`);
  const r = runMutants(file, { max, testCmd });
  if (r.valid === 0) { console.log('  no valid mutants generated (no mutable operators found) — skipping'); process.exit(0); }
  console.log(`  ${r.killed}/${r.valid} mutants killed  ·  ${r.invalid} invalid (syntax, excluded)  ·  score ${(r.score * 100).toFixed(0)}%`);
  if (r.survivors.length) {
    console.log(`\n  survived (test gaps — the self-test did not catch these flips):`);
    for (const s of r.survivors.slice(0, 12)) console.log(`    line ${s.line}: ${s.from} → ${s.to}`);
    if (r.survivors.length > 12) console.log(`    … +${r.survivors.length - 12} more`);
  }
  if (r.score < threshold) { console.error(`\n\x1b[31m✗ mutation score ${(r.score * 100).toFixed(0)}% < threshold ${(threshold * 100).toFixed(0)}%\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ mutation score ${(r.score * 100).toFixed(0)}% ≥ threshold ${(threshold * 100).toFixed(0)}%\x1b[0m`);
  process.exit(0);
}
