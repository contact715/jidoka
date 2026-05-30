#!/usr/bin/env node
// @ts-check
/**
 * Wave-148 — Recurrence Detection Engine
 *
 * Reads the 4 behavioral telemetry JSONL streams, groups events by fingerprint
 * (anti_pattern_slug::agent), applies 9-rule detection thresholds, and emits
 * structured recurrence records to the 5th stream (recurrence-events.jsonl).
 *
 * Detection thresholds (T3):
 *   WARN       — count_24h >= 3 across >= 2 distinct wave identifiers
 *   AUTO-ACTION — count_24h >= 5  OR  count_6h >= 3
 *   AUTO-ACTION — velocity > 0 AND count_24h >= 3  (accelerating pattern)
 *
 * Per-rule overrides:
 *   #6 (scope-creep-mid-wave), #8 (cross-line-authority-contamination): WARN threshold = 2
 *   #5 (over-documentation): WARN threshold = 4
 *
 * Config gates (.sdd-config.json):
 *   recurrenceDetection.enabled:false          → exit 0, write nothing
 *   recurrenceDetection.autoActionEnabled:false → log AUTO-ACTION, do NOT call writeHaltState()
 *
 * Usage:
 *   node scripts/detect-recurrences.mjs [--dry-run]
 *   npm run detect:recurrences
 *
 * Schema: docs/specs/wave-148_MASTER_SPEC.md §3
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  readJsonlStream,
  getCurrentTraceId,
  sanitizeField,
} from './emit-telemetry.mjs';
import { writeHaltState } from './andon-halt-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Stream paths ──────────────────────────────────────────────────────────
const HALT_EVENTS_PATH   = path.join(ROOT, 'docs', 'audits', 'halt-events.jsonl');
const VERDICTS_PATH      = path.join(ROOT, 'docs', 'audits', 'cross-line-verdicts.jsonl');
const CHECKLIST_PATH     = path.join(ROOT, 'docs', 'audits', 'checklist-runs.jsonl');
const AGENT_EVENTS_PATH  = path.join(ROOT, 'docs', 'audits', 'agent-events.jsonl');
const RECURRENCE_PATH    = path.join(ROOT, 'docs', 'audits', 'recurrence-events.jsonl');
const SDD_CONFIG_PATH    = path.join(ROOT, '.sdd-config.json');
const CATALOG_PATH       = path.join(ROOT, 'docs', 'ANTI_PATTERNS_CATALOG.md');

// ── Detection windows (ms) ────────────────────────────────────────────────
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const WINDOW_6H_MS  =  6 * 60 * 60 * 1000;

// ── Rule registry (9 rules — one per catalog entry) ───────────────────────
//
// Each rule maps to one anti-pattern slug.
// threshold_warn: minimum count_24h to emit WARN (default 3; per-rule overrides in T3)
// requires_trace: if true, rule returns NO_DATA when trace_id join is absent
// streams: which input streams to scan for this slug
//
// Rules #5 and #8 require trace_id join — without APP_TRACE_ID propagation
// they return NO_DATA (not a false negative). Documented in spec §17.
//
/** @type {Record<string, { threshold_warn: number, requires_trace: boolean, streams: string[] }>} */
const RULE_REGISTRY = {
  'reactive-incremental-thinking': {
    threshold_warn: 3,
    requires_trace: false,
    streams: ['checklist_run', 'halt', 'cross_line_verdict'],
  },
  'partial-closure-via-documentation': {
    threshold_warn: 3,
    requires_trace: false,
    streams: ['checklist_run', 'halt'],
  },
  'optimistic-completion-bias': {
    threshold_warn: 3,
    requires_trace: false,
    streams: ['checklist_run', 'halt', 'agent_events'],
  },
  'asymmetric-closure-standards': {
    threshold_warn: 3,
    requires_trace: false,
    streams: ['checklist_run', 'halt'],
  },
  'over-documentation': {
    threshold_warn: 4, // per-rule override T3 entry #5
    requires_trace: true, // requires trace_id join (T6 — rules #5 and #8)
    streams: ['checklist_run', 'agent_events'],
  },
  'scope-creep-mid-wave': {
    threshold_warn: 2, // per-rule override T3 entry #6
    requires_trace: false,
    streams: ['checklist_run', 'halt', 'cross_line_verdict'],
  },
  'wave-spec-drift': {
    threshold_warn: 3,
    requires_trace: false,
    streams: ['checklist_run', 'halt'],
  },
  'cross-line-authority-contamination': {
    threshold_warn: 2, // per-rule override T3 entry #8
    requires_trace: true, // requires trace_id join (T6)
    streams: ['cross_line_verdict', 'agent_events'],
  },
  'dispatch-brief-vs-master-spec-drift': {
    threshold_warn: 3,
    requires_trace: false,
    streams: ['checklist_run', 'halt'],
  },
};

