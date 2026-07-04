#!/usr/bin/env node
// standards-mine — bottom-up convention miner (2026-W27 rank 6).
//
// Every other machinery in the engine is TOP-DOWN (specs prescribe) or RETROSPECTIVE (lessons
// recall). Nothing reads HOW the code in a repo is already written. This is the inversion:
// a read-only, deterministic miner that reads real source, derives the repo's DE-FACTO
// conventions (module system, quote style, node: builtins, self-test layout, export/error
// style, file naming), and injects ONLY the task-relevant subset when an agent works. It
// systematically enforces the today-discipline-only rule "clone the sibling, don't re-author"
// (anti-pattern peer-restyle-instead-of-clone) by making the sibling's real convention explicit.
//
// Guardrails (match the engine's invariants): pure Node, zero-dep, read live code as the ONLY
// source of truth (never invents a convention, never writes a 3rd copy of rules next to
// CLAUDE.md / *STANDARDS.md), inject only top-N (respect the context budget). Reuses the
// existing ESM parser (code-map.parseModule) and the existing lexical ranker
// (memory-retrieve.tokenize/buildIdf/scoreItem) — no new parser, no new ranker.
//
// Usage:
//   node scripts/standards-mine.mjs --dir scripts            # print mined conventions
//   node scripts/standards-mine.mjs --dir scripts --write    # also write docs/standards/conventions.md
//   node scripts/standards-mine.mjs --dir scripts --task "add a new gate script"   # task-relevant subset
//   node scripts/standards-mine.mjs --self-test

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModule } from './code-map.mjs';
import { tokenize, buildIdf, scoreItem } from './memory-retrieve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'out', 'coverage', 'venv', '.venv', '__pycache__']);
const SRC_EXT = /\.(mjs|cjs|js|jsx|ts|tsx)$/;

// pct — dominant share as an integer percent, honest 0 when there is no signal.
function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }

/**
 * Mine de-facto conventions from a set of source files. Pure — no filesystem.
 * @param {Array<{path:string, content:string}>} files
 * @returns {Array<{dimension:string, dominant:string, prevalence:number, sample:number, statement:string}>}
 */
