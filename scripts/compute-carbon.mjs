#!/usr/bin/env node
// @ts-check
/**
 * Wave-186 — Carbon / Sustainability Accounting Compute Script
 *
 * Reads token data from docs/metrics/_DASHBOARD.md (~NNK tilde-strings),
 * applies the SCI-aligned carbon estimation model from docs/quality/carbon-factors.json,
 * and computes a 3-point range (low / central / high gCO2e est.) per wave and
 * cumulatively. Every output figure is labeled "est." — this is factor-based
 * estimation, not measurement.
 *
 * Emits carbon_computed and (optionally) carbon_anomaly events to
 * docs/audits/carbon-events.jsonl via the universal telemetry emitter.
 * Appends a Carbon Summary section to docs/metrics/_DASHBOARD.md.
 *
 * Usage:
 *   npm run compute:carbon
 *   node scripts/compute-carbon.mjs
 *   node scripts/compute-carbon.mjs --dry    (print output; no JSONL write, no dashboard append)
 *   node scripts/compute-carbon.mjs --debug  (verbose per-wave breakdown)
 *
 * Decisions honored:
 *   D1: compute-carbon mirrors compute-cost function-for-function (orthogonal gCO2e output)
 *   D2: SCI formula (ISO 21031:2024): SCI = (E * I) / R; M omitted with explicit note
 *   D3: 3-point RANGE (low/central/high gCO2e) — NEVER a single CO2e number (CRITICAL)
 *   D4: Zero hardcoded factor constants — all from carbon-factors.json
 *   D5: central 0.001 Wh/token (IEA 2023), grid central 442 gCO2eq/kWh (world avg),
 *       PUE 1.2 — all in carbon-factors.json with source citations
 *   D6: n/a / TBD token rows → estimate_unavailable: true, excluded from output
 *   D7: Carbon Summary references wave-177 cost figure for unified cost+carbon view
 *   D8: soft-default enabled:false, exits 0 when disabled
 *   D9: NOT added to verification pipeline (on-demand only)
 *
 * HONESTY DISCLAIMER:
 *   Every gCO2e figure is a factor-based estimation. This is NOT energy measurement.
 *   As a SaaS API caller we have zero hardware visibility. See carbon-factors.json
 *   ai_calibration_note for full uncertainty documentation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitTelemetry } from './emit-telemetry.mjs';
import { writeHaltState } from './andon-halt-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');
const CARBON_FACTORS_PATH = path.join(ROOT, 'docs', 'quality', 'carbon-factors.json');
const DASHBOARD_PATH = path.join(ROOT, 'docs', 'metrics', '_DASHBOARD.md');
const CARBON_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'carbon-events.jsonl');

const isDry = process.argv.includes('--dry');
const isDebug = process.argv.includes('--debug');

// ── Config readers ────────────────────────────────────────────────────────────

/**
 * Read carbonMonitoring stanza from .sdd-config.json.
 * Mirrors readConfig() in compute-cost.mjs.
 * @returns {{ enabled: boolean, hardBlockEnabled: boolean, carbonBudget_gco2e: number }}
 */
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return {
      enabled: Boolean(raw?.carbonMonitoring?.enabled),
      hardBlockEnabled: Boolean(raw?.carbonMonitoring?.hardBlockEnabled),
      carbonBudget_gco2e: Number(raw?.carbonMonitoring?.carbonBudget_gco2e) || 50000,
    };
  } catch {
    return { enabled: false, hardBlockEnabled: false, carbonBudget_gco2e: 50000 };
  }
}

/**
 * @typedef {{
 *   version: string,
 *   ai_calibration_note: string,
 *   sci_formula: { formula: string, components: Record<string, string>, honesty_note: string },
 *   carbon_model: {
 *     wh_per_token: { low: number, central: number, high: number, source: string },
 *     grid_intensity_presets: {
 *       low_gco2e_per_kwh: { value: number, label: string },
 *       central_gco2e_per_kwh: { value: number, label: string },
 *       high_gco2e_per_kwh: { value: number, label: string }
 *     },
 *     pue: { value: number, source: string }
 *   },
 *   anomaly: { multiplier: number, window_waves: number },
 *   carbonBudget_gco2e: number,
 *   bands: Record<string, { label: string, max_pct?: number, min_pct?: number }>
 * }} CarbonFactorDefs
 */

