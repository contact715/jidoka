#!/usr/bin/env node
// validate-spec-frontmatter — portable, zero-dep gate: is a spec's YAML frontmatter
// structurally valid, so the cascade/lineage/coverage tooling can actually read it?
//
// WHY THIS EXISTS (the live case it was born from, 2026-06-05 projectx spec-tree
// audit): the hierarchy LOOKED healthy while 99 specs returned INCOMPATIBLE from
// cascade-validate purely because versions were written as `"1.0"` (quoted, 2-part)
// against a parent's `1.0.0` — the comparator read the quoted value as 0.0.0. On top:
// 30 wave specs had no frontmatter at all (invisible to every tool), 34 carried a
// wrong `level:`, and 2 parents[] paths pointed at renamed files. None of it was
// caught for ~80 waves because templates existed but NOTHING validated instances.
// Garbage metadata accumulates silently; this gate makes it loud at commit time.
//
// RELATION TO spec-drift-check.mjs (NOT a duplicate): drift-check asks "do the
// REFERENCES in a spec still point at real files?" — it validates the spec against
// the TREE. This script asks "is the spec's OWN metadata well-formed?" — it validates
// the spec against the SCHEMA. A spec can pass one and fail the other.
//
// HONEST SPLIT (same discipline as northstar-check.mjs / spec-drift-check.mjs):
//   MECHANICAL (this script, zero tokens): required fields present, level in range,
//   version is unquoted 3-part semver, parents[] paths resolve, wave specs carry a
//   wave id. Checkable, deterministic.
//   SEMANTIC (DORMANT → an agent): "is this the RIGHT parent", "is the status
//   truthful", "does the content match the level" — judgement calls for the
//   project-steward / chief-architect, deliberately NOT automated here.
//
// SOFT / HARD (graduation, warn→enforce — HIERARCHICAL_SPEC_SYSTEM §8):
//   .sdd-config.json → specFrontmatter.hardBlockEnabled
//     false (default) → WARN: print findings, exit 0
//     true            → HARD: exit 1 on any ERROR-severity finding
//   .sdd-config.json → specFrontmatter.requiredIn (array of path prefixes / patterns
//   where frontmatter is MANDATORY; elsewhere a file with frontmatter is validated,
//   a file without is ignored). Absent → sensible defaults below.
//
// FULL & self-tested. Usage:
//   node scripts/validate-spec-frontmatter.mjs --self-test
//   node scripts/validate-spec-frontmatter.mjs [--root <dir>] [--staged] [--hard] [--quiet]
//   node scripts/validate-spec-frontmatter.mjs --files "a.md,b.md"

import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ── defaults (overridable via .sdd-config.json → specFrontmatter) ────────────────
const DEFAULTS = {
  enabled: true,
  hardBlockEnabled: false,
  // Path prefixes (relative, /-separated) where frontmatter is MANDATORY.
  requiredIn: [
    'docs/specs/modules/',
    'docs/specs/domains/',
  ],
  // Filename regexes (anywhere under scanRoots) where frontmatter is MANDATORY.
  requiredPatterns: ['^wave-.+_MASTER_SPEC\\.md$'],
  // Where to scan in full mode.
  scanRoots: ['docs/specs'],
  // Directory names excluded from scanning: architect briefs are SCAFFOLDING,
  // not specs (anti-pattern #9: "brief is scaffolding, spec is contract") and
  // carry no frontmatter by design. Dirs starting with "_" (templates) are
  // skipped by the walker unconditionally.
  excludeDirs: ['briefs'],
  levels: ['L0', 'L1', 'L2', 'L3', 'L4'],
  statuses: ['Draft', 'Reviewed', 'Approved', 'Implemented', 'Shipped', 'Retired', 'Active', 'Roadmap'],
  requiredFields: ['level', 'version', 'status'],
};

const SKIP_DIRS = new Set(['.git', 'node_modules', 'venv', '.venv', 'dist', 'build', '.next', 'out', 'coverage']);

// ── pure helpers (exported for self-test) ────────────────────────────────────────
export function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]+?)\n---(\n|$)/);
  return m ? m[1] : null;
}

