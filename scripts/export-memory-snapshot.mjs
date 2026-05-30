#!/usr/bin/env node
// @ts-check
/**
 * Wave-151 — Export memory MCP entities to per-class snapshot files.
 *
 * Extends the wave-145 exporter (export-memory-anti-patterns.mjs) to cover all
 * five entity classes: AntiPattern, Skill, Lesson, wave, and Spec.
 *
 * Source strategy:
 *   AntiPattern / Skill / Lesson — KNOWN_ENTITIES fallback list (wave-145 compat)
 *   wave  — newest .claude/memory-staging/*-retros-*.json file
 *   Spec  — newest .claude/memory-staging/*-specs-*.json file
 *
 * Outputs:
 *   docs/memory-anti-patterns.md   (AntiPattern entities)
 *   docs/memory-waves.md           (wave entities)
 *   docs/memory-specs.md           (Spec entities)
 *   docs/memory-skills.md          (Skill entities)
 *   docs/memory-lessons.md         (Lesson entities)
 *   docs/audits/memory-events.jsonl  (8th JSONL stream — append-only)
 *
 * Usage:
 *   node scripts/export-memory-snapshot.mjs              # export all 5 classes
 *   node scripts/export-memory-snapshot.mjs --class all  # export all 5 classes (explicit sentinel)
 *   node scripts/export-memory-snapshot.mjs --class wave # export wave class only
 *   node scripts/export-memory-snapshot.mjs --dry        # print counts, no file write
 *
 * --class all → export all 5 entity classes (AntiPattern, Skill, Lesson, wave, Spec)
 *
 * Exit codes:
 *   0 — success (files written or dry run)
 *   1 — fatal I/O error (no partial file written, via atomic write pattern)
 *
 * PII hook (T7 — identity in v1, wave-165 provides implementation):
 *   redactPii(obs) returns obs unchanged in v1.
 *
 * ISO 25010 fault tolerance: if staging directory is absent or empty,
 * falls back to KNOWN_ENTITIES for AntiPattern/Skill/Lesson and writes
 * empty tables for wave and Spec. Always exits 0 unless a hard I/O error occurs.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { emitTelemetry } from './emit-telemetry.mjs';
// Wave-165: PII redaction — import shared module (TS/MJS boundary: .mjs only)
import { redactPiiString } from '../lib/redaction/redact-pii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Output paths ─────────────────────────────────────────────────────────────
const OUT_ANTI_PATTERNS = path.join(ROOT, 'docs/memory-anti-patterns.md');
const OUT_WAVES         = path.join(ROOT, 'docs/memory-waves.md');
const OUT_SPECS         = path.join(ROOT, 'docs/memory-specs.md');
const OUT_SKILLS        = path.join(ROOT, 'docs/memory-skills.md');
const OUT_LESSONS       = path.join(ROOT, 'docs/memory-lessons.md');

const STAGING_DIR  = path.join(ROOT, '.claude/memory-staging');
const ARCHIVE_DIR  = path.join(STAGING_DIR, '_archive');

/** @type {Map<string, string>} — entity class name → output file path */
const CLASS_TO_PATH = new Map([
  ['AntiPattern', OUT_ANTI_PATTERNS],
  ['wave',        OUT_WAVES],
  ['Spec',        OUT_SPECS],
  ['Skill',       OUT_SKILLS],
  ['Lesson',      OUT_LESSONS],
]);

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const isDry   = args.includes('--dry');
const classArg = (() => {
  const idx = args.indexOf('--class');
  return idx !== -1 ? args[idx + 1] : null;
})();

if (classArg && classArg !== 'all' && !CLASS_TO_PATH.has(classArg)) {
  process.stderr.write(
    `[export-memory-snapshot] ERROR: unknown class "${classArg}". ` +
    `Valid values: all, ${[...CLASS_TO_PATH.keys()].join(', ')}\n`
  );
  process.exit(1);
}

