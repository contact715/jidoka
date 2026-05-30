#!/usr/bin/env node
// @ts-check
/**
 * Wave-147 — Universal Behavioral Telemetry Emitter
 * Wave-148 — Extended: prev_hash chain, trace propagation, recurrence hook
 * Wave-163 — Extended: 10th stream halluc-events.jsonl (EU AI Act Art 15 Para 3)
 * Wave-164 — Extended: 11th stream eval-events.jsonl (eval_run + eval_regression_detected)
 * Wave-165 — Extended: 12th stream security-events.jsonl (pii_redacted + injection_detected)
 * Wave-166 — Extended: 13th stream constitutional-events.jsonl (constitutional_verdict + constitutional_drift_detected)
 * Wave-167 — Extended: 14th stream rfc-events.jsonl (rfc_opened + rfc_accepted + rfc_withdrawn)
 * Wave-168 — Extended: 15th stream dora-events.jsonl (dora_metric_computed)
 * Wave-169 — Extended: 16th stream kg-events.jsonl (graph_built)
 * Wave-177 — Extended: 17th stream cost-events.jsonl (cost_computed + cost_anomaly)
 * Wave-186 — Extended: 18th stream carbon-events.jsonl (carbon_computed + carbon_anomaly)
 *
 * Single emit entry-point for all agent behavioral events.
 * Routes to one of 18 JSONL streams based on event_type.
 * Non-fatal: I/O errors are logged to stderr but never re-thrown.
 *
 * Usage (ESM import):
 *   import { emitTelemetry } from './emit-telemetry.mjs';
 *   emitTelemetry('halt', { wave: 'wave-147', agent: 'pfca-agent', ... });
 *
 * Stream routing:
 *   halt | resume | forced_resume             → docs/audits/halt-events.jsonl
 *   cross_line_verdict | forced_override      → docs/audits/cross-line-verdicts.jsonl
 *   checklist_run                             → docs/audits/checklist-runs.jsonl
 *   memory_snapshot_exported | ..._restored  → docs/audits/memory-events.jsonl  (wave-151, 8th stream)
 *   slo_evaluated | budget_breach            → docs/audits/slo-events.jsonl     (wave-146, 9th stream)
 *   hallucination_detected | grounding_pass  → docs/audits/halluc-events.jsonl  (wave-163, 10th stream)
 *   eval_run | eval_regression_detected      → docs/audits/eval-events.jsonl     (wave-164, 11th stream)
 *   pii_redacted | injection_detected        → docs/audits/security-events.jsonl (wave-165, 12th stream)
 *   constitutional_verdict | constitutional_drift_detected → docs/audits/constitutional-events.jsonl (wave-166, 13th stream)
 *   rfc_opened | rfc_accepted | rfc_withdrawn → docs/audits/rfc-events.jsonl              (wave-167, 14th stream)
 *   dora_metric_computed                      → docs/audits/dora-events.jsonl             (wave-168, 15th stream)
 *   graph_built                               → docs/audits/kg-events.jsonl               (wave-169, 16th stream)
 *   cost_computed | cost_anomaly              → docs/audits/cost-events.jsonl             (wave-177, 17th stream)
 *   carbon_computed | carbon_anomaly          → docs/audits/carbon-events.jsonl           (wave-186, 18th stream)
 *   any other event_type                      → docs/audits/agent-events.jsonl
 *
 * Wave-148 additions:
 *   CLI: node scripts/emit-telemetry.mjs hash-chain  (backfill prev_hash on all 5 streams)
 *   export getCurrentTraceId()           reads APP_TRACE_ID env or generates UUID
 *   export withTraceContext(id, fn)      sets APP_TRACE_ID for duration of fn()
 *   export readJsonlChainIntegrity(fp)   verifies prev_hash chain integrity
 *
 * Schema: docs/specs/telemetry-schema-v1.md
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
// Wave-165: PII redaction — import from shared module (TS/MJS boundary: .mjs only)
import { redactPiiString, detectPiiTokens } from '../lib/redaction/redact-pii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Stream paths ────────────────────────────────────────────────────────────
const HALT_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'halt-events.jsonl');
const VERDICTS_PATH = path.join(ROOT, 'docs', 'audits', 'cross-line-verdicts.jsonl');
const CHECKLIST_PATH = path.join(ROOT, 'docs', 'audits', 'checklist-runs.jsonl');
const AGENT_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'agent-events.jsonl');
const RECURRENCE_PATH = path.join(ROOT, 'docs', 'audits', 'recurrence-events.jsonl');
const DRIFT_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'drift-events.jsonl');
const STRENGTHEN_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'strengthen-events.jsonl');
// Wave-151: 8th stream — memory snapshot audit trail (EU AI Act Art 12)
const MEMORY_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'memory-events.jsonl');
// Wave-146: 9th stream — SLO evaluation + budget breach events
const SLO_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'slo-events.jsonl');
// Wave-163: 10th stream — hallucination detection + source grounding events (EU AI Act Art 15 Para 3)
const HALLUC_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'halluc-events.jsonl');
// Wave-164: 11th stream — eval runner events (eval_run + eval_regression_detected) (EU AI Act Art 15)
const EVAL_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'eval-events.jsonl');
// Wave-165: 12th stream — security events (pii_redacted + injection_detected) (GDPR Art 32, OWASP LLM01)
const SECURITY_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'security-events.jsonl');
// Wave-166: 13th stream — constitutional drift events (constitutional_verdict + constitutional_drift_detected) (EU AI Act Art 9, Art 15)
const CONSTITUTIONAL_DRIFT_PATH = path.join(ROOT, 'docs', 'audits', 'constitutional-events.jsonl');
// Wave-167: 14th stream — RFC process events (rfc_opened + rfc_accepted + rfc_withdrawn)
const RFC_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'rfc-events.jsonl');
// Wave-168: 15th stream — DORA delivery-performance metric events (dora_metric_computed)
const DORA_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'dora-events.jsonl');
// Wave-169: 16th stream — knowledge graph build events (graph_built)
const KG_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'kg-events.jsonl');
// Wave-177: 17th stream — FinOps agent cost governance events (cost_computed + cost_anomaly)
const COST_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'cost-events.jsonl');
// Wave-186: 18th stream — Carbon / Sustainability Accounting events (carbon_computed + carbon_anomaly)
const CARBON_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'carbon-events.jsonl');

// All 18 streams (used by hash-chain sub-command)
const ALL_STREAM_PATHS = [
  HALT_EVENTS_PATH,
  VERDICTS_PATH,
  CHECKLIST_PATH,
  AGENT_EVENTS_PATH,
  RECURRENCE_PATH,
  DRIFT_EVENTS_PATH,
  STRENGTHEN_EVENTS_PATH,
  MEMORY_EVENTS_PATH,
  SLO_EVENTS_PATH,
  HALLUC_EVENTS_PATH,
  EVAL_EVENTS_PATH,
  SECURITY_EVENTS_PATH,     // wave-165: 12th stream
  CONSTITUTIONAL_DRIFT_PATH, // wave-166: 13th stream
  RFC_EVENTS_PATH,           // wave-167: 14th stream
  DORA_EVENTS_PATH,          // wave-168: 15th stream
  KG_EVENTS_PATH,            // wave-169: 16th stream
  COST_EVENTS_PATH,          // wave-177: 17th stream
  CARBON_EVENTS_PATH,        // wave-186: 18th stream
];

// ── Event-type to stream routing ────────────────────────────────────────────
const HALT_TYPES = new Set(['halt', 'resume', 'forced_resume']);
const VERDICT_TYPES = new Set(['cross_line_verdict', 'forced_override']);
const CHECKLIST_TYPES = new Set(['checklist_run']);
// Wave-151: 8th stream routing — memory snapshot events
const MEMORY_TYPES = new Set(['memory_snapshot_exported', 'memory_snapshot_restored']);
const DRIFT_TYPES = new Set(['drift_detected']);
const STRENGTHEN_TYPES = new Set([
  'strengthen_evaluated',
  'promotion_proposed',
  'promotion_applied',
  'demotion_proposed',
  'demotion_applied',
]);
// Wave-146: 9th stream routing — SLO evaluation and budget breach events
const SLO_TYPES = new Set(['slo_evaluated', 'budget_breach']);
// Wave-163: 10th stream routing — hallucination detection + source grounding events
const HALLUCINATION_TYPES = new Set(['hallucination_detected', 'grounding_pass']);
// Wave-164: 11th stream routing — eval framework events (EU AI Act Art 15)
const EVAL_TYPES = new Set(['eval_run', 'eval_regression_detected']);
// Wave-165: 12th stream routing — security events (GDPR Art 32, OWASP LLM01/LLM02)
// Wave-172: added 'pentest_finding' — routes to security-events.jsonl (12th stream; stream count stays 16)
// Wave-173: added 'gdpr_finding' — routes to security-events.jsonl (12th stream; stream count stays 16)
const SECURITY_TYPES = new Set(['pii_redacted', 'injection_detected', 'pentest_finding', 'gdpr_finding']);
// Wave-166: 13th stream routing — constitutional drift events (EU AI Act Art 9, Art 15)
const CONSTITUTIONAL_DRIFT_TYPES = new Set(['constitutional_verdict', 'constitutional_drift_detected']);
// Wave-167: 14th stream routing — RFC process events
const RFC_EVENT_TYPES = new Set(['rfc_opened', 'rfc_accepted', 'rfc_withdrawn']);
// Wave-168: 15th stream routing — DORA delivery-performance metric events
const DORA_TYPES = new Set(['dora_metric_computed']);
// Wave-169: 16th stream routing — knowledge graph build events
const KG_TYPES = new Set(['graph_built']);
// Wave-177: 17th stream routing — FinOps agent cost governance events (cost_computed + cost_anomaly)
const COST_TYPES = new Set(['cost_computed', 'cost_anomaly']);
// Wave-186: 18th stream routing — Carbon / Sustainability Accounting events (carbon_computed + carbon_anomaly)
const CARBON_TYPES = new Set(['carbon_computed', 'carbon_anomaly']);

const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Resolve the target JSONL file path for a given event_type.
 * @param {string} eventType
 * @returns {string}
 */
