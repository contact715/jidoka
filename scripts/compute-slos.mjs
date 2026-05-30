#!/usr/bin/env node
// @ts-check
/**
 * Wave-146 — Behavioral SLO / Error Budget compute script
 *
 * Reads 5 SLO definitions from docs/quality/slo-definitions.json,
 * evaluates each against its input stream using dual 7d/28d windows,
 * emits one slo_evaluated or budget_breach record per SLO to
 * docs/audits/slo-events.jsonl via the universal telemetry emitter.
 *
 * Usage:
 *   npm run compute:slos
 *   node scripts/compute-slos.mjs
 *
 * Decisions honored:
 *   T1: 7d primary alerting window + 28d budget-remaining (reported only)
 *   T3: 1h fast-burn check at 14.4x threshold
 *   T4: WARN >= 0.5, EXHAUSTED >= 1.0
 *   T6: soft-mode default; hard-mode behind sloMonitoring.hardBlockEnabled
 *   A12: SLO-5 skipped when recurrenceDetection.enabled === false
 *
 * EU AI Act Art 9: slo-definitions.json carries version + rationale per entry.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonlStream, emitTelemetry } from './emit-telemetry.mjs';
import { writeHaltState } from './andon-halt-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');
const SLO_DEFS_PATH = path.join(ROOT, 'docs', 'quality', 'slo-definitions.json');

/** @returns {{ hardBlockEnabled: boolean, sloEnabled: boolean, recurrenceEnabled: boolean }} */
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return {
      sloEnabled: Boolean(raw?.sloMonitoring?.enabled),
      hardBlockEnabled: Boolean(raw?.sloMonitoring?.hardBlockEnabled),
      recurrenceEnabled: Boolean(raw?.recurrenceDetection?.enabled),
    };
  } catch {
    return { sloEnabled: false, hardBlockEnabled: false, recurrenceEnabled: false };
  }
}

/**
 * @typedef {{ id: string, version: string, name: string, rationale: string, stream: string, event_filter: Record<string,unknown>, budget_7d: number, agent: string|null }} SLODef
 */

/** @returns {SLODef[]} */
function loadSLODefs() {
  const raw = JSON.parse(fs.readFileSync(SLO_DEFS_PATH, 'utf8'));
  return raw.slos;
}

/**
 * Check whether a record matches all key/value pairs in filter.
 * null filter values match records where the field is absent, null, or undefined.
 * String comparisons are case-insensitive.
 *
 * @param {Record<string, unknown>} record
 * @param {Record<string, unknown>} filter
 * @returns {boolean}
 */
function matchesFilter(record, filter) {
  for (const [k, v] of Object.entries(filter)) {
    const rv = record[k];
    if (v === null) {
      // null in filter means the field must be absent, null, or undefined
      if (rv !== null && rv !== undefined) return false;
    } else if (typeof v === 'string') {
      if (typeof rv !== 'string') return false;
      if (rv.toLowerCase() !== v.toLowerCase()) return false;
    } else {
      if (rv !== v) return false;
    }
  }
  return true;
}

/** @param {number} ms @returns {number} Unix ms timestamp */
function msAgo(ms) {
  return Date.now() - ms;
}

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_28D = 28 * 24 * 60 * 60 * 1000;
const MS_1H  =      60 * 60 * 1000;

/**
 * Evaluate a single SLO against its stream.
 * Returns null and logs if the stream is absent.
 *
 * @param {SLODef} slo
 * @returns {{ occurrences_7d: number, occurrences_28d: number, occurrences_1h: number } | null}
 */