// ── KNOWN_ENTITIES (wave-145 compat fallback for AntiPattern/Skill/Lesson) ───
/** @type {Array<{name: string, entityType: string, observations: string[], wave: string}>} */
const KNOWN_ENTITIES = [
  {
    name: 'anti-pattern-reactive-incremental-thinking',
    entityType: 'AntiPattern',
    observations: [
      'Trigger: holistic-quality phrases fire, AI dispatches incrementally without gap analysis',
      'Prevention: run proactive-holistic-analysis 6-step protocol before any dispatch',
      'Wave origin: wave-95/102/103/117 retro',
    ],
    wave: 'wave-117-retro',
  },
  {
    name: 'skill-proactive-holistic-analysis',
    entityType: 'Skill',
    observations: [
      'Prevents reactive-incremental-thinking anti-pattern',
      'Trigger: state of the art / maximum передовое / what is missing phrases',
      '6-step protocol: pause, industry research, map existing, gap analysis, propose restructure, wait for approval',
      'Wave origin: wave-117-retro',
    ],
    wave: 'wave-117-retro',
  },
  {
    name: 'lesson-systems-thinking-before-execution',
    entityType: 'Lesson',
    observations: [
      'Do not dispatch waves until holistic gap analysis is complete',
      'Industry pattern research is non-negotiable on holistic prompts',
      'Wave origin: wave-103/108/117 retro sequence',
    ],
    wave: 'wave-103',
  },
  {
    name: 'anti-pattern-partial-closure-via-documentation',
    entityType: 'AntiPattern',
    observations: [
      'Trigger: anti-pattern documented in markdown but no enforcement mechanism ships',
      'Prevention: every documented rule must ship active hook, script check, or agent gating',
      'Wave origin: wave-145',
    ],
    wave: 'wave-145',
  },
  {
    name: 'anti-pattern-optimistic-completion-bias',
    entityType: 'AntiPattern',
    observations: [
      'Trigger: done/shipped/complete claim without structured completion-audit block',
      'Prevention: emit mandatory 5-field completion-audit block before any done claim',
      'Wave origin: wave-145',
    ],
    wave: 'wave-145',
  },
  {
    name: 'anti-pattern-asymmetric-closure-standards',
    entityType: 'AntiPattern',
    observations: [
      'Trigger: product waves get full spec/AC/retro; meta-process fixes get informal treatment',
      'Prevention: same closure standards for meta-process work as product work',
      'Wave origin: wave-145',
    ],
    wave: 'wave-145',
  },
  {
    name: 'anti-pattern-over-documentation',
    entityType: 'AntiPattern',
    observations: [
      'Trigger: rules documented in 3+ places with no single enforcing agent',
      'Prevention: every rule must have exactly one source of truth and one enforcement mechanism',
      'Wave origin: wave-145',
    ],
    wave: 'wave-145',
  },
  {
    name: 'anti-pattern-scope-creep-mid-wave',
    entityType: 'AntiPattern',
    observations: [
      'Trigger: implementation agent adds files not in approved master spec',
      'Prevention: out-of-scope additions require re-submission to Chief Architect',
      'Wave origin: wave-145',
    ],
    wave: 'wave-145',
  },
  {
    name: 'anti-pattern-wave-spec-drift',
    entityType: 'AntiPattern',
    observations: [
      'Trigger: product code modified after wave Shipped without updating master spec',
      'Prevention: any modification to shipped behavior requires new wave or explicit spec amendment',
      'Wave origin: wave-145',
    ],
    wave: 'wave-145',
  },
];

// ── PII redaction hook (wave-165 implementation — replaces wave-151 no-op stub) ──
/**
 * Redact PII from an observation string before it is written to a snapshot file.
 * Delegates to redactPiiString() from lib/redaction/redact-pii.mjs.
 * Patterns: CARD, SSN, EMAIL, PHONE (mirrored from lib/skills/builtin/pii-scrub.ts:50-55).
 * @param {string} obs
 * @returns {string}
 */
function redactPii(obs) {
  if (typeof obs !== 'string') return obs;
  return redactPiiString(obs);
}

// ── Staging file helpers ──────────────────────────────────────────────────────

/**
 * List staging JSON files matching a prefix pattern, sorted descending by date.
 * Prefix examples: 'retros', 'specs'
 * @param {string} prefix
 * @returns {string[]} absolute paths, newest first
 */
