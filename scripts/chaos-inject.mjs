#!/usr/bin/env node
// @ts-check
/**
 * Wave-152 — Chaos Injection CAPSTONE Harness
 *
 * Validates 5 defense scenarios (I-1 to I-5) spanning waves 145, 154, 157, 148, 146.
 * Architecture: steady-state hypothesis, inject, assert, cleanup per scenario.
 * ALL injections target docs/audits/chaos-test-stream.jsonl or temp files.
 * DENY_LIST of 9 production streams is checked as write-argument guard.
 * Production stream line-counts are snapshotted pre/post to detect side-effect writes.
 *
 * Exit codes:
 *   0 — all 5 scenarios PASS + production streams unchanged
 *   1 — any scenario FAIL or production stream corrupted (itemized gap report)
 *
 * Usage:
 *   node scripts/chaos-inject.mjs
 *   npm run chaos:test
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

import { readAndonConfig } from './andon-halt-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── DENY_LIST — 9 production streams that the harness MUST NOT write to ──────
const DENY_LIST = new Set([
  'docs/audits/halt-events.jsonl',
  'docs/audits/cross-line-verdicts.jsonl',
  'docs/audits/checklist-runs.jsonl',
  'docs/audits/agent-events.jsonl',
  'docs/audits/recurrence-events.jsonl',
  'docs/audits/drift-events.jsonl',
  'docs/audits/strengthen-events.jsonl',
  'docs/audits/memory-events.jsonl',
  'docs/audits/slo-events.jsonl',
]);

// ── Chaos write target ────────────────────────────────────────────────────────
const CHAOS_STREAM = path.join(ROOT, 'docs', 'audits', 'chaos-test-stream.jsonl');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @param {string} msg */
function log(msg) {
  process.stdout.write(`[chaos-inject] ${msg}\n`);
}

/**
 * Count non-empty lines in a file. Returns 0 if absent.
 * @param {string} filePath absolute path
 * @returns {number}
 */
function countLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Verify that a write path does not appear in the DENY_LIST.
 * Exits 1 immediately if a match is found.
 * @param {string} writePath relative path (from ROOT) or absolute
 */
function assertNotDenied(writePath) {
  const rel = path.isAbsolute(writePath)
    ? path.relative(ROOT, writePath)
    : writePath;
  if (DENY_LIST.has(rel)) {
    process.stderr.write(
      `[chaos-inject] FATAL: attempted write to DENY_LIST stream: ${rel}\n`
    );
    process.exit(1);
  }
}

/**
 * Truncate chaos-test-stream.jsonl to zero bytes.
 */
function truncateChaosStream() {
  if (fs.existsSync(CHAOS_STREAM)) {
    fs.truncateSync(CHAOS_STREAM, 0);
  }
}

/**
 * Remove .sdd-halt-state.json unconditionally (force: true).
 */
function cleanHaltState() {
  fs.rmSync(path.join(ROOT, '.sdd-halt-state.json'), { force: true });
  fs.rmSync(path.join(ROOT, '.sdd-halt-state.json.tmp'), { force: true });
}

// ── Stream snapshot/restore helpers for scenarios that invoke scripts with ────
// ── side-effect writes to production streams ──────────────────────────────────

/**
 * Save file content (or null if absent) for later restoration.
 * @param {string} filePath absolute path
 * @returns {Buffer | null}
 */
function saveStream(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Restore a file to previously saved content, or remove it if it was absent.
 * @param {string} filePath absolute path
 * @param {Buffer | null} saved
 */
function restoreStream(filePath, saved) {
  try {
    if (saved === null) {
      fs.rmSync(filePath, { force: true });
    } else {
      fs.writeFileSync(filePath, saved);
    }
  } catch (err) {
    process.stderr.write(`[chaos-inject] WARN: restore failed for ${filePath}: ${err}\n`);
  }
}

// ── Pre-flight ────────────────────────────────────────────────────────────────

/**
 * Pre-flight guard: read config and exit if hard-block flags are active.
 * A8: exits with warning if hardBlockEnabled or autoActionEnabled is true.
 */
function preFlightConfigGuard() {
  const andon = readAndonConfig();

  let sloHardBlock = false;
  let autoActionEnabled = false;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '.sdd-config.json'), 'utf8'));
    sloHardBlock = Boolean(raw?.sloMonitoring?.hardBlockEnabled);
    autoActionEnabled = Boolean(raw?.recurrenceDetection?.autoActionEnabled);
  } catch {
    // defaults: false
  }

  if (andon.hardBlockEnabled || sloHardBlock || autoActionEnabled) {
    process.stderr.write(
      '[chaos-inject] PRE-FLIGHT WARN: hard-block flags active — chaos tests must run in soft mode.\n' +
      `  andonCord.hardBlockEnabled=${andon.hardBlockEnabled}\n` +
      `  sloMonitoring.hardBlockEnabled=${sloHardBlock}\n` +
      `  recurrenceDetection.autoActionEnabled=${autoActionEnabled}\n` +
      'Set all three to false in .sdd-config.json before running chaos tests.\n'
    );
    process.exit(1);
  }

  log('PRE-FLIGHT config guard: OK (all hard-block flags are soft-mode)');
}

