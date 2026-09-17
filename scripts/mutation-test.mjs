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

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, realpathSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { runCli } from './lib/cli.mjs';

const OPS = [
  { from: '===', to: '!==' }, { from: '!==', to: '===' },
  { from: '&&', to: '||' }, { from: '||', to: '&&' },
  { from: '>=', to: '<=' }, { from: '<=', to: '>=' },
  // spaced bare comparisons (negate the condition) — won't match `=>` (eq-gt, no leading space)
  { from: ' > ', to: ' <= ' }, { from: ' < ', to: ' >= ' },
  { from: 'true', to: 'false', word: true }, { from: 'false', to: 'true', word: true },
];

const mk = (src, index, from, to) => ({ index, from, to, line: src.slice(0, index).split('\n').length, mutated: src.slice(0, index) + to + src.slice(index + from.length) });

// mark every character that is NOT executable code — inside a string literal ('...', "...", `...`)
// OR inside a comment (// line, /* block */). Operators/booleans there are EQUIVALENT mutants (flipping
// a reason message or a comment changes no behaviour), so counting them as survivors is noise. Comments
// MUST be handled: an apostrophe in a comment ("architect's") would otherwise open a phantom string and
// mask real code after it. A four-state forward scan (code/str/line/block); \-escapes handled in strings.
// Boundary: does not special-case regex literals — fine here as no regex in the engine contains a quote.
export function stringMask(src) {
  const mask = new Uint8Array(src.length);
  let state = 'code', q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; mask[i] = 1; }
      else if (c === '/' && n === '*') { state = 'block'; mask[i] = 1; }
      else if (c === '"' || c === "'" || c === '`') { state = 'str'; q = c; mask[i] = 1; }
    } else if (state === 'str') {
      mask[i] = 1;
      if (c === '\\') { if (i + 1 < src.length) mask[i + 1] = 1; i++; }
      else if (c === q) { state = 'code'; q = null; }
    } else if (state === 'line') {
      mask[i] = 1;
      if (c === '\n') state = 'code';
    } else if (state === 'block') {
      mask[i] = 1;
      if (c === '*' && n === '/') { mask[i + 1] = 1; i++; state = 'code'; }
    }
  }
  return mask;
}

// pure: every single-point mutant of src (one operator flip each), in source order, capped at max.
// Mutations inside string literals are skipped (equivalent-mutant noise).
export function mutate(src, max = Infinity) {
  const mutants = [];
  const mask = stringMask(src);
  for (const op of OPS) {
    if (op.word) {
      for (const m of src.matchAll(new RegExp(`\\b${op.from}\\b`, 'g'))) {
        if (mask[m.index]) continue;
        mutants.push(mk(src, m.index, op.from, op.to));
        if (mutants.length >= max) return mutants;
      }
    } else {
      let i = src.indexOf(op.from);
      while (i !== -1) {
        if (!mask[i]) { mutants.push(mk(src, i, op.from, op.to)); if (mutants.length >= max) return mutants; }
        i = src.indexOf(op.from, i + op.from.length);
      }
    }
  }
  return mutants;
}

export const scoreOf = ({ killed, survived }) => (killed + survived ? killed / (killed + survived) : null);

// pure: the relative .mjs specifiers a module imports statically (`from './x.mjs'`, `from '../lib/y.mjs'`).
export const relativeImports = (src) => [...src.matchAll(/\bfrom\s+['"](\.\.?\/[^'"]+\.mjs)['"]/g)].map((m) => m[1]);

// every file the target reaches through relative imports, as absolute paths (the target itself excluded).
function importClosure(target) {
  const deps = new Set();
  const queue = [target];
  while (queue.length) {
    const cur = queue.shift();
    for (const spec of relativeImports(readFileSync(cur, 'utf8'))) {
      const abs = resolve(dirname(cur), spec);
      if (abs === target || deps.has(abs) || !existsSync(abs)) continue;
      deps.add(abs);
      queue.push(abs);
    }
  }
  return [...deps];
}

// pure: the deepest folder that contains every given file.
export function commonDir(files) {
  const parts = files.map((f) => dirname(f).split(sep));
  const out = [];
  for (let i = 0; i < parts[0].length; i++) {
    if (!parts.every((p) => p[i] === parts[0][i])) break;
    out.push(parts[0][i]);
  }
  return out.join(sep) || sep;
}