function listStagingFiles(prefix) {
  if (!fs.existsSync(STAGING_DIR)) return [];
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${prefix}-[a-f0-9]+\\.json$`);
  return fs
    .readdirSync(STAGING_DIR)
    .filter(f => re.test(f))
    .sort()
    .reverse()
    .map(f => path.join(STAGING_DIR, f));
}

/**
 * Archive all but the newest staging file for a given prefix.
 * Creates _archive/ if needed. Gitignored — local cleanup only.
 * @param {string[]} files — sorted newest-first list
 * @returns {number} count of files archived
 */
function archiveOlderStagingFiles(files) {
  if (files.length <= 1) return 0;
  if (!isDry) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  let archived = 0;
  for (const f of files.slice(1)) {
    if (!isDry) {
      const dest = path.join(ARCHIVE_DIR, path.basename(f));
      try {
        fs.renameSync(f, dest);
        archived++;
      } catch (/** @type {any} */ err) {
        process.stderr.write(`[export-memory-snapshot] WARN: could not archive ${path.basename(f)}: ${err.message}\n`);
      }
    } else {
      archived++;
    }
  }
  return archived;
}

/**
 * Read entities from a staging JSON file.
 * Returns empty array on any parse error.
 * @param {string} filePath
 * @returns {Array<{name: string, entityType: string, observations: string[], wave?: string}>}
 */
function readStagingEntities(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(raw.entities)) return [];
    return raw.entities;
  } catch (/** @type {any} */ err) {
    process.stderr.write(`[export-memory-snapshot] WARN: could not read staging file ${path.basename(filePath)}: ${err.message}\n`);
    return [];
  }
}

// ── Markdown builders ─────────────────────────────────────────────────────────

/**
 * Build per-class markdown snapshot.
 * Mirrors the wave-145 buildMarkdown() output shape.
 * @param {string} entityClass
 * @param {Array<{name: string, entityType: string, observations: string[], wave?: string}>} entities
 * @returns {string}
 */
function buildMarkdown(entityClass, entities) {
  const now = new Date().toISOString().slice(0, 10);

  const rows = entities
    .map(e => {
      const latestObs = redactPii(e.observations[e.observations.length - 1] ?? '—');
      const wave = e.wave ?? '—';
      return `| \`${e.name}\` | ${e.entityType} | ${latestObs} | ${wave} |`;
    })
    .join('\n');

  const details = entities
    .map(e => {
      const obsLines = e.observations
        .map(o => `- ${redactPii(o)}`)
        .join('\n');
      return `### \`${e.name}\`\n\n**Type**: ${e.entityType}\n**Wave**: ${e.wave ?? '—'}\n**Observations**:\n${obsLines}\n`;
    })
    .join('\n');

  // Per-class header label
  const classLabels = {
    AntiPattern: 'Anti-Pattern',
    wave: 'Wave',
    Spec: 'Spec',
    Skill: 'Skill',
    Lesson: 'Lesson',
  };
  const label = classLabels[entityClass] ?? entityClass;

  // Choose the correct regeneration command per class
  const regenCmd = entityClass === 'AntiPattern'
    ? 'node scripts/export-memory-anti-patterns.mjs'
    : `node scripts/export-memory-snapshot.mjs --class ${entityClass}`;

  return `---
schema_version: "1"
entity_class: ${entityClass}
generated_at: ${now}
generator: scripts/export-memory-snapshot.mjs
---

# Memory ${label} Snapshot

> Auto-generated by \`scripts/export-memory-snapshot.mjs\`
> Last updated: ${now}
>
> Entity class: ${entityClass}
> This file is a git-tracked snapshot of memory MCP ${entityClass} entities.
> Source of truth: memory MCP graph. This snapshot survives fresh-machine provisioning.

---

## ${label} entities (${entities.length} total)

| Entity | Type | Latest observation | Wave |
|---|---|---|---|
${rows || '| — | — | — | — |'}

---

## Entity details

${details || '*No entities in this class. Run `npm run memory:snapshot` to export.*'}

---

*To regenerate: \`${regenCmd}\`*
*To run live MCP query and update: dispatch meta-process-auditor or re-run script after MCP sync.*
`;
}

/**
 * Build the memory-anti-patterns.md specifically — preserves the deprecation
 * header and full relations table (wave-145 compat, AC12 body-unchanged guard).
 * This overwrites the file on every run; body content matches KNOWN_ENTITIES.
 * @param {Array<{name: string, entityType: string, observations: string[], wave?: string}>} antiPatternEntities
 * @returns {string}
 */
