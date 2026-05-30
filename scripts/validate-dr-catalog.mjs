#!/usr/bin/env node
// @ts-check
/**
 * Wave-176 — DR Scenario Catalog Validator
 *
 * Validates docs/security/dr-scenario-catalog.json against four invariants:
 *
 *   DR-V1 (EXIT-1): every scenario with recovery_label "automated" must have a
 *                   recovery_script path that resolves to a real file on disk.
 *                   Scenarios with recovery_label "manual-only" and
 *                   recovery_script "manual" are always valid.
 *   DR-V2 (EXIT-1): every scenario_id must be unique within the catalog.
 *   DR-V3 (WARN):   any scenario with rto_target or rpo_target containing "TBD"
 *                   emits a WARN — not a blocker, surfaces the measurement gap.
 *   DR-V4 (EXIT-1): any scenario with recovery_label "automated" and
 *                   recovery_script "manual" is an invariant contradiction — reject.
 *
 * Mirrors the parse-invariant-exit shape from scripts/validate-gdpr-inventory.mjs:36-60
 * and the dangling-ref pattern from scripts/validate-runbooks.mjs:359-370.
 *
 * Honesty bar (wave-173 + wave-176 D2, D3):
 *   - No recovery_script path is accepted as a string unless it exists on disk
 *     (for automated scenarios).
 *   - last_measured_rta: "untested" is the only valid seed value. The validator
 *     does not warn on "untested" — it is the expected initial state.
 *
 * Flags:
 *   --dry    Validate only; print findings; exit with appropriate code.
 *            (Mirrors validate-raci.mjs --dry — no file writes either way,
 *            but makes intent explicit in CI invocations.)
 *
 * Exit codes:
 *   0 — no DR-V1, DR-V2, or DR-V4 violations (DR-V3 WARNs do not block)
 *   1 — one or more violations found
 *
 * Usage:
 *   node scripts/validate-dr-catalog.mjs
 *   node scripts/validate-dr-catalog.mjs --dry
 *   npm run dr:validate
 *
 * No telemetry events emitted. No file writes. Doc-layer governance only.
 * AC-11: zero calls to emitTelemetry or any .jsonl write.
 *
 * Spec: docs/specs/wave-176_MASTER_SPEC.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────────
const CATALOG_PATH = path.join(ROOT, 'docs', 'security', 'dr-scenario-catalog.json');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
// --dry flag: validate only, no file writes (this validator never writes anyway,
// but the flag makes CI intent explicit and mirrors validate-raci.mjs).
const isDry = args.includes('--dry');

// ── Output helpers ─────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── Load catalog ───────────────────────────────────────────────────────────────

if (!fs.existsSync(CATALOG_PATH)) {
  log(`⊘ DORMANT — ${CATALOG_PATH} not seeded yet; DR-catalog gate inactive, not failed. Seed the catalog to activate.`);
  process.exit(0);
}

/** @type {any} */
let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
} catch (err) {
  log(`[VIOLATION] — catalog JSON parse failed: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(catalog.scenarios)) {
  log(`[VIOLATION] — catalog missing top-level "scenarios" array`);
  process.exit(1);
}

const scenarios = catalog.scenarios;

// ── Invariant accumulators ─────────────────────────────────────────────────────
/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const warnings = [];
/** @type {string[]} */
const passes = [];

// ── DR-V2: unique scenario_id ─────────────────────────────────────────────────
const seenIds = new Set();
for (const scenario of scenarios) {
  const id = scenario.scenario_id ?? '(missing scenario_id)';
  if (seenIds.has(id)) {
    violations.push(`[VIOLATION] ${id} — duplicate scenario_id`);
  }
  seenIds.add(id);
}

// ── DR-V1 + DR-V4: recovery_script resolves + label/script contradiction ──────
for (const scenario of scenarios) {
  const id = scenario.scenario_id ?? '(missing scenario_id)';
  const label = scenario.recovery_label;
  const script = scenario.recovery_script;

  // DR-V4: automated + "manual" recovery_script is a contradiction
  if (label === 'automated' && script === 'manual') {
    violations.push(
      `[VIOLATION] ${id} — recovery_label automated contradicts recovery_script manual`
    );
    continue; // no point checking file existence for "manual"
  }

  // DR-V1: automated scenario must have recovery_script that resolves to a real file
  if (label === 'automated') {
    if (!script || typeof script !== 'string' || script.trim() === '') {
      violations.push(`[VIOLATION] ${id} — recovery_script is empty or missing`);
      continue;
    }
    const absPath = path.resolve(ROOT, script);
    if (!fs.existsSync(absPath)) {
      violations.push(
        `[VIOLATION] ${id} — recovery_script path does not resolve: "${script}"`
      );
    } else {
      passes.push(`[PASS] ${id} — recovery_script resolves: "${script}"`);
    }
  }

  // manual-only with "manual" script: valid by design (DR-CHAIN-01, DR-TELEM-01)
  if (label === 'manual-only') {
    if (script === 'manual') {
      passes.push(`[PASS] ${id} — recovery_label manual-only, recovery_script "manual" (expected)`);
    } else if (script && typeof script === 'string' && script.trim() !== '') {
      // manual-only pointing at a file path is allowed (informational reference)
      passes.push(`[PASS] ${id} — recovery_label manual-only, recovery_script ref: "${script}"`);
    }
  }
}

// ── DR-V3: TBD targets (WARN only, no EXIT-1) ─────────────────────────────────
for (const scenario of scenarios) {
  const id = scenario.scenario_id ?? '(missing scenario_id)';
  const rto = scenario.rto_target ?? '';
  const rpo = scenario.rpo_target ?? '';
  if (String(rto).includes('TBD')) {
    warnings.push(
      `[WARN] ${id} — rto_target contains "TBD" — measurement gap: run a real drill and record RTA`
    );
  }
  if (String(rpo).includes('TBD')) {
    warnings.push(
      `[WARN] ${id} — rpo_target contains "TBD" — measurement gap: run a real drill and record RPO`
    );
  }
}

// ── Print results ──────────────────────────────────────────────────────────────
if (isDry) {
  log('[validate-dr-catalog] --dry mode: validation only, no writes.');
}

for (const pass of passes) {
  log(pass);
}
for (const warn of warnings) {
  log(warn);
}
for (const violation of violations) {
  log(violation);
}

const scenarioCount = scenarios.length;

if (violations.length > 0) {
  log(
    `\nFAIL — ${scenarioCount} scenario(s), ${violations.length} violation(s), ${warnings.length} warning(s).`
  );
  process.exit(1);
}

log(
  `\nPASS — ${scenarioCount} scenario(s), 0 violations, ${warnings.length} warning(s).`
);
process.exit(0);