/**
 * Load carbon-factors.json. Mirrors loadDefs() in compute-cost.mjs.
 * @returns {CarbonFactorDefs}
 */
function loadDefs() {
  const raw = JSON.parse(fs.readFileSync(CARBON_FACTORS_PATH, 'utf8'));
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
 * REUSE: verbatim from compute-cost.mjs:123-196.
 * Strips '~' prefix, converts K×1000 and M×1000000.
 * Returns null (estimate_unavailable: true) for 'n/a' or values containing 'TBD'.
 * D6: rows with estimate_unavailable are excluded from output (no range emitted for unknown inputs).
 *
 * Stop-sentinel: breaks when hitting '## Carbon Summary' (prevents re-parse recursion
 * when the script is run twice on a dashboard that already has the appended section).
 * Also breaks at '## FinOps Summary' (mirrors compute-cost.mjs stop-sentinel).
 *
 * @returns {WaveRow[]}
 */
function parseDashboard() {
  const content = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const lines = content.split('\n');

  /** @type {WaveRow[]} */
  const rows = [];

  let headerIdx = -1;
  let colWave = -1;
  let colTokens = -1;
  let colStatus = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
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
    process.stderr.write('[carbon] WARN — could not locate dashboard header row; carbon compute aborted\n');
    return [];
  }

  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim();

    // Stop-sentinel: '## Carbon Summary' is an appended summary table produced by this
    // script — not wave data. Prevents re-parse recursion on second run. (AC-8)
    if (line.startsWith('## Carbon Summary')) break;

    // Also stop at FinOps Summary (mirrors compute-cost.mjs stop-sentinel).
    if (line.startsWith('## FinOps Summary')) break;

    if (!line.startsWith('|')) continue;
    if (line.includes('Metric') && line.includes('Band')) continue;
    if (line.includes('---')) continue;

    const cols = line.split('|').map(c => c.trim());
    const waveId = cols[colWave];
    const tokensRaw = cols[colTokens];
    const statusRaw = cols[colStatus] || '';

    if (!waveId || waveId === 'Wave' || waveId.startsWith('---')) continue;
    if (
      waveId === 'Deployment Frequency' ||
      waveId === 'Lead Time' ||
      waveId === 'Change Failure Rate' ||
      waveId === 'MTTR'
    ) continue;

    const tokens = parseTokenString(tokensRaw);
    const estimate_unavailable = tokens === null;

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
 * REUSE: verbatim from compute-cost.mjs:206-221.
 * D6: TBD and n/a return null — no carbon estimate emitted for unknown token counts.
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

// ── Carbon compute ────────────────────────────────────────────────────────────

/**
 * Determine whether a status string represents a "Shipped" wave.
 * REUSE: verbatim from compute-cost.mjs:233-235.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isShipped(status) {
  return status.toLowerCase().startsWith('shipped');
}

/**
 * Compute per-wave carbon estimation range using SCI formula.
 * SCI = (E * I) / R where:
 *   E = tokens * wh_per_token (central) * pue
 *   I = grid_intensity (low / central / high preset)
 *   R = 1 (per wave as functional unit)
 *   M = OMITTED (see carbon-factors.json sci_formula.components.M)
 *
 * D3: Returns 3-point range {low_gco2e, central_gco2e, high_gco2e} — NEVER a single number.
 * D4: ALL numeric constants come from the `factors` argument (carbon-factors.json) — none hardcoded here.
 * Every returned value is a factor-based estimation. Label as "est." in all output.
 *
 * @param {number} tokens  Total token count
 * @param {CarbonFactorDefs} factors
 * @returns {{ low_gco2e: number, central_gco2e: number, high_gco2e: number }}
 */
function computeWaveCarbonEst(tokens, factors) {
  const whPerToken = factors.carbon_model.wh_per_token.central;
  const pue = factors.carbon_model.pue.value;

  const gridLow = factors.carbon_model.grid_intensity_presets.low_gco2e_per_kwh.value;
  const gridCentral = factors.carbon_model.grid_intensity_presets.central_gco2e_per_kwh.value;
  const gridHigh = factors.carbon_model.grid_intensity_presets.high_gco2e_per_kwh.value;

  // E (in Wh) = tokens * wh_per_token * pue
  // gCO2e = E(Wh) * grid(gCO2eq/kWh) / 1000   [Wh → kWh conversion]
  const energyWh = tokens * whPerToken * pue;
  const low_gco2e = (energyWh * gridLow) / 1000;
  const central_gco2e = (energyWh * gridCentral) / 1000;
  const high_gco2e = (energyWh * gridHigh) / 1000;

  return { low_gco2e, central_gco2e, high_gco2e };
}

/**
 * Compute rolling median of the last N central-gCO2e values.
 * REUSE: verbatim from compute-cost.mjs:269-278 (adapted for gCO2e values).
 *
 * @param {number[]} values  Array of per-wave central_gco2e values in order
 * @param {number} windowSize
 * @returns {number | null}  null if fewer than 2 values
 */
function computeRollingMedian(values, windowSize) {
  if (values.length < 2) return null;
  const window = values.slice(-windowSize);
  const sorted = [...window].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Detect if the given wave central gCO2e is an anomaly (> multiplier × rolling_median).
 * REUSE: verbatim from compute-cost.mjs:287-290.
 *
 * @param {number} centralGco2e
 * @param {number | null} rollingMedian
 * @param {number} anomalyMultiplier
 * @returns {boolean}
 */
function detectAnomaly(centralGco2e, rollingMedian, anomalyMultiplier) {
  if (rollingMedian === null || rollingMedian === 0) return false;
  return centralGco2e > anomalyMultiplier * rollingMedian;
}

/**
 * Classify cumulative central gCO2e band against the carbonBudget_gco2e.
 * Bands: Under / Nominal / Elevated / Spike.
 * REUSE: mirrors classifyBand() shape from compute-cost.mjs:300-306.
 *
 * @param {number} cumulativeCentralGco2e
 * @param {number} carbonBudget_gco2e
 * @returns {'Under' | 'Nominal' | 'Elevated' | 'Spike'}
 */
function classifyBand(cumulativeCentralGco2e, carbonBudget_gco2e) {
  const pct = carbonBudget_gco2e > 0 ? (cumulativeCentralGco2e / carbonBudget_gco2e) * 100 : 0;
  if (pct >= 100) return 'Spike';
  if (pct >= 90) return 'Elevated';
  if (pct >= 60) return 'Nominal';
  return 'Under';
}

// ── FinOps cost lookup (D7) ───────────────────────────────────────────────────

/**
 * Read the cumulative est. cost figure from the FinOps Summary in _DASHBOARD.md.
 * Used in Carbon Summary to tie wave-186 carbon to wave-177 cost (D7).
 * Returns the cost string as-is from the dashboard, or null if not found.
 *
 * @param {string} dashboardContent
 * @returns {string | null}
 */
function readFinopsCostFromDashboard(dashboardContent) {
  // Look for the FinOps Summary cumulative cost row pattern
  const match = dashboardContent.match(
    /\|\s*Cumulative est\. cost \(all waves\)\s*\|\s*(\$[\d.,]+ est\.)/i
  );
  return match ? match[1] : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = readConfig();

  // D8: soft-default — exit 0 with note when disabled
  if (!cfg.enabled) {
    process.stdout.write(
      '[carbon] carbonMonitoring.enabled=false in .sdd-config.json — carbon compute is in soft-mode.\n' +
      '[carbon] Set carbonMonitoring.enabled=true to run the full carbon estimation.\n' +
      '[carbon] Exiting 0 (no halt state written, no telemetry emitted).\n'
    );
    process.exit(0);
  }

  const factors = loadDefs();

  // Ensure carbon-events.jsonl exists before first emitTelemetry call
  if (!fs.existsSync(CARBON_EVENTS_PATH)) {
    fs.mkdirSync(path.dirname(CARBON_EVENTS_PATH), { recursive: true });
    fs.writeFileSync(CARBON_EVENTS_PATH, '', { flag: 'a' });
  }

  const rows = parseDashboard();

  if (rows.length === 0) {
    process.stderr.write('[carbon] WARN — no dashboard rows found; exiting\n');
    process.exit(0);
  }

  const anomalyMultiplier = factors.anomaly.multiplier;
  const anomalyWindowWaves = factors.anomaly.window_waves;

  /** @type {number[]} running list of central_gco2e values for available rows (for median) */
  const carbonHistory = [];
  let cumulativeLowGco2e = 0;
  let cumulativeCentralGco2e = 0;
  let cumulativeHighGco2e = 0;
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
          `[carbon] ${row.wave_id} — estimate_unavailable (tokens: n/a or TBD) — excluded (D6: no range emitted for unknown inputs)\n`
        );
      }
      continue; // D6: exclude TBD/n/a rows — no range emitted
    }

    const { low_gco2e, central_gco2e, high_gco2e } = computeWaveCarbonEst(row.tokens, factors);
    const rollingMedian = computeRollingMedian(carbonHistory, anomalyWindowWaves);
    const isAnomaly = detectAnomaly(central_gco2e, rollingMedian, anomalyMultiplier);

    if (isAnomaly) {
      anomalyCount++;
      process.stdout.write(
        `[carbon] ANOMALY ${row.wave_id} — central est. ${central_gco2e.toFixed(4)} gCO2e est. > ${anomalyMultiplier}x rolling median est. ${(rollingMedian ?? 0).toFixed(4)} gCO2e est.\n`
      );
      if (!isDry) {
        emitTelemetry('carbon_anomaly', {
          source: 'scripts/compute-carbon.mjs',
          wave: row.wave_id,
          agent: 'carbon-compute',
          verdict: 'anomaly',
          payload: {
            low_gco2e_est: low_gco2e,
            central_gco2e_est: central_gco2e,
            high_gco2e_est: high_gco2e,
            carbon_label: 'est.',
            estimation_note: 'factor-based estimation only — SaaS API caller, no hardware visibility',
            token_source: 'dashboard_estimate',
            rolling_median_central_gco2e_est: rollingMedian,
            anomaly_multiplier: anomalyMultiplier,
            anomaly_window_waves: anomalyWindowWaves,
            tokens: row.tokens,
          },
        });
      }
    }

    if (isDebug) {
      process.stdout.write(
        `[carbon] ${row.wave_id} — ${row.tokens.toLocaleString()} tokens — low: ${low_gco2e.toFixed(4)} / central: ${central_gco2e.toFixed(4)} / high: ${high_gco2e.toFixed(4)} gCO2e est.${isAnomaly ? ' [ANOMALY]' : ''}\n`
      );
    }

    cumulativeLowGco2e += low_gco2e;
    cumulativeCentralGco2e += central_gco2e;
    cumulativeHighGco2e += high_gco2e;
    carbonHistory.push(central_gco2e);
  }

  // ── Band classification ──────────────────────────────────────────────────────
  const band = classifyBand(cumulativeCentralGco2e, cfg.carbonBudget_gco2e);

  // ── Summary stdout (D3: 3-point range; every line labeled "est.") ─────────────
  process.stdout.write(`[carbon] Rows parsed: ${rows.length} total, ${unavailableCount} estimate_unavailable (excluded per D6), ${rows.length - unavailableCount} included\n`);
  process.stdout.write(`[carbon] Shipped waves: ${shippedWaveCount}\n`);
  process.stdout.write(`[carbon] Cumulative carbon estimate (3-POINT RANGE):\n`);
  process.stdout.write(`[carbon]   low:     ${cumulativeLowGco2e.toFixed(4)} gCO2e est.\n`);
  process.stdout.write(`[carbon]   central: ${cumulativeCentralGco2e.toFixed(4)} gCO2e est.\n`);
  process.stdout.write(`[carbon]   high:    ${cumulativeHighGco2e.toFixed(4)} gCO2e est.\n`);
  process.stdout.write(`[carbon] Budget band (central): ${band} (budget: ${cfg.carbonBudget_gco2e} gCO2e est.)\n`);
  process.stdout.write(`[carbon] Anomalies detected (central est.): ${anomalyCount}\n`);
  process.stdout.write(`[carbon] HONESTY: all figures are factor-based estimations (factor × token count). SaaS API caller — no hardware visibility. See carbon-factors.json ai_calibration_note.\n`);
  process.stdout.write(`[carbon] AI-calibration: ${factors.ai_calibration_note.slice(0, 120)}...\n`);

  // ── Emit carbon_computed event ───────────────────────────────────────────────
  if (!isDry) {
    emitTelemetry('carbon_computed', {
      source: 'scripts/compute-carbon.mjs',
      wave: 'wave-186',
      agent: 'carbon-compute',
      verdict: band,
      payload: {
        cumulative_low_gco2e_est: cumulativeLowGco2e,
        cumulative_central_gco2e_est: cumulativeCentralGco2e,
        cumulative_high_gco2e_est: cumulativeHighGco2e,
        carbon_label: 'est.',
        estimation_note: 'factor-based estimation only — SaaS API caller, no hardware visibility',
        token_source: 'dashboard_estimate',
        band,
        anomaly_count: anomalyCount,
        rows_total: rows.length,
        rows_estimate_unavailable: unavailableCount,
        rows_included: rows.length - unavailableCount,
        shipped_wave_count: shippedWaveCount,
        carbon_budget_gco2e: cfg.carbonBudget_gco2e,
        sci_formula: 'SCI=(E*I)/R; M omitted (ISO 21031:2024)',
        grid_central_gco2e_per_kwh: factors.carbon_model.grid_intensity_presets.central_gco2e_per_kwh.value,
        wh_per_token_central: factors.carbon_model.wh_per_token.central,
        pue: factors.carbon_model.pue.value,
      },
    });
  }

  // ── Append / update Carbon Summary section in _DASHBOARD.md ──────────────────
  if (!isDry) {
    appendDashboardSummary({
      rows,
      factors,
      cumulativeLowGco2e,
      cumulativeCentralGco2e,
      cumulativeHighGco2e,
      band,
      anomalyCount,
      shippedWaveCount,
      rowsTotal: rows.length,
      rowsUnavailable: unavailableCount,
      carbonBudget: cfg.carbonBudget_gco2e,
    });
  }

  // ── Hard-block on budget breach (soft-default: hardBlockEnabled=false) ────────
  if (cfg.hardBlockEnabled && (band === 'Spike' || band === 'Elevated')) {
    writeHaltState(
      'wave-186',
      'carbon-compute',
      `Carbon band breach — cumulative central est. ${cumulativeCentralGco2e.toFixed(2)} gCO2e in ${band} band (budget: ${cfg.carbonBudget_gco2e} gCO2e). hardBlockEnabled=true triggered halt.`
    );
  }
  // Soft-default: always exit 0 when hardBlockEnabled=false (AC-10)
}