function resolveStream(eventType) {
  const et = (eventType || '').toLowerCase();
  if (HALT_TYPES.has(et)) return HALT_EVENTS_PATH;
  if (VERDICT_TYPES.has(et)) return VERDICTS_PATH;
  if (CHECKLIST_TYPES.has(et)) return CHECKLIST_PATH;
  if (MEMORY_TYPES.has(et)) return MEMORY_EVENTS_PATH; // wave-151: 8th stream
  if (DRIFT_TYPES.has(et)) return DRIFT_EVENTS_PATH;
  if (STRENGTHEN_TYPES.has(et)) return STRENGTHEN_EVENTS_PATH;
  if (SLO_TYPES.has(et)) return SLO_EVENTS_PATH; // wave-146: 9th stream
  if (HALLUCINATION_TYPES.has(et)) return HALLUC_EVENTS_PATH; // wave-163: 10th stream
  if (EVAL_TYPES.has(et)) return EVAL_EVENTS_PATH; // wave-164: 11th stream
  if (SECURITY_TYPES.has(et)) return SECURITY_EVENTS_PATH; // wave-165: 12th stream
  if (CONSTITUTIONAL_DRIFT_TYPES.has(et)) return CONSTITUTIONAL_DRIFT_PATH; // wave-166: 13th stream
  if (RFC_EVENT_TYPES.has(et)) return RFC_EVENTS_PATH; // wave-167: 14th stream
  if (DORA_TYPES.has(et)) return DORA_EVENTS_PATH; // wave-168: 15th stream
  if (KG_TYPES.has(et)) return KG_EVENTS_PATH;     // wave-169: 16th stream
  if (COST_TYPES.has(et)) return COST_EVENTS_PATH;       // wave-177: 17th stream
  if (CARBON_TYPES.has(et)) return CARBON_EVENTS_PATH;  // wave-186: 18th stream
  return AGENT_EVENTS_PATH;
}

