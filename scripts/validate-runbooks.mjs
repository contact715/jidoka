#!/usr/bin/env node
// @ts-check
/**
 * Wave-171 — Runbook Automation Validator
 *
 * Reads docs/runbooks/*.md (excluding _* files), applies named invariants,
 * checks docs/runbooks/_INDEX.md for dangling refs and unknown agent slugs,
 * exits 0/1. Mirrors validate-raci.mjs:1-352 CLI shape (wave-170).
 *
 * YAML + section-heading parsers are IMPORTED from cascade-validate.mjs:41-108.
 * No parser code is redefined here (AC-15 / D4).
 *
 * Invariants enforced:
 *   V1 — Every runbook has doc_type: runbook in YAML frontmatter.
 *   V2 — Every runbook has trigger_halt_types field in YAML frontmatter.
 *   V3 — Every runbook has last_tested field in YAML frontmatter.
 *   V4 — Every runbook has all 4 mandatory section headings (trigger/symptoms,
 *         steps, rollback, verification). Heading-label-aware matching is used
 *         (aliases permitted; the _TEMPLATE.md defines canonical slugs).
 *   V5 — Every trigger_halt_types[] entry must match a known halt-authority
 *         agent slug from scripts/andon-halt-helpers.mjs:3-11 (9 agents).
 *   V6 — _INDEX.md: every runbook_path entry must resolve to a real file.
 *   V7 — _INDEX.md: every halt_agent entry must be a known agent slug (9 agents).
 *   WARN — last_tested older than 90 days emits a warning (not exit 1).
 *
 * Flags:
 *   --dry          Validate only; print findings; no file writes.
 *   --emit-index   Regenerate _INDEX.md header summary from source.
 *
 * Exit codes:
 *   0 — PASS (or WARN-only — staleness warnings do not block)
 *   1 — VIOLATION (any hard invariant failed)
 *
 * Usage:
 *   node scripts/validate-runbooks.mjs
 *   node scripts/validate-runbooks.mjs --dry
 *   node scripts/validate-runbooks.mjs --emit-index
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// D4: Import parsers from cascade-validate.mjs — do not rewrite.
import {
  extractYamlBlock,
  extractYamlField,
  extractSectionHeadings,
} from './cascade-validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────
const RUNBOOKS_DIR = path.join(ROOT, 'docs', 'runbooks');
const INDEX_PATH = path.join(RUNBOOKS_DIR, '_INDEX.md');
const ANDON_HELPERS_PATH = path.join(ROOT, 'scripts', 'andon-halt-helpers.mjs');

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDry = args.includes('--dry');
const emitIndex = args.includes('--emit-index');

// ── Known halt-authority agents ────────────────────────────────────────────
// Canonical source: docs/governance/raci.json halt-gate responsible[] (9 agents).
// Mirrors the comment in scripts/andon-halt-helpers.mjs:3-11. AC-5 / AC-7.
// If the halt-authority list changes, update raci.json first, then here and
// andon-halt-helpers.mjs together.
const HALT_AUTHORITY_AGENTS = new Set([
  'test-runner',
  'coverage-auditor',
  'a11y-auditor',
  'security-scanner',
  'constitutional-reviewer',
  'debate-judge',
  'meta-process-auditor',
  'proactive-surfacing-agent',
  'pfca-agent',
]);

// ── Mandatory section aliases ──────────────────────────────────────────────
// Each concept has a list of heading substrings that satisfy it.
// The validator checks if ANY section heading in the runbook contains
// one of the alias substrings (case-insensitive).
// This handles descriptive titles like "5-phase incident lifecycle"
// matching the "steps" concept, or "rollback verification checklist"
// matching both "rollback" and "verification" concepts.
const MANDATORY_SECTION_CONCEPTS = [
  {
    concept: 'trigger / symptoms',
    aliases: ['trigger', 'symptom', 'detect', 'severity', 'change type', 'config-flag rollback'],
  },
  {
    concept: 'steps',
    aliases: ['steps', 'phase', 'lifecycle', 'workflow', 'procedure', 'rollback steps', 'git-based rollback', 'change type', 'config-flag rollback'],
  },
  {
    concept: 'rollback',
    aliases: ['rollback', 'revert', 'recovery', 'emergency change'],
  },
  {
    concept: 'verification',
    aliases: ['verification', 'verify', 'checklist', 'check', 'post-implementation', 'governance'],
  },
];

// ── Parse trigger_halt_types[] from YAML block ─────────────────────────────
// The YAML block contains a multi-line list like:
//   trigger_halt_types:
//     - constitutional-reviewer
//     - meta-process-auditor
// extractYamlField only handles single-line values, so we parse the block
// manually for this specific array field.
function extractHaltTypes(yamlBlock) {
  if (!yamlBlock) return null;
  const haltTypesMatch = yamlBlock.match(/^trigger_halt_types:\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
  if (!haltTypesMatch) {
    // Also check single-line form: trigger_halt_types: [a, b]
    const inlineMatch = yamlBlock.match(/^trigger_halt_types:\s*\[([^\]]+)\]/m);
    if (inlineMatch) {
      return inlineMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    return null;
  }
  const block = haltTypesMatch[1];
  const items = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\s+-\s+(.+)$/);
    if (m) items.push(m[1].trim());
  }
  return items.length > 0 ? items : null;
}

// ── Glob runbooks (excluding _* files) ────────────────────────────────────
function globRunbooks() {
  if (!fs.existsSync(RUNBOOKS_DIR)) {
    process.stderr.write(`[validate-runbooks] ERROR: ${RUNBOOKS_DIR} not found.\n`);
    process.exit(1);
  }
  return fs.readdirSync(RUNBOOKS_DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => path.join(RUNBOOKS_DIR, f));
}

// ── Parse _INDEX.md for halt_agent and runbook_path columns ───────────────
// Returns { agentRows, pathRows }:
//   agentRows: { agent, runbookPath } from tables with a halt_agent column
//   pathRows:  { runbookPath } from tables with a runbook_path column (first col is a path)
// Scans all tables in the file. Resets table-tracking between tables.
function parseIndexTable() {
  if (!fs.existsSync(INDEX_PATH)) return { agentRows: [], pathRows: [] };
  const text = fs.readFileSync(INDEX_PATH, 'utf8');
  const lines = text.split('\n');

  const agentRows = [];
  const pathRows = [];

  // Track state for each table segment
  let inTable = false;
  let tableType = 'none'; // 'agent-to-runbook' | 'runbook-inventory' | 'unknown'
  let agentCol = -1;
  let pathCol = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('|')) {
      if (inTable) {
        // End of current table
        inTable = false;
        tableType = 'none';
        agentCol = -1;
        pathCol = -1;
      }
      continue;
    }

    // Separator row (|---|---|)
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;

    const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const lower = cells.map((c) => c.toLowerCase());

    if (!inTable) {
      // Identify table type from header row
      const hasHaltAgent = lower.some((c) => c.includes('halt_agent'));
      const hasRunbookPath = lower.some((c) => c.includes('runbook_path'));

      if (hasHaltAgent) {
        agentCol = lower.findIndex((c) => c.includes('halt_agent'));
        pathCol = lower.findIndex((c) => c.includes('runbook_path') || c.includes('path'));
        tableType = 'agent-to-runbook';
        inTable = true;
        continue;
      } else if (hasRunbookPath && lower[0].includes('runbook_path')) {
        // Second table: runbook_path is the first column (not an agent column)
        pathCol = 0;
        tableType = 'runbook-inventory';
        inTable = true;
        continue;
      } else if (hasHaltAgent || hasRunbookPath) {
        agentCol = lower.findIndex((c) => c.includes('halt_agent') || c.includes('agent'));
        pathCol = lower.findIndex((c) => c.includes('path'));
        tableType = 'unknown';
        inTable = true;
        continue;
      } else {
        // Not a table we care about — but scan for any stray docs/runbooks/ rows
        const anyPath = cells.find((c) => c.startsWith('docs/runbooks/') && c.endsWith('.md'));
        const firstCellIsPath = cells[0].startsWith('docs/');
        if (anyPath && !firstCellIsPath) {
          // First cell is an agent slug, last cell is a path
          agentRows.push({ agent: cells[0], runbookPath: anyPath });
        } else if (anyPath && firstCellIsPath) {
          pathRows.push({ runbookPath: anyPath });
        }
        // Treat as a table so subsequent rows are also scanned
        tableType = 'scan-only';
        inTable = true;
        continue;
      }
    }

    // Inside a recognised table — process data rows
    if (tableType === 'agent-to-runbook') {
      const agent = agentCol >= 0 ? (cells[agentCol] ?? cells[0]) : cells[0];
      const runbookPath = pathCol >= 0 ? (cells[pathCol] ?? '') : '';
      if (agent && runbookPath) {
        agentRows.push({ agent, runbookPath });
      }
    } else if (tableType === 'runbook-inventory') {
      const runbookPath = cells[pathCol] ?? cells[0];
      if (runbookPath) {
        pathRows.push({ runbookPath });
      }
    } else if (tableType === 'scan-only') {
      // Stray rows: look for docs/runbooks/ paths
      const anyPath = cells.find((c) => c.startsWith('docs/runbooks/') && c.endsWith('.md'));
      const firstCellIsPath = cells[0].startsWith('docs/');
      if (anyPath && !firstCellIsPath) {
        agentRows.push({ agent: cells[0], runbookPath: anyPath });
      } else if (anyPath && firstCellIsPath) {
        pathRows.push({ runbookPath: anyPath });
      }
    }
  }

  return { agentRows, pathRows };
}

// ── Staleness check (AC-4) ─────────────────────────────────────────────────
// Returns days since last_tested, or null if unparseable.
function daysSinceLastTested(lastTested) {
  if (!lastTested) return null;
  const date = new Date(lastTested);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ── Emit index summary (--emit-index flag) ─────────────────────────────────
function emitIndexSummary(runbookFiles) {
  // Reads the existing _INDEX.md header and regenerates the "Generated by" footer.
  // Does not rewrite the full table — the table is the source of truth.
  if (!fs.existsSync(INDEX_PATH)) {
    process.stdout.write('[validate-runbooks] _INDEX.md not found; cannot emit index summary.\n');
    return;
  }
  const text = fs.readFileSync(INDEX_PATH, 'utf8');
  // Replace or append the "Last validated" line
  const stamp = `\n<!-- Last validated: ${new Date().toISOString()} by validate-runbooks.mjs -->\n`;
  const newText = text.replace(/\n<!-- Last validated:.*-->\n?/g, '') + stamp;
  if (!isDry) {
    fs.writeFileSync(INDEX_PATH, newText, 'utf8');
    process.stdout.write(`[validate-runbooks] _INDEX.md header updated (${runbookFiles.length} runbooks)\n`);
  } else {
    process.stdout.write(`[validate-runbooks] --dry: would update _INDEX.md header (${runbookFiles.length} runbooks)\n`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  const violations = [];
  const warnings = [];

  // ── Glob runbook files ─────────────────────────────────────────────────
  const runbookFiles = globRunbooks();

  if (isDry) {
    process.stdout.write(`[validate-runbooks] --dry mode: validating ${runbookFiles.length} runbooks, no writes.\n`);
  }

  // ── V1-V5: Per-runbook invariants ──────────────────────────────────────
  for (const filePath of runbookFiles) {
    const relPath = path.relative(ROOT, filePath);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      violations.push(`VIOLATION: ${relPath} — could not read file: ${err.message}`);
      continue;
    }

    const yamlBlock = extractYamlBlock(content);

    // V1 — doc_type: runbook
    const docType = extractYamlField(yamlBlock, 'doc_type');
    if (!docType || docType !== 'runbook') {
      violations.push(`VIOLATION: ${relPath} — missing frontmatter field "doc_type: runbook" (found: ${docType ?? 'null'})`);
    }

    // V2 — trigger_halt_types[] present
    const haltTypes = extractHaltTypes(yamlBlock);
    // V2 opt-out (wave-176 D5): operator-initiated drills declare drill_type: tabletop
    // and carry trigger_halt_types: [] by design — no halt agent triggers them.
    // extractHaltTypes returns null for both "field missing" and "trigger_halt_types: []"
    // (empty inline array), so we check extractYamlField for the [] case explicitly.
    const drillType = extractYamlField(yamlBlock, 'drill_type');
    const rawHaltTypesField = extractYamlField(yamlBlock, 'trigger_halt_types');
    const isEmptyInlineArray = rawHaltTypesField !== null && rawHaltTypesField.trim() === '[]';
    if (!haltTypes && !isEmptyInlineArray) {
      violations.push(`VIOLATION: ${relPath} — missing frontmatter field "trigger_halt_types"`);
    } else if ((haltTypes !== null && haltTypes.length === 0) || isEmptyInlineArray) {
      if (drillType === 'tabletop') {
        warnings.push(`WARN: ${relPath} — operator-initiated drill; no halt agents required (drill_type: tabletop)`);
      } else {
        violations.push(`VIOLATION: ${relPath} — frontmatter field "trigger_halt_types" is empty`);
      }
    }

    // V3 — last_tested present
    const lastTested = extractYamlField(yamlBlock, 'last_tested');
    if (!lastTested) {
      violations.push(`VIOLATION: ${relPath} — missing frontmatter field "last_tested"`);
    } else {
      // WARN — staleness (AC-4): warn if > 90 days, do not exit 1
      const days = daysSinceLastTested(lastTested);
      if (days !== null && days > 90) {
        warnings.push(`WARN: ${relPath} — last_tested is ${days} days ago (threshold: 90)`);
      }
    }

    // V4 — Mandatory section headings (D3 / AC-2)
    const headings = extractSectionHeadings(content);
    for (const { concept, aliases } of MANDATORY_SECTION_CONCEPTS) {
      const found = headings.some((h) =>
        aliases.some((alias) => h.includes(alias.toLowerCase()))
      );
      if (!found) {
        violations.push(`VIOLATION: ${relPath} — missing required section "${concept}"`);
      }
    }

    // V5 — trigger_halt_types[] entries must be known agent slugs (AC-5)
    if (haltTypes && haltTypes.length > 0) {
      for (const slug of haltTypes) {
        if (!HALT_AUTHORITY_AGENTS.has(slug)) {
          violations.push(`VIOLATION: ${relPath} — unknown halt agent "${slug}" in trigger_halt_types (not in halt-authority agent list)`);
        }
      }
    }
  }

  // ── V6, V7: _INDEX.md ref checks (AC-6 / AC-7) ────────────────────────
  if (fs.existsSync(INDEX_PATH)) {
    const { agentRows, pathRows } = parseIndexTable();

    // V6 — dangling runbook ref (check all rows that have a runbook path)
    const allPathsToCheck = [
      ...agentRows.map((r) => r.runbookPath),
      ...pathRows.map((r) => r.runbookPath),
    ];
    const seenPaths = new Set();
    for (const runbookPath of allPathsToCheck) {
      if (!runbookPath || seenPaths.has(runbookPath)) continue;
      seenPaths.add(runbookPath);
      const absPath = path.join(ROOT, runbookPath);
      if (!fs.existsSync(absPath)) {
        violations.push(`VIOLATION: docs/runbooks/_INDEX.md — dangling runbook ref "${runbookPath}"`);
      }
    }

    // V7 — unknown halt agent slug (only for rows from agent-to-runbook table)
    for (const { agent } of agentRows) {
      if (!agent) continue;
      if (!HALT_AUTHORITY_AGENTS.has(agent)) {
        violations.push(`VIOLATION: docs/runbooks/_INDEX.md — unknown halt agent "${agent}"`);
      }
    }
  } else {
    violations.push(`VIOLATION: docs/runbooks/_INDEX.md — file does not exist (required by wave-171)`);
  }

  // ── Print warnings ─────────────────────────────────────────────────────
  for (const warn of warnings) {
    process.stdout.write(`${warn}\n`);
  }

  // ── Print violations and exit ──────────────────────────────────────────
  if (violations.length > 0) {
    for (const v of violations) {
      process.stdout.write(`${v}\n`);
    }
    process.stdout.write(
      `\nFAIL — ${runbookFiles.length} runbooks, ${violations.length} violation(s).\n`
    );
    process.exit(1);
  }

  process.stdout.write(`PASS — ${runbookFiles.length} runbooks, 0 violations.\n`);

  // ── --emit-index ───────────────────────────────────────────────────────
  if (emitIndex) {
    emitIndexSummary(runbookFiles);
  }
}

main();
