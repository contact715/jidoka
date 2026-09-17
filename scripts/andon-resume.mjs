#!/usr/bin/env node
// @ts-check
/**
 * Wave-158 — Andon Cord resume command
 *
 * Clears an active halt state after human review and annotation.
 * Required fields prevent click-through "x" responses and seed the annotation corpus.
 *
 * Usage:
 *   node scripts/andon-resume.mjs --wave <id> --approver <name> --reason <text> --root-cause <annotation>
 *   node scripts/andon-resume.mjs --force-clear   # emergency escape — skips field validation
 *
 * Exit codes:
 *   0  — halt cleared successfully
 *   1  — validation failure or missing halt state
 *   2  — invalid call (unknown flag, stray word, flag without value) — nothing read or written
 *
 * Append-only: this script ONLY calls appendFileSync on halt-events.jsonl.
 * It never calls writeFileSync, truncate, or unlink on halt-events.jsonl.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTelemetry } from './emit-telemetry.mjs';
import { runCli } from './lib/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HALT_STATE_PATH = path.join(ROOT, '.sdd-halt-state.json');
const HALT_STATE_TMP = HALT_STATE_PATH + '.tmp';
const HALT_EVENTS_PATH = path.join(ROOT, 'docs/audits/halt-events.jsonl');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function info(msg) {
  process.stdout.write(`[andon-resume] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[andon-resume] ERROR: ${msg}\n`);
  process.exit(1);
}

/**
 * Append a record to docs/audits/halt-events.jsonl (append-only).
 * NEVER calls writeFileSync/truncate/unlink on halt-events.jsonl.
 * Wave-147: removed # comment seeder; co-emits via emitTelemetry().
 * @param {object} record
 */
function appendHaltEvent(record) {
  fs.mkdirSync(path.dirname(HALT_EVENTS_PATH), { recursive: true });
  // Wave-147: removed # comment seeder — sidecar docs/audits/halt-events.jsonl.md replaces the header prose.
  fs.appendFileSync(HALT_EVENTS_PATH, JSON.stringify(record) + '\n', 'utf8');

  // Wave-147 co-emit: write to unified telemetry stream (T2 wiring)
  const canonicalType = record.event === 'FORCED_RESUME' ? 'forced_resume'
    : record.event === 'RESUME' ? 'resume'
    : 'halt';
  emitTelemetry(canonicalType, {
    source: 'scripts/andon-resume.mjs',
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
 * Validate that a field value is a non-empty string of at least minLen characters.
 * @param {string} name
 * @param {string | boolean | undefined} value
 * @param {number} minLen
 */
function validateField(name, value, minLen) {
  if (typeof value !== 'string' || value.trim().length < minLen) {
    fail(
      `--${name} is required and must be at least ${minLen} characters.\n` +
      `  Current value: ${JSON.stringify(value ?? null)}\n` +
      `  Review docs/audits/halt-events.jsonl for context on this halt.`
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Разбор строгий (2026-09-16): самодельный разбор молча пропускал незнакомые флаги и опечатки
// (`--root_cause` вместо `--root-cause`), а флаг без значения превращал в true. Теперь — код 2
// до чтения и записи состояния остановки.
export const CLI = {
  name: 'andon-resume',
  summary: 'Снять активную остановку конвейера (andon) после разбора человеком; поля обязательны, от 10 символов.',
  options: {
    wave: { type: 'string', value: 'id', desc: 'волна (по умолчанию — из состояния остановки)' },
    approver: { type: 'string', value: 'имя', desc: 'кто разрешил продолжить' },
    reason: { type: 'string', value: 'текст', desc: 'почему можно продолжать' },
    'root-cause': { type: 'string', value: 'текст', desc: 'первопричина остановки' },
    'force-clear': { type: 'boolean', desc: 'аварийный выход: снять без проверки полей (пишется как FORCED_RESUME)' },
  },
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const { values: flags } = runCli(CLI);
  const forceFlag = flags['force-clear'] === true;

  // ── Verify halt state exists ────────────────────────────────────────────────
  if (!fs.existsSync(HALT_STATE_PATH)) {
    info('No active halt state found (.sdd-halt-state.json does not exist). Nothing to resume.');
    process.exit(0);
  }

  let haltState;
  try {
    haltState = JSON.parse(fs.readFileSync(HALT_STATE_PATH, 'utf8'));
  } catch (err) {
    fail(`Could not parse .sdd-halt-state.json: ${err.message}`);
  }

  const activeHalt = haltState?.active;
  if (!activeHalt) {
    info('Halt state file exists but active is null. Cleaning up.');
    fs.unlinkSync(HALT_STATE_PATH);
    process.exit(0);
  }

  // ── Force-clear path (A9, D4) ───────────────────────────────────────────────
  if (forceFlag) {
    const ts = new Date().toISOString();
    appendHaltEvent({
      timestamp: ts,
      event: 'FORCED_RESUME',
      wave: activeHalt.wave ?? 'unknown',
      agent: activeHalt.agent ?? 'unknown',
      reason: 'force-clear flag used — field validation skipped',
      approver: null,
      rootCause: null,
      exitCode: null,
    });
    fs.unlinkSync(HALT_STATE_PATH);
    info('FORCED_RESUME logged. Halt state cleared.');
    process.exit(0);
  }

  // ── Field validation (T3 — min 10 chars each) ───────────────────────────────
  const approver = flags['approver'];
  const reason = flags['reason'];
  const rootCause = flags['root-cause'];

  validateField('approver', approver, 10);
  validateField('reason', reason, 10);
  validateField('root-cause', rootCause, 10);

  const wave = typeof flags['wave'] === 'string' ? flags['wave'] : (activeHalt.wave ?? 'unknown');
  const ts = new Date().toISOString();

  // ── Append RESUME record (append-only) ─────────────────────────────────────
  appendHaltEvent({
    timestamp: ts,
    event: 'RESUME',
    wave,
    agent: activeHalt.agent ?? 'unknown',
    reason: /** @type {string} */ (reason),
    approver: /** @type {string} */ (approver),
    rootCause: /** @type {string} */ (rootCause),
    exitCode: null,
  });

  // ── Promote queue or delete halt-state ──────────────────────────────────────
  const queue = haltState.queue ?? [];

  if (queue.length === 0) {
    // No queued halts — delete the sentinel file
    fs.unlinkSync(HALT_STATE_PATH);
    info(`RESUME — halt cleared. wave=${wave} approver=${approver}`);
  } else {
    // Promote queue[0] to active, preserve remaining queue
    const [nextActive, ...remainingQueue] = queue;
    const nextState = { active: nextActive, queue: remainingQueue };

    fs.writeFileSync(HALT_STATE_TMP, JSON.stringify(nextState, null, 2), 'utf8');
    fs.renameSync(HALT_STATE_TMP, HALT_STATE_PATH);

    info(
      `RESUME — active halt cleared. wave=${wave} approver=${approver}\n` +
      `  Next halt promoted from queue: agent=${nextActive.agent} wave=${nextActive.wave}\n` +
      `  Run this command again to address the queued halt.`
    );
  }

  process.exit(0);
}