function buildAntiPatternsMarkdown(antiPatternEntities) {
  const now = new Date().toISOString().slice(0, 10);

  const rows = antiPatternEntities
    .map(e => {
      const latestObs = redactPii(e.observations[e.observations.length - 1] ?? '—');
      return `| \`${e.name}\` | ${e.entityType} | ${latestObs} | ${e.wave ?? '—'} |`;
    })
    .join('\n');

  const details = antiPatternEntities
    .map(e => {
      const obsLines = e.observations.map(o => `- ${redactPii(o)}`).join('\n');
      return `### \`${e.name}\`\n\n**Type**: ${e.entityType}\n**Wave**: ${e.wave ?? '—'}\n**Observations**:\n${obsLines}\n`;
    })
    .join('\n');

  return `<!-- wave-151: DEPRECATED for Skill and Lesson classes.
     Skill entities are now snapshotted in docs/memory-skills.md
     Lesson entities are now snapshotted in docs/memory-lessons.md
     AntiPattern entities remain in this file.
     To regenerate all classes: npm run memory:snapshot -->

# Memory Anti-Pattern Snapshot

> Auto-generated by \`scripts/export-memory-anti-patterns.mjs\`
> Last updated: ${now}
>
> This file is a git-tracked snapshot of memory MCP anti-pattern entities.
> Source of truth: memory MCP graph. This snapshot survives fresh-machine provisioning.
> Related: \`docs/ANTI_PATTERNS_CATALOG.md\`

---

## Anti-pattern entities (${antiPatternEntities.length} total)

| Entity | Type | Latest observation | Wave |
|---|---|---|---|
${rows}

---

## Entity details

${details}

---

## Relations (documented)

| From | Relation | To |
|---|---|---|
| \`wave-145\` | DOCUMENTS | \`anti-pattern-partial-closure-via-documentation\` |
| \`wave-145\` | DOCUMENTS | \`anti-pattern-optimistic-completion-bias\` |
| \`wave-145\` | DOCUMENTS | \`anti-pattern-asymmetric-closure-standards\` |
| \`wave-145\` | DOCUMENTS | \`anti-pattern-over-documentation\` |
| \`wave-145\` | DOCUMENTS | \`anti-pattern-scope-creep-mid-wave\` |
| \`wave-145\` | DOCUMENTS | \`anti-pattern-wave-spec-drift\` |
| \`anti-pattern-partial-closure-via-documentation\` | CAUSES | \`anti-pattern-optimistic-completion-bias\` |
| \`skill-completion-audit\` | PREVENTS | \`anti-pattern-optimistic-completion-bias\` |
| \`skill-completion-audit\` | PREVENTS | \`anti-pattern-partial-closure-via-documentation\` |
| \`skill-proactive-holistic-analysis\` | PREVENTS | \`anti-pattern-reactive-incremental-thinking\` |

---

*To regenerate: \`node scripts/export-memory-anti-patterns.mjs\`*
*To run live MCP query and update: dispatch meta-process-auditor or re-run script after MCP sync.*
`;
}

// ── Atomic write helper ───────────────────────────────────────────────────────

/**
 * Write content to filePath atomically via a .tmp file and fs.renameSync.
 * No partial file is left on crash.
 * @param {string} filePath
 * @param {string} content
 * @returns {void}
 */