export function mineConventions(files = []) {
  const src = files.filter((f) => SRC_EXT.test(f.path));
  const total = src.length;
  const conv = [];
  const add = (dimension, dominant, hits, statement) =>
    conv.push({ dimension, dominant, prevalence: pct(hits, total), sample: total, statement });

  if (total === 0) return conv;

  // 1. Module system — ESM import/export vs CJS require/module.exports.
  const esm = src.filter((f) => /^\s*import\s|^\s*export\s/m.test(f.content)).length;
  const cjs = src.filter((f) => /\brequire\(|\bmodule\.exports\b/.test(f.content)).length;
  add('module-system', esm >= cjs ? 'ESM (import/export)' : 'CommonJS (require)', Math.max(esm, cjs),
    `Modules use ${esm >= cjs ? 'ESM import/export' : 'CommonJS require'} — match it, do not mix styles.`);

  // 2. node: builtin prefix — how builtins are imported.
  const withPrefix = src.filter((f) => /from\s+['"]node:/.test(f.content)).length;
  const bareBuiltin = src.filter((f) => /from\s+['"](fs|path|url|os|child_process|crypto|util)['"]/.test(f.content)).length;
  if (withPrefix + bareBuiltin > 0)
    add('node-builtin-import', withPrefix >= bareBuiltin ? "node: prefix (from 'node:fs')" : "bare (from 'fs')", Math.max(withPrefix, bareBuiltin),
      `Node builtins are imported with the ${withPrefix >= bareBuiltin ? "node: prefix (import fs from 'node:fs')" : 'bare specifier'} — follow the same form.`);

  // 3. Quote style — prevalence is the dominant quote's share of ALL quote chars (not of files).
  let sq = 0, dq = 0;
  for (const f of src) { sq += (f.content.match(/'/g) || []).length; dq += (f.content.match(/"/g) || []).length; }
  conv.push({
    dimension: 'quote-style',
    dominant: sq >= dq ? "single quotes '" : 'double quotes "',
    prevalence: pct(Math.max(sq, dq), sq + dq),
    sample: total,
    statement: `String literals use ${sq >= dq ? 'single' : 'double'} quotes predominantly.`,
  });

  // 4. Shebang on executable scripts.
  const sheb = src.filter((f) => /^#!/.test(f.content)).length;
  add('shebang', sheb > total / 2 ? 'yes (#!/usr/bin/env node)' : 'no', sheb,
    `Executable scripts ${sheb > total / 2 ? 'start with a #!/usr/bin/env node shebang' : 'usually omit a shebang'}.`);

  // 5. Self-test convention — inline --self-test main guard vs separate test file.
  const selfTest = src.filter((f) => /--self-test|import\.meta\.url\s*===/.test(f.content)).length;
  add('self-test', selfTest > 0 ? 'inline --self-test main guard' : 'separate test file', selfTest,
    `Scripts ${selfTest > 0 ? 'carry an inline --self-test guarded by an import.meta.url main check' : 'are tested from separate files'} — a new script should ship its own proof the same way.`);

  // 6. Export style — named vs default.
  let named = 0, def = 0;
  for (const f of src) { const p = parseModule(f.content); if (p.exports.length) named++; if (/export\s+default\b/.test(f.content)) def++; }
  add('export-style', named >= def ? 'named exports' : 'default export', Math.max(named, def),
    `Modules expose ${named >= def ? 'NAMED exports' : 'a default export'} — keep the public surface consistent.`);

  // 7. Error / exit convention.
  const exits = src.filter((f) => /process\.exit\(/.test(f.content)).length;
  add('exit-convention', exits > total / 2 ? 'explicit process.exit(code)' : 'implicit return', exits,
    `CLIs signal outcome with ${exits > total / 2 ? 'an explicit process.exit(code) — 0 pass / non-zero block' : 'an implicit return'}.`);

  // 8. File naming — kebab-case basenames.
  const kebab = src.filter((f) => /^[a-z0-9]+(-[a-z0-9]+)*\.(mjs|cjs|js|jsx|ts|tsx)$/.test(path.basename(f.path))).length;
  add('file-naming', kebab > total / 2 ? 'kebab-case' : 'mixed', kebab,
    `Source files are named in ${kebab > total / 2 ? 'kebab-case (my-thing.mjs)' : 'a mixed style'} — name a new file to match.`);

  return conv;
}

/**
 * Return only the task-relevant conventions, ranked by the existing lexical ranker.
 * @param {Array} conventions from mineConventions
 * @param {string} taskText
 * @param {number} k
 */
export function relevantConventions(conventions, taskText, k = 4) {
  if (!taskText || !conventions.length) return conventions.slice(0, k);
  const docTfs = conventions.map((c) => {
    const tf = new Map();
    for (const t of tokenize(`${c.dimension} ${c.dominant} ${c.statement}`)) tf.set(t, (tf.get(t) || 0) + 1);
    return tf;
  });
  const idf = buildIdf(docTfs);
  const q = tokenize(taskText);
  return conventions
    .map((c, i) => ({ c, s: scoreItem(q, docTfs[i], idf) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.c);
}

function renderMarkdown(conventions, dir) {
  const lines = [
    '# Mined conventions (de-facto)',
    '',
    `Source: \`${dir}\` — ${conventions[0]?.sample ?? 0} file(s). Derived by \`scripts/standards-mine.mjs\` from the`,
    'live code, not authored by hand. Regenerate with `node scripts/standards-mine.mjs --dir <dir> --write`.',
    '',
    '| dimension | dominant | prevalence |',
    '| --- | --- | --- |',
    ...conventions.map((c) => `| ${c.dimension} | ${c.dominant} | ${c.prevalence}% |`),
    '',
    '## What each means',
    '',
    ...conventions.map((c) => `- **${c.dimension}** — ${c.statement}`),
    '',
  ];
  return lines.join('\n');
}

/**
 * Convenience: collect a directory's source files and mine their conventions.
 * Lets a live caller (get-spec-context, a hook) inject conventions without re-doing IO.
 * @param {string} dir  absolute or ROOT-relative directory
 * @returns {Array} conventions from mineConventions ([] if the dir has no source)
 */
export function mineDir(dir = 'scripts') {
  const abs = path.isAbsolute(dir) ? dir : path.resolve(ROOT, dir);
  return mineConventions(collectFiles(abs));
}

function collectFiles(absDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); }
      else if (e.isFile() && SRC_EXT.test(e.name)) {
        try { out.push({ path: path.relative(ROOT, full), content: fs.readFileSync(full, 'utf8') }); } catch { /* skip unreadable */ }
      }
    }
  };
  walk(absDir);
  return out;
}

// ── self-test ──────────────────────────────────────────────────────────────
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--self-test')) {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  const files = [
    { path: 'a.mjs', content: "#!/usr/bin/env node\nimport fs from 'node:fs';\nexport function aa(){}\nif (x) process.exit(0);\n// --self-test\n" },
    { path: 'my-thing.mjs', content: "import path from 'node:path';\nexport const bb = 1;\nprocess.exit(1);\n" },
    { path: 'c.mjs', content: "import os from 'node:os';\nexport function cc(){}\n" },
  ];
  const conv = mineConventions(files);
  const byDim = Object.fromEntries(conv.map((c) => [c.dimension, c]));
  ok('mines a set of dimensions', conv.length >= 6);
  ok('detects ESM as the module system', byDim['module-system'].dominant.startsWith('ESM'));
  ok('detects node: builtin prefix (100%)', byDim['node-builtin-import'].dominant.includes('node:') && byDim['node-builtin-import'].prevalence === 100);
  ok('detects named exports', byDim['export-style'].dominant === 'named exports');
  ok('detects explicit process.exit', byDim['exit-convention'].dominant.includes('process.exit'));
  ok('detects kebab-case file naming', byDim['file-naming'].dominant === 'kebab-case');
  ok('prevalence is an integer 0..100', conv.every((c) => Number.isInteger(c.prevalence) && c.prevalence >= 0 && c.prevalence <= 100));
  ok('empty input → empty conventions (honest, no fabrication)', mineConventions([]).length === 0);

  const rel = relevantConventions(conv, 'how should I name and export a new node builtin import module', 3);
  ok('task-relevant subset respects k', rel.length === 3);
  ok('task-relevant subset is a subset of mined', rel.every((r) => conv.includes(r)));

  if (fails) { console.log('\n\x1b[31mstandards-mine self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ standards-mine derives de-facto conventions from real code\x1b[0m');
  process.exit(0);
}

if (isMain) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const dir = arg('--dir') || 'scripts';
  const absDir = path.resolve(ROOT, dir);
  const files = collectFiles(absDir);
  if (files.length === 0) { console.log(`[standards-mine] no source files under ${dir} — nothing to mine.`); process.exit(0); }
  let conv = mineConventions(files);
  const task = arg('--task');
  if (task) conv = relevantConventions(conv, task, Number(arg('--k')) || 4);

  if (process.argv.includes('--json')) { console.log(JSON.stringify({ dir, files: files.length, conventions: conv }, null, 2)); process.exit(0); }

  console.log(`[standards-mine] ${files.length} file(s) under ${dir}${task ? ` — top ${conv.length} for task` : ''}:`);
  for (const c of conv) console.log(`  ${c.dimension.padEnd(20)} ${c.dominant.padEnd(34)} ${c.prevalence}%`);

  if (process.argv.includes('--write')) {
    const outDir = path.resolve(ROOT, 'docs', 'standards');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'conventions.md');
    fs.writeFileSync(outFile, renderMarkdown(mineConventions(files), dir), 'utf8');
    console.log(`[standards-mine] wrote ${path.relative(ROOT, outFile)}`);
  }
  process.exit(0);
}
