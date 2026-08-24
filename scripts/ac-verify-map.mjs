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
  // 2026-W35-B1 — the fallback used to be `manual`, i.e. the ONE bucket that is credited
  // as covered without any machine check. So a typo, a renamed flag or an unfamiliar
  // wording silently improved the coverage number instead of lowering it. An oracle whose
  // default answer is the flattering one measures its own vocabulary, not the work.
  return 'unrecognized';
}

// ── pure: is this AC's verification actually reachable? ──────────────────────
// Split out of buildRows so the rule is testable without touching the disk.
//   self/engine/cli — wired when the script it names exists
//   manual          — CREDITED by declaration: a human said "covered by X", no machine check
//   unrecognized    — never wired: nothing understood the command at all
export function wiredOf({ kind, script, scriptExists }) {
  if (kind === 'unrecognized') return false;
  if (script) return Boolean(scriptExists);
  return kind === 'manual';
}

// ── pure: the script path a command references (for the WIRED check) ──────────
export function referencedScript(command) {
  const m = command.match(/node\s+(?:--test\s+)?(scripts\/[A-Za-z0-9_\-./]+\.(?:mjs|test\.mjs))/);
  return m ? m[1] : null;
}

// ── pure: roll the per-AC rows into a summary ────────────────────────────────
export function summarize(rows) {
  const total = rows.length;
  const byKind = { self: 0, engine: 0, cli: 0, manual: 0, unrecognized: 0 };
  let wired = 0, executable = 0, credited = 0;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    if (r.wired) wired++;
    if (r.kind === 'self' || r.kind === 'engine') executable++;
    // 2026-W35-B1 — counted APART from `wired`. "Covered by X" is a promise a human
    // wrote, not evidence a machine produced; folding it into one number is how the
    // headline came to read 91/91 while --run executed 13 checks.
    if (r.kind === 'manual') credited++;
  }
  return { total, byKind, wired, executable, credited };
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
      const wired = wiredOf({ kind, script, scriptExists: script ? existsSync(join(ROOT, script)) : false });
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

    // ── 2026-W35-B1: the fallback must NOT be the most favourable bucket ──────
    // Measured 2026-08-24: the headline read "wired 91/91" while --run executed 13
    // checks; 42 ACs sat in `manual` (credited by declaration, never proven) and 2 more
    // had fallen into `manual` silently because nothing recognised their wording.
    // An unrecognised command is a DEFECT IN THE SPEC and must be visible as one.
    ['an unrecognised command is NOT silently called manual',
      classifyVerify('checked by pre-publish-guard home-path rule') === 'unrecognized'],
    ['a DECLARED manual command is still manual',
      classifyVerify('covered by pre-publish-guard home-path rule') === 'manual'],
    ['an unrecognised AC is never wired, even if a script name appears in it',
      wiredOf({ kind: 'unrecognized', script: 'scripts/meta-lib.mjs', scriptExists: true }) === false],
    ['a declared manual AC is credited without any file',
      wiredOf({ kind: 'manual', script: null, scriptExists: false }) === true],
    ['a cli AC is wired only when its script really exists',
      wiredOf({ kind: 'cli', script: 'scripts/gone.mjs', scriptExists: false }) === false
      && wiredOf({ kind: 'cli', script: 'scripts/meta-lib.mjs', scriptExists: true }) === true],
    ['summary separates PROVEN from CREDITED-by-declaration',
      (() => {
        const s = summarize([
          { kind: 'self', wired: true }, { kind: 'engine', wired: true },
          { kind: 'cli', wired: true }, { kind: 'manual', wired: true },
          { kind: 'unrecognized', wired: false },
        ]);
        return s.executable === 2 && s.credited === 1 && s.byKind.unrecognized === 1 && s.total === 5;
      })()],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log(`\n\x1b[31mac-verify-map self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ ac-verify-map self-test passes\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
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
    // 2026-W35-B1 — THREE numbers, never one. The single "wired N/N" line folded proof,
    // reachability and a human's promise into the same figure, so it printed 100% while
    // only a seventh of the criteria were ever executed.
    const proven = run ? runResults.filter(r => r.ok).length : 0;
    console.log(`  доказано прогоном (self/engine): ${run ? proven : '—'} · исполнимых: ${summary.executable}`);
    console.log(`  подключено к существующему файлу (cli): ${summary.byKind.cli}`);
    console.log(`  зачтено по объявлению человека (manual, машина не проверяла): ${summary.credited}`);
    if (summary.byKind.unrecognized) {
      console.log(`  \x1b[31mне опознано (команду не понял никто): ${summary.byKind.unrecognized}\x1b[0m`);
      for (const r of rows.filter(r => r.kind === 'unrecognized')) console.log(`      ${r.spec} ${r.id}: ${r.command.split('\n')[0]}`);
    }
    console.log(`  подключено всего (файл или объявление): ${summary.wired}/${summary.total}`);
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
    // 2026-W35-B1 — an unrecognised command used to raise the coverage number. Under
    // --strict it now lowers it AND blocks, so the declared vocabulary stays the only
    // way in and the flattering bucket can never fill by accident again.
    const unknown = rows.filter(r => r.kind === 'unrecognized');
    if (unknown.length) {
      console.error(`\x1b[31m✗ ${unknown.length} AC(s) whose verification command nothing recognises:\x1b[0m`);
      for (const u of unknown) console.error(`    ${u.spec} ${u.id}: ${u.command}`);
      console.error('    Declare it explicitly (manual:/fixture:/observe:/audit:/behavior:/config:/grep/covered by)');
      console.error('    or give it a runnable `node scripts/...` command.');
      process.exit(1);
    }
  }

  if (run && runFails > 0) {
    console.error(`\x1b[31m✗ ac-verify-map --run: ${runFails} acceptance check(s) FAILED\x1b[0m`);
    process.exit(1);
  }

  process.exit(0);
}
