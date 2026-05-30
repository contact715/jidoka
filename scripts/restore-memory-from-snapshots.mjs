#!/usr/bin/env node
// @ts-check
/**
 * Wave-151 — Restore memory entities from per-class snapshot files.
 *
 * Reads the five per-class snapshot .md files in docs/, parses entity blocks,
 * and writes a single consolidated staging JSON to .claude/memory-staging/.
 * The staging file is picked up by the agent's 6-step MCP merge protocol.
 *
 * IMPORTANT: This script NEVER calls MCP tools directly.
 * All MCP writes occur through the agent-driven 6-step merge in
 * docs/MEMORY_MERGE_PROTOCOL.md (lines 12-13 constraint).
 *
 * Usage:
 *   node scripts/restore-memory-from-snapshots.mjs        # parse all 5 files, write staging
 *   node scripts/restore-memory-from-snapshots.mjs --dry  # print entity count, no staging write
 *
 * Conflict behavior (T6 resolved — graph-wins):
 *   The staging JSON represents the snapshot state at last export time.
 *   On merge, the 6-step agent protocol string-exact-dedupes against the live graph.
 *   Live graph wins on conflicting observations — no overwrite of existing observations.
 *
 * Exit codes:
 *   0 — success (staging file written, or dry run, or partial (some files missing))
 *   1 — ALL five per-class .md files are absent
 *
 * Note: .claude/memory-staging/_archive/ is gitignored — archiving is local cleanup only.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { emitTelemetry } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Source per-class .md files ────────────────────────────────────────────────
const SNAPSHOT_FILES = {
  AntiPattern: path.join(ROOT, 'docs/memory-anti-patterns.md'),
  wave:        path.join(ROOT, 'docs/memory-waves.md'),
  Spec:        path.join(ROOT, 'docs/memory-specs.md'),
  Skill:       path.join(ROOT, 'docs/memory-skills.md'),
  Lesson:      path.join(ROOT, 'docs/memory-lessons.md'),
};

const STAGING_DIR = path.join(ROOT, '.claude/memory-staging');

const args  = process.argv.slice(2);
const isDry = args.includes('--dry');

// ── Markdown entity block parser ─────────────────────────────────────────────

/**
 * Parse entity blocks from a per-class snapshot .md file.
 * Entity format produced by export-memory-snapshot.mjs:
 *
 *   ### `entity-name`
 *
 *   **Type**: EntityType
 *   **Wave**: wave-NN
 *   **Observations**:
 *   - observation 1
 *   - observation 2
 *
 * @param {string} filePath
 * @param {string} expectedClass
 * @returns {{ entities: Array<{name:string, entityType:string, observations:string[], wave?:string}>, skipped: boolean }}
 */
