#!/usr/bin/env node
// @ts-check
/**
 * Wave-183 — Customer Journey Map Validator
 *
 * Journey map domain: per-persona × per-stage synthesis artifact.
 * NOT a copy of insights-register.json (evidence layer, wave-175).
 * NOT a copy of FUNNEL_REGISTRY.md (stage taxonomy).
 * NOT the onboarding curriculum runner at app/(dashboard)/onboarding/journey.
 * Boundary rule: docs/research/methodology.md:133-143.
 *
 * Validates docs/research/journey-registry.json against four invariants.
 * Reuses parseUri / slugify / parseHeadingSlugs from validate-research.mjs:58-94.
 *
 * Coupling note: this validator loads docs/research/insights-register.json and
 * checks each cited insight's `status` field. If the insights-register schema
 * changes in a future wave, the field path `entry.status` must be updated here.
 *
 * Invariants checked:
 *   I1 (EXIT-1): every non-null pain_point insight_id resolves to a real R-NNN
 *                entry in docs/research/insights-register.json
 *                [FAIL] DANGLING insight_id — <id> pain_point references <insight_id>
 *                which does not exist in insights-register.json
 *
 *   I2 (EXIT-1): every stage_anchor resolves to a real heading in FUNNEL_REGISTRY.md
 *                via heading-slug matching (slugify logic from validate-research.mjs:68-75)
 *                [FAIL] DANGLING stage_anchor — <id> stage_anchor <anchor> resolves
 *                to no heading in FUNNEL_REGISTRY.md
 *
 *   I3 (EXIT-1) HONESTY: any pain_point that cites an insight_id must carry an
 *                evidence_level (at entry level) that does not exceed the cited
 *                insight's status. Specifically: if any entry's evidence_level is
 *                "validated" but the cited insight's status is not "validated",
 *                the validator fails.
 *                [FAIL] HONESTY: evidence_level:validated claimed without backing
 *                validated insight — entry <id> cites <insight_id> (status:<status>)
 *
 *   I4 (EXIT-1): any entry with evidence_level:"validated" and no insight_id in any
 *                pain_point is an unanchored validated claim.
 *                [FAIL] HONESTY: evidence_level:validated claimed without any
 *                insight_id — entry <id> has no pain_point linking a validated insight
 *
 *   WARN: any pain_point with evidence:"none" is flagged for human review (non-blocking)
 *         [WARN] entry <id> — pain_point has evidence:none (review gate: human must
 *         confirm before promoting to a real insight link)
 *
 * Top-level checks:
 *   - registry must have hypothesis_journey:true in _schema block
 *   - [FAIL] if hypothesis_journey is missing or false
 *
 * Exit codes:
 *   0 — no I1, I2, I3, or I4 violations
 *   1 — one or more violations found
 *
 * Usage:
 *   node scripts/validate-journey.mjs
 *   npm run journey:validate
 *
 * Spec: docs/specs/wave-183_MASTER_SPEC.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────────
const JOURNEY_REGISTRY_PATH = path.join(ROOT, 'docs', 'research', 'journey-registry.json');
const INSIGHTS_REGISTER_PATH = path.join(ROOT, 'docs', 'research', 'insights-register.json');
const FUNNEL_REGISTRY_PATH = path.join(ROOT, 'docs', 'FUNNEL_REGISTRY.md');

// ── Output helpers ─────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── Heading slug normaliser (reused from validate-research.mjs:68-75) ─────────
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
 * (reused from validate-research.mjs:83-94)
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

// ── URI parser (reused from validate-research.mjs:120-127) ───────────────────
/**
 * Parse a stage_anchor URI into { docPath, anchor }.
 * Expected format: "docs/FUNNEL_REGISTRY.md#1-lead-qualification"
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

// ── Status rank (for cap comparison) ─────────────────────────────────────────
/** @type {Record<string, number>} */
const STATUS_RANK = {
  'untested': 0,
  'observed-heuristic': 1,
  'validated': 2,
  'invalidated': 2,  // invalidated is as authoritative as validated
};