/**
 * Strip newlines from a string field to prevent JSONL injection, then apply
 * PII masking (wave-165: CARD/SSN/EMAIL/PHONE sentinel tokens).
 * JSON.stringify handles the rest (quotes, escapes).
 *
 * Exported so sibling scripts (detect-recurrences.mjs, respond-recurrence.mjs)
 * can import this single canonical copy (wave-165 T7 consolidation).
 *
 * @param {unknown} val
 * @returns {unknown}
 */
export function sanitizeField(val) {
  if (typeof val === 'string') {
    // 1. Strip newlines (existing behaviour — JSONL injection prevention)
    const stripped = val.replace(/[\r\n]/g, ' ');
    // 2. PII masking (wave-165 — write-time, raw PII never reaches disk)
    return redactPiiString(stripped);
  }
  return val;
}

/**
 * Sanitize all string fields in a plain object (one level deep + payload).
 * When a payload field is tagged `pii_possible: true` in the record, all
 * string values in that payload object are redacted (wave-165 A6).
 * Security events (pii_redacted) are emitted for any field where tokens were found.
 *
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function sanitizeRecord(obj) {
  const out = {};
  // Detect whether any payload field is tagged pii_possible
  const payloadObj = obj['payload'];
  const hasPiiPossible =
    payloadObj &&
    typeof payloadObj === 'object' &&
    !Array.isArray(payloadObj) &&
    (/** @type {Record<string, unknown>} */ (payloadObj))['pii_possible'] === true;

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'payload' && v && typeof v === 'object' && !Array.isArray(v)) {
      const payloadOut = {};
      for (const [pk, pv] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
        if (pk === 'pii_possible') {
          // Do not write pii_possible sentinel to output — it's a processing hint only
          continue;
        }
        if (hasPiiPossible && typeof pv === 'string') {
          const tokens = detectPiiTokens(pv);
          const redacted = /** @type {string} */ (sanitizeField(pv));
          payloadOut[pk] = redacted;
          // Emit security event for auditing (non-blocking, non-fatal)
          if (tokens.length > 0) {
            _emitPiiRedactedEvent(pk, tokens);
          }
        } else {
          payloadOut[pk] = sanitizeField(pv);
        }
      }
      out[k] = payloadOut;
    } else {
      out[k] = sanitizeField(v);
    }
  }
  return out;
}

