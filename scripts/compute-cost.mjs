#!/usr/bin/env node
// @ts-check
/**
 * Wave-177 — FinOps / Agent Cost Governance Compute Script
 *
 * Reads token data from docs/metrics/_DASHBOARD.md (~NNK tilde-strings),
 * applies the cost model from docs/quality/cost-budget.json,
 * computes per-wave estimated cost, cumulative est. cost, rolling-median
 * anomaly detection, band classification, and a cost-per-wave-shipped-clean
 * unit-economics metric.
 *
 * Emits one cost_computed event (and zero or more cost_anomaly events) to
 * docs/audits/cost-events.jsonl via the universal telemetry emitter.
 * Appends a FinOps Summary section to docs/metrics/_DASHBOARD.md.
 *
 * Usage:
 *   npm run compute:cost
 *   node scripts/compute-cost.mjs
 *   node scripts/compute-cost.mjs --dry    (print output; no JSONL write, no dashboard append)
 *   node scripts/compute-cost.mjs --debug  (verbose per-wave breakdown)
 *
 * Decisions honored:
 *   D1: 17th stream cost-events.jsonl — compute scripts get their own stream
 *   D2: All cost figures labeled "est." — no figure presented as a billed actual
 *   D3: Sonnet as default model tier (lower-bound estimate; labeled as such)
 *   D4: budgetThreshold_usd: 200; soft-default exit 0; hard-block behind hardBlockEnabled
 *   D5: 3x-median anomaly detection; rolling 10-wave window; flags only, no auto-act
 *   D6: cost-per-wave-shipped-clean unit-economics metric (cumulative est. / SHIPPED count)
 *   D7: DUPLICATE-BLOCK guard — zero references to product billing code
 *       (see docs/quality/cost-budget.json scope_note for the boundary definition)
 *   D8: n/a / TBD token rows → estimate_unavailable: true, excluded from cumulative totals
 *
 * token_source: "dashboard_estimate" on every emitted event (honesty — AC-3)
 * HONESTY DISCLAIMER: every dollar figure is an estimate. Do not treat as a billed actual.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitTelemetry } from './emit-telemetry.mjs';
import { writeHaltState } from './andon-halt-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');
const COST_BUDGET_PATH = path.join(ROOT, 'docs', 'quality', 'cost-budget.json');
const DASHBOARD_PATH = path.join(ROOT, 'docs', 'metrics', '_DASHBOARD.md');
const COST_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'cost-events.jsonl');

const isDry = process.argv.includes('--dry');
const isDebug = process.argv.includes('--debug');

// ── Config readers ────────────────────────────────────────────────────────────

/**
 * Read costMonitoring stanza from .sdd-config.json.
 * Mirrors readConfig() in compute-slos.mjs:38-50.
 * @returns {{ enabled: boolean, hardBlockEnabled: boolean, budgetThreshold_usd: number }}
 */
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return {
      enabled: Boolean(raw?.costMonitoring?.enabled),
      hardBlockEnabled: Boolean(raw?.costMonitoring?.hardBlockEnabled),
      budgetThreshold_usd: Number(raw?.costMonitoring?.budgetThreshold_usd) || 200,
    };
  } catch {
    return { enabled: false, hardBlockEnabled: false, budgetThreshold_usd: 200 };
  }
}

/**
 * @typedef {{
 *   version: string,
 *   ai_calibration_note: string,
 *   scope: string,
 *   cost_model: {
 *     sonnet: { input_per_mtok: number, output_per_mtok: number },
 *     opus: { input_per_mtok: number, output_per_mtok: number },
 *     cache_read_discount: number,
 *     default_tier: string,
 *     token_split_ratio: { input_fraction: number, output_fraction: number }
 *   },
 *   budgets: Array<{ anomaly_multiplier: number, anomaly_window_waves: number }>,
 *   bands: Record<string, { label: string, max_pct?: number, min_pct?: number }>
 * }} CostBudgetDefs
 */

/**
 * Load cost-budget.json. Mirrors loadDORAdefs() in compute-dora.mjs:68-72.
 * @returns {CostBudgetDefs}
 */
function loadDefs() {
  if (!fs.existsSync(COST_BUDGET_PATH)) {
    console.log(`⊘ DORMANT — ${COST_BUDGET_PATH} not seeded yet; cost computation inactive, not failed. Seed the cost budget to activate.`);
    process.exit(0);
  }
  const raw = JSON.parse(fs.readFileSync(COST_BUDGET_PATH, 'utf8'));
  return raw;
}

