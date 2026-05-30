#!/usr/bin/env node
// @ts-check
/**
 * Wave-175 — User Research Validator
 *
 * Validates docs/research/insights-register.json against four invariants.
 * Reuses parse-invariant-exit shape from scripts/validate-gdpr-inventory.mjs:1-60
 * and orphan/dangling-ref pattern from scripts/validate-runbooks.mjs:359-370.
 *
 * Invariants checked:
 *   I1 (EXIT-1): every entry has a non-empty linked_assumption field
 *                [ORPHAN] <id> — linked_assumption is empty
 *   I2 (EXIT-1): every linked_assumption URI resolves to a real heading in the
 *                target document (dangling-ref check)
 *                [ORPHAN] <id> — linked_assumption resolves to no heading in <doc>
 *   I3 (EXIT-1) HONESTY: any entry with status "validated" or "invalidated" MUST
 *                have a non-empty evidence_source. Any entry with status
 *                "observed-heuristic" MUST also have a non-empty evidence_source.
 *                [HONESTY-VIOLATION] <id> — <status> status without evidence_source
 *   I4 (WARN):  any entry with importance "high" AND status "untested" is flagged
 *                as a research priority
 *                [WARN] <id> — high-importance assumption untested: research-priority
 *
 * Flags:
 *   --dry    Validate only; no file writes (this validator never writes files;
 *            --dry is kept for consistency with validate-gdpr-inventory.mjs pattern)
 *
 * Exit codes:
 *   0 — no I1, I2, or I3 violations (I4 is warn-only)
 *   1 — one or more I1, I2, or I3 violations found
 *
 * Usage:
 *   node scripts/validate-research.mjs
 *   node scripts/validate-research.mjs --dry
 *   npm run research:validate
 *
 * Spec: docs/specs/wave-175_MASTER_SPEC.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDry = args.includes('--dry');

// ── Paths ─────────────────────────────────────────────────────────────────────
const REGISTER_PATH = path.join(ROOT, 'docs', 'research', 'insights-register.json');

// ── Output helpers ─────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── Heading slug normaliser ───────────────────────────────────────────────────
/**
 * Converts a Markdown heading to a GitHub-style anchor slug.
 * Rule: lowercase, spaces → hyphens, strip everything that is not
 * alphanumeric, hyphen, or a CJK/Cyrillic character (broad unicode keep).
 * Matches the algorithm GitHub uses for anchor generation.
 *
 * @param {string} heading
 * @returns {string}
 */
function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')  // keep letters, numbers, spaces, hyphens
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse all headings from a Markdown file and return a Set of their slugs.
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

// ── Heading slug cache (parse each doc once) ──────────────────────────────────
/** @type {Map<string, Set<string>>} */
const headingCache = new Map();

/**
 * @param {string} docRelPath  e.g. "docs/MISSION.md"
 * @returns {Set<string>}
 */
function getHeadingSlugs(docRelPath) {
  if (headingCache.has(docRelPath)) return headingCache.get(docRelPath);
  const absPath = path.join(ROOT, docRelPath);
  const slugs = parseHeadingSlugs(absPath);
  headingCache.set(docRelPath, slugs);
  return slugs;
}

// ── URI parser ────────────────────────────────────────────────────────────────
/**
 * Parse a linked_assumption URI into { docPath, anchor }.
 * Expected format: "docs/MISSION.md#the-promise-we-make-to-a-customer"
 *
 * @param {string} uri
 * @returns {{ docPath: string; anchor: string | null }}
 */
function parseUri(uri) {
  const hashIdx = uri.indexOf('#');
  if (hashIdx === -1) return { docPath: uri, anchor: null };
  return {
    docPath: uri.slice(0, hashIdx),
    anchor: uri.slice(hashIdx + 1),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  log(`[validate-research] register: ${REGISTER_PATH}${isDry ? ' (--dry)' : ''}`);

  // ── Parse register ────────────────────────────────────────────────────────
  if (!fs.existsSync(REGISTER_PATH)) {
    log(`[validate-research] FATAL: register not found at ${REGISTER_PATH}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf-8'));
  } catch (err) {
    log(`[validate-research] FATAL: could not parse register JSON — ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(raw)) {
    log('[validate-research] FATAL: register root must be a JSON array');
    process.exit(1);
  }

  // Skip the _schema sentinel entry (first element if it has _schema key)
  const entries = raw.filter((e) => !Object.prototype.hasOwnProperty.call(e, '_schema'));

  log(`[validate-research] loaded ${entries.length} entries (excluding _schema sentinel)`);
  log('');

  let violations = 0;
  let warnings = 0;
  let passes = 0;

  for (const entry of entries) {
    const id = entry.id ?? '(no-id)';

    // ── I1: linked_assumption must be non-empty ───────────────────────────
    const linkedAssumption = (entry.linked_assumption ?? '').trim();
    if (!linkedAssumption) {
      log(`[ORPHAN] ${id} — linked_assumption is empty (I1 violation)`);
      violations++;
      continue;
    }

    // ── I2: dangling-ref check — anchor must resolve to a real heading ────
    const { docPath, anchor } = parseUri(linkedAssumption);
    const absDocPath = path.join(ROOT, docPath);

    if (!fs.existsSync(absDocPath)) {
      log(`[ORPHAN] ${id} — linked_assumption references non-existent document: ${docPath} (I2 violation)`);
      violations++;
      continue;
    }

    if (anchor !== null) {
      const slugs = getHeadingSlugs(docPath);
      if (!slugs.has(anchor)) {
        log(`[ORPHAN] ${id} — linked_assumption anchor "#${anchor}" resolves to no heading in ${docPath} (I2 violation)`);
        violations++;
        continue;
      }
    }

    // ── I3: HONESTY — no validated/invalidated/observed-heuristic without evidence ──
    const status = (entry.status ?? '').trim();
    const evidenceSource = (entry.evidence_source ?? '').trim();
    const requiresEvidence = status === 'validated' || status === 'invalidated' || status === 'observed-heuristic';

    if (requiresEvidence && !evidenceSource) {
      log(`[HONESTY-VIOLATION] ${id} — ${status} status without evidence_source (I3 violation)`);
      violations++;
      continue;
    }

    // ── I4: WARN for high-importance untested assumptions (non-blocking) ──
    if (entry.importance === 'high' && status === 'untested') {
      log(`[WARN] ${id} — high-importance assumption untested: research-priority (I4)`);
      warnings++;
    }

    log(`[PASS] ${id} — ${status} | importance:${entry.importance ?? 'n/a'} | ${linkedAssumption}`);
    passes++;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log('');
  log(`[validate-research] Results: ${passes} PASS, ${warnings} WARN, ${violations} VIOLATION`);

  if (violations > 0) {
    log(`[validate-research] EXIT 1 — ${violations} I1/I2/I3 violation(s) found`);
    process.exit(1);
  }

  log('[validate-research] EXIT 0 — all I1, I2, I3 invariants satisfied');
  process.exit(0);
}

main();