function parseSnapshotFile(filePath, expectedClass) {
  if (!fs.existsSync(filePath)) {
    process.stderr.write(
      `[restore-memory] WARN: snapshot file absent — ${path.basename(filePath)} (class: ${expectedClass}). Skipping.\n`
    );
    return { entities: [], skipped: true };
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (/** @type {any} */ err) {
    process.stderr.write(
      `[restore-memory] WARN: could not read ${path.basename(filePath)}: ${err.message}. Skipping.\n`
    );
    return { entities: [], skipped: true };
  }

  const entities = [];
  const lines = raw.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect entity header: ### `entity-name`
    const headerMatch = line.match(/^###\s+`([^`]+)`\s*$/);
    if (!headerMatch) {
      i++;
      continue;
    }

    const name = headerMatch[1];
    let entityType = expectedClass;
    let wave = undefined;
    const observations = [];
    let inObservations = false;

    i++;
    while (i < lines.length) {
      const eline = lines[i];

      // Next entity block — stop
      if (/^###\s+`/.test(eline)) break;
      // Horizontal rule — end of entity details section
      if (/^---\s*$/.test(eline)) break;

      // Parse **Type**: ...
      const typeMatch = eline.match(/^\*\*Type\*\*:\s*(.+)$/);
      if (typeMatch) {
        entityType = typeMatch[1].trim();
        inObservations = false;
        i++;
        continue;
      }

      // Parse **Wave**: ...
      const waveMatch = eline.match(/^\*\*Wave\*\*:\s*(.+)$/);
      if (waveMatch) {
        const wv = waveMatch[1].trim();
        wave = wv === '—' ? undefined : wv;
        inObservations = false;
        i++;
        continue;
      }

      // Parse **Observations**: — start bullet collection
      if (/^\*\*Observations\*\*:/.test(eline)) {
        inObservations = true;
        i++;
        continue;
      }

      // Collect bullet observations
      if (inObservations) {
        const bulletMatch = eline.match(/^-\s+(.*)$/);
        if (bulletMatch) {
          observations.push(bulletMatch[1].trim());
          i++;
          continue;
        }
        // Blank line inside observations is fine, keep collecting
        if (eline.trim() === '') {
          i++;
          continue;
        }
        // Non-bullet non-blank line ends observations block
        inObservations = false;
      }

      i++;
    }

    // Only add entity if we parsed at least a name (skip scaffolding placeholders)
    if (name && name !== '—') {
      entities.push({ name, entityType, observations, wave });
    }
  }

  return { entities, skipped: false };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  // ── 1. Parse all 5 per-class snapshot files ────────────────────────────────
  let totalSkipped = 0;
  const allEntities = /** @type {Array<{name:string,entityType:string,observations:string[],wave?:string}>} */ ([]);
  const allRelations = /** @type {Array<{from:string,to:string,relationType:string}>} */ ([]);

  for (const [cls, filePath] of Object.entries(SNAPSHOT_FILES)) {
    const { entities, skipped } = parseSnapshotFile(filePath, cls);
    if (skipped) {
      totalSkipped++;
      continue;
    }
    allEntities.push(...entities);
  }

  // AC11: exit non-zero only if ALL five files are absent
  if (totalSkipped >= Object.keys(SNAPSHOT_FILES).length) {
    process.stderr.write(
      '[restore-memory] ERROR: ALL five per-class snapshot files are absent. Cannot restore. Exiting 1.\n'
    );
    process.exit(1);
  }

  // ── 2. Dry run: print count and exit ──────────────────────────────────────
  if (isDry) {
    process.stdout.write(`[dry] parsed ${allEntities.length} entities from ${Object.keys(SNAPSHOT_FILES).length - totalSkipped} file(s) (${totalSkipped} skipped)\n`);
    process.stdout.write(`[dry] no staging file written\n`);
    return;
  }

  // ── 3. Build relations from entity name hints ──────────────────────────────
  // Reconstruct skill-reference relations visible in entity names
  for (const entity of allEntities) {
    if (entity.entityType === 'wave' || entity.name.startsWith('wave-')) {
      // Look for skill references in observations
      for (const obs of entity.observations) {
        const skillMatch = obs.match(/skill-([\w-]+)/g);
        if (skillMatch) {
          for (const skillName of skillMatch) {
            allRelations.push({
              from: entity.name,
              to: skillName,
              relationType: 'references-skill',
            });
          }
        }
      }
    }
  }

  // ── 4. Write consolidated staging JSON ────────────────────────────────────
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ entities: allEntities, relations: allRelations }))
    .digest('hex')
    .slice(0, 8);
  const stagingFile = `${date}-restored-${hash}.json`;
  const stagingPath = path.join(STAGING_DIR, stagingFile);
  const relativePath = `.claude/memory-staging/${stagingFile}`;

  const payload = {
    generatedAt: new Date().toISOString(),
    schema: 'memory-mcp-staging-v1',
    schema_version: '1',
    source: 'docs/memory-*restored*',
    counts: {
      entities: allEntities.length,
      relations: allRelations.length,
      classes: Object.keys(SNAPSHOT_FILES).length - totalSkipped,
      skipped: totalSkipped,
    },
    dispatchHint: [
      'Next agent session: read this file, then:',
      '1. Call mcp__memory__read_graph() to get current entities.',
      '2. For each entity here NOT in the graph, call create_entities([{...}]).',
      '3. For entities already present, diff observations and add_observations only for new ones.',
      '4. Create relations whose target entity exists in the graph; skip orphans.',
      '5. Show the user the merge summary before any irreversible writes.',
      'Conflict rule: graph-wins — live graph observations are never overwritten.',
    ].join('\n'),
    entities: allEntities,
    relations: allRelations,
  };

  try {
    fs.writeFileSync(stagingPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (/** @type {any} */ err) {
    process.stderr.write(`[restore-memory] ERROR: could not write staging file: ${err.message}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `[restore-memory] wrote ${relativePath} (${allEntities.length} entities, ${allRelations.length} relations)\n`
  );
  process.stdout.write(
    `[restore-memory] run "npm run memory:status" to confirm the staging file is detected.\n`
  );

  // ── 5. Emit telemetry (AC8 + §12 Cross-Cutting Gates) ─────────────────────
  emitTelemetry('memory_snapshot_restored', {
    wave: 'wave-151',
    agent: 'memory-snapshot-restorer',
    source: 'scripts/restore-memory-from-snapshots.mjs',
    compliance_ref: 'EU-AI-Act-Art-12',
    payload: {
      entity_count: allEntities.length,
      staging_file: relativePath,
    },
  });

  process.stdout.write(
    `[restore-memory] telemetry emitted to docs/audits/memory-events.jsonl\n`
  );
}

main();