// ── Dashboard parser ──────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   wave_id: string,
 *   tokens: number | null,
 *   estimate_unavailable: boolean,
 *   status: string
 * }} WaveRow
 */

/**
 * Parse the ~NNK token column and Status column from _DASHBOARD.md.
 *
 * Strips '~' prefix, converts K×1000 and M×1000000.
 * Returns null (estimate_unavailable: true) for 'n/a' or values containing 'TBD'.
 * Mirrors the DORA-pattern null-handling at compute-dora.mjs:383.
 *
 * D8: rows with estimate_unavailable are included in output but EXCLUDED from totals.
 *
 * @returns {WaveRow[]}
 */
function parseDashboard() {
  const content = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const lines = content.split('\n');

  /** @type {WaveRow[]} */
  const rows = [];

  // Find the header row to determine column indices
  let headerIdx = -1;
  let colWave = -1;
  let colTokens = -1;
  let colStatus = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    // Look for the header row containing "Total tokens"
    if (line.includes('Total tokens') && line.includes('Wave')) {
      headerIdx = i;
      const cols = line.split('|').map(c => c.trim());
      cols.forEach((col, idx) => {
        if (col.toLowerCase() === 'wave') colWave = idx;
        if (col.toLowerCase() === 'total tokens') colTokens = idx;
        if (col.toLowerCase() === 'status') colStatus = idx;
      });
      break;
    }
  }

  if (headerIdx === -1 || colWave === -1 || colTokens === -1 || colStatus === -1) {
    process.stderr.write('[cost] WARN — could not locate dashboard header row; cost compute aborted\n');
    return [];
  }

  // Parse data rows (skip header row and separator row)
  // Stop when we hit the FinOps Summary section or DORA Summary section — those are
  // appended summary tables, not wave data rows.
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim();

    // Stop parsing at the FinOps Summary section — it is an appended summary table,
    // not wave data rows. (DORA Summary does NOT stop parsing because wave rows
    // continue after it in the dashboard file.)
    if (line.startsWith('## FinOps Summary')) break;

    if (!line.startsWith('|')) continue;
    // Skip sub-table headers (DORA Summary table etc.)
    if (line.includes('Metric') && line.includes('Band')) continue;
    if (line.includes('---')) continue;

    const cols = line.split('|').map(c => c.trim());
    const waveId = cols[colWave];
    const tokensRaw = cols[colTokens];
    const statusRaw = cols[colStatus] || '';

    if (!waveId || waveId === 'Wave' || waveId.startsWith('---')) continue;
    // Skip DORA summary table data rows
    if (waveId === 'Deployment Frequency' || waveId === 'Lead Time' || waveId === 'Change Failure Rate' || waveId === 'MTTR') continue;

    const tokens = parseTokenString(tokensRaw);
    const estimate_unavailable = tokens === null;

    // Status: take only the first word after optional leading chars to determine if "Shipped"
    // Full status text is kept for unit-economics counting
    rows.push({
      wave_id: waveId,
      tokens,
      estimate_unavailable,
      status: statusRaw,
    });
  }

  return rows;
}

/**
 * Parse a token count string like '~580K', '~1.2M', 'n/a', '~TBD'.
 * Returns null when the value is unavailable (n/a or TBD).
 * Strips '~', handles K=×1000, M=×1000000.
 *
 * @param {string} raw
 * @returns {number | null}
 */
function parseTokenString(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^~/, '').toUpperCase();
  if (cleaned === 'N/A' || cleaned === 'TBD' || cleaned.includes('TBD') || cleaned === '') return null;

  const kMatch = cleaned.match(/^([\d.]+)K$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);

  const mMatch = cleaned.match(/^([\d.]+)M$/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);

  const numMatch = cleaned.match(/^[\d.]+$/);
  if (numMatch) return Math.round(parseFloat(cleaned));

  return null;
}

// ── Cost compute ──────────────────────────────────────────────────────────────

/**
 * Determine whether a status string represents a "Shipped" wave.
 * Counts rows where Status starts with "Shipped" (case-insensitive prefix).
 * Also counts "spec phase" is NOT shipped; "In Progress" is NOT shipped.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isShipped(status) {
  return status.toLowerCase().startsWith('shipped');
}

/**
 * Compute per-wave estimated cost using the default_tier model.
 * Applies 50/50 input/output split (v1 — see cost_model.token_split_assumption).
 * All returned values are estimates. Never present as billed actuals.
 *
 * @param {number} tokens Total token count
 * @param {CostBudgetDefs} defs
 * @returns {number} est. cost in USD
 */
