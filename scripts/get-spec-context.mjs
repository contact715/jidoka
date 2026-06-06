#!/usr/bin/env node
/**
 * Part G — Spec Context Discovery (wave-117).
 *
 * AI agent context helper: given a feature name, finds matching specs
 * in docs/specs/, docs/domains/, and module README files, then walks
 * the parents[].path chain upward to print the full L4 → L0 ancestry.
 *
 * Closes the "agent opens new session with no spec ancestry" failure
 * class: the orchestrator can call this before dispatching any wave
 * work to receive the full parent chain.
 *
 * Usage:
 *   node scripts/get-spec-context.mjs --feature voice
 *   node scripts/get-spec-context.mjs --feature voice --format json
 *   node scripts/get-spec-context.mjs --feature __nonexistent__  # exits 0, stderr not-found
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const featureName = args.find((_, i) => args[i - 1] === '--feature') ?? null;
const format = args.find((_, i) => args[i - 1] === '--format') ?? 'text';

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

function extractTitle(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractLevel(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'level');
  if (fromYaml) return fromYaml;
  return extractBoldField(content, 'level');
}

function extractType(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'type');
  if (fromYaml) return fromYaml;
  return extractBoldField(content, 'type');
}

// ── File discovery ─────────────────────────────────────────────────────
// Search in priority order: docs/specs/, docs/domains/, docs/specs/modules/
function collectSearchPaths() {
  const candidates = [
    path.join(ROOT, 'docs/specs'),
    path.join(ROOT, 'docs/domains'),
    path.join(ROOT, 'docs/specs/modules'),
  ];

  const results = [];

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;

    function walk(d) {
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          if (entry.name.startsWith('_')) continue;
          if (!results.includes(fullPath)) results.push(fullPath);
        }
      }
    }

    walk(dir);
  }

  return results;
}

// ── Spec loader ────────────────────────────────────────────────────────
function loadSpec(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const yamlBlock = extractYamlBlock(content);
  const parents = extractYamlParents(yamlBlock);
  const level = extractLevel(content);
  const type = extractType(content);
  const title = extractTitle(content) ?? path.basename(filePath);
  const relPath = path.relative(ROOT, filePath);

  return { filePath, relPath, content, yamlBlock, parents, level, type, title };
}

// ── Feature matching ───────────────────────────────────────────────────
// Case-insensitive substring match against title or type field.
function matchesFeature(spec, featureQuery) {
  const q = featureQuery.toLowerCase();
  if (spec.title.toLowerCase().includes(q)) return true;
  if (spec.type && spec.type.toLowerCase().includes(q)) return true;
  // Also match against relative path for flexibility
  if (spec.relPath.toLowerCase().includes(q)) return true;
  return false;
}

// ── Parent chain walker ────────────────────────────────────────────────
// Walk parents[].path upward from a matched spec.
// Returns ancestry array from immediate to root: [{ level, path, title, relationship }]
function walkAncestry(startSpec, allSpecsByRelPath) {
  const ancestry = [];
  const visited = new Set();

  function walk(spec) {
    if (!spec || visited.has(spec.relPath)) return;
    visited.add(spec.relPath);

    for (const parent of spec.parents) {
      const parentRelPath = parent.path;
      let parentSpec = allSpecsByRelPath.get(parentRelPath);

      // Index only covers docs/specs/** ; L0/L1 parents live at docs/*.md.
      // Fall back to loading the parent directly from disk by its root-relative path.
      if (!parentSpec) {
        const abs = path.join(ROOT, parentRelPath);
        if (fs.existsSync(abs)) {
          parentSpec = loadSpec(abs);
          if (parentSpec) allSpecsByRelPath.set(parentRelPath, parentSpec);
        }
      }

      if (!parentSpec) {
        // Parent file genuinely doesn't exist on disk — note as missing
        ancestry.push({
          level: null,
          path: parentRelPath,
          title: '[missing]',
          relationship: parent.relationship ?? null,
          missing: true,
        });
        continue;
      }

      ancestry.push({
        level: parentSpec.level,
        path: parentRelPath,
        title: parentSpec.title,
        relationship: parent.relationship ?? null,
        missing: false,
      });

      walk(parentSpec);
    }
  }

  walk(startSpec);
  return ancestry;
}

// ── Output formatters ──────────────────────────────────────────────────
function formatText(matchedSpec, ancestry) {
  const lines = [];
  const levelStr = matchedSpec.level ? `[${matchedSpec.level}]` : '[?]';
  lines.push(`${levelStr} ${matchedSpec.relPath} — ${matchedSpec.title}`);

  let indent = '  ';
  for (const ancestor of ancestry) {
    const aLevel = ancestor.level ? `[${ancestor.level}]` : '[?]';
    const rel = ancestor.relationship ? `${ancestor.relationship} ` : '';
    const missing = ancestor.missing ? ' [missing on disk]' : '';
    lines.push(`${indent}${rel}${aLevel} ${ancestor.path} — ${ancestor.title}${missing}`);
    indent += '  ';
  }

  return lines.join('\n');
}

function formatJson(feature, matchedSpec, ancestry) {
  return JSON.stringify(
    {
      feature,
      matched: {
        level: matchedSpec.level,
        path: matchedSpec.relPath,
        title: matchedSpec.title,
        type: matchedSpec.type,
      },
      ancestry: ancestry.map((a) => ({
        level: a.level,
        path: a.path,
        title: a.title,
        relationship: a.relationship,
        missing: a.missing,
      })),
    },
    null,
    2
  );
}

// ── Run trace (forcing-function audit; mirrors reuse-scan's reuse-scans.jsonl) ──
// A behavioral gate is only real if it leaves a verifiable trace (anti-pattern
// #2 partial-closure-via-documentation). check-spec-first.mjs reads this log to
// confirm the Spec-First Read Gate was passed before product code was touched.
function logRun(feature, found, matchedRelPath, ancestryDepth) {
  try {
    fs.mkdirSync(path.join(ROOT, 'docs/audits'), { recursive: true });
    fs.appendFileSync(
      path.join(ROOT, 'docs/audits/spec-context-runs.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        feature,
        found,
        matched: matchedRelPath,
        ancestryDepth,
      }) + '\n',
    );
  } catch {
    /* best-effort: never block the lookup on a log failure */
  }
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  if (!featureName) {
    process.stderr.write('[get-spec-context] error: --feature <name> is required\n');
    process.exit(0);
  }

  // Load all candidate spec files
  const searchPaths = collectSearchPaths();
  const allSpecs = [];
  const allSpecsByRelPath = new Map();

  for (const filePath of searchPaths) {
    const spec = loadSpec(filePath);
    if (!spec) continue;
    allSpecs.push(spec);
    allSpecsByRelPath.set(spec.relPath, spec);
  }

  // Find matching specs
  const matches = allSpecs.filter((s) => matchesFeature(s, featureName));

  if (matches.length === 0) {
    logRun(featureName, false, null, 0);
    process.stderr.write(`[not found] no spec matches "${featureName}"\n`);
    process.exit(0);
  }

  // Use the first match (most specific — docs/specs/ searched first)
  const matchedSpec = matches[0];

  // Walk ancestry upward
  const ancestry = walkAncestry(matchedSpec, allSpecsByRelPath);

  logRun(featureName, true, matchedSpec.relPath, ancestry.length);

  if (format === 'json') {
    process.stdout.write(formatJson(featureName, matchedSpec, ancestry) + '\n');
  } else {
    process.stdout.write(formatText(matchedSpec, ancestry) + '\n');

    if (matches.length > 1) {
      process.stderr.write(`[get-spec-context] note: ${matches.length - 1} additional match(es) found — showing first\n`);
      for (const m of matches.slice(1)) {
        process.stderr.write(`  ${m.relPath}\n`);
      }
    }
  }

  process.exit(0);
}

main();