/**
 * Emit a pii_redacted security event to security-events.jsonl.
 * Non-fatal, non-recursive (writes directly via fs.appendFileSync to avoid
 * infinite loop through emitTelemetry → sanitizeRecord → _emitPiiRedactedEvent).
 *
 * @param {string} field
 * @param {string[]} tokensFound
 */
function _emitPiiRedactedEvent(field, tokensFound) {
  try {
    const record = {
      schema_version: '1',
      id: crypto.randomUUID(),
      source: 'scripts/emit-telemetry.mjs',
      specversion: '1.0',
      type: 'io.app.pii_redacted',
      time: new Date().toISOString(),
      wave: 'wave-165',
      agent: 'emit-telemetry',
      event_type: 'pii_redacted',
      prev_hash: computePrevHash(SECURITY_EVENTS_PATH),
      payload: {
        event_subtype: 'pii_redacted',
        tokens_found: tokensFound,
        field,
        source_script: 'scripts/emit-telemetry.mjs',
      },
    };
    fs.mkdirSync(path.dirname(SECURITY_EVENTS_PATH), { recursive: true });
    fs.appendFileSync(SECURITY_EVENTS_PATH, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // Non-fatal — security event emission failure must not disrupt primary telemetry
  }
}

/**
 * Read recurrenceDetection flags from .sdd-config.json.
 * Returns safe defaults if missing/malformed.
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

/**
 * Compute the prev_hash value for the next record appended to filePath.
 * If the file does not exist or is empty, returns "genesis".
 * If no existing record has a non-null prev_hash, the chain has not started;
 * returns "genesis" to begin the chain from wave-148 forward.
 * Otherwise returns sha256:<hex> of JSON.stringify(lastRecord).
 *
 * Legacy records (prev_hash: null) before wave-148 are intentionally left
 * unmodified. The chain begins at the first post-wave-148 record.
 *
 * @param {string} filePath
 * @returns {string}
 */
function computePrevHash(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 'genesis';
    const records = readJsonlStream(filePath);
    if (records.length === 0) return 'genesis';

    const last = records[records.length - 1];
    // Chain is "active" if any existing record has a non-null prev_hash
    const chainActive = records.some(
      r => r.prev_hash !== null && r.prev_hash !== undefined
    );
    if (!chainActive) {
      // No chain yet — this emit starts it; first new record gets "genesis"
      return 'genesis';
    }

    return 'sha256:' + crypto
      .createHash('sha256')
      .update(JSON.stringify(last))
      .digest('hex');
  } catch {
    return 'genesis';
  }
}

