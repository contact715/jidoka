#!/usr/bin/env node
// @ts-check
/**
 * Wave-168 — DORA Delivery-Performance Compute Script
 *
 * Reads 4 DORA metric definitions from docs/quality/dora-definitions.json,
 * computes each metric from its source signals (git log, halt-events.jsonl,
 * recurrence-events.jsonl), emits one dora_metric_computed record per metric
 * to docs/audits/dora-events.jsonl via the universal telemetry emitter.
 *
 * Usage:
 *   npm run compute:dora
 *   node scripts/compute-dora.mjs
 *   node scripts/compute-dora.mjs --dry   (print metrics; no JSONL write)
 *
 * Decisions honored:
 *   D1: NEW sibling of compute-slos.mjs — different computation class (time-delta vs occurrence-count)
 *   D2: "Deployment" = commit matching ^[a-z+]+\(<scope>\): wave-NNN (any conventional-commit type+scope)
 *   D3: CFR = R2 commit OR halt-producing-R2, union de-duped per wave; anti-gaming enforced
 *   D4: MTTR = HALT→RESUME pairs per wave-id; wave-current excluded; AC-12 stderr note
 *   D5: Lead Time v1 = first→last qualifying commit per wave (proxy, declared in defs)
 *   D6: Four-tier numeric DORA bands (Elite/High/Medium/Low) per 2024 DORA State of DevOps
 *   D7: agent field captured per dora_metric_computed record; correlation deferred to v2
 *   D8: AI-calibration note mandatory in output (framed as calibration, not alarm)
 *   Soft-default: doraMonitoring.hardBlockEnabled=false → exit 0 regardless of band
 *
 * AC-13: A halt that resumes with no subsequent R2 commit for the same wave does NOT
 *        count as a CFR failure event.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readJsonlStream, emitTelemetry } from './emit-telemetry.mjs';
import { writeHaltState } from './andon-halt-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');
const DORA_DEFS_PATH = path.join(ROOT, 'docs', 'quality', 'dora-definitions.json');
const HALT_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'halt-events.jsonl');
const RECURRENCE_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'recurrence-events.jsonl');
const DORA_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'dora-events.jsonl');

const isDry = process.argv.includes('--dry');

/** @returns {{ enabled: boolean, hardBlockEnabled: boolean }} */
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return {
      enabled: Boolean(raw?.doraMonitoring?.enabled),
      hardBlockEnabled: Boolean(raw?.doraMonitoring?.hardBlockEnabled),
    };
  } catch {
    return { enabled: false, hardBlockEnabled: false };
  }
}

/**
 * @typedef {{ id: string, version: string, name: string, rationale: string, bands: Record<string, object> }} DORAMetricDef
 * @typedef {{ version: string, metrics: DORAMetricDef[], ai_calibration_note: string }} DORADefs
 */

/** @returns {DORADefs} */
function loadDORAdefs() {
  const raw = JSON.parse(fs.readFileSync(DORA_DEFS_PATH, 'utf8'));
  return raw;
}

/**
 * Run a shell command relative to ROOT. Returns '' on error (never throws).
 * Mirrors the sh() pattern from scripts/current-wave-status.mjs:28-33.
 * @param {string} cmd
 * @returns {string}
 */
function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// ── Shared time constants ────────────────────────────────────────────────────
const MS_7D = 7 * 24 * 60 * 60 * 1000;

// ── Deployment Frequency (DF) ─────────────────────────────────────────────────

/**
 * Count qualifying wave-delivery commits in the last 7 days.
 * Decision D2 (R2 fix): a qualifying commit subject matches any conventional-commit
 *   type+scope targeting a wave, e.g. feat(rfc): wave-167, fix(memory): wave-151.R2.
 *   The earlier `\(\*\)` literal was a wildcard-vs-literal defect — corrected in R2.
 *
 * De-dup by wave number: a wave with multiple commits counts as ONE deployment.
 * Excludes .R2 / task suffixes from the deployed-wave set so revisions are not
 * double-counted as new deploys.
 *
 * Uses execSync git log, same pattern as scripts/current-wave-status.mjs:37.
 *
 * @returns {{ count_7d: number, commits: string[], unique_waves: number }}
 */
