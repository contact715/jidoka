#!/usr/bin/env node
// @ts-check
/**
 * Wave-166 — Constitutional Drift Monitor
 *
 * Reads docs/audits/constitutional-events.jsonl (13th stream), groups records
 * by q_number (Q1-Q5), computes per-Q 7-day rolling VIOLATION rate, and alerts
 * when any Q's rate crosses 2 standard deviations above its mean.
 *
 * Design decisions (§5 T4, T6, T8):
 *   - v1 = 7-day rolling VIOLATION rate + 2σ band. CUSUM is v2.
 *   - N < 5 guard: skip 2σ alert on sparse data (prevents noise alerts).
 *   - Soft-mode default: constitutionalDrift.hardBlockEnabled: false (exit 0).
 *   - Hard-block opt-in: hardBlockEnabled: true → writeHaltState + exit 42.
 *   - MISSION.md and all .claude/agents/ files are STRICTLY read-only (A13).
 *
 * Mirrors compute-slos.mjs structure: readJsonlStream + window + threshold + emitTelemetry.
 *
 * Usage:
 *   node scripts/detect-constitutional-drift.mjs
 *   node scripts/detect-constitutional-drift.mjs --dry-run
 *
 * Exit codes:
 *   0  — no drift detected, or drift detected in soft mode
 *   42 — drift detected and constitutionalDrift.hardBlockEnabled: true
 *
 * EU AI Act Art 9(2)(c): post-market monitoring data feed
 * EU AI Act Art 15: prior-defined metrics (budget_7d: 0 in SLO-8)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonlStream, emitTelemetry } from './emit-telemetry.mjs';
import { writeHaltState } from './andon-halt-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONSTITUTIONAL_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'constitutional-events.jsonl');
const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');

const MS_7D = 7 * 24 * 60 * 60 * 1000;

/** Valid Q-number IDs per MISSION.md:134-138 */
const Q_IDS = /** @type {const} */ (['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);

// ── Config reader ────────────────────────────────────────────────────────────

/**
 * Read constitutionalDrift flags from .sdd-config.json.
 * Returns false on missing/malformed (soft-mode default per T6).
 * @returns {{ hardBlockEnabled: boolean }}
 */
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return {
      hardBlockEnabled: Boolean(raw?.constitutionalDrift?.hardBlockEnabled),
    };
  } catch {
    return { hardBlockEnabled: false };
  }
}

// ── Stats helpers ────────────────────────────────────────────────────────────

/**
 * Compute mean and population standard deviation for an array of numbers.
 * Returns { mean: 0, sigma: 0 } for empty or single-element arrays.
 * @param {number[]} values
 * @returns {{ mean: number, sigma: number }}
 */
