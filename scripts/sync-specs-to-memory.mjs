#!/usr/bin/env node
/**
 * Part B — Specs → Memory MCP staging extractor.
 *
 * Walks docs/specs/wave-*_MASTER_SPEC.md, extracts frontmatter and AC
 * lines, and emits a staging JSON file that the next agent session reads
 * and explicitly syncs to memory MCP via create_entities /
 * add_observations / create_relations.
 *
 * Why staging-not-sync: scripts cannot call MCP tools. Memory writes
 * belong to a Claude agent's context with user review. This script
 * just suggests; the agent decides + dedupes against the live graph.
 *
 * Output:
 *   .claude/memory-staging/<YYYY-MM-DD>-specs-<hash>.json
 *
 * Usage:
 *   node scripts/sync-specs-to-memory.mjs           # extract all, write staging
 *   node scripts/sync-specs-to-memory.mjs --dry     # print counts, no file write
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPECS_DIR = path.join(ROOT, 'docs/specs');
const STAGING_DIR = path.join(ROOT, '.claude/memory-staging');

const args = new Set(process.argv.slice(2));
const isDry = args.has('--dry');

// Only scan first 20 lines for frontmatter (prevents body false-matches)
function frontmatterSlice(content) {
  return content.split('\n').slice(0, 20).join('\n');
}

function extractField(content, fieldName) {
  const fm = frontmatterSlice(content);
  const re = new RegExp(`^\\*\\*${fieldName}\\*\\*:\\s*(.+)$`, 'm');
  const m = fm.match(re);
  return m ? m[1].trim() : null;
}

// ── YAML + bold-field two-pass parser (wave-117 — shared contract from T.1) ──
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

function extractVersion(content) {
  const yamlBlock = extractYamlBlock(content);
  const fromYaml = extractYamlField(yamlBlock, 'version');
  if (fromYaml) return fromYaml;
  return extractField(content, 'version');
}

// Parse semver into { major, minor, patch }
function parseSemver(v) {
  if (!v) return { major: 0, minor: 0, patch: 0 };
  const parts = String(v).split('.');
  return {
    major: parseInt(parts[0] ?? '0', 10) || 0,
    minor: parseInt(parts[1] ?? '0', 10) || 0,
    patch: parseInt(parts[2] ?? '0', 10) || 0,
  };
}

function extractTitle(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractDependsOn(content) {
  const raw = extractField(content, 'depends_on');
  if (!raw) return [];
  return raw.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

// ── AC line extraction ─────────────────────────────────────────────────
// Matches lines like: **A1** [...] text, or: 1. [micro] text, or: - AC-A1: text
export const AC_RE = /\*\*(AC-[\w]+|[A-Z]\d+)\*\*\s+\[(?:micro|macro|carto|synthesis)\][^\n]*|^\d+\.\s+\[(?:micro|macro|carto|synthesis)\][^\n]*/gm;
export const AC_LABEL_RE = /\*\*(AC-[\w]+|[A-Z]\d+)\*\*/;

export function extractACs(content) {
  const acs = [];
  for (const m of content.matchAll(AC_RE)) {
    const line = m[0].trim();
    if (line.length < 20) continue;
    const label = AC_LABEL_RE.exec(line)?.[1] ?? null;
    acs.push({ label, text: line.replace(/\*\*/g, '').trim() });
  }
  return acs;
}