export function fieldValue(fm, name) {
  const m = fm.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

// version must be UNQUOTED 3-part semver. Returns null if ok, else the problem.
export function versionProblem(raw) {
  if (raw == null) return 'missing';
  if (/^["'].*["']$/.test(raw)) return `quoted (${raw}) — parses as 0.0.0 in semver comparators; write it unquoted`;
  if (!/^\d+\.\d+\.\d+$/.test(raw)) return `not 3-part semver (${raw}) — write MAJOR.MINOR.PATCH, e.g. 1.0.0`;
  return null;
}

// Extract parents[] entries: [{ path, version, line }]
export function extractParents(fm) {
  const pm = fm.match(/^parents:\n((?:[ \t]+.*\n?)+)/m);
  if (!pm) return [];
  const items = pm[1].split(/^[ \t]+-\s+path:/m).slice(1);
  return items.map((item) => {
    const path = item.split('\n')[0].trim();
    const vm = item.match(/version:\s*(.+)/);
    return { path, version: vm ? vm[1].trim() : null };
  });
}

// Validate one file's content. Returns findings: [{ rule, severity, message }].
export function validateSpec(relPath, content, cfg, fileExists) {
  const findings = [];
  const fname = relPath.split('/').pop();
  const isWaveSpec = cfg.requiredPatterns.some((p) => new RegExp(p).test(fname));
  const inRequiredDir = cfg.requiredIn.some((prefix) => relPath.startsWith(prefix));
  const fm = extractFrontmatter(content);

  if (!fm) {
    if (inRequiredDir || isWaveSpec) {
      findings.push({ rule: 'F1', severity: 'ERROR', message: 'frontmatter REQUIRED here but missing — invisible to cascade/lineage/coverage tooling' });
    }
    return findings; // nothing else checkable
  }

  // F2 required fields
  for (const f of cfg.requiredFields) {
    if (fieldValue(fm, f) == null) {
      findings.push({ rule: 'F2', severity: 'ERROR', message: `required field '${f}' missing` });
    }
  }

  // F3 level enum
  const level = fieldValue(fm, 'level');
  if (level != null && !cfg.levels.includes(level)) {
    findings.push({ rule: 'F3', severity: 'ERROR', message: `level '${level}' not in ${cfg.levels.join('/')}` });
  }

  // F4 version format (own version)
  const ver = fieldValue(fm, 'version');
  if (ver != null) {
    const p = versionProblem(ver);
    if (p) findings.push({ rule: 'F4', severity: 'ERROR', message: `version ${p}` });
  }

  // F5 parents[]: path resolves + version format
  for (const parent of extractParents(fm)) {
    if (!parent.path) continue;
    if (!fileExists(parent.path)) {
      findings.push({ rule: 'F5', severity: 'ERROR', message: `parents[] path does not exist: ${parent.path}` });
    }
    if (parent.version == null) {
      findings.push({ rule: 'F5', severity: 'WARN', message: `parents[] entry ${parent.path} has no version — cascade verdict will be AMBIGUOUS` });
    } else {
      const p = versionProblem(parent.version);
      if (p) findings.push({ rule: 'F5', severity: 'ERROR', message: `parents[] ${parent.path} version ${p}` });
    }
  }

  // F6 wave specs need a wave id
  if (isWaveSpec && fieldValue(fm, 'wave') == null) {
    findings.push({ rule: 'F6', severity: 'ERROR', message: "wave spec missing 'wave: wave-NNN' field" });
  }

  // F7 status enum
  const status = fieldValue(fm, 'status');
  if (status != null && !cfg.statuses.includes(status)) {
    findings.push({ rule: 'F7', severity: 'WARN', message: `status '${status}' not in conventional set (${cfg.statuses.join('/')})` });
  }

  return findings;
}

// ── runner ───────────────────────────────────────────────────────────────────────
function loadConfig(root) {
  const p = join(root, '.sdd-config.json');
  let user = {};
  try { user = JSON.parse(readFileSync(p, 'utf8')).specFrontmatter ?? {}; } catch { /* defaults */ }
  return { ...DEFAULTS, ...user };
}

function* walkMd(dir, excludeDirs) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('_') || excludeDirs.includes(e.name)) continue;
      yield* walkMd(join(dir, e.name), excludeDirs);
    } else if (e.name.endsWith('.md') && !e.name.startsWith('_') && e.name !== 'README.md') {
      yield join(dir, e.name);
    }
  }
}