function computeDeploymentFrequency() {
  const since = new Date(Date.now() - MS_7D).toISOString();
  const raw = sh(`git log --pretty=format:"%s" --since="${since}"`);
  if (!raw) return { count_7d: 0, commits: [], unique_waves: 0 };

  const lines = raw.split('\n').filter(Boolean);
  // Matches any conventional-commit type+scope with a wave number, e.g. feat(rfc): wave-167
  const deployPattern = /^[a-z+]+\([^)]*\): wave-(\d+)/;
  const qualifying = lines.filter(line => deployPattern.test(line));

  // De-dup by wave number — count unique waves, not raw commit count
  const waveSet = new Set();
  for (const line of qualifying) {
    const m = deployPattern.exec(line);
    if (m) waveSet.add(m[1]); // just the number; .R2/task suffixes are not a separate wave
  }

  return { count_7d: waveSet.size, commits: qualifying, unique_waves: waveSet.size };
}

/**
 * Classify DF band based on per-week count.
 * Elite >= 7/week; High >= 1/week < 7; Medium < 1/week but > 0 (approx per 28d);
 * Low = 0 in 7d.
 * @param {number} count_7d
 * @returns {string}
 */
function classifyDFBand(count_7d) {
  if (count_7d >= 7) return 'Elite';
  if (count_7d >= 1) return 'High';
  // Check last 28d for Medium vs Low
  const since28 = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
  const raw28 = sh(`git log --pretty=format:"%s" --since="${since28}"`);
  const deployPattern28 = /^[a-z+]+\([^)]*\): wave-(\d+)/;
  const waveSet28 = new Set();
  for (const l of (raw28 || '').split('\n').filter(Boolean)) {
    const m = deployPattern28.exec(l);
    if (m) waveSet28.add(m[1]);
  }
  const count28 = waveSet28.size;
  if (count28 >= 1) return 'Medium';
  return 'Low';
}

// ── Lead Time (LT) ───────────────────────────────────────────────────────────

/**
 * Compute approximate lead time per wave as first→last qualifying commit.
 * Decision D5: proxy only; declared in dora-definitions.json.
 *
 * Returns average lead time in hours across all waves with >= 2 qualifying commits.
 * Waves with only 1 qualifying commit have 0 lead time (point-in-time delivery).
 *
 * @returns {{ avg_hours: number, wave_count: number, approximation: string }}
 */
function computeLeadTime() {
  // Get all qualifying commits with timestamps in the last 90 days
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const raw = sh(`git log --pretty=format:"%aI|%s" --since="${since90}"`);
  if (!raw) return { avg_hours: 0, wave_count: 0, approximation: 'insufficient data' };

  // Matches any conventional-commit type+scope with a wave number; capture group 1 = wave number
  const deployPattern = /^[a-z+]+\([^)]*\): wave-(\d+)/;
  /** @type {Map<string, number[]>} wave-NNN → [timestamp_ms, ...] */
  const waveTimestamps = new Map();

  for (const line of raw.split('\n').filter(Boolean)) {
    const [isoTime, ...subjectParts] = line.split('|');
    const subject = subjectParts.join('|');
    const m = deployPattern.exec(subject);
    if (!m) continue;
    const waveNum = m[1];
    const waveId = `wave-${waveNum}`;
    const ts = new Date(isoTime).getTime();
    if (isNaN(ts)) continue;
    if (!waveTimestamps.has(waveId)) waveTimestamps.set(waveId, []);
    waveTimestamps.get(waveId).push(ts);
  }

  let totalHours = 0;
  let waveCount = 0;
  for (const [, timestamps] of waveTimestamps) {
    if (timestamps.length < 2) continue; // point-in-time delivery; skip
    const first = Math.min(...timestamps);
    const last = Math.max(...timestamps);
    totalHours += (last - first) / (1000 * 60 * 60);
    waveCount++;
  }

  const avg_hours = waveCount > 0 ? totalHours / waveCount : 0;
  return {
    avg_hours: Math.round(avg_hours * 100) / 100,
    wave_count: waveCount,
    approximation: 'first-to-last qualifying commit per wave (v1 proxy — see lt.lead_time_approximation_note in dora-definitions.json)',
  };
}

/**
 * Classify Lead Time band.
 * @param {number} avg_hours
 * @returns {string}
 */
