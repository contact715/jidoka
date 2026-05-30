#!/usr/bin/env node
/**
 * Part C — Cascade Regenerator (wave-117).
 *
 * Non-breaking propagation: when a parent spec's version changes
 * (non-breaking, i.e. no breaking_change_in_v set), updates
 * last_validated_against_parents and parents[].version in direct
 * child spec files, then appends a timestamped entry to docs/cascade-log.md.
 *
 * Only direct children (depth 1) per run. For deeper propagation,
 * run again against the updated child.
 *
 * Safety: if breaking_change_in_v is non-null on the root spec,
 * prints a warning and exits 0 without modifying any child files.
 *
 * Usage:
 *   node scripts/cascade-regenerate.mjs --root docs/MISSION.md
 *   node scripts/cascade-regenerate.mjs --root docs/MISSION.md --dry
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CASCADE_LOG = path.join(ROOT, 'docs', 'cascade-log.md');

// ── CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const rootArg = args.find((_, i) => args[i - 1] === '--root') ?? null;
const isDry = args.includes('--dry');

// ── YAML + bold-field two-pass parser (shared contract from T.1) ───────
function extractYamlBlock(content) {
  const m = content.match(/^---\n([\s\S]+?)\n---\n/);
  return m ? m[1] : null;
}

function extractYamlField(yamlBlock, fieldName) {
  if (!yamlBlock) return null;
  const re = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const m = yamlBlock.match(re);
  return m ? m[1].trim() : null;
}

function extractYamlParents(yamlBlock) {
  if (!yamlBlock) return [];
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

function extractVersion(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'version');
  if (fromYaml) return fromYaml;
  return extractBoldField(content, 'version');
}

// ── File discovery ─────────────────────────────────────────────────────
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
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (entry.name.startsWith('_')) continue;
        results.push(fullPath);
      }
    }
  }

  walk(DOCS_DIR);
  return results;
}

// ── Find direct children of rootRelPath ────────────────────────────────
function findDirectChildren(rootRelPath) {
  const files = collectSpecFiles();
  const children = [];

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const yamlBlock = extractYamlBlock(content);
    if (!yamlBlock) continue;

    const parents = extractYamlParents(yamlBlock);
    const matchingParent = parents.find((p) => p.path === rootRelPath);
    if (!matchingParent) continue;

    children.push({
      filePath,
      relPath: path.relative(ROOT, filePath),
      content,
      yamlBlock,
      recordedParentVersion: matchingParent.version,
    });
  }

  return children;
}

// ── YAML field updater ─────────────────────────────────────────────────
// Updates a specific field in the YAML block of a spec file.
// For parents[].version, we need to find the matching parent entry.
function updateYamlParentVersion(content, parentPath, newVersion) {
  // Pattern: find "- path: <parentPath>" and update the version line below it
  const escaped = parentPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(- path:\\s*${escaped}[\\s\\S]*?)(\\n[\\s\\t]+version:\\s*)([^\\n]+)`,
    'm'
  );
  return content.replace(re, `$1$2${newVersion}`);
}

function updateYamlFieldInBlock(content, fieldName, newValue) {
  // Replace the field in the YAML frontmatter block
  const re = new RegExp(`(^---[\\s\\S]+?)(^${fieldName}:\\s*)([^\\n]+)([\s\S]*?---\n)`, 'm');
  if (re.test(content)) {
    return content.replace(re, `$1$2${newValue}$4`);
  }
  // Field not found in YAML block — try to insert before closing ---
  const closingRe = /(^---[\s\S]+?)(^---\n)/m;
  return content.replace(closingRe, `$1${fieldName}: ${newValue}\n$2`);
}

// Update last_validated_against_parents in YAML block
function updateLastValidated(content, isoDate) {
  const re = /^last_validated_against_parents:\s*.+$/m;
  if (re.test(content)) {
    return content.replace(re, `last_validated_against_parents: ${isoDate}`);
  }
  // Not found — insert into YAML block before closing ---
  const closingRe = /(---\n)$/m;
  return content.replace(/(^---[\s\S]+?)(^---\n)/m, `$1last_validated_against_parents: ${isoDate}\n$2`);
}

// ── Cascade log appender ───────────────────────────────────────────────
function appendCascadeLog(rootPath, childPath, version) {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} root=${rootPath} child=${childPath} version=${version}\n`;

  if (!fs.existsSync(CASCADE_LOG)) {
    const header = `# Cascade Log\n\n> Append-only propagation log. Auto-generated by cascade-regenerate.mjs — do not edit manually.\n\n`;
    fs.writeFileSync(CASCADE_LOG, header, 'utf8');
  }

  fs.appendFileSync(CASCADE_LOG, line, 'utf8');
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  if (!rootArg) {
    process.stderr.write('[cascade-regenerate] error: --root <spec-path> is required\n');
    process.exit(0);
  }

  const rootAbsPath = path.isAbsolute(rootArg)
    ? rootArg
    : path.resolve(ROOT, rootArg);
  const rootRelPath = path.relative(ROOT, rootAbsPath);

  if (!fs.existsSync(rootAbsPath)) {
    process.stderr.write(`[cascade-regenerate] warn: --root "${rootRelPath}" does not exist — exiting 0\n`);
    process.exit(0);
  }

  let rootContent;
  try {
    rootContent = fs.readFileSync(rootAbsPath, 'utf8');
  } catch {
    process.stderr.write(`[cascade-regenerate] warn: could not read "${rootRelPath}" — exiting 0\n`);
    process.exit(0);
  }

  const rootYaml = extractYamlBlock(rootContent);
  const rootVersion = extractVersion(rootContent);
  const breakingChangeIn = extractYamlField(rootYaml, 'breaking_change_in_v');

  // Block propagation if breaking_change_in_v is set (non-null, non-empty, not "null")
  if (breakingChangeIn && breakingChangeIn !== 'null') {
    process.stdout.write(
      `[cascade-regenerate] warn: root spec has breaking_change_in_v: ${breakingChangeIn}\n` +
      '[cascade-regenerate] cascade-regenerate cannot auto-propagate breaking changes.\n' +
      '[cascade-regenerate] Manually review and update child specs, then clear breaking_change_in_v.\n'
    );
    process.exit(0);
  }

  if (!rootVersion) {
    process.stderr.write(`[cascade-regenerate] warn: root spec "${rootRelPath}" has no version field — cannot propagate\n`);
    process.exit(0);
  }

  // Find direct children
  const children = findDirectChildren(rootRelPath);

  if (children.length === 0) {
    process.stdout.write(`[cascade-regenerate] root: ${rootRelPath} (version: ${rootVersion})\n`);
    process.stdout.write('[cascade-regenerate] no direct child specs found — nothing to propagate\n');
    process.exit(0);
  }

  const today = new Date().toISOString().slice(0, 10);
  let updated = 0;
  let skipped = 0;

  process.stdout.write(`[cascade-regenerate] root: ${rootRelPath} (version: ${rootVersion})\n`);
  process.stdout.write(`[cascade-regenerate] found ${children.length} direct child spec(s)\n\n`);

  for (const child of children) {
    // Skip if already up to date
    if (child.recordedParentVersion === rootVersion) {
      process.stdout.write(`[skip] already up to date: ${child.relPath}\n`);
      skipped++;
      continue;
    }

    if (isDry) {
      process.stdout.write(`[dry] would update: ${child.relPath} (${child.recordedParentVersion ?? 'unset'} → ${rootVersion})\n`);
      updated++;
      continue;
    }

    // Update parents[].version for matching parent path
    let updatedContent = child.content;
    updatedContent = updateYamlParentVersion(updatedContent, rootRelPath, rootVersion);
    updatedContent = updateLastValidated(updatedContent, today);

    try {
      fs.writeFileSync(child.filePath, updatedContent, 'utf8');
      appendCascadeLog(rootRelPath, child.relPath, rootVersion);
      process.stdout.write(`[updated] ${child.relPath} → version ${rootVersion}\n`);
      updated++;
    } catch (err) {
      process.stderr.write(`[cascade-regenerate] error writing ${child.relPath}: ${err.message}\n`);
    }
  }

  process.stdout.write(`\n[cascade-regenerate] done: ${updated} updated, ${skipped} skipped\n`);
  process.exit(0);
}

main();
