#!/usr/bin/env node
// @ts-check
/**
 * Wave-179 — Domain Glossary Validator
 *
 * Validates docs/quality/glossary-registry.json against three invariants
 * and scans a bounded set of 8 target docs for deprecated-synonym usage.
 *
 * Context-aware: each target doc is assigned a bounded context (product or
 * dev-system) via _schema.doc_context_map. The validator applies only
 * context-local deprecated-synonym lists — "agent" in .claude/AGENT_PLAYBOOK.md
 * (dev-system) does NOT false-positive; a deprecated synonym in a product doc
 * DOES flag.
 *
 * Invariants:
 *   I1 (EXIT-1): every term entry has a non-empty canonical_source_anchor
 *                [glossary] FAIL term=<term> — canonical_source_anchor is empty
 *   I2 (EXIT-1): every canonical_source_anchor resolves to a real heading slug
 *                in the referenced target doc
 *                [glossary] FAIL anchor-dangling term=<term> anchor=<anchor>
 *   I3 (EXIT-1): for role terms (technician, dispatcher, owner/admin), every
 *                deprecated_synonym in the registry must be a subset of the
 *                normalizeRole() alias inputs at lib/types/roles.ts:54-64.
 *                Validated by static reference table matching the function.
 *                [glossary] FAIL I3 term=<term> — synonym "<syn>" not in normalizeRole()
 *
 * Context scan (EXIT-1 on FAIL, EXIT-0 on WARN/CONFLICT-OPEN):
 *   For each target doc:
 *     determine bounded context from _schema.doc_context_map
 *     collect deprecated_synonyms of terms where term.context matches doc context OR "both"
 *     scan doc lines for those synonyms (word-boundary match)
 *     if match found and term.lifecycle !== "Conflicted":
 *       [glossary] FAIL  file=<doc> line=<N> — deprecated synonym "<syn>" (canonical: "<term>")
 *     if match found and term.lifecycle === "Conflicted":
 *       [glossary] WARN  file=<doc> line=<N> — conflicted synonym "<syn>" (canonical: "<term>")
 *
 * Conflicted entries (EXIT-0 always):
 *   Each term with lifecycle=Conflicted emits:
 *   [glossary] CONFLICT-OPEN term=<term> — <conflict_note first 120 chars>
 *
 * Exit codes:
 *   0 — no I1, I2, or I3 violations; no FAIL from context scan (WARN and CONFLICT-OPEN are exit-0)
 *   1 — one or more I1, I2, I3, or context-scan FAIL violations
 *
 * Usage:
 *   node scripts/validate-glossary.mjs
 *   npm run glossary:validate
 *
 * No telemetry emitted. No new stream. Exit-code CI gate only.
 *
 * Spec: docs/specs/wave-179_MASTER_SPEC.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────────
const REGISTRY_PATH = path.join(ROOT, 'docs', 'quality', 'glossary-registry.json');

// ── Output helpers ─────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── normalizeRole() alias map — static reference from lib/types/roles.ts:54-64 ──
// This table mirrors the function exactly. Validator uses it for I3.
// NEVER diverge from the actual function; if roles.ts changes, update this table.
/**
 * @type {Record<string, string>}
 * Maps each input alias to the canonical RoleKey it resolves to.
 */
const NORMALIZE_ROLE_MAP = {
  // line 57
  'root':       'admin',
  'owner':      'admin',
  'admin':      'admin',
  // line 58
  'manager':    'manager',
  'lead':       'manager',
  // line 59
  'dispatcher': 'dispatcher',
  'router':     'dispatcher',
  // line 60
  'technician': 'technician',
  'tech':       'technician',
  'field':      'technician',
  // line 61
  'sales':      'sales',
  'rep':        'sales',
  'closer':     'sales',
  // line 62
  'support':    'support',
  'service':    'support',
};

// Role terms for which I3 is enforced
const ROLE_TERMS = new Set(['owner', 'admin', 'dispatcher', 'technician', 'manager', 'sales', 'support']);

// ── Heading slug normaliser ────────────────────────────────────────────────────
// Reused from scripts/validate-research.mjs:68-75
/**
 * @param {string} heading
 * @returns {string}
 */
function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse all headings from a Markdown file and return a Set of their slugs.
 * Reused from scripts/validate-research.mjs:83-94
 *
 * @param {string} absPath
 * @returns {Set<string>}
 */
