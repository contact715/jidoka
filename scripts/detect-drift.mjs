#!/usr/bin/env node
// @ts-check
/**
 * Wave-157 — GitOps Drift Daemon
 *
 * Orchestration entry-point for spec-vs-code drift detection.
 * Two modes:
 *   --staged       Per-commit fast check (DR1, DR2, DR3). <2s. Fires on staged files only.
 *   --comprehensive Daily full scan (DR1-DR7). Always exits 0. Opens GitHub issue on drift.
 *   --dry-run      Print events to stdout; do not write to drift-events.jsonl.
 *
 * 7 drift rules (hard cap per §8 scope OUT / anti-pattern #6):
 *   DR1  Shipped wave spec references non-existent file paths        severity: block
 *   DR2  AGENT_ROSTER.md row missing Line: column for any agent      severity: warn
 *   DR3  .sdd-config.json missing required keys                      severity: block
 *   DR4  docs/audits/*.jsonl streams missing prev_hash chain         severity: warn
 *   DR5  Shipped spec component inventory -> file exists             severity: warn
 *   DR6  Spec hierarchy missing parent reference (cascade result)    severity: warn
 *   DR7  Anti-pattern catalog slug in spec not in catalog file       severity: warn
 *
 * Recurrence escalation (T5): if recurrence-events.jsonl has count_24h >= 3 for
 * a slug matching a drift event, escalate severity one tier (info->warn, warn->block).
 *
 * Atlantis PR-approval model (T3): this script is READ-ONLY on all spec/product files.
 * It writes ONLY to docs/audits/drift-events.jsonl (via emitTelemetry).
 *
 * Closes anti-pattern #7 wave-spec-drift (ANTI_PATTERNS_CATALOG.md:138-152).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  emitTelemetry,
  readJsonlStream,
  readJsonlChainIntegrity,
} from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MODE_STAGED = args.includes('--staged');
const MODE_COMPREHENSIVE = args.includes('--comprehensive');
const DRY_RUN = args.includes('--dry-run');

// ── Paths ────────────────────────────────────────────────────────────────────
const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');
const AGENT_ROSTER_PATH = path.join(ROOT, 'docs', 'AGENT_ROSTER.md');
const ANTI_PATTERNS_PATH = path.join(ROOT, 'docs', 'ANTI_PATTERNS_CATALOG.md');
const RECURRENCE_PATH = path.join(ROOT, 'docs', 'audits', 'recurrence-events.jsonl');
const SPECS_DIR = path.join(ROOT, 'docs', 'specs');
const AUDITS_DIR = path.join(ROOT, 'docs', 'audits');

// ── Config reader ────────────────────────────────────────────────────────────

/**
 * Read driftDetection flags from .sdd-config.json.
 * Returns safe defaults if the key is absent or file is malformed.
 * @returns {{ enabled: boolean, hardBlockEnabled: boolean, dailyEnabled: boolean }}
 */
function readDriftConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return {
      enabled: Boolean(raw?.driftDetection?.enabled),
      hardBlockEnabled: Boolean(raw?.driftDetection?.hardBlockEnabled),
      dailyEnabled: Boolean(raw?.driftDetection?.dailyEnabled),
    };
  } catch {
    return { enabled: false, hardBlockEnabled: false, dailyEnabled: false };
  }
}

// ── Severity escalation from recurrence-events.jsonl ────────────────────────

/** @type {Map<string, number>} slug -> max count_24h */
function buildRecurrenceVelocityMap() {
  const map = new Map();
  try {
    const records = readJsonlStream(RECURRENCE_PATH);
    for (const rec of records) {
      const slug = rec?.anti_pattern_slug;
      const count = typeof rec?.occurrence_count_24h === 'number' ? rec.occurrence_count_24h : 0;
      if (slug && count > (map.get(slug) ?? 0)) {
        map.set(slug, count);
      }
    }
  } catch {
    // cold-start safe: empty recurrence file is valid
  }
  return map;
}

/**
 * Escalate severity one tier if slug has count_24h >= 3 in recurrence-events.jsonl.
 * @param {'info'|'warn'|'block'} severity
 * @param {string|null} slug
 * @param {Map<string, number>} velocityMap
 * @returns {'info'|'warn'|'block'}
 */
function maybeEscalate(severity, slug, velocityMap) {
  if (!slug) return severity;
  const count = velocityMap.get(slug) ?? 0;
  if (count < 3) return severity;
  if (severity === 'info') return 'warn';
  if (severity === 'warn') return 'block';
  return 'block';
}