/**
 * Fire-and-forget spawn of detect-recurrences.mjs after each emit.
 * Gated by recurrenceDetection.enabled in .sdd-config.json.
 * Non-fatal: any error is logged to stderr without re-throwing.
 * @returns {void}
 */
function spawnRecurrenceDetection() {
  try {
    const { enabled } = readRecurrenceConfig();
    if (!enabled) return;

    const detectPath = path.join(ROOT, 'scripts', 'detect-recurrences.mjs');
    if (!fs.existsSync(detectPath)) return;

    const child = fork(detectPath, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
  } catch (e) {
    // Non-fatal per T.4 AC
    process.stderr.write(`[telemetry] WARN — recurrence detection hook error: ${e}\n`);
  }
}

// ── Public exports ──────────────────────────────────────────────────────────

export { DRIFT_EVENTS_PATH, STRENGTHEN_EVENTS_PATH, MEMORY_EVENTS_PATH, SLO_EVENTS_PATH, HALLUC_EVENTS_PATH, EVAL_EVENTS_PATH, SECURITY_EVENTS_PATH, CONSTITUTIONAL_DRIFT_PATH, RFC_EVENTS_PATH, DORA_EVENTS_PATH, KG_EVENTS_PATH, COST_EVENTS_PATH, CARBON_EVENTS_PATH };

/**
 * Parser shim: read lines from an existing JSONL file, filtering legacy `#`
 * comment lines (produced by wave-158 seeders). Wave-148+ consumers call this
 * when they need to read historical streams.
 *
 * @param {string} filePath
 * @returns {object[]}
 */
export function readJsonlStream(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Wave-148 — Return the active trace ID from the environment.
 * If APP_TRACE_ID is set, return it unchanged.
 * If absent, generate a new UUID, warn to stderr, and return the new ID.
 *
 * @returns {string}
 */
export function getCurrentTraceId() {
  const envId = process.env.APP_TRACE_ID;
  if (envId && envId.trim()) return envId.trim();
  const newId = crypto.randomUUID();
  process.stderr.write(
    `[telemetry] WARN — APP_TRACE_ID not set; generating ephemeral trace_id ${newId}. ` +
    `Root dispatchers should set APP_TRACE_ID before spawning sub-processes.\n`
  );
  return newId;
}

/**
 * Wave-148 — Run fn() with APP_TRACE_ID bound to traceId, then restore
 * the original env var (or delete it if it was absent).
 *
 * @param {string} traceId
 * @param {() => void} fn
 * @returns {void}
 */
export function withTraceContext(traceId, fn) {
  const prev = process.env.APP_TRACE_ID;
  process.env.APP_TRACE_ID = traceId;
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env.APP_TRACE_ID;
    } else {
      process.env.APP_TRACE_ID = prev;
    }
  }
}