function parseHeadingSlugs(absPath) {
  if (!fs.existsSync(absPath)) return new Set();
  const text = fs.readFileSync(absPath, 'utf-8');
  const slugs = new Set();
  for (const line of text.split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match) {
      slugs.add(slugify(match[1].trim()));
    }
  }
  return slugs;
}

/** @type {Map<string, Set<string>>} */
const headingCache = new Map();

/**
 * @param {string} docRelPath  e.g. "docs/MISSION.md"
 * @returns {Set<string>}
 */
function getHeadingSlugs(docRelPath) {
  if (headingCache.has(docRelPath)) return /** @type {Set<string>} */ (headingCache.get(docRelPath));
  const absPath = path.join(ROOT, docRelPath);
  const slugs = parseHeadingSlugs(absPath);
  headingCache.set(docRelPath, slugs);
  return slugs;
}

// ── URI parser ────────────────────────────────────────────────────────────────
/**
 * @param {string} uri  e.g. "docs/MISSION.md#who-buys"
 * @returns {{ docPath: string; anchor: string | null }}
 */
function parseAnchorUri(uri) {
  const hashIdx = uri.indexOf('#');
  if (hashIdx === -1) return { docPath: uri, anchor: null };
  return {
    docPath: uri.slice(0, hashIdx),
    anchor: uri.slice(hashIdx + 1),
  };
}

// ── Word-boundary synonym matcher ─────────────────────────────────────────────
/**
 * Returns true if the synonym appears as a whole word (or hyphenated phrase)
 * in the given line. Case-insensitive.
 *
 * @param {string} line
 * @param {string} synonym
 * @returns {boolean}
 */
