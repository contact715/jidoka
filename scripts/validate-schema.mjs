#!/usr/bin/env node
// @ts-check
/**
 * Wave-178 — Schema Conformance Validator
 *
 * Reads all 17 JSONL streams via readJsonlStream (emit-telemetry.mjs:369).
 * Classifies each record:
 *   LEGACY              — missing both schema_version AND id (pre-wave-147 flat format)
 *                         → WARN, counted but not a failure
 *   PASS                — schema_version:"1", all required envelope + payload fields present
 *   FAIL                — schema_version:"1" claimed but required fields missing
 *                         → exits 1
 *   SCHEMA_TBD          — event_type has schema_tbd:true in REGISTRY
 *                         → WARN (honest gap marker, not PASS, not FAIL)
 *   UNKNOWN             — schema_version:"1" but event_type not in REGISTRY
 *                         → treated as SCHEMA_TBD (WARN)
 *   LEGACY_TRANSITIONAL — id matches KNOWN_LEGACY_EXCEPTIONS in registry
 *                         → WARN (id-pinned documented exception; visible in TRANSITIONAL
 *                            column, NOT folded into PASS; excluded from coverage %)
 *                         → does NOT set anyFail; gate remains real for all other records
 *
 * Exception mechanism (wave-178 adjudication — mirrors wave-174 nosemgrep-with-justification):
 *   Records that claim schema_version:"1" but were emitted before the full wave-147 envelope
 *   was wired at their emit site, AND are hash-chained (cannot be mutated per anti-pattern #7),
 *   may be registered in KNOWN_LEGACY_EXCEPTIONS keyed by their record id. Each exception
 *   requires a documented justification string. The exception is auditable (visible in the
 *   TRANSITIONAL column), not silent. Adding a future exception requires a documented
 *   justification and does not mutate the record.
 *
 * Prints a conformance table per stream:
 *   stream | total | LEGACY | PASS | FAIL | TBD | TRANSITIONAL | coverage%
 *
 * Exit codes:
 *   0 — no FAIL records (LEGACY, SCHEMA_TBD, and LEGACY_TRANSITIONAL are WARN only)
 *   1 — one or more FAIL records found
 *
 * D7  constraint: NO hash-chain calls. Chain-integrity function is NOT called.
 *                 No chain hash comparison. Schema conformance is orthogonal.
 * D8  constraint: No telemetry emitted. No new JSONL stream created.
 * AC-10 evidence: grep for chain-integrity function names returns zero matches.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// AC-4: import readJsonlStream from emit-telemetry.mjs (REUSE, not re-implemented)
import { readJsonlStream } from './emit-telemetry.mjs';

// AC-1, D3: import REGISTRY + exception map from registry module (single source of truth)
import { REGISTRY, ENVELOPE_FIELDS, KNOWN_LEGACY_EXCEPTIONS } from './telemetry-schema-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Stream file list (all 17 streams — AC-13) ──────────────────────────────
// Mirrors ALL_STREAM_PATHS from emit-telemetry.mjs but is read-only here.
// Order matches emit-telemetry.mjs for parity.
const STREAMS = [
  { name: 'halt-events',           path: path.join(ROOT, 'docs', 'audits', 'halt-events.jsonl') },
  { name: 'cross-line-verdicts',   path: path.join(ROOT, 'docs', 'audits', 'cross-line-verdicts.jsonl') },
  { name: 'checklist-runs',        path: path.join(ROOT, 'docs', 'audits', 'checklist-runs.jsonl') },
  { name: 'agent-events',          path: path.join(ROOT, 'docs', 'audits', 'agent-events.jsonl') },
  { name: 'recurrence-events',     path: path.join(ROOT, 'docs', 'audits', 'recurrence-events.jsonl') },
  { name: 'drift-events',          path: path.join(ROOT, 'docs', 'audits', 'drift-events.jsonl') },
  { name: 'strengthen-events',     path: path.join(ROOT, 'docs', 'audits', 'strengthen-events.jsonl') },
  { name: 'memory-events',         path: path.join(ROOT, 'docs', 'audits', 'memory-events.jsonl') },
  { name: 'slo-events',            path: path.join(ROOT, 'docs', 'audits', 'slo-events.jsonl') },
  { name: 'halluc-events',         path: path.join(ROOT, 'docs', 'audits', 'halluc-events.jsonl') },
  { name: 'eval-events',           path: path.join(ROOT, 'docs', 'audits', 'eval-events.jsonl') },
  { name: 'security-events',       path: path.join(ROOT, 'docs', 'audits', 'security-events.jsonl') },
  { name: 'constitutional-events', path: path.join(ROOT, 'docs', 'audits', 'constitutional-events.jsonl') },
  { name: 'rfc-events',            path: path.join(ROOT, 'docs', 'audits', 'rfc-events.jsonl') },
  { name: 'dora-events',           path: path.join(ROOT, 'docs', 'audits', 'dora-events.jsonl') },
  { name: 'kg-events',             path: path.join(ROOT, 'docs', 'audits', 'kg-events.jsonl') },
  { name: 'cost-events',           path: path.join(ROOT, 'docs', 'audits', 'cost-events.jsonl') },
];

// ── Epoch classification ────────────────────────────────────────────────────

/**
 * Classify a single record into LEGACY | PASS | FAIL | SCHEMA_TBD | LEGACY_TRANSITIONAL.
 *
 * D4 (AC-5, AC-9): LEGACY detection is the FIRST check — it must fire before
 * any required-field validation to avoid mis-classifying historical artifacts.
 *
 * LEGACY rule (from spec §3):
 *   record has no schema_version AND no id field → LEGACY (pre-wave-147 flat)
 *
 * LEGACY_TRANSITIONAL rule (wave-178 exception mechanism):
 *   After the standard v1 envelope check produces FAIL, if the record's id is
 *   present in KNOWN_LEGACY_EXCEPTIONS, the verdict is downgraded to
 *   LEGACY_TRANSITIONAL (WARN). The FAIL path remains intact for every other id.
 *   LEGACY_TRANSITIONAL is counted in the TRANSITIONAL column — NOT in PASS —
 *   and is excluded from the coverage % denominator (same as LEGACY/TBD).
 *
 * @param {Record<string, unknown>} record
 * @param {number} lineNum  — 1-based line index within the stream
 * @param {string} streamName
 * @returns {{ verdict: 'LEGACY'|'PASS'|'FAIL'|'SCHEMA_TBD'|'LEGACY_TRANSITIONAL', missing?: string[] }}
 */
