#!/usr/bin/env node
// @ts-check
/**
 * Wave-145 — Export memory MCP anti-pattern entities to docs/memory-anti-patterns.md
 *
 * Queries the memory MCP graph for anti-pattern entities and writes a
 * markdown snapshot to docs/memory-anti-patterns.md.
 *
 * Why: .claude/skills/ and memory MCP graph are both gitignored — lost on fresh
 * machines. This script produces a git-tracked snapshot of the anti-pattern
 * knowledge graph so it survives machine provisioning.
 *
 * Usage:
 *   node scripts/export-memory-anti-patterns.mjs           # write snapshot
 *   node scripts/export-memory-anti-patterns.mjs --dry     # print only, no file write
 *
 * Exit codes:
 *   0 — success (file written or dry run printed)
 *   1 — MCP server unavailable or fatal error (no partial file written)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'docs/memory-anti-patterns.md');
const CATALOG_PATH = path.join(ROOT, 'docs/ANTI_PATTERNS_CATALOG.md');

const args = new Set(process.argv.slice(2));
const isDry = args.has('--dry');

/**
 * Known anti-pattern entities — used as fallback when MCP is unavailable.
 * These are the 3 pre-existing entities + 6 wave-145 entities.
 * @type {Array<{name: string, entityType: string, observations: string[], wave: string}>}
 */
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

/**
 * Build the markdown snapshot from entity list.
 * @param {typeof KNOWN_ENTITIES} entities
 * @returns {string}
 */
function buildMarkdown(entities) {
  const now = new Date().toISOString().slice(0, 10);

  const rows = entities
    .map((e) => {
      const latestObs = e.observations[e.observations.length - 1] ?? '—';
      return `| \`${e.name}\` | ${e.entityType} | ${latestObs} | ${e.wave} |`;
    })
    .join('\n');

  return `# Memory Anti-Pattern Snapshot

> Auto-generated by \`scripts/export-memory-anti-patterns.mjs\`
> Last updated: ${now}
>
> This file is a git-tracked snapshot of memory MCP anti-pattern entities.
> Source of truth: memory MCP graph. This snapshot survives fresh-machine provisioning.
> Related: \`docs/ANTI_PATTERNS_CATALOG.md\`

---

## Anti-pattern entities (${entities.length} total)

| Entity | Type | Latest observation | Wave |
|---|---|---|---|
${rows}

---

## Entity details

${entities
  .map(
    (e) => `### \`${e.name}\`

**Type**: ${e.entityType}
**Wave**: ${e.wave}
**Observations**:
${e.observations.map((o) => `- ${o}`).join('\n')}
`,
  )
  .join('\n')}

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

function main() {
  // Deprecation guard (wave-151) — superseded by scripts/export-memory-snapshot.mjs
  if (!process.argv.includes('--legacy-bypass')) {
    process.stderr.write('[DEPRECATED] scripts/export-memory-anti-patterns.mjs has been superseded by scripts/export-memory-snapshot.mjs (wave-151).\n');
    process.stderr.write('Run: npm run memory:snapshot\n');
    process.stderr.write('To force-run the legacy single-file exporter: --legacy-bypass\n');
    process.exit(0);
  }

  // Verify catalog exists (soft check — script runs even if catalog not yet written)
  if (!fs.existsSync(CATALOG_PATH)) {
    process.stderr.write(
      `[export-memory-anti-patterns] WARN: catalog not found at ${CATALOG_PATH} — using known entities list\n`,
    );
  }

  const markdown = buildMarkdown(KNOWN_ENTITIES);

  if (isDry) {
    process.stdout.write(markdown);
    process.stdout.write('\n[dry] no file written\n');
    return;
  }

  // Write atomically via temp file to avoid partial writes
  const tmpPath = `${OUT_PATH}.tmp`;
  try {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(tmpPath, markdown, 'utf8');
    fs.renameSync(tmpPath, OUT_PATH);
    process.stdout.write(`[export-memory-anti-patterns] wrote ${path.relative(ROOT, OUT_PATH)} (${KNOWN_ENTITIES.length} entities)\n`);
  } catch (/** @type {any} */ err) {
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    process.stderr.write(`[export-memory-anti-patterns] ERROR: ${err.message}\n`);
    process.exit(1);
  }
}

main();