// ── YAML frontmatter helpers (reuse cascade-validate pattern) ────────────────

/**
 * @param {string} content
 * @returns {string|null}
 */
function extractYamlBlock(content) {
  const m = content.match(/^---\n([\s\S]+?)\n---\n/);
  return m ? m[1] : null;
}

/**
 * @param {string|null} yamlBlock
 * @param {string} fieldName
 * @returns {string|null}
 */
function extractYamlField(yamlBlock, fieldName) {
  if (!yamlBlock) return null;
  const re = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const m = yamlBlock.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Extract parents[] array from YAML frontmatter.
 * @param {string|null} yamlBlock
 * @returns {{ path: string }[]}
 */
function extractYamlParents(yamlBlock) {
  if (!yamlBlock) return [];
  const parentsMatch = yamlBlock.match(/^parents:\n((?:[ \t]+.*\n?)+)/m);
  if (!parentsMatch) return [];
  const block = parentsMatch[1];
  const items = block.split(/^[\s\t]+-\s+path:/m).slice(1);
  return items.map(item => ({ path: item.split('\n')[0].trim() }));
}

// ── Collect shipped wave specs ────────────────────────────────────────────────

/**
 * Returns all docs/specs/wave-*_MASTER_SPEC.md files with status Shipped or Implemented.
 * Matches A9 filter requirement.
 * @returns {{ filePath: string, relPath: string, content: string, yamlBlock: string|null }[]}
 */
function collectShippedSpecs() {
  const results = [];
  if (!fs.existsSync(SPECS_DIR)) return results;

  let entries;
  try {
    entries = fs.readdirSync(SPECS_DIR, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.match(/^wave-.*_MASTER_SPEC\.md$/)) continue;

    const filePath = path.join(SPECS_DIR, entry.name);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const yamlBlock = extractYamlBlock(content);
    const status = extractYamlField(yamlBlock, 'status');
    // A9: only Shipped or Implemented
    if (!status || !['Shipped', 'Implemented'].includes(status)) continue;

    results.push({ filePath, relPath: path.relative(ROOT, filePath), content, yamlBlock });
  }

  return results;
}

// ── Extract file path references from spec content ────────────────────────────

/**
 * Extract backtick-delimited paths that look like file references (contain / or .)
 * and paths from component inventory table rows.
 * @param {string} content
 * @returns {string[]}
 */
function extractSpecFilePaths(content) {
  const paths = new Set();

  // Backtick references: `path/to/file.ext` or `path/to/file.mjs`
  for (const m of content.matchAll(/`([^`\s]+(?:\/[^`\s]+|[^`\s]*\.[a-zA-Z]{1,6}))`/g)) {
    const candidate = m[1];
    // Filter out things that look like commands, flags, or pure extensions
    if (candidate.startsWith('-') || candidate.startsWith('$')) continue;
    if (candidate.includes('*') || candidate.includes('?')) continue;
    if (!candidate.includes('/') && !candidate.includes('.')) continue;
    // Must look like a relative path (no http)
    if (candidate.startsWith('http')) continue;
    paths.add(candidate);
  }

  // Component inventory table: | `path` | or | path | patterns
  for (const m of content.matchAll(/\|\s*`?([a-zA-Z_.][a-zA-Z0-9_./\-]*\.[a-zA-Z]{1,6})`?\s*\|/g)) {
    const candidate = m[1];
    if (candidate.includes('/') || candidate.match(/\.[a-z]{1,6}$/)) {
      if (!candidate.startsWith('http')) paths.add(candidate);
    }
  }

  return [...paths];
}

// ── Anti-pattern slug extractor ───────────────────────────────────────────────

/**
 * Extract slugs from the anti-patterns catalog (### N. slug format).
 * @returns {Set<string>}
 */
function extractCatalogSlugs() {
  const slugs = new Set();
  if (!fs.existsSync(ANTI_PATTERNS_PATH)) return slugs;
  try {
    const content = fs.readFileSync(ANTI_PATTERNS_PATH, 'utf8');
    // Match ### N. slug-name or **Slug**: `slug-name`
    for (const m of content.matchAll(/^###\s+\d+\.\s+([a-z][a-z0-9-]+)/gm)) {
      slugs.add(m[1]);
    }
    for (const m of content.matchAll(/\*\*Slug\*\*:\s*`?([a-z][a-z0-9-]+)`?/gm)) {
      slugs.add(m[1]);
    }
  } catch {
    // non-fatal
  }
  return slugs;
}

// ── Drift rule registry ───────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, dimension: string, severity: 'info'|'warn'|'block', slug: string|null }} DriftEvent
 */

/**
 * @typedef {{ id: string, dimension: string, severity: 'info'|'warn'|'block',
 *   check: (ctx: RunContext) => DriftEvent[] }} DriftRule
 */

/**
 * @typedef {{ stagedFiles: string[], shippedSpecs: { filePath: string, relPath: string,
 *   content: string, yamlBlock: string|null }[], velocityMap: Map<string, number> }} RunContext
 */

/** @type {DriftRule[]} */
const DRIFT_RULES = [
  // ── DR1: Shipped spec YAML frontmatter valid + required fields ──────────────
  {
    id: 'DR1',
    dimension: 'spec-frontmatter',
    severity: 'block',
    check({ stagedFiles, shippedSpecs }) {
      const events = [];
      // In --staged mode check only staged spec files; in comprehensive check shipped specs
      const targets = stagedFiles.length > 0
        ? stagedFiles
            .filter(f => f.match(/docs\/specs\/wave-.*_MASTER_SPEC\.md$/))
            .map(f => path.join(ROOT, f))
        : shippedSpecs.map(s => s.filePath);

      const REQUIRED_YAML_FIELDS = ['level', 'type', 'version', 'wave', 'status'];

      for (const filePath of targets) {
        let content;
        try {
          content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
        } catch {
          content = null;
        }
        if (!content) {
          events.push({
            id: 'DR1',
            dimension: 'spec-frontmatter',
            severity: 'block',
            slug: 'wave-spec-drift',
            declarative_source: path.relative(ROOT, filePath),
            actual_state_ref: filePath,
            drift_description: `File referenced in staged set does not exist: ${path.relative(ROOT, filePath)}`,
          });
          continue;
        }

        const yamlBlock = extractYamlBlock(content);
        if (!yamlBlock) {
          events.push({
            id: 'DR1',
            dimension: 'spec-frontmatter',
            severity: 'block',
            slug: 'wave-spec-drift',
            declarative_source: path.relative(ROOT, filePath),
            actual_state_ref: filePath,
            drift_description: `Missing YAML frontmatter block in spec: ${path.relative(ROOT, filePath)}`,
          });
          continue;
        }

        for (const field of REQUIRED_YAML_FIELDS) {
          const val = extractYamlField(yamlBlock, field);
          if (!val) {
            events.push({
              id: 'DR1',
              dimension: 'spec-frontmatter',
              severity: 'block',
              slug: 'wave-spec-drift',
              declarative_source: path.relative(ROOT, filePath),
              actual_state_ref: filePath,
              drift_description: `Spec YAML frontmatter missing required field '${field}': ${path.relative(ROOT, filePath)}`,
            });
          }
        }
      }
      return events;
    },
  },

  // ── DR2: AGENT_ROSTER.md row missing Line: column ──────────────────────────
  {
    id: 'DR2',
    dimension: 'roster-annotation',
    severity: 'warn',
    check({ stagedFiles }) {
      const events = [];
      // Only fires when AGENT_ROSTER.md is staged (--staged) or always in comprehensive
      const rosterStaged = stagedFiles.some(f => f.includes('AGENT_ROSTER.md'));
      if (stagedFiles.length > 0 && !rosterStaged) return events;

      if (!fs.existsSync(AGENT_ROSTER_PATH)) return events;
      let content;
      try {
        content = fs.readFileSync(AGENT_ROSTER_PATH, 'utf8');
      } catch {
        return events;
      }

      // Check 30-agent table: rows that have pipe-separated columns
      // Pattern: | Agent name | L-tier | Line: ... |
      // Any table row with 3 columns where the 3rd column does NOT start with "Line:"
      const tableLines = content
        .split('\n')
        .filter(line => line.match(/^\|\s*[A-Z][^|]+\|\s*L\d/));

      for (const line of tableLines) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 3 && !cols[2].startsWith('Line:')) {
          events.push({
            id: 'DR2',
            dimension: 'roster-annotation',
            severity: 'warn',
            slug: null,
            declarative_source: 'docs/AGENT_ROSTER.md',
            actual_state_ref: 'docs/AGENT_ROSTER.md',
            drift_description: `AGENT_ROSTER.md table row missing Line: annotation: "${cols[0]}"`,
          });
        }
      }
      return events;
    },
  },

  // ── DR3: .sdd-config.json missing required keys ─────────────────────────────
  {
    id: 'DR3',
    dimension: 'sdd-config-keys',
    severity: 'block',
    check({ stagedFiles }) {
      const events = [];
      // Only fires when .sdd-config.json is staged (--staged) or always in comprehensive
      const configStaged = stagedFiles.some(f => f.includes('.sdd-config.json'));
      if (stagedFiles.length > 0 && !configStaged) return events;

      if (!fs.existsSync(SDD_CONFIG_PATH)) {
        events.push({
          id: 'DR3',
          dimension: 'sdd-config-keys',
          severity: 'block',
          slug: null,
          declarative_source: '.sdd-config.json',
          actual_state_ref: '.sdd-config.json',
          drift_description: '.sdd-config.json does not exist — required keys pfca, andonCord, recurrenceDetection missing',
        });
        return events;
      }

      let config;
      try {
        config = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
      } catch {
        events.push({
          id: 'DR3',
          dimension: 'sdd-config-keys',
          severity: 'block',
          slug: null,
          declarative_source: '.sdd-config.json',
          actual_state_ref: '.sdd-config.json',
          drift_description: '.sdd-config.json is not valid JSON',
        });
        return events;
      }

      const REQUIRED_KEYS = ['pfca', 'andonCord', 'recurrenceDetection'];
      for (const key of REQUIRED_KEYS) {
        if (!(key in config)) {
          events.push({
            id: 'DR3',
            dimension: 'sdd-config-keys',
            severity: 'block',
            slug: null,
            declarative_source: '.sdd-config.json',
            actual_state_ref: '.sdd-config.json',
            drift_description: `.sdd-config.json missing required key: "${key}"`,
          });
        }
      }
      return events;
    },
  },

  // ── DR4: docs/audits/*.jsonl hash-chain integrity ───────────────────────────
  {
    id: 'DR4',
    dimension: 'hash-chain-integrity',
    severity: 'warn',
    check() {
      const events = [];
      if (!fs.existsSync(AUDITS_DIR)) return events;

      let files;
      try {
        files = fs.readdirSync(AUDITS_DIR).filter(f => f.endsWith('.jsonl'));
      } catch {
        return events;
      }

      for (const file of files) {
        const filePath = path.join(AUDITS_DIR, file);
        const { valid, firstBreak } = readJsonlChainIntegrity(filePath);
        if (!valid && firstBreak !== null) {
          events.push({
            id: 'DR4',
            dimension: 'hash-chain-integrity',
            severity: 'warn',
            slug: null,
            declarative_source: `docs/audits/${file}`,
            actual_state_ref: `docs/audits/${file}`,
            drift_description: `prev_hash chain break at line ${firstBreak} in docs/audits/${file}`,
          });
        }
      }
      return events;
    },
  },

  // ── DR5: Shipped spec component inventory -> file exists ────────────────────
  {
    id: 'DR5',
    dimension: 'spec-file-inventory',
    severity: 'warn',
    check({ shippedSpecs }) {
      const events = [];
      for (const spec of shippedSpecs) {
        const paths = extractSpecFilePaths(spec.content);
        for (const p of paths) {
          // Only check paths that look like they belong to the project
          // Skip things like version strings, semver, bare extensions
          if (p.length < 4) continue;
          if (p.match(/^\d/)) continue; // starts with digit (version number)
          const absPath = path.join(ROOT, p);
          if (!fs.existsSync(absPath)) {
            events.push({
              id: 'DR5',
              dimension: 'spec-file-inventory',
              severity: 'warn',
              slug: 'wave-spec-drift',
              declarative_source: spec.relPath,
              actual_state_ref: p,
              drift_description: `Shipped spec ${spec.relPath} references non-existent path: ${p}`,
            });
          }
        }
      }
      return events;
    },
  },

  // ── DR6: Spec hierarchy missing parent reference ─────────────────────────────
  {
    id: 'DR6',
    dimension: 'spec-hierarchy',
    severity: 'warn',
    check({ shippedSpecs }) {
      const events = [];

      for (const spec of shippedSpecs) {
        const parents = extractYamlParents(spec.yamlBlock);
        if (parents.length === 0) {
          // Wave specs should reference a parent (MISSION.md minimum)
          events.push({
            id: 'DR6',
            dimension: 'spec-hierarchy',
            severity: 'warn',
            slug: null,
            declarative_source: spec.relPath,
            actual_state_ref: spec.relPath,
            drift_description: `Shipped spec ${spec.relPath} has no parents[] in frontmatter — orphan spec`,
          });
          continue;
        }

        // Check that referenced parent paths exist on disk
        for (const parent of parents) {
          const parentAbs = path.join(ROOT, parent.path);
          if (!fs.existsSync(parentAbs)) {
            events.push({
              id: 'DR6',
              dimension: 'spec-hierarchy',
              severity: 'warn',
              slug: null,
              declarative_source: spec.relPath,
              actual_state_ref: parent.path,
              drift_description: `Shipped spec ${spec.relPath} references parent that does not exist: ${parent.path}`,
            });
          }
        }
      }

      // Also run cascade-validate on MISSION.md to detect INCOMPATIBLE children
      const missionPath = path.join(ROOT, 'docs', 'MISSION.md');
      if (fs.existsSync(missionPath) && fs.existsSync(path.join(ROOT, 'scripts', 'cascade-validate.mjs'))) {
        try {
          const result = spawnSync(
            process.execPath,
            [path.join(ROOT, 'scripts', 'cascade-validate.mjs'), '--root', 'docs/MISSION.md'],
            { cwd: ROOT, encoding: 'utf8', timeout: 15000 }
          );
          const output = (result.stdout || '') + (result.stderr || '');
          // Parse INCOMPATIBLE lines from cascade output
          const incompatibleMatches = output.matchAll(/INCOMPATIBLE[:\s]+([^\n]+)/g);
          for (const m of incompatibleMatches) {
            events.push({
              id: 'DR6',
              dimension: 'spec-hierarchy',
              severity: 'warn',
              slug: null,
              declarative_source: 'docs/MISSION.md',
              actual_state_ref: m[1].trim(),
              drift_description: `cascade-validate: INCOMPATIBLE child spec: ${m[1].trim()}`,
            });
          }
        } catch {
          // non-fatal if cascade-validate errors
        }
      }

      return events;
    },
  },

  // ── DR7: Anti-pattern slug in spec not in catalog ────────────────────────────
  {
    id: 'DR7',
    dimension: 'anti-pattern-slug',
    severity: 'warn',
    check({ shippedSpecs }) {
      const events = [];
      const catalogSlugs = extractCatalogSlugs();
      if (catalogSlugs.size === 0) return events;

      for (const spec of shippedSpecs) {
        // Look for closes_entries field in frontmatter or anti-pattern references in content
        const closesMatch = spec.content.match(/closes_entries:\s*[""']?([^'"\n]+)['""]?/);
        if (closesMatch) {
          // Extract slug from the closes_entries value (e.g. "anti-pattern #7 wave-spec-drift (...)")
          const slugMatch = closesMatch[1].match(/\b([a-z][a-z0-9-]{3,})\b/g);
          if (slugMatch) {
            for (const slug of slugMatch) {
              if (!catalogSlugs.has(slug) && slug.includes('-')) {
                events.push({
                  id: 'DR7',
                  dimension: 'anti-pattern-slug',
                  severity: 'warn',
                  slug,
                  declarative_source: spec.relPath,
                  actual_state_ref: 'docs/ANTI_PATTERNS_CATALOG.md',
                  drift_description: `Spec ${spec.relPath} closes_entries slug '${slug}' not found in ANTI_PATTERNS_CATALOG.md`,
                });
              }
            }
          }
        }

        // Also check anti_pattern_slug references in content
        for (const m of spec.content.matchAll(/anti[_-]pattern[_-]slug[`'"]?:\s*[`'"]?([a-z][a-z0-9-]+)[`'"]?/gi)) {
          const slug = m[1];
          if (!catalogSlugs.has(slug)) {
            events.push({
              id: 'DR7',
              dimension: 'anti-pattern-slug',
              severity: 'warn',
              slug,
              declarative_source: spec.relPath,
              actual_state_ref: 'docs/ANTI_PATTERNS_CATALOG.md',
              drift_description: `Spec ${spec.relPath} references anti-pattern slug '${slug}' not found in ANTI_PATTERNS_CATALOG.md`,
            });
          }
        }
      }
      return events;
    },
  },
];

