#!/usr/bin/env node
// ac-verify-map — maps every L3 module-spec acceptance criterion to its executable
// verification, and (in --run) actually executes the self-test / engine-test ones to
// prove the ACs hold. This is "acceptance criteria as tests": an L3 AC is not prose,
// it carries the command that proves it.
//
// DISTINCT from map-ac-coverage.mjs (which maps wave-spec L4 ACs to test FILES). This
// one works on the L3 module tree (docs/specs/modules/**), where each AC embeds a
// fenced command block written by the spec-tree generator.
//
// Verify-kind classification (from the AC's command block):
//   self    — ends in `--self-test`            (runnable, pure)
//   engine  — `node --test scripts/__tests__/` (runnable, pure)
//   cli     — other `node scripts/...`         (runnable, may need state — not auto-run)
//   manual  — starts with manual:/fixture:/observe:/audit:/behavior:/covered by
// An AC is WIRED when its command references a script file that exists on disk.
//
// Usage:
//   node scripts/ac-verify-map.mjs            # report + write the map, exit 0
//   node scripts/ac-verify-map.mjs --run      # also EXECUTE every self/engine AC; exit 1 on any failure
//   node scripts/ac-verify-map.mjs --strict   # exit 1 if any AC has no command block, or any command names a missing script
//   node scripts/ac-verify-map.mjs --json
//   node scripts/ac-verify-map.mjs --self-test

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES_DIR = join(ROOT, 'docs/specs/modules');
const OUT = join(ROOT, 'docs/metrics/ac-verify-map.json');

// ── pure: extract ACs and their command blocks from a module spec ────────────
// Each AC is `### AC-N — title` followed by a fenced ```...``` block (the command).
export function extractACVerifies(content) {
  const out = [];
  const re = /^###\s+(AC-\d+)\s+—\s+(.+?)\s*$\n+```\n([\s\S]*?)\n```/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push({ id: m[1], title: m[2].trim(), command: m[3].trim() });
  }
  return out;
}

// ── pure: classify a command into a verify-kind ──────────────────────────────
export function classifyVerify(command) {
  const c = command.trim();
  // Manual prefixes win FIRST — prose like "covered by X --self-test" is documentation,
  // not a runnable command, even though it ends in --self-test.
  if (/^(manual|fixture|observe|audit|behavior|config|grep|covered by)\b/i.test(c)) return 'manual';
  if (/--self-test\s*$/.test(c)) return 'self';
  if (/^node\s+--test\s+/.test(c)) return 'engine';
  if (/^node\s+scripts\//.test(c)) return 'cli';
  return 'manual';
}

// ── pure: the script path a command references (for the WIRED check) ──────────
export function referencedScript(command) {
  const m = command.match(/node\s+(?:--test\s+)?(scripts\/[A-Za-z0-9_\-./]+\.(?:mjs|test\.mjs))/);
  return m ? m[1] : null;
}

// ── pure: roll the per-AC rows into a summary ────────────────────────────────
export function summarize(rows) {
  const total = rows.length;
  const byKind = { self: 0, engine: 0, cli: 0, manual: 0 };
  let wired = 0, executable = 0;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    if (r.wired) wired++;
    if (r.kind === 'self' || r.kind === 'engine') executable++;
  }
  return { total, byKind, wired, executable };
}

// ── impure: collect module specs ─────────────────────────────────────────────
function moduleSpecs() {
  const out = [];
  if (!existsSync(MODULES_DIR)) return out;
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!e.name.startsWith('_') && !e.name.startsWith('.')) walk(join(dir, e.name)); }
      else if (e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('_')) out.push(join(dir, e.name));
    }
  })(MODULES_DIR);
  return out;
}

function buildRows() {
  const rows = [];
  for (const file of moduleSpecs()) {
    const content = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    for (const ac of extractACVerifies(content)) {
      const kind = classifyVerify(ac.command);
      const script = referencedScript(ac.command);
      const wired = script ? existsSync(join(ROOT, script)) : (kind === 'manual');
      rows.push({ spec: rel, id: ac.id, title: ac.title, command: ac.command, kind, script, wired });
    }
  }
  return rows;
}

