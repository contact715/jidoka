#!/usr/bin/env node
// type-coverage — measure how genuinely TYPED a TypeScript codebase is: count the deliberate
// type-escapes (`: any`, `as any`, `<any>`, `any[]`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`)
// per 1000 LOC and gate on the density. A green tsc with `any` everywhere is a lie this catches.
//
// HONEST boundary: a marker-density heuristic, NOT a tsc type-checker run (no compiler dependency, runs
// on a clean clone). It measures explicit escapes, not inferred-any. The framework itself is .mjs (no
// TypeScript) → it SKIPS honestly (N/A) and the gate ships to products via install-into.
//
// FULL & self-tested. Usage:
//   node scripts/type-coverage.mjs --self-test
//   node scripts/type-coverage.mjs [--dir src] [--max-per-1k 5]

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ESCAPE = /(:\s*any\b|<any>|\bany\[\]|\bas\s+any\b|@ts-ignore|@ts-nocheck|@ts-expect-error)/g;

// pure: type-escape density per 1000 LOC over a list of {path, text}
export function assess(files, { maxPer1k = 5 } = {}) {
  let loc = 0, escapes = 0;
  for (const f of files) {
    loc += f.text.split('\n').length;
    escapes += (f.text.match(ESCAPE) || []).length;
  }
  const per1k = loc ? +((1000 * escapes) / loc).toFixed(2) : 0;
  return { files: files.length, loc, escapes, per1k, ok: per1k <= maxPer1k };
}

function tsFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push({ path: p, text: readFileSync(p, 'utf8') });
  }
  return acc;
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const clean = { path: 'a.ts', text: 'function f(x: number): string { return String(x); }\nconst y: User = load();\n' };
  const dirty = { path: 'b.ts', text: 'function g(x: any): any { return x as any; }\n// @ts-ignore\nconst z: any[] = [];\n' };

  ok('clean typed file → 0 escapes, ok', (() => { const a = assess([clean]); return a.escapes === 0 && a.ok === true; })());
  ok('any/as any/@ts-ignore/any[] all counted', assess([dirty]).escapes >= 4);
  ok('high escape density → NOT ok', assess([dirty], { maxPer1k: 5 }).ok === false);
  ok('counts ": any" but not the word "company"', assess([{ path: 'c.ts', text: 'const company = 1; const x: any = 2;' }]).escapes === 1);
  ok('empty fileset → 0 density, ok (vacuous pass)', assess([]).ok === true && assess([]).per1k === 0);
  ok('density scales per 1000 LOC', (() => { const big = { path: 'd.ts', text: 'const x: any = 1;\n' + 'const y = 2;\n'.repeat(999) }; return assess([big]).per1k <= 5; })());

  if (fails.length) { console.log(`\n\x1b[31mtype-coverage self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ type-coverage: type-escape density assessment correct\x1b[0m');
  process.exit(0);
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : d; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const dir = arg('--dir', existsSync('src') ? 'src' : '.');
  const files = existsSync(dir) ? tsFiles(dir) : [];
  if (files.length === 0) {
    console.log(`type-coverage: no .ts/.tsx files under ${dir}/ — N/A (this repo is not TypeScript). The gate ships to products.`);
    process.exit(0);
  }
  const maxPer1k = parseFloat(arg('--max-per-1k', '5'));
  const r = assess(files, { maxPer1k });
  console.log(`type-coverage: ${r.files} TS files · ${r.loc} LOC · ${r.escapes} type-escape(s) · ${r.per1k}/1k (max ${maxPer1k})`);
  if (!r.ok) { console.error(`\n\x1b[31m✗ type-escape density ${r.per1k}/1k > ${maxPer1k}/1k — too many any/@ts-ignore. Type the code, don't escape it.\x1b[0m`); process.exit(1); }
  console.log('\x1b[32m✓ type-escape density within budget.\x1b[0m');
  process.exit(0);
}