function countOccurrences(slo) {
  const streamPath = path.join(ROOT, slo.stream);

  if (!fs.existsSync(streamPath)) {
    process.stderr.write(`[slo] stream absent: ${slo.stream}\n`);
    return null;
  }

  const records = readJsonlStream(streamPath);
  const cutoff7d  = msAgo(MS_7D);
  const cutoff28d = msAgo(MS_28D);
  const cutoff1h  = msAgo(MS_1H);

  let occ_7d  = 0;
  let occ_28d = 0;
  let occ_1h  = 0;

  for (const rec of records) {
    const ts = rec.timestamp ?? rec.time;
    if (!ts) continue;
    const tsMs = new Date(ts).getTime();
    if (isNaN(tsMs)) continue;

    if (!matchesFilter(rec, slo.event_filter)) continue;

    if (tsMs >= cutoff28d) occ_28d++;
    if (tsMs >= cutoff7d)  occ_7d++;
    if (tsMs >= cutoff1h)  occ_1h++;
  }

  return { occurrences_7d: occ_7d, occurrences_28d: occ_28d, occurrences_1h: occ_1h };
}

async function main() {
  const cfg = readConfig();
  const slos = loadSLODefs();

  for (const slo of slos) {
    // A12: skip SLO-5 when recurrenceDetection.enabled is false
    if (slo.id === 'SLO-5' && !cfg.recurrenceEnabled) {
      process.stderr.write('[slo] SLO-5 skipped: recurrenceDetection.enabled=false\n');
      continue;
    }

    const counts = countOccurrences(slo);
    if (counts === null) {
      // Stream absent — skip without emitting a record (non-fatal per ISO 25010 fault-tolerance)
      continue;
    }

    const { occurrences_7d, occurrences_28d, occurrences_1h } = counts;

    // T3: burn rate = occurrences in 7d / budget for 7d
    const burn_rate = occurrences_7d / slo.budget_7d;

    // T3: fast-burn check — if 1h rate extrapolated to 7d exceeds 14.4x the budget
    // hourly_budget = budget_7d / (7*24) = budget_7d / 168
    const hourly_budget = slo.budget_7d / 168;
    const fast_burn_1h = hourly_budget > 0
      ? (occurrences_1h / hourly_budget) >= 14.4
      : occurrences_1h > 0;

    // T5: 28d budget remaining (budget_7d * 4 = 28d budget)
    const budget_remaining_28d = (slo.budget_7d * 4) - occurrences_28d;

    // T4: verdict thresholds
    let verdict;
    if (burn_rate >= 1.0) {
      verdict = 'EXHAUSTED';
    } else if (burn_rate >= 0.5) {
      verdict = 'WARN';
    } else {
      verdict = 'PASS';
    }

    // A9: log to stderr on WARN or EXHAUSTED
    if (verdict !== 'PASS') {
      process.stderr.write(
        `[slo] ${slo.id} ${verdict} burn_rate=${burn_rate.toFixed(3)} remaining_28d=${budget_remaining_28d}\n`
      );
    }

    if (fast_burn_1h) {
      process.stderr.write(
        `[slo] ${slo.id} FAST-BURN 1h occurrences=${occurrences_1h} (threshold exceeded 14.4x)\n`
      );
    }

    // A6: emit to slo-events.jsonl (event type drives routing to 9th stream)
    const eventType = verdict === 'EXHAUSTED' ? 'budget_breach' : 'slo_evaluated';

    emitTelemetry(eventType, {
      source: 'scripts/compute-slos.mjs',
      wave: 'wave-146',
      agent: 'slo-monitor',
      verdict,
      payload: {
        slo_id: slo.id,
        window: '7d',
        current_occurrences: occurrences_7d,
        budget_per_window: slo.budget_7d,
        burn_rate,
        fast_burn_1h,
        budget_remaining_28d,
        event_count_7d: occurrences_7d,
      },
    });

    // A11: hard-mode halt on EXHAUSTED — only when hardBlockEnabled === true
    if (verdict === 'EXHAUSTED' && cfg.hardBlockEnabled) {
      writeHaltState(
        'wave-146',
        'slo-monitor',
        `${slo.id} budget EXHAUSTED — burn_rate=${burn_rate.toFixed(3)}, occurrences_7d=${occurrences_7d}, budget_7d=${slo.budget_7d}`
      );
    }
  }
}

main().catch(err => {
  process.stderr.write(`[slo] FATAL: ${err}\n`);
  process.exit(1);
});