// ── Spec ID from filename ──────────────────────────────────────────────
function inferSpecId(filename) {
  const m = filename.match(/^wave-([\d]+(?:\.[\d]+[a-z]?)?)/);
  if (m) return `wave-${m[1]}`;
  return filename.replace(/_MASTER_SPEC\.md$/, '').replace(/\.md$/, '');
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(SPECS_DIR)) {
    console.warn('[sync-specs] docs/specs/ not found — nothing to sync');
    process.exit(0);
  }

  let files;
  try {
    files = fs
      .readdirSync(SPECS_DIR)
      .filter((f) => /^wave-[\d]/.test(f) && f.endsWith('_MASTER_SPEC.md'))
      .sort();
  } catch (err) {
    console.warn(`[sync-specs] could not read specs dir: ${err.message}`);
    process.exit(0);
  }

  if (files.length === 0) {
    console.warn('[sync-specs] no wave spec files found — nothing to sync');
    process.exit(0);
  }

  const entities = [];
  const relations = [];
  // Build known spec IDs set for orphan-skip rule
  const knownSpecIds = new Set(files.map((f) => `${inferSpecId(f)}-spec`));

  for (const file of files) {
    const filePath = path.join(SPECS_DIR, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      console.warn(`[sync-specs] could not read ${file} — skipping`);
      continue;
    }

    const specId = inferSpecId(file);
    const entityName = `${specId}-spec`;
    const title = extractTitle(content) ?? file;
    const status = extractField(content, 'Status') ?? 'Draft';
    const effort = extractField(content, 'Effort') ?? '?';
    const date = extractField(content, 'Date') ?? 'unknown';
    const deps = extractDependsOn(content);
    const acs = extractACs(content);

    // wave-117 Part H: extract YAML level, type, parents
    const yamlBlock = extractYamlBlock(content);
    const level = extractYamlField(yamlBlock, 'level') ?? extractField(content, 'level');
    const type = extractYamlField(yamlBlock, 'type') ?? extractField(content, 'type');
    const parents = extractYamlParents(yamlBlock);
    const specVersion = extractVersion(content);

    const observations = [
      `[meta] title: ${title}`,
      `[meta] status: ${status.split(/[|(\s]/)[0].trim()}`,
      `[meta] effort: ${effort}`,
      `[meta] date: ${date}`,
      `[meta] source: docs/specs/${file}`,
    ];

    // wave-117 Part H: level and type observations
    if (level) observations.push(`[meta] level: ${level}`);
    if (type) observations.push(`[meta] type: ${type}`);

    observations.push(...acs.map(({ label, text }) => `[ac] ${label ? `${label}: ` : ''}${text}`));

    entities.push({
      name: entityName,
      entityType: 'Spec',
      observations,
    });

    // IMPLEMENTED_BY relation: spec → wave entity
    // Wave entity name convention (from extract-retro-memory.mjs): "wave-NN"
    relations.push({
      from: entityName,
      to: specId,
      relationType: 'IMPLEMENTED_BY',
    });

    // DEPENDS_ON relations — skip if parent spec entity not known (orphan rule)
    for (const dep of deps) {
      const depEntityName = `${dep}-spec`;
      if (!knownSpecIds.has(depEntityName)) {
        console.warn(`[sync-specs] dangling depends_on "${dep}" from ${specId} — skipping DEPENDS_ON relation`);
        continue;
      }
      relations.push({
        from: entityName,
        to: depEntityName,
        relationType: 'DEPENDS_ON',
      });
    }

    // wave-117 Part H: IMPLEMENTS / REFINES / SUPERSEDES relations from parents[]
    for (const parent of parents) {
      const parentPath = parent.path;
      const relationship = parent.relationship ?? null;
      const childRecordedVersion = parent.version;

      // Build a synthetic entity name for the parent path
      // Use path basename without extension as entity name
      const parentEntityName = parentPath
        .replace(/^docs\/specs\//, '')
        .replace(/_MASTER_SPEC\.md$/, '')
        .replace(/\.md$/, '')
        .replace(/\//g, '-');

      if (relationship === 'implements') {
        relations.push({
          from: entityName,
          to: parentEntityName,
          relationType: 'IMPLEMENTS',
        });
      } else if (relationship === 'refines') {
        relations.push({
          from: entityName,
          to: parentEntityName,
          relationType: 'REFINES',
        });
      }

      // SUPERSEDES check: if parent has MAJOR version bump above child's recorded version
      if (specVersion && childRecordedVersion) {
        const parentVer = parseSemver(specVersion);
        const childVer = parseSemver(childRecordedVersion);
        if (parentVer.major > childVer.major) {
          console.warn(
            `[sync-specs] SUPERSEDES: ${parentEntityName} v${specVersion} supersedes child-recorded v${childRecordedVersion} in ${specId}`
          );
          relations.push({
            from: `${parentEntityName}-v${parentVer.major}`,
            to: `${parentEntityName}-v${childVer.major}`,
            relationType: 'SUPERSEDES',
          });
        }
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    schema: 'memory-mcp-staging-v1',
    source: 'docs/specs/',
    counts: {
      specs: files.length,
      entities: entities.length,
      observations: entities.reduce((sum, e) => sum + e.observations.length, 0),
      relations: relations.length,
    },
    dispatchHint: [
      'Next agent session: read this file, then:',
      '1. Call mcp__memory__read_graph() to get current entities.',
      '2. For each entity here NOT in the graph, call create_entities([{...}]).',
      '3. For entities already present, diff observations and add_observations only for new ones.',
      '4. Create relations whose target entity exists in the graph; skip orphans.',
      '5. Show the user the merge summary before any irreversible writes.',
    ].join('\n'),
    entities,
    relations,
  };

  const summary = `${files.length} specs → ${entities.length} entities · ${payload.counts.observations} observations · ${relations.length} relations`;

  if (isDry) {
    console.log(`[dry] ${summary}`);
    console.log(`[dry] sample entity: ${JSON.stringify(entities[0], null, 2)}`);
    return;
  }

  fs.mkdirSync(STAGING_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ entities, relations }))
    .digest('hex')
    .slice(0, 8);
  const outPath = path.join(STAGING_DIR, `${date}-specs-${hash}.json`);

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[sync-specs] ${summary}`);
  console.log(`[sync-specs] wrote ${path.relative(ROOT, outPath)}`);
}

// Only run main() when executed directly (not when imported as a module)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