function computeStats(values) {
  if (values.length === 0) return { mean: 0, sigma: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, sigma: 0 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, sigma: Math.sqrt(variance) };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // A14: absent stream — log + exit 0 (no events)
  if (!fs.existsSync(CONSTITUTIONAL_EVENTS_PATH)) {
    process.stderr.write('[drift] constitutional-events.jsonl absent — no data to analyze\n');
    process.exit(0);
  }

  const records = readJsonlStream(CONSTITUTIONAL_EVENTS_PATH);

  if (records.length === 0) {
    process.stderr.write('[drift] constitutional-events.jsonl empty — no data to analyze\n');
    process.exit(0);
  }

  const cfg = readConfig();
  const now = Date.now();
  const cutoff7d = now - MS_7D;

  // ── Per-Q analysis ─────────────────────────────────────────────────────────
  // Group all records by q_number; use payload.q_number field (emitted by T.2).
  // Records without q_number (PASS records where q_number is null) are counted
  // under a null key but not included in drift analysis (only VIOLATION matters).

  /** @type {Map<string, Array<{ ts: number, verdict: string }>>} */
  const byQ = new Map();
  for (const q of Q_IDS) {
    byQ.set(q, []);
  }

  for (const rec of records) {
    // constitutional_verdict records carry verdict at top level; payload carries q_number
    const verdict = rec.verdict ?? rec.payload?.verdict;
    const qNum = rec.payload?.q_number ?? rec.q_number;
    const ts = new Date(rec.time ?? rec.timestamp ?? 0).getTime();
    if (!verdict || !qNum || !Q_IDS.includes(/** @type {string} */ (qNum))) continue;
    if (byQ.has(qNum)) {
      byQ.get(qNum)?.push({ ts, verdict: String(verdict) });
    }
  }

  let driftDetected = false;

  for (const qId of Q_IDS) {
    const qRecords = byQ.get(qId) ?? [];
    const totalN = qRecords.length;

    // A8: insufficient data guard — skip 2σ alert when N < 5
    if (totalN < 5) {
      process.stderr.write(
        `[drift] ${qId}: insufficient data (N=${totalN}<5) — skipping alert\n`
      );
      continue;
    }

    // Count VIOLATION records in the trailing 7-day window
    const violations7d = qRecords.filter(r => r.ts >= cutoff7d && r.verdict === 'VIOLATION').length;
    // Total records in 7d window (for rate denominator)
    const total7d = qRecords.filter(r => r.ts >= cutoff7d).length;
    const rate7d = total7d > 0 ? violations7d / total7d : 0;

    // Build a rolling per-week VIOLATION rate series using all historical records
    // sorted by time. Use a sliding 7d window across weeks to build data points.
    // Simplified: compute weekly rates using all records grouped by 7d buckets.
    const sortedTs = qRecords.map(r => r.ts).sort((a, b) => a - b);
    const earliest = sortedTs[0];
    const latest = sortedTs[sortedTs.length - 1];
    const windowMs = MS_7D;

    /** @type {number[]} */
    const weeklyRates = [];

    // Slide a 7d window from earliest to latest in 7d steps
    let windowStart = earliest;
    while (windowStart <= latest) {
      const windowEnd = windowStart + windowMs;
      const inWindow = qRecords.filter(r => r.ts >= windowStart && r.ts < windowEnd);
      const totalInWindow = inWindow.length;
      const violationsInWindow = inWindow.filter(r => r.verdict === 'VIOLATION').length;
      if (totalInWindow > 0) {
        weeklyRates.push(violationsInWindow / totalInWindow);
      }
      windowStart = windowEnd;
    }

    const { mean, sigma } = computeStats(weeklyRates);
    const threshold = mean + 2 * sigma;

    if (dryRun) {
      process.stdout.write(
        `[drift] ${qId}: rate_7d=${rate7d.toFixed(3)} mean=${mean.toFixed(3)} sigma=${sigma.toFixed(3)} threshold=${threshold.toFixed(3)} N=${totalN}\n`
      );
    }

    // A7: alert if current 7d rate exceeds mean + 2σ
    if (rate7d > threshold) {
      process.stderr.write(
        `[drift] ALERT — ${qId} constitutional drift: rate_7d=${rate7d.toFixed(3)} > threshold=${threshold.toFixed(3)} (mean=${mean.toFixed(3)}, sigma=${sigma.toFixed(3)})\n`
      );

      driftDetected = true;

      if (!dryRun) {
        emitTelemetry('constitutional_drift_detected', {
          source: 'scripts/detect-constitutional-drift.mjs',
          wave: 'wave-166',
          agent: 'constitutional-drift-monitor',
          payload: {
            q_number: qId,
            rate_7d: rate7d,
            mean,
            sigma,
            threshold,
          },
        });
      }

      // A9/A10: hard-block vs soft-mode
      if (cfg.hardBlockEnabled && !dryRun) {
        writeHaltState(
          'wave-166',
          'constitutional-drift-monitor',
          `${qId} constitutional drift detected: rate_7d=${rate7d.toFixed(3)} > threshold=${threshold.toFixed(3)}`
        );
        // writeHaltState calls process.exit(42) internally
      }
    }
  }

  if (!driftDetected && !dryRun) {
    process.stdout.write('[drift] PASS — no constitutional drift detected in any Q1-Q5\n');
  }

  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`[drift] FATAL: ${err}\n`);
  process.exit(1);
});