// ── Config readers ────────────────────────────────────────────────────────

/**
 * @returns {{ enabled: boolean, autoActionEnabled: boolean }}
 */
function readRecurrenceConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return {
      enabled: Boolean(raw?.recurrenceDetection?.enabled),
      autoActionEnabled: Boolean(raw?.recurrenceDetection?.autoActionEnabled),
    };
  } catch {
    return { enabled: false, autoActionEnabled: false };
  }
}

// ── Catalog slug reader ───────────────────────────────────────────────────

/**
 * Read known anti-pattern slugs from the catalog markdown.
 * Matches "### N. slug-name" headings.
 * @returns {Set<string>}
 */
function readCatalogSlugs() {
  const known = new Set();
  try {
    const content = fs.readFileSync(CATALOG_PATH, 'utf8');
    const matches = content.matchAll(/^###\s+\d+\.\s+([a-z0-9-]+)/gm);
    for (const m of matches) {
      known.add(m[1]);
    }
  } catch {
    // Catalog missing — all slugs are novel
  }
  return known;
}

// ── prev_hash computation for recurrence stream ───────────────────────────
// sanitizeField imported from emit-telemetry.mjs (wave-165 T7 consolidation)

/**
 * Compute prev_hash for the next record appended to RECURRENCE_PATH.
 * @returns {string}
 */
function computeRecurrencePrevHash() {
  try {
    if (!fs.existsSync(RECURRENCE_PATH)) return 'genesis';
    const records = readJsonlStream(RECURRENCE_PATH);
    if (records.length === 0) return 'genesis';
    const last = records[records.length - 1];
    const chainActive = records.some(
      r => r.prev_hash !== null && r.prev_hash !== undefined
    );
    if (!chainActive) return 'genesis';
    return 'sha256:' + crypto
      .createHash('sha256')
      .update(JSON.stringify(last))
      .digest('hex');
  } catch {
    return 'genesis';
  }
}

// ── UPDATE_NEEDED appender (T5) ───────────────────────────────────────────

/**
 * Append an UPDATE_NEEDED block to the anti-patterns catalog when a novel
 * slug is detected that does not match any existing catalog entry.
 * Does NOT auto-write a full entry — human-review prompt only.
 *
 * @param {string} slug
 * @param {string} streamSource
 * @param {string[]} matchedWaves
 * @param {number} matchCount
 * @param {string} timestamp
 */
function appendUpdateNeededToCatalog(slug, streamSource, matchedWaves, matchCount, timestamp) {
  try {
    const block = [
      '',
      '---',
      '',
      `<!-- UPDATE_NEEDED — detected by wave-148 detect-recurrences.mjs -->`,
      `<!-- slug: ${sanitizeField(slug)} -->`,
      `<!-- stream_source: ${sanitizeField(streamSource)} -->`,
      `<!-- detected_in_waves: ${matchedWaves.map(w => sanitizeField(w)).join(', ')} -->`,
      `<!-- match_count: ${matchCount} -->`,
      `<!-- detected_at: ${timestamp} -->`,
      `<!-- Action required: human to review and add full catalog entry if this is a genuine new anti-pattern. -->`,
      '',
    ].join('\n');

    fs.appendFileSync(CATALOG_PATH, block, 'utf8');
    process.stderr.write(
      `[detect-recurrences] UPDATE_NEEDED appended to catalog for novel slug: ${slug}\n`
    );
  } catch (err) {
    process.stderr.write(`[detect-recurrences] WARN — could not append UPDATE_NEEDED: ${err}\n`);
  }
}

// ── Core detection logic ──────────────────────────────────────────────────

/**
 * Load all 4 input streams, filter by timestamp window, group by fingerprint.
 *
 * A "fingerprint" is `anti_pattern_slug::agent`.
 * We derive anti_pattern_slug from event fields by checking:
 *   - record.payload?.rootCause
 *   - record.payload?.anti_pattern_slug
 *   - record.anti_pattern_slug
 *   - record.type (extract last segment after last dot)
 * against the known slug set from the rule registry.
 *
 * @param {number} now
 * @returns {Map<string, { events: object[], agent: string, slug: string }>}
 */
function loadAndGroupEvents(now) {
  const cutoff24 = now - WINDOW_24H_MS;
  const streams = [
    { path: HALT_EVENTS_PATH,  source: 'halt-events' },
    { path: VERDICTS_PATH,     source: 'cross-line-verdicts' },
    { path: CHECKLIST_PATH,    source: 'checklist-runs' },
    { path: AGENT_EVENTS_PATH, source: 'agent-events' },
  ];

  const knownSlugs = new Set(Object.keys(RULE_REGISTRY));

  /** @type {Map<string, { events: object[], agent: string, slug: string, source: string }>} */
  const groups = new Map();

  for (const { path: streamPath, source } of streams) {
    let records;
    try {
      records = readJsonlStream(streamPath);
    } catch {
      records = [];
    }

    for (const rec of records) {
      // Filter by 24h window
      const ts = rec.time ?? rec.timestamp;
      if (!ts) continue;
      const recTime = new Date(ts).getTime();
      if (isNaN(recTime) || recTime < cutoff24) continue;

      // Derive slug
      const slug = deriveSlug(rec, knownSlugs);
      if (!slug) continue;

      const agent = String(rec.agent ?? 'unknown');
      const fingerprint = `${slug}::${agent}`;

      if (!groups.has(fingerprint)) {
        groups.set(fingerprint, { events: [], agent, slug, source });
      }
      /** @type {{ events: object[], agent: string, slug: string, source: string }} */ (groups.get(fingerprint)).events.push(rec);
    }
  }

  return groups;
}

/**
 * Try to derive an anti-pattern slug from a telemetry record.
 * Returns null if no known slug matches.
 *
 * @param {Record<string, unknown>} rec
 * @param {Set<string>} knownSlugs
 * @returns {string | null}
 */
function deriveSlug(rec, knownSlugs) {
  // Direct field
  const direct = rec.anti_pattern_slug ?? rec.payload?.anti_pattern_slug;
  if (typeof direct === 'string' && knownSlugs.has(direct)) return direct;

  // rootCause field may contain slug keywords
  const rootCause = String(rec.payload?.rootCause ?? rec.rootCause ?? '').toLowerCase();
  for (const slug of knownSlugs) {
    if (rootCause.includes(slug)) return slug;
  }

  // payload.principle or verdict may contain slug
  const principle = String(rec.payload?.principle ?? rec.verdict ?? '').toLowerCase();
  for (const slug of knownSlugs) {
    if (principle.includes(slug)) return slug;
  }

  return null;
}

/**
 * Count events in a group that fall within the 6h window.
 *
 * @param {object[]} events
 * @param {number} now
 * @returns {number}
 */
function count6h(events, now) {
  const cutoff = now - WINDOW_6H_MS;
  return events.filter(e => {
    const ts = e.time ?? e.timestamp;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return !isNaN(t) && t >= cutoff;
  }).length;
}

/**
 * Get the set of distinct wave identifiers in a group of events.
 *
 * @param {object[]} events
 * @returns {Set<string>}
 */
function distinctWaves(events) {
  const waves = new Set();
  for (const e of events) {
    if (e.wave && typeof e.wave === 'string') waves.add(e.wave);
  }
  return waves;
}

/**
 * Collect trace_ids from a group of events.
 *
 * @param {object[]} events
 * @returns {string[]}
 */
function collectTraceIds(events) {
  const ids = new Set();
  for (const e of events) {
    if (e.trace_id && typeof e.trace_id === 'string') ids.add(e.trace_id);
  }
  return [...ids];
}

/**
 * Collect event IDs (id field = UUID) from a group.
 *
 * @param {object[]} events
 * @returns {string[]}
 */
function collectEventIds(events) {
  return events
    .map(e => e.id)
    .filter(id => typeof id === 'string');
}

// ── Main detection run ────────────────────────────────────────────────────

/**
 * Run the full detection cycle.
 * @param {{ dryRun: boolean }} opts
 * @returns {void}
 */
function runDetection({ dryRun }) {
  const config = readRecurrenceConfig();

  if (!config.enabled && !dryRun) {
    process.stdout.write(
      '[detect-recurrences] recurrenceDetection.enabled is false — exiting (no records written)\n'
    );
    process.exit(0);
  }

  const now = Date.now();
  const groups = loadAndGroupEvents(now);

  if (groups.size === 0) {
    process.stdout.write(
      `[detect-recurrences] no recurrence detected (0 events matched known slugs in 24h window)\n`
    );
    process.exit(0);
  }

  const knownCatalogSlugs = readCatalogSlugs();
  let recordsEmitted = 0;
  const timestamp = new Date(now).toISOString();
  const currentTraceId = getCurrentTraceId();

  for (const [fingerprint, group] of groups) {
    try {
      const { events, agent, slug, source } = group;
      const count24h = events.length;
      const count6h_val = count6h(events, now);
      const waves = distinctWaves(events);
      const rule = RULE_REGISTRY[slug];

      // A3 — minimum events and distinct waves check
      const warnThreshold = rule?.threshold_warn ?? 3;
      if (count24h < warnThreshold || waves.size < 2) {
        process.stdout.write(
          `[detect-recurrences] SKIP ${fingerprint} — count_24h=${count24h} waves=${waves.size} (below threshold)\n`
        );
        continue;
      }

      // T6 — rules requiring trace_id join
      if (rule?.requires_trace) {
        const traceIds = collectTraceIds(events);
        if (traceIds.length === 0) {
          process.stdout.write(
            `[detect-recurrences] NO_DATA ${fingerprint} — requires trace_id join but no trace_ids found\n`
          );
          continue;
        }
      }

      // T7 — velocity computation
      const velocity = (count6h_val * 4) - count24h;

      // T2/T3 — verdict computation
      let verdict = 'WARN';
      if (count24h >= 5 || count6h_val >= 3 || (velocity > 0 && count24h >= warnThreshold)) {
        verdict = 'AUTO-ACTION';
      }

      const traceIds = collectTraceIds(events);
      const matchedEventIds = collectEventIds(events);
      const prevHash = computeRecurrencePrevHash();

      const record = {
        timestamp,
        event: 'recurrence_detected',
        fingerprint: String(sanitizeField(fingerprint)),
        anti_pattern_slug: String(sanitizeField(slug)),
        agent: String(sanitizeField(agent)),
        verdict,
        occurrence_count_24h: count24h,
        occurrence_count_6h: count6h_val,
        velocity,
        matched_event_ids: matchedEventIds,
        trace_ids: traceIds.length > 0 ? traceIds : [currentTraceId],
        outcome: 'pending',
        resolution_wave: null,
        resolution_notes: null,
        prev_hash: prevHash,
      };

      if (!dryRun) {
        fs.mkdirSync(path.dirname(RECURRENCE_PATH), { recursive: true });
        fs.appendFileSync(RECURRENCE_PATH, JSON.stringify(record) + '\n', 'utf8');
        recordsEmitted++;
      }

      process.stdout.write(
        `[detect-recurrences] ${verdict} ${fingerprint} — count_24h=${count24h} count_6h=${count6h_val} velocity=${velocity}${dryRun ? ' [DRY-RUN]' : ''}\n`
      );

      // AUTO-ACTION path: call writeHaltState only when autoActionEnabled is true
      if (verdict === 'AUTO-ACTION' && config.autoActionEnabled && !dryRun) {
        writeHaltState(
          'wave-148',
          'detect-recurrences',
          `AUTO-ACTION: anti-pattern "${slug}" recurrence — count_24h=${count24h}, count_6h=${count6h_val}, velocity=${velocity}`
        );
        // writeHaltState calls process.exit(42); code below is unreachable on halt
      }

      // T5 — UPDATE_NEEDED for novel slugs not in catalog
      if (!knownCatalogSlugs.has(slug) && !dryRun) {
        appendUpdateNeededToCatalog(
          slug,
          source,
          [...waves],
          count24h,
          timestamp
        );
      }
    } catch (err) {
      // Per-rule try/catch — one bad rule does not suppress others
      process.stderr.write(`[detect-recurrences] ERROR evaluating ${fingerprint}: ${err}\n`);
    }
  }

  const summary = dryRun
    ? `[detect-recurrences] DRY-RUN complete — ${groups.size} fingerprint(s) evaluated, 0 records written`
    : `[detect-recurrences] complete — ${recordsEmitted} recurrence record(s) written`;

  process.stdout.write(summary + '\n');
}

// ── CLI entrypoint ────────────────────────────────────────────────────────
// Guard: only run when executed directly (not when imported as a module).
// This allows `import('./scripts/detect-recurrences.mjs')` to succeed
// without triggering process.exit() on import.

const isDirectExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  runDetection({ dryRun });
}