function classifyLTBand(avg_hours) {
  if (avg_hours < 24) return 'Elite';
  if (avg_hours < 168) return 'High';
  if (avg_hours < 730) return 'Medium';
  return 'Low';
}

// ── Change Failure Rate (CFR) ─────────────────────────────────────────────────

/**
 * Compute CFR.
 * Decision D3:
 *   - Total deployed waves = qualifying non-R2 commits in last 90d (one per wave-id)
 *   - Failure waves = waves with an R2 commit OR a HALT followed by R2 (union, de-duped)
 *   - A HALT without subsequent R2 does NOT count as failure (AC-13 anti-gaming rule)
 *
 * @returns {{ cfr_pct: number, failure_waves: number, total_waves: number, failure_wave_ids: string[] }}
 */
function computeCFR() {
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Get all qualifying commits with timestamps
  const raw = sh(`git log --pretty=format:"%aI|%s" --since="${since90}"`);

  // Any conventional-commit delivering a wave (not anchored with $ — subjects have trailing descriptions)
  const featPattern = /^[a-z+]+\([^)]*\): wave-(\d+)\b/;
  // R2 revision commits: fix(<scope>): wave-NNN.R2 — matches all 4 real R2 commits
  const r2Pattern = /^fix\([^)]*\): wave-(\d+)\.R2\b/;

  /** @type {Set<string>} */
  const deployedWaves = new Set();
  /** @type {Set<string>} */
  const r2Waves = new Set();

  for (const line of (raw || '').split('\n').filter(Boolean)) {
    const [, ...subjectParts] = line.split('|');
    const subject = subjectParts.join('|');
    const featM = featPattern.exec(subject);
    if (featM) deployedWaves.add(`wave-${featM[1]}`);
    const r2M = r2Pattern.exec(subject);
    if (r2M) {
      r2Waves.add(`wave-${r2M[1]}`);
      deployedWaves.add(`wave-${r2M[1]}`); // R2 wave is also a deployed wave
    }
  }

  // Halt-then-R2 waves: a HALT event for a wave-id that ALSO has an R2 commit
  // (AC-13: HALT alone does not make it a failure — only HALT + R2 together)
  const haltRecords = readJsonlStream(HALT_EVENTS_PATH);
  /** @type {Set<string>} halt wave-ids (excluding wave-current per AC-12) */
  const haltWaveIds = new Set();
  for (const rec of haltRecords) {
    const waveId = rec.wave || rec.payload?.wave;
    const eventType = (rec.event_type || rec.event || '').toLowerCase();
    if (eventType !== 'halt') continue;
    if (!waveId || waveId === 'wave-current') continue;
    haltWaveIds.add(waveId);
  }

  // Union: failure waves = R2 waves + (halt waves that also have R2) — per D3 union
  // Note: halts without R2 are excluded by construction (haltWaveIds ∩ r2Waves)
  /** @type {Set<string>} */
  const failureWaves = new Set(r2Waves);
  for (const waveId of haltWaveIds) {
    if (r2Waves.has(waveId)) failureWaves.add(waveId); // already in r2Waves
  }

  const total = deployedWaves.size;
  const failures = failureWaves.size;
  const cfr_pct = total > 0 ? Math.round((failures / total) * 10000) / 100 : 0;

  return {
    cfr_pct,
    failure_waves: failures,
    total_waves: total,
    failure_wave_ids: Array.from(failureWaves).sort(),
  };
}

/**
 * Classify CFR band.
 * @param {number} cfr_pct
 * @returns {string}
 */
function classifyCFRBand(cfr_pct) {
  if (cfr_pct < 5) return 'Elite';
  if (cfr_pct < 10) return 'High';
  if (cfr_pct < 15) return 'Medium';
  return 'Low';
}

// ── MTTR ─────────────────────────────────────────────────────────────────────

/**
 * Compute MTTR from halt-events.jsonl.
 * Decision D4:
 *   - Pair each HALT with the nearest subsequent RESUME on the same wave field
 *   - FORCED_RESUME events are not counted as recovery (they bypass the gate)
 *   - wave === 'wave-current' records are excluded with AC-12 stderr note
 *   - Returns average MTTR in seconds across all valid pairs
 *
 * @returns {{ mttr_seconds: number | null, pair_count: number, pairs: Array<{wave: string, halt_time: string, resume_time: string, elapsed_seconds: number, agent: string}> }}
 */