function computeWaveCostEst(tokens, defs) {
  const tier = defs.cost_model.default_tier === 'opus'
    ? defs.cost_model.opus
    : defs.cost_model.sonnet;

  const inputFraction = defs.cost_model.token_split_ratio.input_fraction;
  const outputFraction = defs.cost_model.token_split_ratio.output_fraction;

  const inputTokens = tokens * inputFraction;
  const outputTokens = tokens * outputFraction;

  const inputCost = (inputTokens / 1_000_000) * tier.input_per_mtok;
  const outputCost = (outputTokens / 1_000_000) * tier.output_per_mtok;

  return inputCost + outputCost;
}

/**
 * Compute rolling median of the last N cost values.
 * @param {number[]} costs Array of per-wave costs in order
 * @param {number} windowSize
 * @returns {number | null} null if fewer than 2 values
 */
function computeRollingMedian(costs, windowSize) {
  if (costs.length < 2) return null;
  const window = costs.slice(-windowSize);
  const sorted = [...window].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Detect if the given wave cost is an anomaly (> anomaly_multiplier × rolling_median).
 * @param {number} waveCost
 * @param {number | null} rollingMedian
 * @param {number} anomalyMultiplier
 * @returns {boolean}
 */
function detectAnomaly(waveCost, rollingMedian, anomalyMultiplier) {
  if (rollingMedian === null || rollingMedian === 0) return false;
  return waveCost > anomalyMultiplier * rollingMedian;
}

/**
 * Classify cumulative cost band against the budgetThreshold_usd.
 * Bands: Under / Nominal / Elevated / Spike.
 *
 * @param {number} cumulativeCostEst
 * @param {number} budgetThreshold_usd
 * @returns {'Under' | 'Nominal' | 'Elevated' | 'Spike'}
 */
function classifyBand(cumulativeCostEst, budgetThreshold_usd) {
  const pct = budgetThreshold_usd > 0 ? (cumulativeCostEst / budgetThreshold_usd) * 100 : 0;
  if (pct >= 100) return 'Spike';
  if (pct >= 90) return 'Elevated';
  if (pct >= 60) return 'Nominal';
  return 'Under';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = readConfig();
  const defs = loadDefs();

  // Ensure cost-events.jsonl exists before first emitTelemetry call
  if (!fs.existsSync(COST_EVENTS_PATH)) {
    fs.mkdirSync(path.dirname(COST_EVENTS_PATH), { recursive: true });
    fs.writeFileSync(COST_EVENTS_PATH, '', { flag: 'a' });
  }

  const rows = parseDashboard();

  if (rows.length === 0) {
    process.stderr.write('[cost] WARN — no dashboard rows found; exiting\n');
    process.exit(0);
  }

  const budgetConfig = defs.budgets[0];
  const anomalyMultiplier = budgetConfig.anomaly_multiplier;
  const anomalyWindowWaves = budgetConfig.anomaly_window_waves;

  /** @type {number[]} running list of est. costs for available rows (for median) */
  const costHistory = [];
  let cumulativeEstCostUsd = 0;
  let anomalyCount = 0;
  let shippedWaveCount = 0;
  let unavailableCount = 0;

  // ── Per-wave pass ────────────────────────────────────────────────────────────
  for (const row of rows) {
    if (isShipped(row.status)) shippedWaveCount++;

    if (row.estimate_unavailable || row.tokens === null) {
      unavailableCount++;
      if (isDebug) {
        process.stdout.write(
          `[cost] ${row.wave_id} — estimate_unavailable (tokens: n/a or TBD) — excluded from cumulative\n`
        );
      }
      continue; // D8: exclude from cumulative totals
    }

    const waveCostEst = computeWaveCostEst(row.tokens, defs);
    const rollingMedian = computeRollingMedian(costHistory, anomalyWindowWaves);
    const isAnomaly = detectAnomaly(waveCostEst, rollingMedian, anomalyMultiplier);

    if (isAnomaly) {
      anomalyCount++;
      process.stdout.write(
        `[cost] ANOMALY ${row.wave_id} — est. $${waveCostEst.toFixed(4)} > ${anomalyMultiplier}x rolling median est. $${(rollingMedian ?? 0).toFixed(4)}\n`
      );
      if (!isDry) {
        emitTelemetry('cost_anomaly', {
          source: 'scripts/compute-cost.mjs',
          wave: row.wave_id,
          agent: 'cost-compute',
          verdict: 'anomaly',
          payload: {
            est_cost_usd: waveCostEst,
            cost_label: 'est.',
            rolling_median_est_usd: rollingMedian,
            anomaly_multiplier: anomalyMultiplier,
            anomaly_window_waves: anomalyWindowWaves,
            tokens: row.tokens,
            token_source: 'dashboard_estimate',
            honesty_note: 'estimate from session reports; not billed actual',
          },
        });
      }
    }

    if (isDebug) {
      process.stdout.write(
        `[cost] ${row.wave_id} — ${row.tokens.toLocaleString()} tokens — est. $${waveCostEst.toFixed(4)} — median est. $${rollingMedian !== null ? rollingMedian.toFixed(4) : 'n/a'}${isAnomaly ? ' [ANOMALY]' : ''}\n`
      );
    }

    cumulativeEstCostUsd += waveCostEst;
    costHistory.push(waveCostEst);
  }

  // ── Unit economics ───────────────────────────────────────────────────────────
  const costPerWaveShippedEst = shippedWaveCount > 0
    ? cumulativeEstCostUsd / shippedWaveCount
    : null;

  // ── Band classification ──────────────────────────────────────────────────────
  const band = classifyBand(cumulativeEstCostUsd, cfg.budgetThreshold_usd);

  // ── Summary stdout ───────────────────────────────────────────────────────────
  const estTotalStr = `$${cumulativeEstCostUsd.toFixed(2)} est.`;
  const estPerWaveStr = costPerWaveShippedEst !== null
    ? `$${costPerWaveShippedEst.toFixed(4)} est.`
    : 'n/a (no SHIPPED rows)';

  process.stdout.write(`[cost] Rows parsed: ${rows.length} total, ${unavailableCount} estimate_unavailable (excluded), ${rows.length - unavailableCount} included\n`);
  process.stdout.write(`[cost] Shipped waves (for unit-economics): ${shippedWaveCount}\n`);
  process.stdout.write(`[cost] Cumulative est. cost: ${estTotalStr} (model: ${defs.cost_model.default_tier}, lower-bound)\n`);
  process.stdout.write(`[cost] Cost per wave shipped (est.): ${estPerWaveStr}\n`);
  process.stdout.write(`[cost] Budget band: ${band} (threshold: $${cfg.budgetThreshold_usd} est.)\n`);
  process.stdout.write(`[cost] Anomalies detected (est.): ${anomalyCount}\n`);
  process.stdout.write(`[cost] HONESTY: all figures are estimates from dashboard session reports — not billed actuals\n`);
  process.stdout.write(`[cost] AI-calibration: ${defs.ai_calibration_note.slice(0, 120)}...\n`);

  // ── Emit cost_computed event ─────────────────────────────────────────────────
  if (!isDry) {
    emitTelemetry('cost_computed', {
      source: 'scripts/compute-cost.mjs',
      wave: 'wave-177',
      agent: 'cost-compute',
      verdict: band,
      payload: {
        cumulative_est_cost_usd: cumulativeEstCostUsd,
        cost_label: 'est.',
        cost_per_wave_shipped_est: costPerWaveShippedEst,
        band,
        anomaly_count: anomalyCount,
        rows_total: rows.length,
        rows_estimate_unavailable: unavailableCount,
        rows_included: rows.length - unavailableCount,
        shipped_wave_count: shippedWaveCount,
        model_tier: defs.cost_model.default_tier,
        budget_threshold_usd: cfg.budgetThreshold_usd,
        token_source: 'dashboard_estimate',
        honesty_note: 'estimate from session reports; not billed actual',
        scope: defs.scope,
      },
    });
  }

  // ── Append / update FinOps Summary section in _DASHBOARD.md ─────────────────
  if (!isDry) {
    appendDashboardSummary({
      cumulativeEstCostUsd,
      costPerWaveShippedEst,
      band,
      anomalyCount,
      shippedWaveCount,
      rowsTotal: rows.length,
      rowsUnavailable: unavailableCount,
      modelTier: defs.cost_model.default_tier,
      budgetThreshold: cfg.budgetThreshold_usd,
    });
  }

  // ── Hard-block on budget breach (soft-default: hardBlockEnabled=false) ───────
  // AC-8: exit 0 when hardBlockEnabled is false, regardless of band
  if (cfg.hardBlockEnabled && (band === 'Spike' || band === 'Elevated')) {
    writeHaltState(
      'wave-177',
      'cost-compute',
      `Cost band breach — cumulative est. $${cumulativeEstCostUsd.toFixed(2)} in ${band} band (threshold: $${cfg.budgetThreshold_usd}). hardBlockEnabled=true triggered halt.`
    );
  }
  // Soft-default: always exit 0 when hardBlockEnabled=false (AC-8)
}

/**
 * Append (or replace) the FinOps Summary section in _DASHBOARD.md.
 * Mirrors the DORA Summary append pattern at docs/metrics/_DASHBOARD.md:129.
 *
 * @param {{
 *   cumulativeEstCostUsd: number,
 *   costPerWaveShippedEst: number | null,
 *   band: string,
 *   anomalyCount: number,
 *   shippedWaveCount: number,
 *   rowsTotal: number,
 *   rowsUnavailable: number,
 *   modelTier: string,
 *   budgetThreshold: number
 * }} summary
 */
function appendDashboardSummary(summary) {
  try {
    let content = fs.readFileSync(DASHBOARD_PATH, 'utf8');

    const SECTION_MARKER = '## FinOps Summary';
    const now = new Date().toISOString().slice(0, 10);

    const estPerWave = summary.costPerWaveShippedEst !== null
      ? `$${summary.costPerWaveShippedEst.toFixed(4)} est.`
      : 'n/a (no SHIPPED rows)';

    const sectionContent = [
      '',
      SECTION_MARKER,
      '',
      'Run `npm run compute:cost` to refresh the values below.',
      '',
      '| Metric | Value | Note |',
      '|---|---|---|',
      `| Cumulative est. cost (all waves) | $${summary.cumulativeEstCostUsd.toFixed(2)} est. | Model: ${summary.modelTier} (lower-bound) |`,
      `| Cost per wave shipped (est.) | ${estPerWave} | Cumulative est. / ${summary.shippedWaveCount} SHIPPED waves |`,
      `| Budget band | ${summary.band} | Threshold: $${summary.budgetThreshold} est. |`,
      `| Anomaly flags | ${summary.anomalyCount} | Waves exceeding 3x trailing-10-wave median est. |`,
      `| Rows with estimate_unavailable | ${summary.rowsUnavailable} of ${summary.rowsTotal} | n/a or TBD token rows — excluded from cumulative |`,
      '',
      `_Last refreshed: ${now} by wave-177. Run \`npm run compute:cost\` to update._`,
      '',
      '**HONESTY DISCLAIMER**: All cost figures are estimates derived from session-report token counts in the Total tokens column above. These are NOT Anthropic billing API responses and must not be treated as invoiceable amounts. Known undercount factors: reasoning tokens (billed but invisible), output-ratio underestimation (median 4x actual), retry overhead (5-15%). Real billed costs are materially higher. Reconciliation against Anthropic billing API is deferred to v2.',
      '',
      `**Source**: \`docs/quality/cost-budget.json\` — Sonnet $3/$15 per MTok input/output; Opus $5/$25. token_source: "dashboard_estimate".`,
      '',
      'Separation note: Cost = financial governance lens (spend). DORA = delivery-performance lens (output). SLO = behavioral-quality lens (process compliance). These are separate namespaces. Do not average or combine them.',
    ].join('\n');

    if (content.includes(SECTION_MARKER)) {
      // Replace existing section
      const sectionStart = content.indexOf(SECTION_MARKER);
      content = content.slice(0, sectionStart).trimEnd() + sectionContent + '\n';
    } else {
      // Append new section
      content = content.trimEnd() + '\n' + sectionContent + '\n';
    }

    fs.writeFileSync(DASHBOARD_PATH, content, 'utf8');
    process.stdout.write(`[cost] FinOps Summary appended to ${DASHBOARD_PATH}\n`);
  } catch (err) {
    process.stderr.write(`[cost] WARN — failed to append FinOps Summary to _DASHBOARD.md: ${err}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`[cost] FATAL: ${err}\n`);
  process.exit(1);
});
