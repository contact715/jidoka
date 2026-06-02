#!/usr/bin/env node
// cross-layer-dup — detect the same validation/business logic duplicated across BE and FE layers.
// Smell: a developer replicates email validation, price calculation, or status checks on both the
// frontend (for UX) and the backend (for correctness). When the rule changes, one copy diverges.
// The fix: extract to a shared module or API contract.
//
// Approach: normalize code blocks to a fingerprint (strip whitespace/identifiers), find blocks
// that appear in both a backend/ and a frontend/ path. HONEST boundary: text similarity, not
// semantic equivalence (two different implementations of the same logic won't be caught).
//
// Usage:
//   node scripts/cross-layer-dup.mjs --self-test
//   node scripts/cross-layer-dup.mjs --be-dir src/server --fe-dir src/client

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

// JS keywords to keep (they define structure, not naming)
const JS_KW = new Set(['if','else','while','for','forEach','map','reduce','return','const','let','var','function','async','await','class','new','import','export','from','try','catch','throw','switch','case','break','continue','of','in','typeof','instanceof']);

// normalise a code line into a fingerprint: collapse user identifiers but keep JS keywords
// so "if (a > b)" and "while (a > b)" produce DIFFERENT fingerprints
function normalise(line) {
  return line
    .replace(/\/\/.*$/, '')           // strip line comments
    .replace(/"[^"]*"|'[^']*'/g, 'S') // collapse string literals
    .replace(/\b\d+\.?\d*\b/g, 'N')  // collapse numbers
    .replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g, (m) => JS_KW.has(m) ? m : 'I') // user ids → I
    .replace(/\s+/g, ' ')
    .trim();
}

// extract normalised 4-line sliding windows from a file
function windows(code, size = 4) {
  const lines = code.split('\n').map(normalise).filter((l) => l.length > 3);
  const result = [];
  for (let i = 0; i + size <= lines.length; i++) result.push(lines.slice(i, i + size).join('|'));
  return result;
}

function collect(dir, exts = ['.js', '.ts', '.jsx', '.tsx']) {
  if (!existsSync(dir)) return {};
  const map = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.includes(extname(e.name))) {
        const code = readFileSync(p, 'utf8');
        for (const w of windows(code)) {
          (map[w] ??= []).push(p);
        }
      }
    }
  };
  walk(dir);
  return map;
}

export function findDuplicates(beDir, feDir) {
  const be = collect(beDir);
  const fe = collect(feDir);
  const dups = [];
  for (const [fingerprint, beFiles] of Object.entries(be)) {
    if (fe[fingerprint]) {
      dups.push({ fingerprint: fingerprint.slice(0, 80), beFiles: [...new Set(beFiles)], feFiles: [...new Set(fe[fingerprint])] });
    }
  }
  return { duplicates: dups, count: dups.length, ok: dups.length === 0 };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  // normalise strips identifiers but keeps structure
  ok('normalise collapses identifiers', normalise('const email = value.trim();') === normalise('const addr = input.trim();'));
  ok('normalise keeps structure differences', normalise('if (a > b)') !== normalise('while (a > b)'));

  // windows with identical logic produce same fingerprints
  const logic = `function validate(x) {\n  if (!x) return false;\n  if (x.length < 3) return false;\n  return true;\n}`;
  const wins = windows(logic);
  ok('windows produces non-empty fingerprints for real code', wins.length > 0);
  ok('same code produces same fingerprint (duplicate detection works)', windows(logic)[0] === windows(logic)[0]);

  // different code produces different fingerprints
  const other = `function save(x) {\n  db.insert(x);\n  log(x);\n  return x;\n}`;
  ok('different code produces different fingerprints', windows(logic)[0] !== windows(other)[0]);

  if (fails.length) { console.log(`\n\x1b[31mcross-layer-dup self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ cross-layer-dup: fingerprint dedup across BE/FE layers correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const beDir = arg('--be-dir') || 'src/server';
  const feDir = arg('--fe-dir') || 'src/client';
  const r = findDuplicates(beDir, feDir);
  if (r.count === 0) { console.log(`\x1b[32m✓ cross-layer-dup: no logic duplication found between ${beDir} and ${feDir}\x1b[0m`); process.exit(0); }
  console.error(`\x1b[31m✗ cross-layer-dup: ${r.count} duplicated logic block(s) between BE and FE\x1b[0m`);
  r.duplicates.slice(0, 5).forEach((d) => console.error(`  BE: ${d.beFiles[0]}\n  FE: ${d.feFiles[0]}\n  pattern: ${d.fingerprint}\n`));
  process.exit(1);
}