/**
 * Wave-148 — Verify the prev_hash chain in a JSONL stream file.
 *
 * Legacy records (prev_hash: null) are treated as a pre-chain prefix and
 * skipped entirely. The chain is considered to start at the first non-null
 * record. That anchor record is accepted unconditionally — it may be "genesis"
 * (chain starting fresh) or a sha256 value (chain continuing from a prior
 * session where the anchor was correctly computed at emit time). Subsequent
 * records in the chain are verified against the SHA-256 of the previous record.
 *
 * This means the integrity check cannot detect tampering of the anchor record
 * itself, but it does detect any mutation of records after the anchor.
 *
 * @param {string} filePath
 * @returns {{ valid: boolean, firstBreak: number | null }}
 */
export function readJsonlChainIntegrity(filePath) {
  const records = readJsonlStream(filePath);
  if (records.length === 0) return { valid: true, firstBreak: null };

  /** @type {object | null} */
  let prevRecord = null;
  let chainStarted = false;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const lineNum = i + 1;

    if (rec.prev_hash === null || rec.prev_hash === undefined) {
      // Legacy record before wave-148 — pre-chain prefix, skip
      continue;
    }

    if (!chainStarted) {
      // First non-null record — accept as chain anchor unconditionally.
      // It may be "genesis" or a sha256 computed at emit time against
      // the last record visible then (which may have since been null-restored).
      prevRecord = rec;
      chainStarted = true;
      continue;
    }

    // Subsequent chained record — verify against previous record's hash
    const expectedHash = 'sha256:' + crypto
      .createHash('sha256')
      .update(JSON.stringify(prevRecord))
      .digest('hex');

    if (rec.prev_hash !== expectedHash) {
      return { valid: false, firstBreak: lineNum };
    }

    prevRecord = rec;
  }

  return { valid: true, firstBreak: null };
}

/**
 * Emit a single telemetry event to the appropriate JSONL stream.
 *
 * Required fields in `fields`:
 *   wave      {string}         e.g. "wave-147"
 *   agent     {string}         e.g. "pfca-agent"
 *
 * Optional but recommended:
 *   trace_id        {string}   UUID-v4 per top-level dispatch (generated if absent)
 *   span_id         {string}   UUID-v4 per agent action (always generated fresh)
 *   parent_span_id  {string|null}
 *   verdict         {string|null}
 *   payload         {object}
 *   source          {string}   script path (e.g. "scripts/run-checklist.mjs")
 *
 * @param {string} eventType  — one of the canonical event_type values
 * @param {Record<string, unknown>} fields
 * @returns {void}
 */
export function emitTelemetry(eventType, fields) {
  try {
    const et = (eventType || 'unknown').toLowerCase();
    const targetPath = resolveStream(et);

    // Build the canonical envelope (schema_version 1)
    const envelope = sanitizeRecord({
      schema_version: '1',
      id: crypto.randomUUID(),
      source: fields.source ?? 'scripts/emit-telemetry.mjs',
      specversion: '1.0',
      type: `io.app.${et}`,
      time: new Date().toISOString(),
      trace_id: fields.trace_id ?? crypto.randomUUID(),
      span_id: crypto.randomUUID(),
      parent_span_id: fields.parent_span_id ?? null,
      wave: fields.wave ?? 'wave-unknown',
      agent: fields.agent ?? 'unknown',
      event_type: et,
      verdict: fields.verdict ?? null,
      payload: fields.payload ?? {},
      compliance_ref: fields.compliance_ref ?? null,
      prev_hash: computePrevHash(targetPath), // wave-148: SHA-256 chain
    });

    // Ensure directory exists (AC2)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    // Append-only write — one JSON line
    fs.appendFileSync(targetPath, JSON.stringify(envelope) + '\n', 'utf8');

    // Wave-148 T.4: fire-and-forget online recurrence detection hook
    spawnRecurrenceDetection();
  } catch (err) {
    // AC3: non-fatal — log to stderr, never re-throw
    process.stderr.write(`[telemetry] ERROR: failed to emit event "${eventType}": ${err}\n`);
  }
}

// ── Wave-148: hash-chain sub-command ───────────────────────────────────────
// Run: node scripts/emit-telemetry.mjs hash-chain
// Reads all 15 JSONL streams, rewrites prev_hash forward from wave-148.
// Legacy records (prev_hash: null) are untouched. Atomic write via .tmp file.