function classifyRecord(record, lineNum, streamName) {
  // D4, AC-5, AC-9 — LEGACY check FIRST (must precede all other checks)
  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(record, 'schema_version');
  const hasId = Object.prototype.hasOwnProperty.call(record, 'id');

  if (!hasSchemaVersion && !hasId) {
    // Pre-wave-147 flat format — LEGACY, not a schema failure
    return { verdict: 'LEGACY' };
  }

  // Only v1-claiming records are subject to schema validation
  if (record.schema_version !== '1') {
    // Has schema_version but not "1" — treat as LEGACY (unknown version, not v1)
    return { verdict: 'LEGACY' };
  }

  // Record claims schema_version:"1" — validate against REGISTRY
  const eventType = typeof record.event_type === 'string'
    ? record.event_type.toLowerCase()
    : null;

  const entry = eventType ? REGISTRY[eventType] : null;

  // AC-7, D5 — SCHEMA_TBD: registry entry exists but schema not yet declared
  if (entry && entry.schema_tbd === true) {
    return { verdict: 'SCHEMA_TBD' };
  }

  // UNKNOWN event_type (not in REGISTRY) — treat as SCHEMA_TBD (honest gap)
  if (!entry) {
    return { verdict: 'SCHEMA_TBD' };
  }

  // AC-6 — FAIL / PASS: check required envelope fields
  const missingFields = [];
  for (const field of ENVELOPE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      missingFields.push(field);
    }
  }

  // Check required payload fields
  const payload = record.payload;
  if (entry.required_payload.length > 0) {
    if (typeof payload !== 'object' || payload === null) {
      missingFields.push('payload (must be object)');
    } else {
      for (const pf of entry.required_payload) {
        if (!Object.prototype.hasOwnProperty.call(payload, pf)) {
          missingFields.push(`payload.${pf}`);
        }
      }
    }
  }

  if (missingFields.length > 0) {
    // Wave-178 exception mechanism: check KNOWN_LEGACY_EXCEPTIONS before returning FAIL.
    // Only fires when the standard v1 check has already produced a FAIL — the FAIL path
    // remains fully intact for every record whose id is NOT in the exception map.
    const recordId = typeof record.id === 'string' ? record.id : null;
    if (recordId && Object.prototype.hasOwnProperty.call(KNOWN_LEGACY_EXCEPTIONS, recordId)) {
      // Id-pinned documented exception: downgrade to LEGACY_TRANSITIONAL (WARN, not FAIL).
      // Does NOT set anyFail. Visible in TRANSITIONAL column, excluded from coverage %.
      return { verdict: 'LEGACY_TRANSITIONAL', missing: missingFields };
    }
    return { verdict: 'FAIL', missing: missingFields };
  }

  return { verdict: 'PASS' };
}