function computeMTTR() {
  const records = readJsonlStream(HALT_EVENTS_PATH);

  let skippedAmbiguous = 0;

  /** @type {Array<{waveId: string, timestamp: number, agent: string}>} */
  const openHalts = [];

  /** @type {Array<{wave: string, halt_time: string, resume_time: string, elapsed_seconds: number, agent: string}>} */
  const pairs = [];

  for (const rec of records) {
    const waveId = rec.wave || rec.payload?.wave;
    const eventType = (rec.event_type || rec.event || '').toLowerCase();
    const rawTime = rec.time || rec.timestamp;
    if (!rawTime || !waveId) continue;
    const tsMs = new Date(rawTime).getTime();
    if (isNaN(tsMs)) continue;

    // AC-12: skip ambiguous wave-current halt records
    if (waveId === 'wave-current') {
      if (eventType === 'halt') {
        skippedAmbiguous++;
      }
      continue;
    }

    if (eventType === 'halt') {
      openHalts.push({ waveId, timestamp: tsMs, agent: rec.agent || 'unknown' });
    } else if (eventType === 'resume') {
      // Find the earliest unmatched HALT for the same wave
      const matchIdx = openHalts.findIndex(h => h.waveId === waveId);
      if (matchIdx === -1) continue; // orphaned resume — skip

      const halt = openHalts.splice(matchIdx, 1)[0];
      const elapsed_seconds = Math.round((tsMs - halt.timestamp) / 1000);
      if (elapsed_seconds < 0) continue; // resume before halt — skip (data anomaly)

      pairs.push({
        wave: waveId,
        halt_time: new Date(halt.timestamp).toISOString(),
        resume_time: rawTime,
        elapsed_seconds,
        agent: halt.agent,
      });
    }
    // FORCED_RESUME: intentionally excluded from pairing (bypass event, not a recovery)
  }

  if (skippedAmbiguous > 0) {
    process.stderr.write(
      `[dora] skipped ${skippedAmbiguous} ambiguous wave-current halt record${skippedAmbiguous > 1 ? 's' : ''}\n`
    );
  }

  if (pairs.length === 0) {
    return { mttr_seconds: null, pair_count: 0, pairs: [] };
  }

  const totalSeconds = pairs.reduce((sum, p) => sum + p.elapsed_seconds, 0);
  const mttr_seconds = Math.round(totalSeconds / pairs.length);

  return { mttr_seconds, pair_count: pairs.length, pairs };
}

/**
 * Classify MTTR band.
 * @param {number | null} mttr_seconds
 * @returns {string}
 */