function run() {
  const args = process.argv.slice(2);
  const rootArg = args.find((_, i) => args[i - 1] === '--root');
  const filesArg = args.find((_, i) => args[i - 1] === '--files');
  const root = resolve(rootArg ?? process.cwd());
  const cfg = loadConfig(root);
  if (cfg.enabled === false) { console.log('[spec-frontmatter] disabled via .sdd-config.json'); return 0; }
  const hard = args.includes('--hard') || cfg.hardBlockEnabled === true;
  const quiet = args.includes('--quiet');

  let files = [];
  if (filesArg) {
    files = filesArg.split(',').map((f) => resolve(root, f.trim())).filter(existsSync);
  } else if (args.includes('--staged')) {
    try {
      files = execSync('git diff --cached --name-only', { cwd: root, encoding: 'utf8' })
        .split('\n').filter((f) => f.endsWith('.md'))
        .filter((f) => cfg.scanRoots.some((r) => f.startsWith(r + '/')))
        .filter((f) => { const b = f.split('/').pop(); return !b.startsWith('_') && b !== 'README.md'; })
        .map((f) => resolve(root, f)).filter(existsSync);
    } catch { files = []; }
  } else {
    for (const r of cfg.scanRoots) files.push(...walkMd(join(root, r), cfg.excludeDirs ?? []));
  }

  const fileExists = (rel) => existsSync(join(root, rel));
  let errors = 0; let warns = 0; let checked = 0;
  for (const f of files) {
    const rel = relative(root, f).split(sep).join('/');
    let content;
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    checked++;
    for (const fnd of validateSpec(rel, content, cfg, fileExists)) {
      if (fnd.severity === 'ERROR') errors++; else warns++;
      if (!quiet) console.log(`[spec-frontmatter] ${fnd.severity} [${fnd.rule}] ${rel} — ${fnd.message}`);
    }
  }
  console.log(`[spec-frontmatter] checked ${checked} specs: ${errors} errors, ${warns} warnings (${hard ? 'HARD' : 'soft'} mode)`);
  if (errors > 0 && hard) return 1;
  return 0;
}

// ── self-test ────────────────────────────────────────────────────────────────────
function selfTest() {
  const cfg = { ...DEFAULTS };
  const dir = mkdtempSync(join(tmpdir(), 'fm-selftest-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'PARENT.md'), '---\nversion: 1.0.0\nlevel: L0\nstatus: Active\n---\n# P\n');
  const exists = (rel) => existsSync(join(dir, rel));
  const cases = [
    ['good spec passes', 'docs/specs/modules/x/a.md',
      '---\nlevel: L3\nversion: 1.0.0\nstatus: Draft\nparents:\n  - path: docs/PARENT.md\n    version: 1.0.0\n---\nbody',
      (f) => f.length === 0],
    ['quoted version is ERROR F4', 'docs/specs/modules/x/b.md',
      '---\nlevel: L3\nversion: "1.0"\nstatus: Draft\n---\nbody',
      (f) => f.some((x) => x.rule === 'F4' && x.severity === 'ERROR')],
    ['missing frontmatter in required dir is ERROR F1', 'docs/specs/modules/x/c.md',
      '# no frontmatter',
      (f) => f.some((x) => x.rule === 'F1')],
    ['missing frontmatter OUTSIDE required dirs is fine', 'docs/specs/notes.md',
      '# just notes',
      (f) => f.length === 0],
    ['bad level is ERROR F3', 'docs/specs/modules/x/d.md',
      '---\nlevel: L9\nversion: 1.0.0\nstatus: Draft\n---\nbody',
      (f) => f.some((x) => x.rule === 'F3')],
    ['nonexistent parent is ERROR F5', 'docs/specs/modules/x/e.md',
      '---\nlevel: L3\nversion: 1.0.0\nstatus: Draft\nparents:\n  - path: docs/NOPE.md\n    version: 1.0.0\n---\nbody',
      (f) => f.some((x) => x.rule === 'F5' && x.severity === 'ERROR')],
    ['parent without version is WARN F5', 'docs/specs/modules/x/f.md',
      '---\nlevel: L3\nversion: 1.0.0\nstatus: Draft\nparents:\n  - path: docs/PARENT.md\n---\nbody',
      (f) => f.some((x) => x.rule === 'F5' && x.severity === 'WARN')],
    ['wave spec without wave field is ERROR F6', 'docs/specs/wave-042_MASTER_SPEC.md',
      '---\nlevel: L4\nversion: 1.0.0\nstatus: Shipped\n---\nbody',
      (f) => f.some((x) => x.rule === 'F6')],
    ['2-part version is ERROR F4', 'docs/specs/modules/x/g.md',
      '---\nlevel: L3\nversion: 1.0\nstatus: Draft\n---\nbody',
      (f) => f.some((x) => x.rule === 'F4')],
    ['unknown status is WARN F7', 'docs/specs/modules/x/h.md',
      '---\nlevel: L3\nversion: 1.0.0\nstatus: Done\n---\nbody',
      (f) => f.some((x) => x.rule === 'F7' && x.severity === 'WARN')],
  ];
  let pass = 0;
  for (const [name, rel, content, check] of cases) {
    const findings = validateSpec(rel, content, cfg, exists);
    if (check(findings)) { pass++; console.log(`  ok  ${name}`); }
    else { console.log(`  FAIL ${name} → ${JSON.stringify(findings)}`); }
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`[spec-frontmatter] self-test: ${pass}/${cases.length}`);
  return pass === cases.length ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('validate-spec-frontmatter.mjs')) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