// ── Coverage % computation (AC-8) ─────────────────────────────────────────

/**
 * Compute conformance coverage %.
 * Formula (spec §7 AC-8): PASS / (total - LEGACY - SCHEMA_TBD - TRANSITIONAL) * 100
 * LEGACY_TRANSITIONAL records are excluded from both numerator and denominator —
 * counting them as PASS would overstate conformance (dishonest 100%).
 * Returns 'N/A (empty)' or 'N/A (all LEGACY/TBD)' when denominator is zero.
 *
 * @param {number} total
 * @param {number} legacy
 * @param {number} pass
 * @param {number} tbd
 * @param {number} transitional
 * @returns {string}
 */
function computeCoverage(total, legacy, pass, tbd, transitional) {
  const denominator = total - legacy - tbd - transitional;
  if (denominator <= 0) {
    if (total === 0) return 'N/A (empty)';
    return 'N/A (all LEGACY/TBD)';
  }
  const pct = (pass / denominator) * 100;
  return `${pct.toFixed(1)}%`;
}

// ── Main validation loop ────────────────────────────────────────────────────

function main() {
  /** @type {Array<{name:string,total:number,legacy:number,pass:number,fail:number,tbd:number,transitional:number,coverage:string}>} */
  const tableRows = [];
  const allFails = [];
  const allTransitionals = [];
  let anyFail = false;

  process.stdout.write('\n[schema] Wave-178 — Telemetry Schema Conformance Validator\n');
  process.stdout.write('[schema] Reading 17 streams...\n\n');

  for (const stream of STREAMS) {
    // readJsonlStream handles missing files (returns []) and strips # comment lines
    const records = readJsonlStream(stream.path);

    let legacy = 0;
    let pass = 0;
    let fail = 0;
    let tbd = 0;
    let transitional = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const lineNum = i + 1;
      const result = classifyRecord(record, lineNum, stream.name);

      switch (result.verdict) {
        case 'LEGACY':
          legacy++;
          break;
        case 'PASS':
          pass++;
          break;
        case 'FAIL':
          fail++;
          anyFail = true;
          // Collect for FAIL report
          allFails.push({
            stream: stream.name,
            line: lineNum,
            id: typeof record.id === 'string' ? record.id : '(missing)',
            event_type: record.event_type ?? '(missing)',
            missing: result.missing ?? [],
          });
          break;
        case 'SCHEMA_TBD':
          tbd++;
          break;
        case 'LEGACY_TRANSITIONAL':
          // Id-pinned documented exception (wave-178 exception mechanism).
          // Does NOT set anyFail — gate remains real for all other records.
          // Visible in TRANSITIONAL column; excluded from coverage % (not counted as PASS).
          transitional++;
          allTransitionals.push({
            stream: stream.name,
            line: lineNum,
            id: typeof record.id === 'string' ? record.id : '(missing)',
            event_type: record.event_type ?? '(missing)',
            missing: result.missing ?? [],
            justification: typeof record.id === 'string'
              ? KNOWN_LEGACY_EXCEPTIONS[record.id] ?? '(no justification found)'
              : '(no id)',
          });
          break;
      }
    }

    const total = records.length;
    const coverage = computeCoverage(total, legacy, pass, tbd, transitional);

    tableRows.push({ name: stream.name, total, legacy, pass, fail, tbd, transitional, coverage });

    // AC-5 (LEGACY WARN output) — print per-stream summary line
    if (legacy > 0) {
      process.stdout.write(
        `[schema] LEGACY  ${stream.name}: ${legacy}/${total} record(s) pre-wave-147 flat format (WARN, not FAIL)\n`
      );
    }
    if (tbd > 0) {
      process.stdout.write(
        `[schema] SCHEMA_TBD  ${stream.name}: ${tbd}/${total} record(s) — payload schema not yet declared (WARN)\n`
      );
    }
    if (transitional > 0) {
      process.stdout.write(
        `[schema] LEGACY_TRANSITIONAL  ${stream.name}: ${transitional}/${total} record(s) — id-pinned documented exception (WARN, not FAIL, not PASS)\n`
      );
    }
    if (fail > 0) {
      process.stdout.write(
        `[schema] FAIL  ${stream.name}: ${fail}/${total} record(s) claim schema_version:"1" but fail conformance\n`
      );
    }
  }

  // ── Print LEGACY_TRANSITIONAL details ──────────────────────────────────
  if (allTransitionals.length > 0) {
    process.stdout.write('\n[schema] LEGACY_TRANSITIONAL details (id-pinned documented exceptions):\n');
    for (const t of allTransitionals) {
      process.stdout.write(
        `[schema] LEGACY_TRANSITIONAL  stream=${t.stream}  line=${t.line}  id=${t.id}  event_type=${t.event_type}  missing=[${t.missing.join(', ')}]\n`
      );
      process.stdout.write(
        `[schema]   justification: ${t.justification}\n`
      );
    }
  }

  // ── Print FAIL details ──────────────────────────────────────────────────
  if (allFails.length > 0) {
    process.stdout.write('\n[schema] FAIL details:\n');
    for (const f of allFails) {
      process.stdout.write(
        `[schema] FAIL  stream=${f.stream}  line=${f.line}  id=${f.id}  event_type=${f.event_type}  missing=[${f.missing.join(', ')}]\n`
      );
    }
  }

  // ── Conformance table (AC-8) ────────────────────────────────────────────
  // TRANSITIONAL column is explicit — not folded into PASS.
  // Coverage % = PASS / (total - LEGACY - TBD - TRANSITIONAL) * 100.
  // Counting TRANSITIONAL as PASS would produce a dishonest 100%.
  process.stdout.write('\n[schema] Conformance coverage table:\n');
  process.stdout.write(
    padRight('Stream', 26) +
    padLeft('Total', 7) +
    padLeft('LEGACY', 8) +
    padLeft('PASS', 6) +
    padLeft('FAIL', 6) +
    padLeft('TBD', 6) +
    padLeft('TRANSIT', 9) +
    padLeft('Coverage%', 11) +
    '\n'
  );
  process.stdout.write('-'.repeat(79) + '\n');

  for (const row of tableRows) {
    process.stdout.write(
      padRight(row.name, 26) +
      padLeft(String(row.total), 7) +
      padLeft(String(row.legacy), 8) +
      padLeft(String(row.pass), 6) +
      padLeft(String(row.fail), 6) +
      padLeft(String(row.tbd), 6) +
      padLeft(String(row.transitional), 9) +
      padLeft(row.coverage, 11) +
      '\n'
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const totals = tableRows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      legacy: acc.legacy + r.legacy,
      pass: acc.pass + r.pass,
      fail: acc.fail + r.fail,
      tbd: acc.tbd + r.tbd,
      transitional: acc.transitional + r.transitional,
    }),
    { total: 0, legacy: 0, pass: 0, fail: 0, tbd: 0, transitional: 0 }
  );

  process.stdout.write('-'.repeat(79) + '\n');
  process.stdout.write(
    padRight('TOTAL', 26) +
    padLeft(String(totals.total), 7) +
    padLeft(String(totals.legacy), 8) +
    padLeft(String(totals.pass), 6) +
    padLeft(String(totals.fail), 6) +
    padLeft(String(totals.tbd), 6) +
    padLeft(String(totals.transitional), 9) +
    padLeft(computeCoverage(totals.total, totals.legacy, totals.pass, totals.tbd, totals.transitional), 11) +
    '\n'
  );

  process.stdout.write('\n');

  if (anyFail) {
    process.stdout.write(
      `[schema] RESULT: FAIL — ${allFails.length} record(s) claim schema_version:"1" but fail conformance check.\n`
    );
    process.stdout.write('[schema] Exit 1.\n');
    process.exit(1);
  } else {
    process.stdout.write('[schema] RESULT: PASS (no conformance failures). LEGACY, SCHEMA_TBD, and LEGACY_TRANSITIONAL records are WARN only.\n');
    process.stdout.write('[schema] Exit 0.\n');
    process.exit(0);
  }
}

// ── String formatting helpers ───────────────────────────────────────────────

/** @param {string} s @param {number} w @returns {string} */
function padRight(s, w) {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}

/** @param {string} s @param {number} w @returns {string} */
function padLeft(s, w) {
  // For coverage column: never truncate — allow overflow with trailing space
  if (s.length >= w) return s + ' ';
  return ' '.repeat(w - s.length) + s;
}

// ── Entrypoint ──────────────────────────────────────────────────────────────
main();