/**
 * Snapshot line-counts for all 9 DENY_LIST production streams.
 * @returns {Map<string, number>}
 */
function snapshotStreamLengths() {
  const snapshot = new Map();
  for (const rel of DENY_LIST) {
    snapshot.set(rel, countLines(path.join(ROOT, rel)));
  }
  return snapshot;
}

/**
 * Post-flight check: compare current line-counts to the pre-flight snapshot.
 * Exits 1 and identifies changed streams if any differ. [A7]
 * @param {Map<string, number>} before
 */
function postFlightStreamCheck(before) {
  const changed = [];
  for (const [rel, beforeCount] of before) {
    const afterCount = countLines(path.join(ROOT, rel));
    if (afterCount !== beforeCount) {
      changed.push({ stream: rel, before: beforeCount, after: afterCount });
    }
  }
  if (changed.length > 0) {
    process.stderr.write('[chaos-inject] POST-FLIGHT FAIL: production streams modified during test run:\n');
    for (const { stream, before, after } of changed) {
      process.stderr.write(`  ${stream}: ${before} -> ${after} lines\n`);
    }
    process.exit(1);
  }
  log('POST-FLIGHT stream integrity: OK (all 9 production streams unchanged)');
}

// ── Ensure chaos-test-stream.jsonl exists ─────────────────────────────────────
function ensureChaosStream() {
  assertNotDenied(path.relative(ROOT, CHAOS_STREAM));
  if (!fs.existsSync(CHAOS_STREAM)) {
    fs.mkdirSync(path.dirname(CHAOS_STREAM), { recursive: true });
    fs.writeFileSync(CHAOS_STREAM, '', 'utf8');
    log('Created docs/audits/chaos-test-stream.jsonl');
  }
}

// ── Scenario runner ───────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string; pass: boolean; expected: string; received: string }} ScenarioResult
 */

/** @type {ScenarioResult[]} */
const results = [];

/**
 * Run a single scenario with try/finally cleanup.
 * @param {string} name e.g. "I-1"
 * @param {() => string} runFn returns the combined output string for assertion
 * @param {string} expectedToken token that must appear in the output
 * @param {() => void} cleanupFn called in finally (always)
 */
