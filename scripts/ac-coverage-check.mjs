#!/usr/bin/env node
// ac-coverage-check — portable, zero-dep gate: do a spec's acceptance criteria
// have tests that reference them?
//
// WHY THIS EXISTS (2026-06-05 projectx spec-tree audit + industry benchmark):
// the single biggest gap vs frontier-lab practice (Anthropic/OpenAI eval-driven
// development) was AC→test traceability scoring 3/10 — specs define ACs in EARS
// format, tests exist, but NOTHING links them. A test can stay green while the
// AC it covered was dropped. "Two engineers reading the same spec come away with
// different interpretations; an eval suite resolves the ambiguity" — the eval/test
// IS the executable spec, and an AC with no test is an unverifiable promise.
//
// RELATION TO projectx scripts/map-ac-coverage.mjs (NOT a duplicate): that tool is
// the project-local RETROSPECTIVE auditor — full cross-wave map, metrics artifact,
// it.todo stub generation, explicitly "not wired to any workflow" (its D6). THIS
// script is the portable COMMIT-TIME gate: staged spec → are its ACs referenced by
// any test file? Same AC regex (kept in sync with sync-specs-to-memory.mjs AC_RE).
//
// HONEST SPLIT:
//   MECHANICAL (this script): an AC label (A1, AC-foo, EARS-3) appearing in a spec
//   must appear in at least one test file (as `AC-<id>`, `[A1]`, `EARS-3` token).
//   Checkable, deterministic. A matching token does NOT prove the test MEANINGFULLY
//   covers the AC —
//   SEMANTIC (DORMANT → an agent): "does this test actually verify the AC's
//   behaviour" is judgement for test-engineer / best-of-N-judge, not this script.
//
// SOFT / HARD (graduation, warn→enforce — HIERARCHICAL_SPEC_SYSTEM §8):
//   .sdd-config.json → acCoverage.hardBlockEnabled  (false → WARN, true → exit 1)
//   .sdd-config.json → acCoverage.testDirs          (default ["tests","e2e","__tests__"])
//
// FULL & self-tested. Usage:
//   node scripts/ac-coverage-check.mjs --self-test
//   node scripts/ac-coverage-check.mjs --staged [--root <dir>] [--hard]
//   node scripts/ac-coverage-check.mjs --specs "docs/specs/wave-201_MASTER_SPEC.md"

import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const DEFAULTS = {
  enabled: true,
  hardBlockEnabled: false,
  testDirs: ['tests', 'e2e', '__tests__', 'app', 'components', 'lib'], // test files matched by suffix below
  testFilePattern: '\\.(test|spec)\\.(ts|tsx|js|jsx|mjs)$|\\.spec-stubs\\.test\\.ts$',
  specGlobDirs: ['docs/specs'],
};

const SKIP_DIRS = new Set(['.git', 'node_modules', 'venv', '.venv', 'dist', 'build', '.next', 'out', 'coverage']);

// ── AC extraction — SAME patterns as projectx sync-specs-to-memory.mjs AC_RE,
// plus numbered EARS labels ([EARS-1]) which module specs use. Kept additive.
export const AC_RE = /\*\*(AC-[\w]+|[A-Z]\d+)\*\*\s+\[(?:micro|macro|carto|synthesis)\][^\n]*|^\d+\.\s+\[(?:micro|macro|carto|synthesis)\][^\n]*/gm;
export const AC_LABEL_RE = /\*\*(AC-[\w]+|[A-Z]\d+)\*\*/;
export const EARS_RE = /\[(EARS-\d+)\]/g;

export function extractAcLabels(content) {
  const labels = new Set();
  for (const m of content.matchAll(AC_RE)) {
    const label = AC_LABEL_RE.exec(m[0])?.[1];
    if (label) labels.add(label);
  }
  for (const m of content.matchAll(EARS_RE)) labels.add(m[1]);
  return [...labels];
}