/**
 * Returns true if claimedLevel is strictly higher than the insight allows.
 * "validated" claim against "untested" insight → cap exceeded.
 *
 * @param {string} claimedLevel  evidence_level on the journey entry
 * @param {string} insightStatus status from insights-register.json
 * @returns {boolean}
 */
function exceedsCap(claimedLevel, insightStatus) {
  if (claimedLevel !== 'validated') return false;
  return (STATUS_RANK[insightStatus] ?? 0) < STATUS_RANK['validated'];
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  log('[validate-journey] Journey map domain: per-persona × per-stage synthesis artifact');
  log('[validate-journey] Boundary rule: docs/research/methodology.md:133-143');
  log(`[validate-journey] registry: ${JOURNEY_REGISTRY_PATH}`);
  log('');

  // ── Load journey registry ─────────────────────────────────────────────────
  if (!fs.existsSync(JOURNEY_REGISTRY_PATH)) {
    log(`[validate-journey] FATAL: journey registry not found at ${JOURNEY_REGISTRY_PATH}`);
    process.exit(1);
  }

  let journeyRaw;
  try {
    journeyRaw = JSON.parse(fs.readFileSync(JOURNEY_REGISTRY_PATH, 'utf-8'));
  } catch (err) {
    log(`[validate-journey] FATAL: could not parse journey-registry.json — ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(journeyRaw)) {
    log('[validate-journey] FATAL: journey-registry.json root must be a JSON array');
    process.exit(1);
  }

  // Separate _schema sentinel from entries
  const schemaBlock = journeyRaw.find((e) => Object.prototype.hasOwnProperty.call(e, '_schema'));
  const entries = journeyRaw.filter((e) => !Object.prototype.hasOwnProperty.call(e, '_schema'));

  log(`[validate-journey] loaded ${entries.length} journey entries (excluding _schema sentinel)`);

  // ── Check hypothesis_journey:true ─────────────────────────────────────────
  const hypothesisJourney = schemaBlock?._schema?.hypothesis_journey;
  if (hypothesisJourney !== true) {
    log('[FAIL] HONESTY: hypothesis_journey is not set to true in _schema block');
    log('[validate-journey] EXIT 1 — hypothesis_journey:true is mandatory (AC-3)');
    process.exit(1);
  }
  log('[PASS] _schema.hypothesis_journey:true — registry is honestly marked as a hypothesis');
  log('');

  // ── Load insights register ────────────────────────────────────────────────
  if (!fs.existsSync(INSIGHTS_REGISTER_PATH)) {
    log(`[validate-journey] FATAL: insights register not found at ${INSIGHTS_REGISTER_PATH}`);
    process.exit(1);
  }

  let insightsRaw;
  try {
    insightsRaw = JSON.parse(fs.readFileSync(INSIGHTS_REGISTER_PATH, 'utf-8'));
  } catch (err) {
    log(`[validate-journey] FATAL: could not parse insights-register.json — ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(insightsRaw)) {
    log('[validate-journey] FATAL: insights-register.json root must be a JSON array');
    process.exit(1);
  }

  // Build a Map of insight_id → status for O(1) lookup
  /** @type {Map<string, string>} */
  const insightStatusMap = new Map();
  for (const item of insightsRaw) {
    if (item.id && item.status) {
      insightStatusMap.set(item.id, item.status);
    }
  }
  log(`[validate-journey] loaded ${insightStatusMap.size} insights from insights-register.json`);
  log('');

  // ── Load FUNNEL_REGISTRY heading slugs ────────────────────────────────────
  if (!fs.existsSync(FUNNEL_REGISTRY_PATH)) {
    log(`[validate-journey] FATAL: FUNNEL_REGISTRY.md not found at ${FUNNEL_REGISTRY_PATH}`);
    process.exit(1);
  }
  const funnelSlugs = parseHeadingSlugs(FUNNEL_REGISTRY_PATH);
  log(`[validate-journey] loaded ${funnelSlugs.size} heading slugs from FUNNEL_REGISTRY.md`);
  log('');

  // ── Validate each entry ───────────────────────────────────────────────────
  let violations = 0;
  let warnings = 0;
  let passes = 0;

  for (const entry of entries) {
    const entryId = entry.id ?? '(no-id)';
    const evidenceLevel = (entry.evidence_level ?? '').trim();
    let entryViolated = false;

    // ── I2: stage_anchor must resolve to a real FUNNEL_REGISTRY heading ────
    const stageAnchor = (entry.stage_anchor ?? '').trim();
    if (!stageAnchor) {
      log(`[FAIL] DANGLING stage_anchor — entry ${entryId}: stage_anchor is empty (I2 violation)`);
      violations++;
      entryViolated = true;
    } else {
      const { docPath, anchor } = parseUri(stageAnchor);
      const absDocPath = path.join(ROOT, docPath);

      if (!fs.existsSync(absDocPath)) {
        log(`[FAIL] DANGLING stage_anchor — entry ${entryId}: stage_anchor references non-existent document: ${docPath} (I2 violation)`);
        violations++;
        entryViolated = true;
      } else if (anchor !== null) {
        if (!funnelSlugs.has(anchor)) {
          log(`[FAIL] DANGLING stage_anchor — entry ${entryId}: stage_anchor anchor "#${anchor}" resolves to no heading in ${docPath} (I2 violation)`);
          violations++;
          entryViolated = true;
        }
      }
    }

    // ── Check pain_points ────────────────────────────────────────────────────
    const painPoints = Array.isArray(entry.pain_points) ? entry.pain_points : [];
    let hasValidatedInsight = false;

    for (const pp of painPoints) {
      const ppInsightId = pp.insight_id ?? null;
      const ppEvidence = (pp.evidence ?? '').trim();

      if (ppInsightId !== null) {
        // ── I1: insight_id must resolve to a real entry in insights-register ─
        if (!insightStatusMap.has(ppInsightId)) {
          log(`[FAIL] DANGLING insight_id — entry ${entryId}: pain_point references insight_id "${ppInsightId}" which does not exist in insights-register.json (I1 violation)`);
          violations++;
          entryViolated = true;
        } else {
          const insightStatus = insightStatusMap.get(ppInsightId);

          // ── I3: HONESTY — evidence_level cannot exceed cited insight's status ─
          if (exceedsCap(evidenceLevel, insightStatus)) {
            log(`[FAIL] HONESTY: evidence_level:validated claimed without backing validated insight — entry ${entryId} cites ${ppInsightId} (status:${insightStatus}) but entry claims evidence_level:validated (I3 violation)`);
            violations++;
            entryViolated = true;
          }

          if (insightStatus === 'validated') {
            hasValidatedInsight = true;
          }
        }
      } else {
        // pain_point has no insight_id — must carry evidence:"none" explicitly
        if (ppEvidence !== 'none') {
          log(`[FAIL] HONESTY: pain_point in entry ${entryId} has no insight_id and no evidence:"none" — silent omission is not allowed (I4 variant)`);
          violations++;
          entryViolated = true;
        } else {
          // evidence:none is allowed but warn
          log(`[WARN] entry ${entryId} — pain_point has evidence:none (human review gate: confirm before promoting to a real insight link)`);
          warnings++;
        }
      }
    }

    // ── I4: validated entry must have at least one backing validated insight ─
    if (evidenceLevel === 'validated' && !hasValidatedInsight && !entryViolated) {
      log(`[FAIL] HONESTY: evidence_level:validated claimed without any insight_id linking a validated insight — entry ${entryId} (I4 violation)`);
      violations++;
      entryViolated = true;
    }

    if (!entryViolated) {
      log(`[PASS] ${entryId} — persona:${entry.persona ?? 'n/a'} stage:${entry.stage ?? 'n/a'} evidence_level:${evidenceLevel}`);
      passes++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log('');
  log(`[validate-journey] Results: ${passes} PASS, ${warnings} WARN, ${violations} VIOLATION`);

  if (violations > 0) {
    log(`[validate-journey] EXIT 1 — ${violations} violation(s) found`);
    process.exit(1);
  }

  log('[validate-journey] EXIT 0 — all invariants satisfied (I1 dangling insight_id, I2 dangling stage_anchor, I3 evidence cap, I4 validated-without-backing)');
  process.exit(0);
}

main();