function runScenario(name, runFn, expectedToken, cleanupFn) {
  let output = '';
  let passed = false;
  try {
    output = runFn();
    passed = output.includes(expectedToken);
    if (passed) {
      log(`[${name}] PASS — token "${expectedToken}" found`);
    } else {
      process.stderr.write(`[chaos-inject] [${name}] FAIL — expected "${expectedToken}" not found\n`);
      process.stderr.write(`  Output snippet: ${output.slice(0, 300)}\n`);
    }
  } catch (err) {
    process.stderr.write(`[chaos-inject] [${name}] FAIL — exception: ${err}\n`);
    output = String(err);
    passed = false;
  } finally {
    try {
      cleanupFn();
    } catch (cleanupErr) {
      process.stderr.write(`[chaos-inject] [${name}] cleanup error: ${cleanupErr}\n`);
    }
    truncateChaosStream();
    cleanHaltState();
  }
  results.push({ name, pass: passed, expected: expectedToken, received: output.slice(0, 200) });
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO I-1: audit-meta-process retro injection (wave-145 defense)
// ═════════════════════════════════════════════════════════════════════════════
//
// hypothesis: audit-meta-process.mjs emits REGRESSION_DETECTED when the anti-pattern
//   slug "partial-closure-via-documentation" appears in 2+ retros within the last-5 window.
//
// pre_state: docs/retros/ contains real wave retros; no __chaos__ prefixed files.
//   halt-events.jsonl and agent-events.jsonl at baseline.
//
// inject: copy I-1-retro.md fixture twice into docs/retros/ under __chaos__ prefixed names,
//   giving them recent mtimes so they rank in the last-5 scan.
//
// post_state: audit-meta-process.mjs stdout includes "REGRESSION_DETECTED".
//   halt-events.jsonl and agent-events.jsonl restored to pre-scenario content
//   (audit-meta-process calls writeHaltState + emitTelemetry as expected side-effects
//   of the defense firing; cleanup restores them for post-flight DENY_LIST integrity check).
//
// cleanup: remove both __chaos__ retro files; restore halt-events and agent-events.
//
// ─────────────────────────────────────────────────────────────────────────────
function scenarioI1() {
  const fixtureSource = path.join(__dirname, 'chaos-fixtures', 'I-1-retro.md');
  const retro1 = path.join(ROOT, 'docs', 'retros', 'wave-__chaos__-x1.md');
  const retro2 = path.join(ROOT, 'docs', 'retros', 'wave-__chaos__-x2.md');
  const haltEventsPath = path.join(ROOT, 'docs', 'audits', 'halt-events.jsonl');
  const agentEventsPath = path.join(ROOT, 'docs', 'audits', 'agent-events.jsonl');

  let savedHaltEvents = null;
  let savedAgentEvents = null;

  runScenario(
    'I-1',
    () => {
      // Save production streams that audit-meta-process.mjs writes to when defense fires
      savedHaltEvents = saveStream(haltEventsPath);
      savedAgentEvents = saveStream(agentEventsPath);

      // Inject: write two retro copies with the slug
      const content = fs.readFileSync(fixtureSource, 'utf8');
      fs.writeFileSync(retro1, content, 'utf8');
      fs.writeFileSync(retro2, content, 'utf8');

      // Invoke: run audit-meta-process.mjs (reads docs/retros/)
      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, 'audit-meta-process.mjs')],
        { cwd: ROOT, encoding: 'utf8', timeout: 15000 }
      );
      return (result.stdout ?? '') + (result.stderr ?? '');
    },
    'REGRESSION_DETECTED',
    () => {
      fs.rmSync(retro1, { force: true });
      fs.rmSync(retro2, { force: true });
      // Restore production streams to pre-scenario state
      restoreStream(haltEventsPath, savedHaltEvents);
      restoreStream(agentEventsPath, savedAgentEvents);
    }
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO I-2: detect-drift DR1 spec-frontmatter injection (wave-157 defense)
// ═════════════════════════════════════════════════════════════════════════════
//
// hypothesis: detect-drift.mjs emits a DR1 block event when run in --comprehensive
//   --dry-run mode against a spec with a missing required YAML frontmatter field
//   ("version" is absent from the fixture).
//
// pre_state: docs/specs/ contains real wave specs; no __chaos_test_spec__.md.
//
// inject: write I-2-spec.md fixture to docs/specs/__chaos_test_spec__.md.
//   The fixture has status: Shipped but is missing "version" — DR1 fires.
//
// post_state: detect-drift.mjs stdout or stderr includes "DR1".
//
// cleanup: remove docs/specs/__chaos_test_spec__.md.
//
// ─────────────────────────────────────────────────────────────────────────────
function scenarioI2() {
  const fixtureSource = path.join(__dirname, 'chaos-fixtures', 'I-2-spec.md');
  const tempSpec = path.join(ROOT, 'docs', 'specs', '__chaos_test_spec__.md');

  runScenario(
    'I-2',
    () => {
      // Inject: write fixture spec into docs/specs/ so it gets picked up by collectShippedSpecs
      const content = fs.readFileSync(fixtureSource, 'utf8');
      fs.writeFileSync(tempSpec, content, 'utf8');

      // Invoke: comprehensive + dry-run (exits 0, prints events to stdout, does not write JSONL)
      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, 'detect-drift.mjs'), '--comprehensive', '--dry-run'],
        { cwd: ROOT, encoding: 'utf8', timeout: 30000 }
      );
      return (result.stdout ?? '') + (result.stderr ?? '');
    },
    'DR1',
    () => {
      fs.rmSync(tempSpec, { force: true });
    }
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO I-3: check-cross-line-dispatch cross-line WARN (wave-154 defense)
// ═════════════════════════════════════════════════════════════════════════════
//
// hypothesis: check-cross-line-dispatch.mjs emits WARN for a First-line caller
//   dispatching to a Second-line callee with no override (soft-trial mode).
//
// pre_state: .sdd-config.json has crossLineBlock.hardBlockEnabled: false (soft mode).
//   cross-line-verdicts.jsonl and agent-events.jsonl at baseline length.
//
// inject: spawnSync check-cross-line-dispatch.mjs with
//   --caller frontend-agent --callee "Self-Improvement Reviewer".
//   Script writes one WARN record to cross-line-verdicts.jsonl (expected side-effect).
//
// post_state: combined stdout+stderr includes "WARN" (soft-trial cross-line signal).
//   cross-line-verdicts.jsonl and agent-events.jsonl restored to pre-scenario content.
//
// cleanup: restore cross-line-verdicts.jsonl and agent-events.jsonl to saved content.
//
// ─────────────────────────────────────────────────────────────────────────────
function scenarioI3() {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'chaos-fixtures', 'I-3-dispatch-event.json'), 'utf8')
  );

  const verdictsPath = path.join(ROOT, 'docs', 'audits', 'cross-line-verdicts.jsonl');
  const agentEventsPath = path.join(ROOT, 'docs', 'audits', 'agent-events.jsonl');

  // Save both streams before injection (restoration happens in cleanup)
  let savedVerdicts = null;
  let savedAgentEvents = null;

  runScenario(
    'I-3',
    () => {
      // Save pre-scenario content for cleanup
      savedVerdicts = saveStream(verdictsPath);
      savedAgentEvents = saveStream(agentEventsPath);

      // Invoke: spawnSync with First-line caller -> Second-line callee, no override
      const result = spawnSync(
        process.execPath,
        [
          path.join(__dirname, 'check-cross-line-dispatch.mjs'),
          '--caller', fixture.callerAgent,
          '--callee', fixture.calleeAgent,
        ],
        { cwd: ROOT, encoding: 'utf8', timeout: 10000 }
      );
      return (result.stdout ?? '') + (result.stderr ?? '');
    },
    'WARN',
    () => {
      // Restore UNCONDITIONALLY. restoreStream(path, null) REMOVES a stream that was absent
      // pre-scenario — that is the cleanup for the record check-cross-line-dispatch writes. The old
      // `if (saved !== null)` guard SKIPPED restore in a clean checkout (stream absent → saved=null),
      // leaking the created cross-line-verdicts.jsonl → post-flight saw 0->1 and FAILED. This only
      // bit a fresh checkout (CI), which is why it passed locally where the stream already existed.
      restoreStream(verdictsPath, savedVerdicts);
      restoreStream(agentEventsPath, savedAgentEvents);
    }
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO I-4: detect-recurrences AUTO-ACTION injection (wave-148 defense)
// ═════════════════════════════════════════════════════════════════════════════
//
// hypothesis: detect-recurrences.mjs emits AUTO-ACTION when the checklist-runs stream
//   contains 6 BLOCK records sharing "partial-closure-via-documentation" slug
//   across 3 distinct wave IDs within a 24h window.
//
// pre_state: checklist-runs.jsonl at baseline; chaos-test-stream.jsonl empty.
//   recurrenceDetection.autoActionEnabled: false (dry-run mode prevents halt).
//
// inject: write 6 timestamped fixture records to checklist-runs.jsonl (temporarily).
//   Run detect-recurrences.mjs --dry-run.
//
// post_state: detect-recurrences.mjs stdout includes "AUTO-ACTION".
//   checklist-runs.jsonl restored to pre-scenario content.
//
// cleanup: restore checklist-runs.jsonl to saved content.
//
// ─────────────────────────────────────────────────────────────────────────────
function scenarioI4() {
  const fixtureRecords = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'chaos-fixtures', 'I-4-checklist-runs.json'), 'utf8')
  );
  const checklistPath = path.join(ROOT, 'docs', 'audits', 'checklist-runs.jsonl');

  let savedChecklist = null;

  runScenario(
    'I-4',
    () => {
      // Save pre-scenario content
      savedChecklist = saveStream(checklistPath);

      // Stamp live timestamps (within 24h) and write to checklist-runs.jsonl
      const now = Date.now();
      const lines = fixtureRecords.map((/** @type {Record<string,unknown>} */ rec) => {
        const ts = new Date(now - (/** @type {number} */ (rec.offset_seconds_ago)) * 1000).toISOString();
        return JSON.stringify({
          event_type: rec.event_type,
          verdict: rec.verdict,
          anti_pattern_slug: rec.anti_pattern_slug,
          wave: rec.wave,
          agent: rec.agent,
          timestamp: ts,
          time: ts,
        });
      });
      fs.writeFileSync(checklistPath, lines.join('\n') + '\n', 'utf8');

      // Invoke: --dry-run prevents writing to recurrence-events.jsonl
      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, 'detect-recurrences.mjs'), '--dry-run'],
        { cwd: ROOT, encoding: 'utf8', timeout: 15000 }
      );
      return (result.stdout ?? '') + (result.stderr ?? '');
    },
    'AUTO-ACTION',
    () => {
      restoreStream(checklistPath, savedChecklist);
    }
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO I-5: compute-slos SLO-1 EXHAUSTED injection (wave-146 defense)
// ═════════════════════════════════════════════════════════════════════════════
//
// hypothesis: compute-slos.mjs emits EXHAUSTED to stderr for SLO-1 when the
//   agent-events stream contains 4 REGRESSION_DETECTED records within 7 days
//   (budget_7d = 3, so burn_rate = 4/3 = 1.33 >= 1.0).
//
// pre_state: agent-events.jsonl at baseline; slo-events.jsonl at baseline.
//   sloMonitoring.hardBlockEnabled: false (prevents halt on EXHAUSTED).
//
// inject: write 4 timestamped REGRESSION_DETECTED records to agent-events.jsonl.
//   Run compute-slos.mjs (reads slo-definitions.json, evaluates SLO-1).
//
// post_state: compute-slos.mjs stderr includes "EXHAUSTED".
//   agent-events.jsonl and slo-events.jsonl restored to pre-scenario content.
//
// cleanup: restore agent-events.jsonl and slo-events.jsonl to saved content.
//
// ─────────────────────────────────────────────────────────────────────────────
function scenarioI5() {
  const fixtureRecords = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'chaos-fixtures', 'I-5-slo-events.json'), 'utf8')
  );
  const agentEventsPath = path.join(ROOT, 'docs', 'audits', 'agent-events.jsonl');
  const sloEventsPath = path.join(ROOT, 'docs', 'audits', 'slo-events.jsonl');

  let savedAgentEvents = null;
  let savedSloEvents = null;

  runScenario(
    'I-5',
    () => {
      // Save pre-scenario content
      savedAgentEvents = saveStream(agentEventsPath);
      savedSloEvents = saveStream(sloEventsPath);

      // Stamp live timestamps (within 7 days) and write to agent-events.jsonl
      const now = Date.now();
      const lines = fixtureRecords.map((/** @type {Record<string,unknown>} */ rec) => {
        const ts = new Date(now - (/** @type {number} */ (rec.offset_seconds_ago)) * 1000).toISOString();
        return JSON.stringify({
          verdict: rec.verdict,
          event_type: rec.event_type,
          wave: rec.wave,
          agent: rec.agent,
          timestamp: ts,
          time: ts,
        });
      });
      fs.writeFileSync(agentEventsPath, lines.join('\n') + '\n', 'utf8');

      // Invoke: compute-slos reads agent-events.jsonl for SLO-1
      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, 'compute-slos.mjs')],
        { cwd: ROOT, encoding: 'utf8', timeout: 15000 }
      );
      return (result.stdout ?? '') + (result.stderr ?? '');
    },
    'EXHAUSTED',
    () => {
      restoreStream(agentEventsPath, savedAgentEvents);
      restoreStream(sloEventsPath, savedSloEvents);
    }
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  log('=== Wave-152 Chaos Injection CAPSTONE ===');

  // Pre-flight: config guard [A8]
  preFlightConfigGuard();

  // Pre-flight: snapshot production stream lengths [A7]
  const streamsBefore = snapshotStreamLengths();
  log(`Pre-flight stream snapshot: ${[...streamsBefore.entries()].map(([k, v]) => `${k}:${v}`).join(', ')}`);

  // Ensure write target exists [T1]
  ensureChaosStream();

  // Run all 5 scenarios
  scenarioI1();
  scenarioI2();
  scenarioI3();
  scenarioI4();
  scenarioI5();

  // Post-flight: verify production streams unchanged [A7]
  postFlightStreamCheck(streamsBefore);

  // AND-logic result gate [A6, A10]
  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass);

  if (failed.length === 0) {
    log(`CHAOS CAPSTONE: 5/5 scenarios PASSED`);
    process.stdout.write('CHAOS CAPSTONE: 5/5 scenarios PASSED\n');
    process.exit(0);
  } else {
    process.stderr.write('\n[chaos-inject] === CHAOS CAPSTONE GAP REPORT ===\n');
    process.stderr.write(`  PASSED: ${passed.map((r) => r.name).join(', ') || 'none'}\n`);
    process.stderr.write(`  FAILED: ${failed.map((r) => r.name).join(', ')}\n`);
    for (const f of failed) {
      process.stderr.write(`  [${f.name}] expected token "${f.expected}" not found in output:\n`);
      process.stderr.write(`    ${f.received.trim().replace(/\n/g, '\n    ')}\n`);
    }
    process.stderr.write(`  Result: ${passed.length}/5 scenarios PASSED\n`);
    process.exit(1);
  }
}

main();
