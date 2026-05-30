#!/usr/bin/env node
// @ts-check
/**
 * Wave-178 — Telemetry Schema Registry
 *
 * Single source of truth for per-event-type schemas.
 * Event types are DERIVED from emit-telemetry.mjs Sets (lines 110-142) — no
 * parallel list is defined here. The REGISTRY keys must remain a strict subset
 * of the union of all Sets in that file.
 *
 * Per-entry shape:
 *   schema_version  string    — "1" (matches telemetry-schema-v1.md)
 *   stream          string    — relative JSONL path (docs/audits/...)
 *   required_envelope string[] — 15 canonical envelope field names (schema-v1:15-35)
 *   required_payload  string[] — required payload fields inferred from live records
 *   schema_tbd      boolean   — true when no live records exist and payload shape
 *                               cannot be inferred; validator emits SCHEMA_TBD WARN
 *
 * AC-1 enforcement: rg must find Set name references in this file.
 * AC-3 enforcement: no ajv, no zod imported here.
 * D2  enforcement:  all event_type keys are values from the Sets below.
 */

// ── Reference to emit-telemetry.mjs Sets (AC-1) ────────────────────────────
// Event types sourced from HALT_TYPES, VERDICT_TYPES, CHECKLIST_TYPES,
// MEMORY_TYPES, DRIFT_TYPES, STRENGTHEN_TYPES, SLO_TYPES,
// HALLUCINATION_TYPES, EVAL_TYPES, SECURITY_TYPES,
// CONSTITUTIONAL_DRIFT_TYPES, RFC_EVENT_TYPES, DORA_TYPES,
// KG_TYPES, COST_TYPES (emit-telemetry.mjs:110-142)
// plus agent-events catch-all types (llm_call, sub_agent_dispatch, etc.)

// ── 15 required envelope fields (telemetry-schema-v1.md:15-35) ─────────────
const ENVELOPE_FIELDS = [
  'schema_version',
  'id',
  'source',
  'specversion',
  'type',
  'time',
  'trace_id',
  'span_id',
  'parent_span_id',
  'wave',
  'agent',
  'event_type',
  'verdict',
  'payload',
  'compliance_ref',
];

// ── Stream path constants ───────────────────────────────────────────────────
const HALT_STREAM          = 'docs/audits/halt-events.jsonl';
const VERDICTS_STREAM      = 'docs/audits/cross-line-verdicts.jsonl';
const CHECKLIST_STREAM     = 'docs/audits/checklist-runs.jsonl';
const AGENT_STREAM         = 'docs/audits/agent-events.jsonl';
const RECURRENCE_STREAM    = 'docs/audits/recurrence-events.jsonl';
const DRIFT_STREAM         = 'docs/audits/drift-events.jsonl';
const STRENGTHEN_STREAM    = 'docs/audits/strengthen-events.jsonl';
const MEMORY_STREAM        = 'docs/audits/memory-events.jsonl';
const SLO_STREAM           = 'docs/audits/slo-events.jsonl';
const HALLUC_STREAM        = 'docs/audits/halluc-events.jsonl';
const EVAL_STREAM          = 'docs/audits/eval-events.jsonl';
const SECURITY_STREAM      = 'docs/audits/security-events.jsonl';
const CONSTITUTIONAL_STREAM = 'docs/audits/constitutional-events.jsonl';
const RFC_STREAM           = 'docs/audits/rfc-events.jsonl';
const DORA_STREAM          = 'docs/audits/dora-events.jsonl';
const KG_STREAM            = 'docs/audits/kg-events.jsonl';
const COST_STREAM          = 'docs/audits/cost-events.jsonl';

// ── Registry ────────────────────────────────────────────────────────────────
// Keys = event_type values from emit-telemetry.mjs Sets (D2, AC-1)
// Each entry: required_envelope + required_payload (from live data sampling)

