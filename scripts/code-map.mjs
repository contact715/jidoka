#!/usr/bin/env node
// code-map — a STRUCTURAL map of the codebase (import/export graph), so agents orient by structure
// instead of grepping blind. Honest naming: this is a deterministic import/export graph, NOT ML
// embeddings. It answers the two questions surface-cartographer can't from grep alone:
//   • "where is symbol X defined?"            (symbol → file index)
//   • "what breaks if I touch file Y?"        (blast radius — who imports it, transitively)
// On a large repo this is the difference between an agent finding the right file and missing it.
//
// FULL & self-tested (ESM import/export parsing via regex — enough for ESM; not a full AST).
// Usage:
//   node scripts/code-map.mjs --self-test
//   node scripts/code-map.mjs --dir scripts            # summary: modules, symbols, orphans
//   node scripts/code-map.mjs --dir scripts --symbol loadLedger   # where defined + who uses
//   node scripts/code-map.mjs --dir scripts --blast meta-lib.mjs  # what breaks if you touch it

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { runCli } from './lib/cli.mjs';

// pure: parse one ESM module's exports + local imports
export function parseModule(content) {
  const exports = [];
  for (const m of String(content).matchAll(/export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z_$][\w$]*)/g)) exports.push(m[1]);
  for (const m of String(content).matchAll(/export\s*\{([^}]+)\}/g)) for (const n of m[1].split(',')) { const parts = n.trim().split(/\s+as\s+/); const nm = (parts[1] || parts[0] || '').trim(); if (nm && nm !== 'default') exports.push(nm); }
  const imports = [];
  for (const m of String(content).matchAll(/import\s+[^;]*?from\s+['"]([^'"]+)['"]/g)) imports.push(m[1]);
  for (const m of String(content).matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) imports.push(m[1]);
  return { exports: [...new Set(exports)], imports };
}

const resolveRel = (from, imp) => join(dirname(from), imp);

// pure: build the graph from [{path, content}]
export function buildGraph(files) {
  const modules = {}, symbolIndex = {}, importers = {};
  for (const f of files) { modules[f.path] = parseModule(f.content); importers[f.path] = []; }
  for (const [path, m] of Object.entries(modules)) {
    for (const e of m.exports) (symbolIndex[e] ||= []).push(path);
    for (const imp of m.imports) {
      if (!imp.startsWith('.')) continue;
      const resolved = resolveRel(path, imp);
      if (importers[resolved]) importers[resolved].push(path);
    }
  }
  return { modules, symbolIndex, importers };
}

// pure: transitive set of modules that (directly or indirectly) import `path`
export function blastRadius(importers, path) {
  const seen = new Set(), queue = [path];
  while (queue.length) { const p = queue.shift(); for (const imp of (importers[p] || [])) if (!seen.has(imp)) { seen.add(imp); queue.push(imp); } }
  return [...seen];
}

function selfTest() {
  const files = [
    { path: 'a.mjs', content: 'import { x } from "./b.mjs";\nexport function aa(){}' },
    { path: 'b.mjs', content: 'import { y } from "./c.mjs";\nexport const x = 1;' },
    { path: 'c.mjs', content: 'export const y = 2;' },
    { path: 'orphan.mjs', content: 'export const z = 3;' },
  ];
  const g = buildGraph(files);
  const T = [
    ['parses exports', parseModule('export function foo(){}').exports[0] === 'foo'],
    ['parses brace exports', parseModule('export { a, b as c }').exports.join(',') === 'a,c'],
    ['parses imports', parseModule('import x from "./y.mjs"').imports[0] === './y.mjs'],
    ['symbol index points at definer', g.symbolIndex.x[0] === 'b.mjs'],
    ['importers: b is imported by a', g.importers['b.mjs'].includes('a.mjs')],
    ['blast radius is transitive (touch c → a and b break)', blastRadius(g.importers, 'c.mjs').sort().join(',') === 'a.mjs,b.mjs'],
    ['orphan has no importers', g.importers['orphan.mjs'].length === 0],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mcode-map self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ code-map: import/export graph correct\x1b[0m');
  process.exit(0);
}

function scan(dir) {
  const files = [];
  for (const f of readdirSync(dir)) { const p = join(dir, f); try { if (statSync(p).isFile() && /\.(mjs|js|ts)$/.test(f)) files.push({ path: p, content: readFileSync(p, 'utf8') }); } catch { /* skip */ } }
  return files;
}

// Разбор строгий (2026-09-16): незнакомый флаг, лишнее слово или флаг без значения — код 2
// до чтения папки. Код 2 на «папка не найдена» был и раньше.
export const CLI = {
  name: 'code-map',
  summary: 'Структурная карта кода (граф import/export): где определён символ и что сломается при правке файла.',
  selfTest: true,
  options: {
    dir: { type: 'string', value: 'папка', desc: 'что сканировать (по умолчанию scripts)' },
    symbol: { type: 'string', value: 'имя', desc: 'где определён экспорт и кто его импортирует' },
    blast: { type: 'string', value: 'файл.mjs', desc: 'радиус поражения: кто импортирует файл, транзитивно' },
  },
};

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  const { values, selfTest: wantsSelfTest } = runCli(CLI);
  if (wantsSelfTest) selfTest();
  const dir = values.dir || 'scripts';
  if (!existsSync(dir)) { console.error(`code-map: ${dir} not found`); process.exit(2); }
  const g = buildGraph(scan(dir));
  const sym = values.symbol || null, blast = values.blast || null;
  if (sym) {
    const def = g.symbolIndex[sym] || [];
    console.log(`symbol "${sym}": ${def.length ? 'defined in ' + def.join(', ') : 'not found'}`);
    for (const d of def) { const users = g.importers[d] || []; console.log(`  ${basename(d)} used by ${users.length}: ${users.map(p => basename(p)).join(', ') || '(none)'}`); }
    process.exit(0);
  }
  if (blast) {
    const path = join(dir, blast);
    const r = blastRadius(g.importers, path);
    console.log(`blast radius of ${blast}: ${r.length} module(s) would be affected${r.length ? ':\n  ' + r.map(p => basename(p)).join(', ') : ' (safe — nothing imports it)'}`);
    process.exit(0);
  }
  const mods = Object.keys(g.modules);
  const orphans = mods.filter(p => g.importers[p].length === 0);
  const hub = mods.map(p => [p, g.importers[p].length]).sort((a, b) => b[1] - a[1])[0];
  console.log(`code-map: ${dir} — ${mods.length} modules, ${Object.keys(g.symbolIndex).length} exported symbols`);
  console.log(`  most-imported (hub): ${hub ? basename(hub[0]) + ' (' + hub[1] + ' importers)' : '—'}`);
  console.log(`  orphans (no local importer — CLI entrypoints + leaves): ${orphans.length}`);
  console.log(`  \x1b[2m--symbol <name> to locate, --blast <file.mjs> for impact radius before touching it.\x1b[0m`);
  process.exit(0);
}