// A test "references" an AC when the label appears as a token: AC-A1, [A1], EARS-3, 'A1:'
export function testReferencesLabel(testContent, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(\\bAC-${esc}\\b|\\[${esc}\\]|\\b${esc}\\b)`).test(testContent);
}

// ── runner ───────────────────────────────────────────────────────────────────
function loadConfig(root) {
  let user = {};
  try { user = JSON.parse(readFileSync(join(root, '.sdd-config.json'), 'utf8')).acCoverage ?? {}; } catch { /* defaults */ }
  return { ...DEFAULTS, ...user };
}

function* walk(dir, suffixRe) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(join(dir, e.name), suffixRe);
    } else if (suffixRe.test(e.name)) {
      yield join(dir, e.name);
    }
  }
}

function run() {
  const args = process.argv.slice(2);
  const rootArg = args.find((_, i) => args[i - 1] === '--root');
  const specsArg = args.find((_, i) => args[i - 1] === '--specs');
  const root = resolve(rootArg ?? process.cwd());
  const cfg = loadConfig(root);
  if (cfg.enabled === false) { console.log('[ac-coverage] disabled via .sdd-config.json'); return 0; }
  const hard = args.includes('--hard') || cfg.hardBlockEnabled === true;

  // Which specs to check
  let specFiles = [];
  if (specsArg) {
    specFiles = specsArg.split(',').map((f) => resolve(root, f.trim())).filter(existsSync);
  } else if (args.includes('--staged')) {
    try {
      specFiles = execSync('git diff --cached --name-only', { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter((f) => f.endsWith('.md') && cfg.specGlobDirs.some((d) => f.startsWith(d + '/')))
        .map((f) => resolve(root, f)).filter(existsSync);
    } catch { specFiles = []; }
  } else {
    console.log('[ac-coverage] nothing to do: pass --staged or --specs (full-tree audits belong to the project\'s retrospective tool)');
    return 0;
  }
  if (specFiles.length === 0) { console.log('[ac-coverage] no staged specs to check'); return 0; }

  // Index test files once
  const testRe = new RegExp(cfg.testFilePattern);
  const testFiles = [];
  for (const d of cfg.testDirs) testFiles.push(...walk(join(root, d), testRe));
  const testContents = testFiles.map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } });

  let uncovered = 0; let total = 0;
  for (const spec of specFiles) {
    const rel = relative(root, spec).split(sep).join('/');
    let content;
    try { content = readFileSync(spec, 'utf8'); } catch { continue; }
    const labels = extractAcLabels(content);
    if (labels.length === 0) continue;
    for (const label of labels) {
      total++;
      const covered = testContents.some((tc) => testReferencesLabel(tc, label));
      if (!covered) {
        uncovered++;
        console.log(`[ac-coverage] WARN ${rel} — AC '${label}' has no test referencing it (tag a test with AC-${label} / [${label}])`);
      }
    }
  }
  console.log(`[ac-coverage] ${total - uncovered}/${total} ACs in staged specs have test references (${hard ? 'HARD' : 'soft'} mode, ${testFiles.length} test files indexed)`);
  if (uncovered > 0 && hard) return 1;
  return 0;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0; const total = 6;
  // extraction
  const spec = '## ACs\n**A1** [micro] the panel renders the count badge always\n**AC-login** [macro] login flow round-trips the token correctly\nbody [EARS-3] WHEN x, the system SHALL y\n';
  const labels = extractAcLabels(spec);
  if (labels.includes('A1')) { pass++; console.log('  ok  extracts A1'); } else console.log('  FAIL A1 → ' + JSON.stringify(labels));
  if (labels.includes('AC-login')) { pass++; console.log('  ok  extracts AC-login'); } else console.log('  FAIL AC-login');
  if (labels.includes('EARS-3')) { pass++; console.log('  ok  extracts EARS-3'); } else console.log('  FAIL EARS-3');
  // matching
  if (testReferencesLabel('it("badge renders", () => {}) // AC-A1', 'A1')) { pass++; console.log('  ok  matches AC-A1 tag'); } else console.log('  FAIL AC-A1 tag');
  if (testReferencesLabel('describe("[EARS-3] sla", ...)', 'EARS-3')) { pass++; console.log('  ok  matches [EARS-3]'); } else console.log('  FAIL [EARS-3]');
  if (!testReferencesLabel('nothing relevant here', 'A1')) { pass++; console.log('  ok  no false match'); } else console.log('  FAIL false match');
  console.log(`[ac-coverage] self-test: ${pass}/${total}`);
  return pass === total ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('ac-coverage-check.mjs')) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