function lineContainsSynonym(line, synonym) {
  // Escape regex special chars in synonym
  const escaped = synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word boundary: start/end of string or non-word char (handles hyphenated terms too)
  const pattern = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i');
  return pattern.test(line);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  log(`[glossary] registry: ${REGISTRY_PATH}`);

  // ── Load registry ──────────────────────────────────────────────────────────
  if (!fs.existsSync(REGISTRY_PATH)) {
    log(`[glossary] FATAL: registry not found at ${REGISTRY_PATH}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch (err) {
    log(`[glossary] FATAL: could not parse registry JSON — ${/** @type {Error} */(err).message}`);
    process.exit(1);
  }

  const schema = raw['_schema'];
  if (!schema || typeof schema !== 'object') {
    log('[glossary] FATAL: registry missing _schema block');
    process.exit(1);
  }

  const docContextMap = /** @type {Record<string, string>} */ (schema['doc_context_map'] || {});
  if (Object.keys(docContextMap).length === 0) {
    log('[glossary] FATAL: _schema.doc_context_map is empty or missing');
    process.exit(1);
  }

  const terms = /** @type {Array<Record<string, unknown>>} */ (raw['terms']);
  if (!Array.isArray(terms) || terms.length === 0) {
    log('[glossary] FATAL: registry terms[] is missing or empty');
    process.exit(1);
  }

  log(`[glossary] loaded ${terms.length} term(s), ${Object.keys(docContextMap).length} target doc(s)`);
  log('');

  const violations = /** @type {string[]} */ ([]);
  const warns = /** @type {string[]} */ ([]);
  const conflicts = /** @type {string[]} */ ([]);

  // ── Emit CONFLICT-OPEN for every Conflicted term ───────────────────────────
  for (const entry of terms) {
    if (entry['lifecycle'] === 'Conflicted') {
      const conflictNote = typeof entry['conflict_note'] === 'string'
        ? entry['conflict_note'].slice(0, 120)
        : '(no conflict_note)';
      conflicts.push(
        `[glossary] CONFLICT-OPEN term=${entry['term']} — ${conflictNote}`
      );
    }
  }

  // ── I1 — every term has non-empty canonical_source_anchor ─────────────────
  for (const entry of terms) {
    const anchor = entry['canonical_source_anchor'];
    if (!anchor || typeof anchor !== 'string' || anchor.trim() === '') {
      violations.push(
        `[glossary] FAIL I1 term=${entry['term']} — canonical_source_anchor is empty`
      );
    }
  }

  // ── I2 — anchor resolves to a real heading in the target doc ──────────────
  for (const entry of terms) {
    const anchorUri = entry['canonical_source_anchor'];
    if (!anchorUri || typeof anchorUri !== 'string' || anchorUri.trim() === '') continue; // already caught by I1

    const { docPath, anchor } = parseAnchorUri(anchorUri);
    if (!anchor) {
      // No fragment — just verify the file exists
      const absPath = path.join(ROOT, docPath);
      if (!fs.existsSync(absPath)) {
        violations.push(
          `[glossary] FAIL I2 anchor-dangling term=${entry['term']} anchor=${anchorUri} — file not found: ${docPath}`
        );
      }
      continue;
    }

    const slugs = getHeadingSlugs(docPath);
    if (slugs.size === 0) {
      violations.push(
        `[glossary] FAIL I2 anchor-dangling term=${entry['term']} anchor=${anchorUri} — file not found or no headings: ${docPath}`
      );
      continue;
    }

    if (!slugs.has(anchor)) {
      violations.push(
        `[glossary] FAIL I2 anchor-dangling term=${entry['term']} anchor=${anchorUri} — heading slug "${anchor}" not found in ${docPath}`
      );
    }
  }

  // ── I3 — role-term deprecated_synonyms must be subsets of normalizeRole() ──
  for (const entry of terms) {
    const termName = String(entry['term'] || '');
    // Only enforce I3 for role terms
    if (!ROLE_TERMS.has(termName) && !ROLE_TERMS.has(String(entry['canonical_form'] || ''))) continue;

    const synonyms = entry['deprecated_synonyms'];
    if (!Array.isArray(synonyms)) continue;

    for (const syn of synonyms) {
      if (typeof syn !== 'string') continue;
      const synLower = syn.toLowerCase().trim();
      if (!Object.prototype.hasOwnProperty.call(NORMALIZE_ROLE_MAP, synLower)) {
        violations.push(
          `[glossary] FAIL I3 term=${entry['term']} — synonym "${syn}" not in normalizeRole() (lib/types/roles.ts:54-64)`
        );
      }
    }
  }

  // ── Context-aware deprecated-synonym scan across target docs ───────────────
  for (const [docRelPath, docContext] of Object.entries(docContextMap)) {
    const absPath = path.join(ROOT, docRelPath);
    if (!fs.existsSync(absPath)) {
      warns.push(`[glossary] WARN skipping target doc (not found): ${docRelPath}`);
      continue;
    }

    const lines = fs.readFileSync(absPath, 'utf-8').split('\n');

    // Collect which terms/synonyms to check for this doc's context
    for (const entry of terms) {
      const termContext = String(entry['context'] || 'both');
      // Skip term if it doesn't apply to this doc's context
      if (termContext !== 'both' && termContext !== docContext) continue;

      const synonyms = entry['deprecated_synonyms'];
      if (!Array.isArray(synonyms) || synonyms.length === 0) continue;

      const isConflicted = entry['lifecycle'] === 'Conflicted';
      const canonicalTerm = String(entry['canonical_form'] || entry['term'] || '');

      for (const syn of synonyms) {
        if (typeof syn !== 'string' || syn.trim() === '') continue;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip YAML frontmatter lines and markdown table header separator lines
          if (line.trim().startsWith('---') || /^\|[-: ]+\|/.test(line)) continue;

          if (lineContainsSynonym(line, syn)) {
            const lineNum = i + 1;
            if (isConflicted) {
              warns.push(
                `[glossary] WARN  file=${docRelPath} line=${lineNum} — conflicted synonym "${syn}" (canonical: "${canonicalTerm}")`
              );
            } else {
              violations.push(
                `[glossary] FAIL  file=${docRelPath} line=${lineNum} — deprecated synonym "${syn}" (canonical: "${canonicalTerm}")`
              );
            }
          }
        }
      }
    }
  }

  // ── Print results ──────────────────────────────────────────────────────────
  log('--- CONFLICT-OPEN entries (lifecycle:Conflicted — exit 0, action required) ---');
  for (const c of conflicts) {
    log(c);
  }
  log('');

  if (warns.length > 0) {
    log('--- WARNINGS ---');
    for (const w of warns) {
      log(w);
    }
    log('');
  }

  if (violations.length > 0) {
    log('--- FAILURES ---');
    for (const v of violations) {
      log(v);
    }
    log('');
    log(`[glossary] FAIL — ${terms.length} terms, ${conflicts.length} conflict(s), ${warns.length} warn(s), ${violations.length} violation(s). Exit 1.`);
    process.exit(1);
  }

  log(`[glossary] PASS — ${terms.length} terms, ${conflicts.length} conflict(s) surfaced (exit 0), ${warns.length} warn(s), 0 violations.`);
}

main();