if (process.argv[2] === 'hash-chain') {
  runHashChain();
}

/**
 * Batch hash-chain computation for all 5 JSONL streams.
 * Each stream is processed independently.
 * Writes to a .tmp file then renames atomically (per wave-158 pattern).
 *
 * Strategy (wave-148 R2 fix — anti-pattern #7):
 *   - Records with prev_hash: null are the pre-wave-148 legacy prefix and are
 *     NEVER mutated. Skipping them is spec-mandated (§5 T5, §7 Scope OUT).
 *   - Records with prev_hash already set (genesis or sha256) are verified and
 *     left unchanged if correct, or corrected if a prior batch run was buggy.
 *   - Records that have no prev_hash key at all (freshly appended, never seen
 *     by hash-chain) are assigned "genesis" if they are the first non-null
 *     record, or sha256(prev) otherwise.
 *
 * The chain START is always the first record that does NOT have prev_hash: null.
 * Legacy null records form the pre-chain prefix and are left byte-for-byte intact.
 *
 * @returns {void}
 */
function runHashChain() {
  let totalUpdated = 0;

  for (const streamPath of ALL_STREAM_PATHS) {
    if (!fs.existsSync(streamPath)) {
      process.stdout.write(`[hash-chain] SKIP ${path.basename(streamPath)} — file does not exist\n`);
      continue;
    }

    const records = readJsonlStream(streamPath);
    if (records.length === 0) {
      process.stdout.write(`[hash-chain] SKIP ${path.basename(streamPath)} — empty stream\n`);
      continue;
    }

    // Find the first non-null record — this is where the chain begins
    const chainStartIdx = records.findIndex(
      r => r.prev_hash !== null && r.prev_hash !== undefined
    );

    if (chainStartIdx === -1) {
      // All records are legacy null — nothing to chain, nothing to write
      process.stdout.write(`[hash-chain] SKIP ${path.basename(streamPath)} — all records are legacy (prev_hash: null)\n`);
      continue;
    }

    let updated = 0;
    /** @type {object | null} */
    let prevRecord = null;
    let chainStarted = false;

    const updated_records = records.map((rec, idx) => {
      // Pre-chain prefix: any record with prev_hash: null is legacy — never touch
      if (rec.prev_hash === null || rec.prev_hash === undefined) {
        return rec;
      }

      // First non-null record — chain anchor
      if (!chainStarted) {
        const expectedPrevHash = 'genesis';
        const newRec = rec.prev_hash === expectedPrevHash
          ? rec
          : { ...rec, prev_hash: expectedPrevHash };
        if (newRec.prev_hash !== rec.prev_hash) updated++;
        prevRecord = newRec;
        chainStarted = true;
        return newRec;
      }

      // Subsequent chained record — compute expected hash from prev
      const expectedPrevHash = prevRecord !== null
        ? 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(prevRecord)).digest('hex')
        : 'genesis';

      const newRec = rec.prev_hash === expectedPrevHash
        ? rec
        : { ...rec, prev_hash: expectedPrevHash };

      if (newRec.prev_hash !== rec.prev_hash) updated++;
      prevRecord = newRec;
      return newRec;
    });

    if (updated === 0) {
      process.stdout.write(`[hash-chain] OK ${path.basename(streamPath)} — chain already consistent\n`);
      continue;
    }

    // Atomic write via .tmp then rename
    const tmpPath = streamPath + '.tmp';
    try {
      const content = updated_records.map(r => JSON.stringify(r)).join('\n') + '\n';
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.renameSync(tmpPath, streamPath);
      totalUpdated += updated;
      process.stdout.write(
        `[hash-chain] UPDATED ${path.basename(streamPath)} — ${updated} record(s) hashed\n`
      );
    } catch (err) {
      process.stderr.write(`[hash-chain] ERROR ${path.basename(streamPath)}: ${err}\n`);
      // Leave .tmp in place for inspection
    }
  }

  process.stdout.write(`[hash-chain] DONE — ${totalUpdated} total record(s) updated across all streams\n`);
}