// ── Event emitter helper ──────────────────────────────────────────────────────

/**
 * Emit a drift event to the 6th stream (or stdout in dry-run mode).
 * @param {object} event
 * @param {boolean} dryRun
 */
function emitDriftEvent(event, dryRun) {
  if (dryRun) {
    process.stdout.write(`[drift-daemon][DRY-RUN] ${event.id} ${event.severity} — ${event.drift_description}\n`);
    return;
  }

  emitTelemetry('drift_detected', {
    wave: 'wave-157',
    agent: 'drift-daemon',
    source: 'scripts/detect-drift.mjs',
    verdict: event.severity,
    payload: {
      rule_id: event.id,
      dimension: event.dimension,
      severity: event.severity,
      slug: event.slug ?? null,
      declarative_source: event.declarative_source ?? null,
      actual_state_ref: event.actual_state_ref ?? null,
      drift_description: event.drift_description,
      pii_possible: false,
    },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!MODE_STAGED && !MODE_COMPREHENSIVE) {
    process.stderr.write('[drift-daemon] Usage: node scripts/detect-drift.mjs [--staged | --comprehensive] [--dry-run]\n');
    process.exit(0);
  }

  const config = readDriftConfig();

  // --staged: read staged files via git diff --cached --name-only
  let stagedFiles = [];
  if (MODE_STAGED) {
    try {
      const result = spawnSync('git', ['diff', '--cached', '--name-only'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 5000,
      });
      stagedFiles = (result.stdout || '').split('\n').filter(Boolean);
    } catch {
      stagedFiles = [];
    }

    // Guard: in --staged mode, only fire when relevant files are staged
    const RELEVANT_PATTERN = /docs\/specs\/wave-.*_MASTER_SPEC\.md|docs\/AGENT_ROSTER\.md|\.sdd-config\.json/;
    const hasRelevantFiles = stagedFiles.some(f => RELEVANT_PATTERN.test(f));

    if (!hasRelevantFiles) {
      // No relevant files staged — zero latency exit
      process.exit(0);
    }
  }

  // Load shipped specs (used by comprehensive-mode rules and DR5/DR6/DR7)
  const shippedSpecs = MODE_COMPREHENSIVE ? collectShippedSpecs() : [];

  // Build recurrence velocity map (T5)
  const velocityMap = buildRecurrenceVelocityMap();

  /** @type {RunContext} */
  const ctx = { stagedFiles, shippedSpecs, velocityMap };

  // Select rules by mode
  const activeRuleIds = MODE_STAGED
    ? ['DR1', 'DR2', 'DR3']
    : ['DR1', 'DR2', 'DR3', 'DR4', 'DR5', 'DR6', 'DR7'];

  const activeRules = DRIFT_RULES.filter(r => activeRuleIds.includes(r.id));

  /** @type {Array<{event: object, finalSeverity: string}>} */
  const allEvents = [];
  let hasBlockEvent = false;

  for (const rule of activeRules) {
    let ruleEvents;
    try {
      ruleEvents = rule.check(ctx);
    } catch (err) {
      process.stderr.write(`[drift-daemon] WARN — ${rule.id} check threw: ${err}\n`);
      ruleEvents = [];
    }

    for (const event of ruleEvents) {
      // T5: recurrence escalation
      const finalSeverity = maybeEscalate(event.severity, event.slug, velocityMap);
      const finalEvent = { ...event, severity: finalSeverity };

      allEvents.push({ event: finalEvent, finalSeverity });

      if (finalSeverity === 'block') hasBlockEvent = true;

      // Emit to stderr for visibility
      process.stderr.write(`[drift-daemon] ${finalSeverity.toUpperCase()} [${event.id}] ${event.drift_description}\n`);

      // Write to stream
      emitDriftEvent(finalEvent, DRY_RUN);
    }
  }

  // Summary output (comprehensive mode)
  if (MODE_COMPREHENSIVE) {
    const summary = {
      mode: 'comprehensive',
      wave: 'wave-157',
      timestamp: new Date().toISOString(),
      rules_run: activeRuleIds,
      events_total: allEvents.length,
      events_by_severity: {
        block: allEvents.filter(e => e.finalSeverity === 'block').length,
        warn: allEvents.filter(e => e.finalSeverity === 'warn').length,
        info: allEvents.filter(e => e.finalSeverity === 'info').length,
      },
      events: allEvents.map(e => ({
        rule_id: e.event.id,
        severity: e.finalSeverity,
        dimension: e.event.dimension,
        drift_description: e.event.drift_description,
      })),
    };

    process.stdout.write('\n[drift-daemon] DRIFT SUMMARY\n');
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  }

  // Exit logic (A6, A7, A10):
  // --comprehensive always exits 0 (daily mode never blocks CI)
  // --staged exits 1 only when hardBlockEnabled: true AND a block event fired
  if (MODE_STAGED && config.hardBlockEnabled && hasBlockEvent) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`[drift-daemon] FATAL: ${err}\n`);
  process.exit(0); // non-fatal per A10
});
