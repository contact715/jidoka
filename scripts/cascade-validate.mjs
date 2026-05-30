#!/usr/bin/env node
/**
 * Part B — Cascade Validator (wave-117).
 *
 * Computes the transitive closure of all specs whose parents[].path
 * includes a given --root spec (directly or transitively) and prints
 * a COMPATIBLE / INCOMPATIBLE / AMBIGUOUS verdict per child spec.
 *
 * Verdict semantics (TLA+ refinement vocabulary):
 *   COMPATIBLE  — semver diff is patch-only (PATCH bump or equal)
 *   INCOMPATIBLE — semver MAJOR version bump
 *   AMBIGUOUS   — semver MINOR bump OR keyword-signature failure
 *
 * Exit codes:
 *   0 — all COMPATIBLE (or AMBIGUOUS with stderr warnings)
 *   1 — any INCOMPATIBLE child spec found
 *   0 — graceful on missing --root (warn + exit 0)
 *
 * Usage:
 *   node scripts/cascade-validate.mjs --root docs/MISSION.md
 *   node scripts/cascade-validate.mjs --root docs/MISSION.md --level L0
 *   node scripts/cascade-validate.mjs --root docs/MISSION.md --dry
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const rootArg = args.find((_, i) => args[i - 1] === '--root') ?? null;
const levelFilter = args.find((_, i) => args[i - 1] === '--level') ?? null;
// --dry is a no-op for cascade-validate (always read-only), kept for parity
// with other cascade scripts.
const isDry = args.includes('--dry');

// ── YAML + bold-field two-pass parser (shared contract from T.1) ───────
// Wave-171: exported so validate-runbooks.mjs can import without rewriting (D4 / AC-15).
export function extractYamlBlock(content) {
  const m = content.match(/^---\n([\s\S]+?)\n---\n/);
  return m ? m[1] : null;
}

export function extractYamlField(yamlBlock, fieldName) {
  if (!yamlBlock) return null;
  const re = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const m = yamlBlock.match(re);
  return m ? m[1].trim() : null;
}

// Extract parents[] array from YAML block.
// Format:
//   parents:
//     - path: docs/MISSION.md
//       version: 1.0.0
//       relationship: implements
function extractYamlParents(yamlBlock) {
  if (!yamlBlock) return [];
  // Match `parents:\n` followed by 1+ indented lines (each starts with space/tab).
  // Captures all sub-fields (path, version, relationship) under each `- path:` item.
  const parentsMatch = yamlBlock.match(/^parents:\n((?:[ \t]+.*\n?)+)/m);
  if (!parentsMatch) return [];
  const block = parentsMatch[1];
  const items = block.split(/^[\s\t]+-\s+path:/m).slice(1);
  const entries = [];
  for (const item of items) {
    const pathVal = item.split('\n')[0].trim();
    const versionM = item.match(/version:\s*(.+)/);
    const relM = item.match(/relationship:\s*(.+)/);
    entries.push({
      path: pathVal,
      version: versionM ? versionM[1].trim() : null,
      relationship: relM ? relM[1].trim() : null,
    });
  }
  return entries;
}

function extractBoldField(content, fieldName) {
  const lines = content.split('\n').slice(0, 20).join('\n');
  const re = new RegExp(`^\\*\\*${fieldName}\\*\\*:\\s*(.+)$`, 'm');
  const m = lines.match(re);
  return m ? m[1].trim() : null;
}

// Two-pass version extractor: YAML first, bold-field fallback.
function extractVersion(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'version');
  if (fromYaml) return fromYaml;
  return extractBoldField(content, 'version');
}

function extractTitle(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

// Extract ## section headings for keyword-signature check.
// Wave-171: exported so validate-runbooks.mjs can import without rewriting (D4 / AC-15).
export function extractSectionHeadings(content) {
  const headings = [];
  for (const m of content.matchAll(/^##\s+(.+)$/gm)) {
    headings.push(m[1].trim().toLowerCase());
  }
  return headings;
}

// ── Semver comparison ──────────────────────────────────────────────────
// Returns { major, minor, patch } from "MAJOR.MINOR.PATCH" string.
// Returns { major: 0, minor: 0, patch: 0 } for null/malformed input.
function parseSemver(v) {
  if (!v) return { major: 0, minor: 0, patch: 0 };
  const parts = String(v).split('.');
  return {
    major: parseInt(parts[0] ?? '0', 10) || 0,
    minor: parseInt(parts[1] ?? '0', 10) || 0,
    patch: parseInt(parts[2] ?? '0', 10) || 0,
  };
}

// COMPATIBLE / INCOMPATIBLE / AMBIGUOUS
function semverVerdict(parentVersion, childRecordedVersion) {
  const pv = parseSemver(parentVersion);
  const cv = parseSemver(childRecordedVersion);

  // If neither version is set, treat as COMPATIBLE (no version info = no violation)
  if (!parentVersion && !childRecordedVersion) return 'COMPATIBLE';
  // Child has no record of parent version = AMBIGUOUS (can't verify)
  if (!childRecordedVersion) return 'AMBIGUOUS';
  // Parent has no version set = treat as COMPATIBLE
  if (!parentVersion) return 'COMPATIBLE';

  if (pv.major > cv.major) return 'INCOMPATIBLE';
  if (pv.major < cv.major) return 'COMPATIBLE'; // child is ahead? treat as COMPATIBLE
  if (pv.minor > cv.minor) return 'AMBIGUOUS';
  return 'COMPATIBLE'; // patch diff or equal
}

// ── File discovery ─────────────────────────────────────────────────────
// Walk docs/ directory recursively and collect all .md files.
function collectSpecFiles() {
  const DOCS_DIR = path.join(ROOT, 'docs');
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden + auto/template directories (leading `.` or `_`)
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Skip auto-generated files
        if (entry.name.startsWith('_')) continue;
        results.push(fullPath);
      }
    }
  }

  walk(DOCS_DIR);
  return results;
}

// ── Spec loader ────────────────────────────────────────────────────────
// Returns array of { filePath, relPath, yamlBlock, parents, version, title, headings }
function loadAllSpecs() {
  const files = collectSpecFiles();
  const specs = [];

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const yamlBlock = extractYamlBlock(content);
    // Only include files that have YAML parents block or could be a root target
    const parents = extractYamlParents(yamlBlock);
    const version = extractVersion(content);
    const title = extractTitle(content);
    const headings = extractSectionHeadings(content);
    const relPath = path.relative(ROOT, filePath);

    specs.push({ filePath, relPath, yamlBlock, parents, version, title, headings });
  }

  return specs;
}

// ── Adjacency map ──────────────────────────────────────────────────────
// Build: parentRelPath → [{ childRelPath, childRecordedVersion, relationship }]
function buildAdjacencyMap(specs) {
  const map = new Map(); // parentRelPath → children[]

  for (const spec of specs) {
    for (const parent of spec.parents) {
      // Normalise parent path to relPath format
      const parentRel = parent.path.replace(/^\//, '');
      if (!map.has(parentRel)) map.set(parentRel, []);
      map.get(parentRel).push({
        childRelPath: spec.relPath,
        childRecordedVersion: parent.version,
        relationship: parent.relationship,
        childSpec: spec,
      });
    }
  }

  return map;
}

// ── Transitive closure (BFS) ───────────────────────────────────────────
// Returns array of { childRelPath, childSpec, childRecordedVersion, depth }
function transitiveClosure(rootRelPath, adjacencyMap) {
  const visited = new Set();
  const queue = [{ relPath: rootRelPath, depth: 0 }];
  const results = [];

  while (queue.length > 0) {
    const { relPath, depth } = queue.shift();
    if (visited.has(relPath)) continue;
    visited.add(relPath);

    const children = adjacencyMap.get(relPath) ?? [];
    for (const child of children) {
      if (!visited.has(child.childRelPath)) {
        results.push({
          childRelPath: child.childRelPath,
          childSpec: child.childSpec,
          childRecordedVersion: child.childRecordedVersion,
          depth: depth + 1,
        });
        queue.push({ relPath: child.childRelPath, depth: depth + 1 });
      }
    }
  }

  return results;
}

// ── Keyword-signature check ────────────────────────────────────────────
// Child spec must reference at least one heading word from the root spec.
// Failure is AMBIGUOUS (not INCOMPATIBLE — semantic mismatch is uncertain).
function keywordSignatureCheck(rootHeadings, childSpec) {
  if (rootHeadings.length === 0) return true; // no headings to check
  const childContent = fs.readFileSync(childSpec.filePath, 'utf8').toLowerCase();
  for (const heading of rootHeadings) {
    // Extract individual significant words (>4 chars to skip stop words)
    const words = heading.split(/\s+/).filter((w) => w.length > 4);
    if (words.some((word) => childContent.includes(word))) return true;
  }
  return false;
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  if (!rootArg) {
    process.stderr.write('[cascade-validate] error: --root <spec-path> is required\n');
    process.exit(0);
  }

  // Resolve root path relative to ROOT
  const rootAbsPath = path.isAbsolute(rootArg)
    ? rootArg
    : path.resolve(ROOT, rootArg);
  const rootRelPath = path.relative(ROOT, rootAbsPath);

  if (!fs.existsSync(rootAbsPath)) {
    process.stderr.write(`[cascade-validate] warn: --root "${rootRelPath}" does not exist — exiting 0\n`);
    process.exit(0);
  }

  let rootContent;
  try {
    rootContent = fs.readFileSync(rootAbsPath, 'utf8');
  } catch {
    process.stderr.write(`[cascade-validate] warn: could not read "${rootRelPath}" — exiting 0\n`);
    process.exit(0);
  }

  const rootVersion = extractVersion(rootContent);
  const rootHeadings = extractSectionHeadings(rootContent);

  // Load all specs
  const allSpecs = loadAllSpecs();

  // Build adjacency map
  const adjacencyMap = buildAdjacencyMap(allSpecs);

  // Transitive closure from root
  const closure = transitiveClosure(rootRelPath, adjacencyMap);

  if (closure.length === 0) {
    process.stdout.write(`[cascade-validate] root: ${rootRelPath} (version: ${rootVersion ?? 'unset'})\n`);
    process.stdout.write('[cascade-validate] no dependent child specs found — nothing to validate\n');
    process.exit(0);
  }

  // Evaluate each child
  const rows = [];
  let hasIncompatible = false;
  const ambiguousPaths = [];

  for (const { childRelPath, childSpec, childRecordedVersion } of closure) {
    // Apply level filter if provided
    if (levelFilter && childSpec.yamlBlock) {
      const childLevel = extractYamlField(childSpec.yamlBlock, 'level');
      if (childLevel && childLevel !== levelFilter) continue;
    }

    let verdict = semverVerdict(rootVersion, childRecordedVersion);

    // Keyword-signature check: only run if not already INCOMPATIBLE
    if (verdict !== 'INCOMPATIBLE') {
      const keywordOk = keywordSignatureCheck(rootHeadings, childSpec);
      if (!keywordOk) verdict = 'AMBIGUOUS';
    }

    const versionGap = rootVersion && childRecordedVersion
      ? `${childRecordedVersion} → ${rootVersion}`
      : 'unset';

    rows.push({ childRelPath, versionGap, verdict });

    if (verdict === 'INCOMPATIBLE') {
      hasIncompatible = true;
    } else if (verdict === 'AMBIGUOUS') {
      ambiguousPaths.push(childRelPath);
    }
  }

  // Print report
  process.stdout.write(`[cascade-validate] root: ${rootRelPath} (version: ${rootVersion ?? 'unset'})\n`);
  if (levelFilter) {
    process.stdout.write(`[cascade-validate] level filter: ${levelFilter}\n`);
  }
  process.stdout.write('\n');
  process.stdout.write('| Child spec | Version gap | Verdict |\n');
  process.stdout.write('|---|---|---|\n');
  for (const row of rows) {
    process.stdout.write(`| ${row.childRelPath} | ${row.versionGap} | ${row.verdict} |\n`);
  }
  process.stdout.write('\n');

  // Emit AMBIGUOUS warnings to stderr
  for (const p of ambiguousPaths) {
    process.stderr.write(`[cascade-validate] AMBIGUOUS: ${p} — parent MINOR bump or keyword-signature mismatch\n`);
  }

  if (hasIncompatible) {
    process.stderr.write('[cascade-validate] INCOMPATIBLE child specs found — parent has MAJOR version bump\n');
    process.exit(1);
  }

  process.exit(0);
}

// Wave-171: guard so main() only runs when this file is the entry point,
// not when it is imported by validate-runbooks.mjs for its exported parsers.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
