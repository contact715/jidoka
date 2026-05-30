#!/usr/bin/env node
// @ts-check
/**
 * Wave-148 — Art 9 Outcome Loop CLI
 *
 * Append an outcome record to docs/audits/recurrence-events.jsonl.
 * Mirrors the `scripts/surface-concerns.mjs --respond` pattern (wave-155).
 * Append-not-mutate: prior records are never modified.
 *
 * Usage:
 *   node scripts/respond-recurrence.mjs \
 *     --fingerprint <anti_pattern_slug::agent> \
 *     --outcome suppressed|investigated|resolved \
 *     --wave wave-NNN \
 *     --notes "<free text>"
 *
 * Exit codes:
 *   0  — outcome appended successfully
 *   1  — usage error or file not found
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJsonlStream, sanitizeField } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RECURRENCE_PATH = path.join(ROOT, 'docs', 'audits', 'recurrence-events.jsonl');

const VALID_OUTCOMES = new Set(['suppressed', 'investigated', 'resolved']);

// ── CLI argument parser ───────────────────────────────────────────────────

/**
 * @returns {{ fingerprint: string, outcome: string, wave: string, notes: string }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  /** @type {Record<string, string>} */
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      const key = args[i].slice(2);
      parsed[key] = args[i + 1];
      i++;
    }
  }

  return {
    fingerprint: parsed['fingerprint'] ?? '',
    outcome: parsed['outcome'] ?? '',
    wave: parsed['wave'] ?? '',
    notes: parsed['notes'] ?? '',
  };
}

// sanitizeField imported from emit-telemetry.mjs (wave-165 T7 consolidation)
// Local alias so existing call sites using `sanitize(val)` continue to work.
const sanitize = (/** @type {string} */ val) => /** @type {string} */ (sanitizeField(val));

// ── Main CLI function ─────────────────────────────────────────────────────

function main() {
  const args = parseArgs();

  // Usage validation
  if (!args.fingerprint || !args.outcome || !args.wave) {
    process.stderr.write(
      'Usage: node scripts/respond-recurrence.mjs \\\n' +
      '  --fingerprint <slug::agent> \\\n' +
      '  --outcome suppressed|investigated|resolved \\\n' +
      '  --wave wave-NNN \\\n' +
      '  --notes "<text>"\n'
    );
    process.exit(1);
  }

  if (!VALID_OUTCOMES.has(args.outcome)) {
    process.stderr.write(
      `[respond-recurrence] ERROR — invalid outcome "${args.outcome}". ` +
      `Must be one of: ${[...VALID_OUTCOMES].join(', ')}\n`
    );
    process.exit(1);
  }

  // Check file exists
  if (!fs.existsSync(RECURRENCE_PATH)) {
    process.stderr.write(
      '[respond-recurrence] ERROR — no recurrence records found. ' +
      `File does not exist: ${RECURRENCE_PATH}\n`
    );
    process.exit(1);
  }

  // Read existing records to find matching fingerprint
  const records = readJsonlStream(RECURRENCE_PATH);
  const matching = records.filter(r => r.fingerprint === args.fingerprint);

  if (matching.length === 0) {
    process.stderr.write(
      `[respond-recurrence] WARN — no records found for fingerprint "${args.fingerprint}". ` +
      `Appending outcome record anyway.\n`
    );
  }

  // Warn when overriding an existing non-pending outcome (per spec §17 risk row)
  const latest = matching.length > 0 ? matching[matching.length - 1] : null;
  if (latest && latest.outcome && latest.outcome !== 'pending') {
    process.stderr.write(
      `[respond-recurrence] WARN — outcome already set to "${latest.outcome}" for fingerprint ` +
      `"${args.fingerprint}" — appending override record.\n`
    );
  }

  // Compute prev_hash for the new record
  let prevHash = 'genesis';
  try {
    if (records.length > 0) {
      const last = records[records.length - 1];
      const chainActive = records.some(
        r => r.prev_hash !== null && r.prev_hash !== undefined
      );
      if (chainActive) {
        prevHash = 'sha256:' + crypto
          .createHash('sha256')
          .update(JSON.stringify(last))
          .digest('hex');
      }
    }
  } catch {
    prevHash = 'genesis';
  }

  // Build outcome record (append-not-mutate)
  const outcomeRecord = {
    timestamp: new Date().toISOString(),
    event: 'recurrence_outcome',
    fingerprint: sanitize(args.fingerprint),
    anti_pattern_slug: sanitize(args.fingerprint.split('::')[0] ?? args.fingerprint),
    agent: sanitize(args.fingerprint.split('::')[1] ?? 'unknown'),
    verdict: latest?.verdict ?? null,
    occurrence_count_24h: latest?.occurrence_count_24h ?? null,
    occurrence_count_6h: latest?.occurrence_count_6h ?? null,
    velocity: latest?.velocity ?? null,
    matched_event_ids: latest?.matched_event_ids ?? [],
    trace_ids: latest?.trace_ids ?? [],
    outcome: sanitize(args.outcome),
    resolution_wave: sanitize(args.wave),
    resolution_notes: sanitize(args.notes || ''),
    prev_hash: prevHash,
  };

  // Append-only write
  try {
    fs.mkdirSync(path.dirname(RECURRENCE_PATH), { recursive: true });
    fs.appendFileSync(RECURRENCE_PATH, JSON.stringify(outcomeRecord) + '\n', 'utf8');
    process.stdout.write(
      `[respond-recurrence] OK — outcome "${args.outcome}" recorded for "${args.fingerprint}" ` +
      `(wave: ${args.wave})\n`
    );
  } catch (err) {
    process.stderr.write(`[respond-recurrence] ERROR — failed to write outcome: ${err}\n`);
    process.exit(1);
  }
}

// ── CLI entrypoint guard ──────────────────────────────────────────────────
// Only run when executed directly, not when imported as a module.

const isDirectExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main();
}