/** Чистая: где кончается библиотечная часть файла (дальше самопроверка и вход CLI). */
export function libraryRegionEnd(src) {
  const guard = src.search(/\n(function selfTest\b|const isMain|if \([^\n]*import\.meta\.url|if \(process\.argv\[1\])/);
  return guard === -1 ? src.length : guard;
}

export function runMutants(file, { max = 60, testCmd } = {}) {
  const src = readFileSync(file, 'utf8');
  // Only mutate the LIBRARY region (above `function selfTest(` and the `const isMain` / import.meta CLI
  // guard). The selfTest body is the TEST itself (mutating its own assertions yields un-killable mutants)
  // and the CLI block is glue --self-test never executes; counting either unfairly depresses the score.
  // Stated boundary: the score reflects the exported LOGIC's test gaps, not the test harness or I/O wrapper.
  // Сторож входа бывает и в форме `if (fileURLToPath(import.meta.url) === process.argv[1])`: без неё
  // область мутаций у cascade-validate разрослась до main() после перевода на строгий разбор (2026-09-16).
  const regionEnd = libraryRegionEnd(src);
  const mutants = mutate(src).filter(m => m.index < regionEnd).slice(0, max);
  const tmp = mkdtempSync(join(tmpdir(), 'jidoka-mut-'));
  // copy the target's relative-.mjs imports TRANSITIVELY (BFS) so the mutated copy resolves them — a
  // one-level copy breaks on deps-of-deps (e.g. run-state → planner → debate-trigger) and every mutant
  // would then falsely count as "killed" on the import error. Imports in subfolders and above
  // (`./lib/cli.mjs`, `../lib/cli.mjs`) are copied too, with the folder layout kept: the flat
  // `./name.mjs` match missed them, and after the strict-CLI migration (2026-09-16) every engine
  // script imports ./lib/cli.mjs — each mutant died on the import error and the score read 100%.
  const target = resolve(file);
  const deps = importClosure(target);
  const root = commonDir([target, ...deps]);
  for (const dep of deps) {
    const to = join(tmp, relative(root, dep));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(dep, to);
  }
  // realpath the temp dir: macOS tmpdir() is symlinked (/var → /private/var); without this,
  // `process.argv[1] === fileURLToPath(import.meta.url)` (the isMain guard) is FALSE in the copy, so
  // the file's --self-test never runs and EVERY mutant falsely "survives". This bug silently faked
  // scores until a manual check caught it — the realpath makes argv[1] match the resolved module URL.
  const tmpFile = join(realpathSync(tmp), relative(root, target));
  mkdirSync(dirname(tmpFile), { recursive: true });
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
  {
    const lib = 'export function f(a) { return a > 0; }\n';
    ok('область мутаций кончается на сторож вида if (fileURLToPath(import.meta.url) === process.argv[1])',
      libraryRegionEnd(`${lib}\nfunction main() { return 1; }\nif (fileURLToPath(import.meta.url) === process.argv[1]) { main(); }\n`) < lib.length + 40);
    ok('область мутаций кончается на const isMain', libraryRegionEnd(`${lib}const isMain = 1;\n`) === lib.length - 1);
    ok('без сторожа мутируется весь файл', libraryRegionEnd(lib) === lib.length);
  }
  const strMut = mutate("const s = 'true === false'; const c = a && b;");
  ok('skips operators/booleans inside string literals (equivalent-mutant noise)', strMut.length === 1 && strMut[0].from === '&&');
  const cmtMut = mutate("// don't mutate: a && b\nlet z = c === d;");
  ok('comment (with apostrophe) does not mask the code after it', cmtMut.some(m => m.from === '===') && !cmtMut.some(m => m.from === '&&'));
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
    // imports from a subfolder and from above are copied with the layout kept: a missing import would
    // kill every mutant on the load error, and a no-op self-test would read as a perfect score
    mkdirSync(join(tmp, 'pkg', 'lib'), { recursive: true });
    mkdirSync(join(tmp, 'pkg', 'sub'), { recursive: true });
    writeFileSync(join(tmp, 'pkg', 'lib', 'h.mjs'), 'export const one = () => 1;\n');
    const down = join(tmp, 'pkg', 'down.mjs');
    writeFileSync(down, 'import { one } from "./lib/h.mjs";\nexport function f(a){ return a >= one(); }\nif (process.argv.includes("--self-test")) { process.exit(0); }\n');
    const up = join(tmp, 'pkg', 'sub', 'up.mjs');
    writeFileSync(up, 'import { one } from \'../lib/h.mjs\';\nexport function f(a){ return a >= one(); }\nif (process.argv.includes("--self-test")) { process.exit(0); }\n');
    ok('subfolder import (./lib/x.mjs) resolves in the copy: no-op self-test is not a fake kill', runMutants(down, { max: 2 }).survived > 0);
    ok('parent-folder import (../lib/x.mjs) resolves in the copy: no-op self-test is not a fake kill', runMutants(up, { max: 2 }).survived > 0);
    ok('relativeImports finds ./ and ../ specifiers, skips packages', relativeImports(`import a from './a.mjs';\nimport { b } from "../lib/b.mjs";\nimport c from 'node:fs';`).join() === './a.mjs,../lib/b.mjs');
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  if (fails.length) { console.log(`\n\x1b[31mmutation-test self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ mutation-test: operator mutation + parse-filter + score discrimination correct\x1b[0m');
  process.exit(0);
}

// Strict parsing (2026-09-16): an unknown flag or a stray word exits 2 before any mutant is written.
export const CLI = {
  name: 'mutation-test',
  summary: 'Мутационная проверка: по одному перевороту оператора в файле, ловит ли его собственный --self-test.',
  selfTest: true,
  options: {
    file: { type: 'string', value: 'путь', desc: 'файл для мутаций (обязателен)' },
    test: { type: 'string', value: 'команда', desc: 'команда проверки, {file} — мутант (по умолчанию node {file} --self-test)' },
    threshold: { type: 'number', default: 0.5, desc: 'порог счёта, 0..1' },
    max: { type: 'number', default: 60, desc: 'сколько мутантов максимум' },
  },
};

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  const { values, selfTest: wantsSelfTest } = runCli(CLI);
  if (wantsSelfTest) selfTest();
  const file = values.file;
  if (!file) { console.error('usage: mutation-test.mjs --file <path> [--test "node {file} --self-test"] [--threshold 0.5] [--max 60]'); process.exit(2); }
  const threshold = values.threshold;
  const max = Math.trunc(values.max);
  const testCmd = values.test;
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