function atomicWrite(filePath, content) {
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (/** @type {any} */ err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw err;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Collect entities per class ──────────────────────────────────────────

  // AntiPattern / Skill / Lesson: KNOWN_ENTITIES fallback (wave-145 compat)
  const knownByClass = /** @type {Map<string, typeof KNOWN_ENTITIES>} */ (new Map());
  for (const e of KNOWN_ENTITIES) {
    if (!knownByClass.has(e.entityType)) knownByClass.set(e.entityType, []);
    knownByClass.get(e.entityType)?.push(e);
  }

  // wave: newest retros-* staging file
  const retroFiles = listStagingFiles('retros');
  let waveEntities = /** @type {Array<{name:string,entityType:string,observations:string[],wave?:string}>} */ ([]);
  if (retroFiles.length > 0) {
    waveEntities = readStagingEntities(retroFiles[0])
      .filter(e => e.entityType === 'wave');
  }

  // Spec: newest specs-* staging file
  const specsFiles = listStagingFiles('specs');
  let specEntities = /** @type {Array<{name:string,entityType:string,observations:string[],wave?:string}>} */ ([]);
  if (specsFiles.length > 0) {
    specEntities = readStagingEntities(specsFiles[0])
      .filter(e => e.entityType === 'Spec');
  }

  // Counts per class
  const antiPatternList = knownByClass.get('AntiPattern') ?? [];
  const skillList       = knownByClass.get('Skill')       ?? [];
  const lessonList      = knownByClass.get('Lesson')      ?? [];

  const counts = {
    AntiPattern: antiPatternList.length,
    wave:        waveEntities.length,
    Spec:        specEntities.length,
    Skill:       skillList.length,
    Lesson:      lessonList.length,
  };

  // ── 2. Dry run: print counts and exit ──────────────────────────────────────
  if (isDry) {
    for (const [cls, count] of Object.entries(counts)) {
      process.stdout.write(`[dry] ${cls}: ${count} entities\n`);
    }
    process.stdout.write(`[dry] total: ${Object.values(counts).reduce((a, b) => a + b, 0)} entities across 5 classes — no files written\n`);
    return;
  }

  // ── 3. Determine which classes to export ───────────────────────────────────
  // --class all is an explicit sentinel for "export all 5 classes"
  const classesToExport = (!classArg || classArg === 'all') ? [...CLASS_TO_PATH.keys()] : [classArg];

  // ── 4. Archive older staging files (T6) ───────────────────────────────────
  if (!classArg || classArg === 'all' || classArg === 'wave') {
    const archived = archiveOlderStagingFiles(retroFiles);
    if (archived > 0) {
      process.stdout.write(`[export-memory-snapshot] archived ${archived} older retros-* staging file(s) to _archive/\n`);
    }
  }
  if (!classArg || classArg === 'all' || classArg === 'Spec') {
    const archived = archiveOlderStagingFiles(specsFiles);
    if (archived > 0) {
      process.stdout.write(`[export-memory-snapshot] archived ${archived} older specs-* staging file(s) to _archive/\n`);
    }
  }

  // ── 5. Write per-class snapshot files ─────────────────────────────────────
  const classData = {
    AntiPattern: antiPatternList,
    wave:        waveEntities,
    Spec:        specEntities,
    Skill:       skillList,
    Lesson:      lessonList,
  };

  let totalWritten = 0;
  const writtenClasses = [];

  for (const cls of classesToExport) {
    const outPath = CLASS_TO_PATH.get(cls);
    if (!outPath) continue;

    const entities = classData[cls] ?? [];
    let content;

    if (cls === 'AntiPattern') {
      // Use the compat builder that preserves the relations table
      content = buildAntiPatternsMarkdown(entities);
    } else {
      content = buildMarkdown(cls, entities);
    }

    try {
      atomicWrite(outPath, content);
      process.stdout.write(
        `[export-memory-snapshot] wrote ${path.relative(ROOT, outPath)} (${entities.length} ${cls} entities)\n`
      );
      writtenClasses.push(cls);
      totalWritten += entities.length;
    } catch (/** @type {any} */ err) {
      process.stderr.write(`[export-memory-snapshot] ERROR writing ${path.basename(outPath)}: ${err.message}\n`);
      process.exit(1);
    }
  }

  // ── 6. Emit telemetry (AC3 + §12 Cross-Cutting Gates) ────────────────────
  emitTelemetry('memory_snapshot_exported', {
    wave: 'wave-151',
    agent: 'memory-snapshot-exporter',
    source: 'scripts/export-memory-snapshot.mjs',
    compliance_ref: 'EU-AI-Act-Art-12',
    payload: {
      classes_exported: writtenClasses,
      entity_count: totalWritten,
    },
  });

  process.stdout.write(
    `[export-memory-snapshot] done — ${totalWritten} entities across ${writtenClasses.length} class(es) exported. ` +
    `Telemetry emitted to docs/audits/memory-events.jsonl\n`
  );
}

main();