export const REGISTRY = {

  // ── HALT_TYPES ─────────────────────────────────────────────────────────
  // Live sample (halt-events.jsonl:16+): payload has approver, rootCause, pii_possible
  halt: {
    schema_version: '1',
    stream: HALT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  resume: {
    schema_version: '1',
    stream: HALT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  forced_resume: {
    schema_version: '1',
    stream: HALT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },

  // ── VERDICT_TYPES ──────────────────────────────────────────────────────
  // cross-line-verdicts.jsonl: older records are LEGACY (no schema_version/id)
  // v1 records expected once the stream adopts the envelope
  cross_line_verdict: {
    schema_version: '1',
    stream: VERDICTS_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  forced_override: {
    schema_version: '1',
    stream: VERDICTS_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },

  // ── CHECKLIST_TYPES ────────────────────────────────────────────────────
  // checklist-runs.jsonl: older records are LEGACY; v1 expected
  checklist_run: {
    schema_version: '1',
    stream: CHECKLIST_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },

  // ── MEMORY_TYPES (wave-151, 8th stream) ───────────────────────────────
  // Live sample: payload.classes_exported (array), payload.entity_count (number)
  memory_snapshot_exported: {
    schema_version: '1',
    stream: MEMORY_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['classes_exported', 'entity_count'],
    schema_tbd: false,
  },
  // Live sample: payload.entity_count (number), payload.staging_file (string)
  memory_snapshot_restored: {
    schema_version: '1',
    stream: MEMORY_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['entity_count', 'staging_file'],
    schema_tbd: false,
  },

  // ── DRIFT_TYPES (6th stream) ───────────────────────────────────────────
  // Live sample: payload.rule_id, dimension, severity, slug, declarative_source,
  //   actual_state_ref, drift_description, pii_possible
  drift_detected: {
    schema_version: '1',
    stream: DRIFT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['rule_id', 'dimension', 'severity', 'drift_description'],
    schema_tbd: false,
  },

  // ── STRENGTHEN_TYPES (7th stream — wave-149) ──────────────────────────
  // strengthen-events.jsonl uses a LEGACY format (no schema_version/id/specversion)
  // All existing records are LEGACY. The envelope schema applies to future v1 records.
  strengthen_evaluated: {
    schema_version: '1',
    stream: STRENGTHEN_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  promotion_proposed: {
    schema_version: '1',
    stream: STRENGTHEN_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  promotion_applied: {
    schema_version: '1',
    stream: STRENGTHEN_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  demotion_proposed: {
    schema_version: '1',
    stream: STRENGTHEN_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  demotion_applied: {
    schema_version: '1',
    stream: STRENGTHEN_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },

  // ── SLO_TYPES (wave-146, 9th stream) ──────────────────────────────────
  // Live sample: payload.slo_id, window, current_occurrences, budget_per_window,
  //   burn_rate, fast_burn_1h, budget_remaining_28d, event_count_7d
  slo_evaluated: {
    schema_version: '1',
    stream: SLO_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['slo_id', 'window', 'burn_rate'],
    schema_tbd: false,
  },
  budget_breach: {
    schema_version: '1',
    stream: SLO_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['slo_id', 'window', 'burn_rate'],
    schema_tbd: false,
  },

  // ── HALLUCINATION_TYPES (wave-163, 10th stream) ────────────────────────
  // halluc-events.jsonl does NOT exist on disk — zero live records
  hallucination_detected: {
    schema_version: '1',
    stream: HALLUC_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },
  grounding_pass: {
    schema_version: '1',
    stream: HALLUC_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },

  // ── EVAL_TYPES (wave-164, 11th stream) ────────────────────────────────
  // eval-events.jsonl does NOT exist on disk — zero live records
  eval_run: {
    schema_version: '1',
    stream: EVAL_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },
  eval_regression_detected: {
    schema_version: '1',
    stream: EVAL_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },

  // ── SECURITY_TYPES (wave-165, 12th stream) ────────────────────────────
  // Live sample: payload.event_subtype, tokens_found (array), field, source_script
  pii_redacted: {
    schema_version: '1',
    stream: SECURITY_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['event_subtype'],
    schema_tbd: false,
  },
  // Live sample: payload.event_subtype, patterns_matched (array), severity, source_script
  injection_detected: {
    schema_version: '1',
    stream: SECURITY_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['event_subtype', 'severity'],
    schema_tbd: false,
  },
  // Live sample: payload.event_subtype, finding_id, check_id, title, severity, cvss_score, cwe, status, sla_deadline
  pentest_finding: {
    schema_version: '1',
    stream: SECURITY_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['event_subtype', 'finding_id', 'severity'],
    schema_tbd: false,
  },
  // Live sample: payload.event_subtype, finding_id, check_id, title, severity, status
  gdpr_finding: {
    schema_version: '1',
    stream: SECURITY_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['event_subtype', 'finding_id', 'severity'],
    schema_tbd: false,
  },

  // ── CONSTITUTIONAL_DRIFT_TYPES (wave-166, 13th stream) ────────────────
  // constitutional-events.jsonl: only a # comment line — no v1 records
  constitutional_verdict: {
    schema_version: '1',
    stream: CONSTITUTIONAL_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },
  constitutional_drift_detected: {
    schema_version: '1',
    stream: CONSTITUTIONAL_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },

  // ── RFC_EVENT_TYPES (wave-167, 14th stream) ────────────────────────────
  // rfc-events.jsonl: empty file — zero live records
  rfc_opened: {
    schema_version: '1',
    stream: RFC_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },
  rfc_accepted: {
    schema_version: '1',
    stream: RFC_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },
  rfc_withdrawn: {
    schema_version: '1',
    stream: RFC_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: true,
  },

  // ── DORA_TYPES (wave-168, 15th stream) ────────────────────────────────
  // Live sample: payload.metric, metric_id, value, unit, band, window_days
  dora_metric_computed: {
    schema_version: '1',
    stream: DORA_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['metric', 'metric_id', 'value', 'unit', 'band'],
    schema_tbd: false,
  },

  // ── KG_TYPES (wave-169, 16th stream) ──────────────────────────────────
  // Live sample: payload.node_count, edge_count, orphan_count, built_at
  graph_built: {
    schema_version: '1',
    stream: KG_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['node_count', 'edge_count'],
    schema_tbd: false,
  },

  // ── COST_TYPES (wave-177, 17th stream) ────────────────────────────────
  // Live sample: payload.est_cost_usd, rolling_median_est_usd, anomaly_multiplier,
  //   tokens, token_source, honesty_note
  cost_anomaly: {
    schema_version: '1',
    stream: COST_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['est_cost_usd', 'tokens'],
    schema_tbd: false,
  },
  // Live sample: payload.cumulative_est_cost_usd, band, token_source, honesty_note
  // Note: cost_computed is the cumulative summary record (distinct from cost_anomaly).
  // Payload uses cumulative_est_cost_usd, NOT est_cost_usd (which belongs to cost_anomaly).
  cost_computed: {
    schema_version: '1',
    stream: COST_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['cumulative_est_cost_usd', 'band'],
    schema_tbd: false,
  },

  // ── Agent-events catch-all types (docs/audits/agent-events.jsonl) ─────
  // Covers: llm_call, sub_agent_dispatch, agent_start, agent_end,
  //   meta_process_regression, pre_mortem_run, and any other event_type
  //   that does not match a named stream routing Set.
  llm_call: {
    schema_version: '1',
    stream: AGENT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  sub_agent_dispatch: {
    schema_version: '1',
    stream: AGENT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  agent_start: {
    schema_version: '1',
    stream: AGENT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  agent_end: {
    schema_version: '1',
    stream: AGENT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  meta_process_regression: {
    schema_version: '1',
    stream: AGENT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: [],
    schema_tbd: false,
  },
  pre_mortem_run: {
    schema_version: '1',
    stream: AGENT_STREAM,
    required_envelope: ENVELOPE_FIELDS,
    required_payload: ['lens_count', 'total_themes'],
    schema_tbd: false,
  },
};

// ── Known legacy exceptions (id-pinned, wave-178 exception mechanism) ──────
//
// An exception is a single JSONL record that:
//   (a) claims schema_version:"1" and has an id,
//   (b) is missing one or more required v1 envelope fields,
//   (c) is hash-chained into the stream and MUST NOT be mutated (anti-pattern #7), AND
//   (d) was emitted before the full wave-147 envelope was wired at its emit site.
//
// Exception policy (mirrors wave-174 nosemgrep-with-justification):
//   - Every exception is keyed by the record's unique `id` field (UUID v4).
//   - A justification string is mandatory — exceptions are NOT silent.
//   - The validator classifies the record as LEGACY_TRANSITIONAL (WARN) instead of FAIL.
//   - LEGACY_TRANSITIONAL is visible in the conformance table TRANSITIONAL column;
//     it is NOT counted as PASS. Coverage % excludes it (like LEGACY / TBD).
//   - Adding a future exception requires: a documented justification AND the record id.
//     Do not mutate the JSONL record to "fix" it — that breaks the hash chain (anti-pattern #7).
//
// @type {Record<string, string>}
export const KNOWN_LEGACY_EXCEPTIONS = {
  '23db34bb-ae09-4bd1-bd7d-bd0c2231075e':
    'wave-165 transitional pii_redacted record emitted before full wave-147 envelope rollout; ' +
    'lines 2-3 of same security-events.jsonl stream already conform; ' +
    'hash-chained, not mutable per anti-pattern #7 (wave-148 chain integrity rule). ' +
    'Adjudicated disposition: LEGACY_TRANSITIONAL — visible in conformance table, not folded into PASS.',
};

// ── Exports for test harness ────────────────────────────────────────────────
export { ENVELOPE_FIELDS };