function classifyMTTRBand(mttr_seconds) {
  if (mttr_seconds === null) return 'Insufficient data';
  if (mttr_seconds < 3600) return 'Elite';
  if (mttr_seconds < 86400) return 'High';
  if (mttr_seconds < 604800) return 'Medium';
  return 'Low';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = readConfig();
  const defs = loadDORAdefs();

  // Ensure dora-events.jsonl exists before first emitTelemetry call
  // (emit-telemetry creates the dir but not necessarily the file for a brand-new stream)
  if (!fs.existsSync(DORA_EVENTS_PATH)) {
    fs.mkdirSync(path.dirname(DORA_EVENTS_PATH), { recursive: true });
    fs.writeFileSync(DORA_EVENTS_PATH, '', { flag: 'a' });
  }

  // ── 1. Deployment Frequency ──────────────────────────────────────────────
  const df = computeDeploymentFrequency();
  const dfBand = classifyDFBand(df.count_7d);
  process.stdout.write(`[dora] Deployment Frequency: ${df.count_7d} unique waves in last 7d (${df.commits.length} qualifying commits) — Band: ${dfBand}\n`);

  if (!isDry) {
    emitTelemetry('dora_metric_computed', {
      source: 'scripts/compute-dora.mjs',
      wave: 'wave-168',
      agent: 'dora-compute',
      verdict: dfBand,
      payload: {
        metric: 'Deployment Frequency',
        metric_id: 'df',
        value: df.count_7d,
        unit: 'unique_waves_per_7d',
        band: dfBand,
        window_days: 7,
        qualifying_commits: df.commits,
      },
    });
  }

  // ── 2. Lead Time ─────────────────────────────────────────────────────────
  const lt = computeLeadTime();
  const ltBand = classifyLTBand(lt.avg_hours);
  process.stdout.write(`[dora] Lead Time: avg ${lt.avg_hours}h across ${lt.wave_count} wave(s) — Band: ${ltBand} (${lt.approximation})\n`);

  if (!isDry) {
    emitTelemetry('dora_metric_computed', {
      source: 'scripts/compute-dora.mjs',
      wave: 'wave-168',
      agent: 'dora-compute',
      verdict: ltBand,
      payload: {
        metric: 'Lead Time',
        metric_id: 'lt',
        value: lt.avg_hours,
        unit: 'hours_avg',
        band: ltBand,
        wave_count: lt.wave_count,
        approximation: lt.approximation,
      },
    });
  }

  // ── 3. Change Failure Rate ───────────────────────────────────────────────
  const cfr = computeCFR();
  const cfrBand = classifyCFRBand(cfr.cfr_pct);
  process.stdout.write(
    `[dora] Change Failure Rate: ${cfr.cfr_pct}% (${cfr.failure_waves}/${cfr.total_waves} waves) — Band: ${cfrBand}\n`
  );

  if (!isDry) {
    emitTelemetry('dora_metric_computed', {
      source: 'scripts/compute-dora.mjs',
      wave: 'wave-168',
      agent: 'dora-compute',
      verdict: cfrBand,
      payload: {
        metric: 'Change Failure Rate',
        metric_id: 'cfr',
        value: cfr.cfr_pct,
        unit: 'percent',
        band: cfrBand,
        failure_waves: cfr.failure_waves,
        total_waves: cfr.total_waves,
        failure_wave_ids: cfr.failure_wave_ids,
        window_days: 90,
        anti_gaming_note: 'Halts without subsequent R2 commit excluded per D3/AC-13',
      },
    });
  }

  // ── 4. MTTR ──────────────────────────────────────────────────────────────
  const mttr = computeMTTR();
  const mttrBand = classifyMTTRBand(mttr.mttr_seconds);
  const mttrDisplay = mttr.mttr_seconds !== null ? `${mttr.mttr_seconds}s` : 'no paired halt/resume data';
  process.stdout.write(
    `[dora] MTTR: ${mttrDisplay} across ${mttr.pair_count} pair(s) — Band: ${mttrBand}\n`
  );

  if (!isDry) {
    emitTelemetry('dora_metric_computed', {
      source: 'scripts/compute-dora.mjs',
      wave: 'wave-168',
      agent: 'dora-compute',
      verdict: mttrBand,
      payload: {
        metric: 'MTTR',
        metric_id: 'mttr',
        value: mttr.mttr_seconds,
        unit: 'seconds_avg',
        band: mttrBand,
        pair_count: mttr.pair_count,
        pairs: mttr.pairs,
      },
    });
  }

  // ── AI calibration note (D8 — framed as calibration, not alarm) ─────────
  process.stdout.write(
    `[dora] AI-calibration: ${defs.ai_calibration_note.slice(0, 120)}...\n`
  );

  // ── Hard-block on band breach (soft-default: hardBlockEnabled=false) ─────
  // AC-11: if hardBlockEnabled=false, exit 0 regardless of bands
  if (cfg.hardBlockEnabled) {
    const lowBands = ['Low', 'Insufficient data'];
    const breaches = [
      dfBand, ltBand, cfrBand, mttrBand,
    ].filter(b => lowBands.includes(b));

    if (breaches.length > 0) {
      writeHaltState(
        'wave-168',
        'dora-compute',
        `DORA band breach — ${breaches.length} metric(s) in Low band: ${[
          dfBand !== 'Low' ? null : 'Deployment Frequency',
          ltBand !== 'Low' ? null : 'Lead Time',
          cfrBand !== 'Low' ? null : 'Change Failure Rate',
          mttrBand !== 'Low' ? null : 'MTTR',
        ].filter(Boolean).join(', ')}`
      );
    }
  }
  // Soft-default: always exit 0 when hardBlockEnabled=false (AC-11)
}

main().catch(err => {
  process.stderr.write(`[dora] FATAL: ${err}\n`);
  process.exit(1);
});
