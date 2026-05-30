#!/usr/bin/env node
// @ts-check
/**
 * Wave-158 — Andon Cord halt-state helpers
 *
 * Shared by all 9 halt-authority agents:
 *   test-runner, coverage-auditor, a11y-auditor, security-scanner,
 *   constitutional-reviewer, debate-judge, meta-process-auditor,
 *   proactive-surfacing-agent (blocking severity only), pfca-agent
 *
 * Canonical source for this list: docs/governance/raci.json halt-gate responsible[]
 *
 * Exit codes:
 *   42 — halted, awaiting human resume via `node scripts/andon-resume.mjs`
 *
 * Atomic write pattern: write .sdd-halt-state.json.tmp, then rename to
 * .sdd-halt-state.json to prevent partial-write corruption under parallel halts.
 * Last writer wins on `active`; additional halts append to `queue`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTelemetry } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HALT_STATE_PATH = path.join(ROOT, '.sdd-halt-state.json');
const HALT_STATE_TMP = HALT_STATE_PATH + '.tmp';
const HALT_EVENTS_PATH = path.join(ROOT, 'docs/audits/halt-events.jsonl');
const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');

/**
 * Read and parse the current halt-state file.
 * Returns null if no halt-state file exists.
 * @returns {{ active: object | null, queue: object[] } | null}
 */
export function readHaltState() {
  if (!fs.existsSync(HALT_STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(HALT_STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Read andonCord config flags from .sdd-config.json.
 * Returns defaults if config is missing or malformed.
 * @returns {{ enabled: boolean, hardBlockEnabled: boolean }}
 */
export function readAndonConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return {
      enabled: Boolean(raw?.andonCord?.enabled),
      hardBlockEnabled: Boolean(raw?.andonCord?.hardBlockEnabled),
    };
  } catch {
    return { enabled: false, hardBlockEnabled: false };
  }
}

/**
 * Append a record to docs/audits/halt-events.jsonl (append-only).
 * Creates the file with a header comment if it does not exist.
 * NEVER calls writeFileSync/truncate/unlink on halt-events.jsonl.
 * @param {object} record
 */
function appendHaltEvent(record) {
  fs.mkdirSync(path.dirname(HALT_EVENTS_PATH), { recursive: true });
  // Wave-147: removed # comment seeder — sidecar docs/audits/halt-events.jsonl.md replaces the header prose.
  fs.appendFileSync(HALT_EVENTS_PATH, JSON.stringify(record) + '\n', 'utf8');

  // Wave-147 co-emit: also write to unified telemetry stream (T2 wiring)
  const eventType = (record.event || 'halt').toLowerCase().replace('_', '').replace('halt', 'halt').replace('resume', 'resume').replace('forcedresume', 'forced_resume');
  // Normalise event string to canonical event_type
  const canonicalType = record.event === 'FORCED_RESUME' ? 'forced_resume'
    : record.event === 'RESUME' ? 'resume'
    : 'halt';
  emitTelemetry(canonicalType, {
    source: 'scripts/andon-halt-helpers.mjs',
    wave: record.wave ?? 'wave-unknown',
    agent: record.agent ?? 'unknown',
    verdict: record.event ?? null,
    payload: {
      approver: record.approver ?? null,
      rootCause: record.rootCause ?? null,
      principle: null,
      override: false,
      pii_possible: true, // reason field may contain PII (wave-165 redaction)
      reason: record.reason ?? null,
      exitCode: record.exitCode ?? null,
    },
  });
}

/**
 * Write the halt-state sentinel file using atomic temp-file-then-rename.
 * If an active halt already exists, the new halt is appended to queue.
 * Appends a HALT record to halt-events.jsonl.
 * Then exits the process with code 42.
 *
 * @param {string} wave          - e.g. "wave-158"
 * @param {string} agent         - e.g. "constitutional-reviewer"
 * @param {string} reason        - human-readable reason for the halt
 * @param {string|null} [runbook] - wave-171: optional path to the runbook that covers this
 *                                  halt type, e.g. "docs/runbooks/incident-response.md".
 *                                  Defaults to null. Existing 3-arg callers are unaffected.
 */
export function writeHaltState(wave, agent, reason, runbook = null) {
  const { enabled } = readAndonConfig();
  const timestamp = new Date().toISOString();

  const newHalt = {
    haltedAt: timestamp,
    wave,
    agent,
    reason,
    exitCode: 42,
  };

  // Read existing state (if any) to handle queue semantics
  let current = readHaltState();

  let nextState;
  if (current && current.active) {
    // Active halt exists — append new halt to queue (D3)
    nextState = {
      active: current.active,
      queue: [...(current.queue || []), newHalt],
    };
  } else {
    nextState = { active: newHalt, queue: [] };
  }

  // Atomic write via temp file (§9 risk row 3)
  fs.writeFileSync(HALT_STATE_TMP, JSON.stringify(nextState, null, 2), 'utf8');
  fs.renameSync(HALT_STATE_TMP, HALT_STATE_PATH);

  // Append HALT record (append-only — no writeFileSync/truncate/unlink on halt-events)
  // wave-171: runbook field added (null for 3-arg callers; path string for 4-arg callers).
  appendHaltEvent({
    timestamp,
    event: 'HALT',
    wave,
    agent,
    reason,
    approver: null,
    rootCause: null,
    exitCode: 42,
    runbook: runbook ?? null,
  });

  // A8 soft-mode warning
  if (!enabled) {
    process.stderr.write(
      `[andon] WARN — andon soft mode (andonCord.enabled: false). Halt state written but pipeline gates will not block.\n`
    );
  }

  process.stderr.write(
    `[andon] HALT — wave=${wave} agent=${agent}\n` +
    `  reason: ${reason}\n` +
    `  resume: node scripts/andon-resume.mjs --wave ${wave} --approver <name> --reason <text> --root-cause <annotation>\n`
  );

  process.exit(42);
}