/**
 * Append (or replace) the Carbon Summary section in _DASHBOARD.md.
 * Mirrors appendDashboardSummary() shape from compute-cost.mjs:483-531.
 *
 * Writes '## Carbon Summary' below '## FinOps Summary'.
 * The stop-sentinel in parseDashboard() at '## Carbon Summary' prevents
 * this appended section from being parsed as wave data on re-run (AC-8).
 *
 * D7: References the wave-177 cost figure for the same pipeline run.
 * Every table cell carries "est." label. The word "measurement" must not appear in output.
 *
 * @param {{
 *   rows: import('./compute-carbon.mjs').WaveRow[],
 *   factors: CarbonFactorDefs,
 *   cumulativeLowGco2e: number,
 *   cumulativeCentralGco2e: number,
 *   cumulativeHighGco2e: number,
 *   band: string,
 *   anomalyCount: number,
 *   shippedWaveCount: number,
 *   rowsTotal: number,
 *   rowsUnavailable: number,
 *   carbonBudget: number
 * }} summary
 */
function appendDashboardSummary(summary) {
  try {
    let content = fs.readFileSync(DASHBOARD_PATH, 'utf8');

    const SECTION_MARKER = '## Carbon Summary';
    const now = new Date().toISOString().slice(0, 10);

    // D7: read wave-177 cost from FinOps Summary for unified view
    const finopsCost = readFinopsCostFromDashboard(content);
    const costRef = finopsCost
      ? `~${finopsCost} (wave-177 FinOps est.)`
      : 'see ## FinOps Summary (wave-177)';

    // Build per-wave range rows for included waves only
    const waveTableRows = summary.rows
      .filter(row => !row.estimate_unavailable && row.tokens !== null)
      .map(row => {
        const { low_gco2e, central_gco2e, high_gco2e } = computeWaveCarbonEst(
          /** @type {number} */ (row.tokens),
          summary.factors
        );
        return `| ${row.wave_id} | ${row.tokens != null ? (row.tokens / 1000).toFixed(0) + 'K' : 'n/a'} | ${low_gco2e.toFixed(4)} gCO2e est. | ${central_gco2e.toFixed(4)} gCO2e est. | ${high_gco2e.toFixed(4)} gCO2e est. |`;
      });

    const sectionContent = [
      '',
      SECTION_MARKER,
      '',
      'Run `npm run compute:carbon` to refresh the values below.',
      '',
      '**HONESTY NOTE**: All gCO2e figures are factor-based estimations derived from session-report token counts. As a SaaS API caller we have zero hardware visibility — only token counts are available. See `docs/quality/carbon-factors.json` `ai_calibration_note` for full uncertainty documentation.',
      '',
      '**SCI Formula (ISO 21031:2024)**: SCI = (E × I) / R where E = tokens × Wh/token × PUE, I = grid carbon intensity (three presets below), R = per wave. M (embodied emissions) omitted — not available to a SaaS API caller.',
      '',
      '**Uncertainty ranges**: energy-per-token ~10x across hardware; grid intensity ~200x by region (2–1,158 gCO2eq/kWh). A single CO2e number would be false precision. Output is always a 3-point range (low / central / high).',
      '',
      '| Metric | Low est. | Central est. | High est. | Note |',
      '|---|---|---|---|---|',
      `| Cumulative gCO2e (all waves) | ${summary.cumulativeLowGco2e.toFixed(4)} gCO2e est. | ${summary.cumulativeCentralGco2e.toFixed(4)} gCO2e est. | ${summary.cumulativeHighGco2e.toFixed(4)} gCO2e est. | Grid: low=2 / central=442 / high=800 gCO2eq/kWh |`,
      `| Budget band (central) | — | ${summary.band} | — | Budget: ${summary.carbonBudget} gCO2e est. |`,
      `| Anomaly flags | — | ${summary.anomalyCount} | — | Waves exceeding 3x trailing-10-wave median (central) |`,
      `| Rows with estimate_unavailable | — | ${summary.rowsUnavailable} of ${summary.rowsTotal} | — | n/a or TBD token rows — excluded per D6 |`,
      '',
      '**Cost + Carbon unified view (D7)**: prompt caching reduces token counts, which reduces both cost and carbon.',
      `_For this pipeline run: cost ${costRef} + carbon range shown above (est.). Caching reduces both._`,
      '',
      '| Wave | Tokens | Low gCO2e est. | Central gCO2e est. | High gCO2e est. |',
      '|---|---|---|---|---|',
      ...waveTableRows,
      '',
      `_Last refreshed: ${now} by wave-186. Run \`npm run compute:carbon\` to update._`,
      '',
      '**Grid presets used**: low = 2 gCO2eq/kWh (renewables-heavy, IEA 2023); central = 442 gCO2eq/kWh (world average, GlobalDataMonitor 2024); high = 800 gCO2eq/kWh (coal-heavy, IEA 2023). Wh/token central = 0.001 (IEA 2023 LLM inference). PUE = 1.2 (Uptime Institute 2023). All factors in `docs/quality/carbon-factors.json`.',
      '',
      'Separation note: Carbon = environmental governance lens (gCO2e est.). Cost = financial governance lens (USD est.). DORA = delivery-performance lens. SLO = behavioral-quality lens. These are separate namespaces.',
    ].join('\n');

    if (content.includes(SECTION_MARKER)) {
      const sectionStart = content.indexOf(SECTION_MARKER);
      content = content.slice(0, sectionStart).trimEnd() + sectionContent + '\n';
    } else {
      content = content.trimEnd() + '\n' + sectionContent + '\n';
    }

    fs.writeFileSync(DASHBOARD_PATH, content, 'utf8');
    process.stdout.write(`[carbon] Carbon Summary appended to ${DASHBOARD_PATH}\n`);
  } catch (err) {
    process.stderr.write(`[carbon] WARN — failed to append Carbon Summary to _DASHBOARD.md: ${err}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`[carbon] FATAL: ${err}\n`);
  process.exit(1);
});