function selfTest() {
  const sample = [
    '### AC-1 — Self-test passes',
    '',
    '```',
    'node scripts/spec-drift-check.mjs --self-test',
    '```',
    '',
    '### AC-2 — A miss is reported',
    '',
    '```',
    'observe: warning printed',
    '```',
    '',
    '### AC-3 — Engine test passes',
    '',
    '```',
    'node --test scripts/__tests__/meta-lib.test.mjs',
    '```',
  ].join('\n');
  const acs = extractACVerifies(sample);
  const T = [
    ['extracts all three ACs', acs.length === 3],
    ['classifies --self-test as self', classifyVerify(acs[0].command) === 'self'],
    ['classifies observe: as manual', classifyVerify(acs[1].command) === 'manual'],
    ['classifies node --test as engine', classifyVerify(acs[2].command) === 'engine'],
    ['referencedScript pulls the self-test script', referencedScript(acs[0].command) === 'scripts/spec-drift-check.mjs'],
    ['referencedScript pulls the engine test file', referencedScript(acs[2].command) === 'scripts/__tests__/meta-lib.test.mjs'],
    ['manual command has no referenced script', referencedScript(acs[1].command) === null],
    ['summary counts kinds', (() => { const s = summarize([{ kind: 'self', wired: true }, { kind: 'manual', wired: true }]); return s.total === 2 && s.byKind.self === 1 && s.executable === 1; })()],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log(`\n\x1b[31mac-verify-map self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ ac-verify-map self-test passes\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) selfTest();

const rows = buildRows();
const summary = summarize(rows);
const run = process.argv.includes('--run');
const strict = process.argv.includes('--strict');

// --run: execute every self/engine AC and record pass/fail (real executable proof).
let runResults = [];
let runFails = 0;
if (run) {
  const seen = new Set(); // dedupe identical commands (many ACs share `--self-test`)
  for (const r of rows) {
    if ((r.kind !== 'self' && r.kind !== 'engine') || seen.has(r.command)) continue;
    seen.add(r.command);
    try {
      execSync(r.command, { cwd: ROOT, stdio: 'pipe' });
      runResults.push({ command: r.command, ok: true });
    } catch {
      runResults.push({ command: r.command, ok: false });
      runFails++;
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, rows, runResults }, null, 2));
} else {
  console.log(`ac-verify-map: ${summary.total} ACs across ${moduleSpecs().length} module specs`);
  console.log(`  executable (self/engine): ${summary.executable}   cli: ${summary.byKind.cli}   manual: ${summary.byKind.manual}`);
  console.log(`  wired (command → real file, or manual): ${summary.wired}/${summary.total}`);
  if (run) {
    const ok = runResults.filter(r => r.ok).length;
    console.log(`  --run: executed ${runResults.length} unique self/engine checks → ${ok} passed, ${runFails} failed`);
    for (const r of runResults.filter(r => !r.ok)) console.log(`    \x1b[31m✗ ${r.command}\x1b[0m`);
  }
}

writeFileSync(OUT, JSON.stringify({ generated: 'spec-tree-overhaul', summary, rows, runResults }, null, 2) + '\n');

// strict: a real spec must give every AC a command, and every command that names a
// script must resolve. This blocks a NEW L3 spec whose ACs are unverifiable prose.
if (strict) {
  const broken = rows.filter(r => r.script && !r.wired);
  if (broken.length) {
    console.error(`\x1b[31m✗ ${broken.length} AC(s) reference a script that does not exist:\x1b[0m`);
    for (const b of broken) console.error(`    ${b.spec} ${b.id}: ${b.command}`);
    process.exit(1);
  }
}

if (run && runFails > 0) {
  console.error(`\x1b[31m✗ ac-verify-map --run: ${runFails} acceptance check(s) FAILED\x1b[0m`);
  process.exit(1);
}

process.exit(0);
