#!/usr/bin/env node
/**
 * check-cross-line-dispatch.mjs — Wave-154 cross-line boundary enforcement.
 *
 * Reads the 30-agent line-assignment table from docs/AGENT_ROSTER.md and checks
 * whether a caller/callee pair violates IIA Three Lines boundaries. Writes every
 * verdict (BLOCK, WARN, PASS, LOG) to docs/audits/cross-line-verdicts.jsonl as an
 * append-only EU AI Act Article 14 audit artifact.
 *
 * Usage:
 *   node scripts/check-cross-line-dispatch.mjs --caller <agent> --callee <agent>
 *   node scripts/check-cross-line-dispatch.mjs --caller <agent> --callee <agent> \
 *     --override '{"approver":"platform-owner","reason":"emergency hotfix"}'
 *   node scripts/check-cross-line-dispatch.mjs --staged   (pre-commit mode)
 *   node scripts/check-cross-line-dispatch.mjs --help
 *
 * Exit codes:
 *   0  PASS — same-line or same-line-adjacent dispatch, or valid attributed override
 *   1  BLOCK — cross-line dispatch with no valid attributed override (hardBlockEnabled: true)
 *      WARN — cross-line dispatch in soft-trial mode (hardBlockEnabled: false), exits 0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTelemetry } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────
const ROSTER_PATH = path.join(ROOT, 'docs', 'AGENT_ROSTER.md');
const CONFIG_PATH = path.join(ROOT, '.sdd-config.json');
const VERDICTS_PATH = path.join(ROOT, 'docs', 'audits', 'cross-line-verdicts.jsonl');

// ── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
check-cross-line-dispatch.mjs — IIA Three Lines cross-boundary enforcement

Usage:
  node scripts/check-cross-line-dispatch.mjs --caller <agent> --callee <agent> [--override <JSON>]
  node scripts/check-cross-line-dispatch.mjs --staged   (pre-commit: checks staged ROSTER/agent diffs)

Exit codes:
  0  PASS or WARN (soft-trial mode)
  1  BLOCK (hardBlockEnabled: true + cross-line violation without valid override)
`);
  process.exit(0);
}

// ── Config ────────────────────────────────────────────────────────────────
function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    return {
      enabled: cfg.crossLineBlock?.enabled === true,
      hardBlockEnabled: cfg.crossLineBlock?.hardBlockEnabled === true,
    };
  } catch {
    return { enabled: false, hardBlockEnabled: false };
  }
}

// ── Roster parser ─────────────────────────────────────────────────────────
// Reads the 30-agent table from docs/AGENT_ROSTER.md (lines 34-65).
// Table format: | Agent | L-tier | Line: |
// Extracts each agent name and normalises the line value to: First|Second|Third|Support
function parseRoster() {
  const text = fs.readFileSync(ROSTER_PATH, 'utf8');
  const lines = text.split('\n');
  const roster = new Map(); // agent name (lowercase) -> line classification

  // Find the 30-agent table by looking for the header row
  let inTable = false;
  for (const line of lines) {
    if (line.includes('| Agent |') && line.includes('Line:')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      // Stop at next markdown heading or blank separator
      if (line.startsWith('#') || (line.startsWith('|') === false && line.trim() !== '' && !line.startsWith('|---'))) {
        break;
      }
      if (!line.startsWith('|') || line.startsWith('|---')) continue;

      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 3) continue;
      const agentName = cells[0];
      const lineValue = cells[2]; // e.g. "Line: First — Operations"

      let lineClass = 'unknown';
      if (lineValue.includes('First')) lineClass = 'First';
      else if (lineValue.includes('Second')) lineClass = 'Second';
      else if (lineValue.includes('Third')) lineClass = 'Third';
      else if (lineValue.includes('Pre-wave') || lineValue.includes('Support')) lineClass = 'Support';

      roster.set(agentName.toLowerCase(), { name: agentName, line: lineClass });
    }
  }
  return roster;
}

// ── Override validation ───────────────────────────────────────────────────
function parseOverride(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const approver = (obj.approver || '').trim();
    const reason = (obj.reason || '').trim();
    if (!approver || !reason) return null; // A3: empty approver or reason = invalid
    return { approver, reason };
  } catch {
    return null;
  }
}

// ── Verdict log ───────────────────────────────────────────────────────────
function appendVerdict(record) {
  // Ensure directory exists
  const dir = path.dirname(VERDICTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Append-only — never use writeFileSync on this file (A4)
  fs.appendFileSync(VERDICTS_PATH, JSON.stringify(record) + '\n', 'utf8');

  // Wave-147 co-emit: write to unified telemetry stream (T3 wiring)
  emitTelemetry('cross_line_verdict', {
    source: 'scripts/check-cross-line-dispatch.mjs',
    wave: record.wave ?? 'wave-unknown',
    agent: record.agent ?? 'unknown',
    verdict: record.verdict ?? null,
    payload: {
      approver: record.override?.approver ?? null,
      rootCause: null,
      principle: record.principle ?? null,
      override: record.override !== null,
      pii_possible: false,
      callerLine: record.callerLine ?? null,
      calleeLine: record.calleeLine ?? null,
    },
  });
}

function timestamp() {
  return new Date().toISOString();
}

// ── Cross-line check ──────────────────────────────────────────────────────
function isCrossLine(callerLine, calleeLine) {
  // A cross-line violation: First line dispatching to Second Line
  // (Second holds risk-compliance authority; First should not hold that authority)
  // Per spec: "Second Line agent receives write-tooling grants matching First Line scope"
  // Simplified check: First caller → Second callee, or Second caller → Third callee
  if (callerLine === 'First' && calleeLine === 'Second') return true;
  if (callerLine === 'Second' && calleeLine === 'Third') return true;
  // Third Line → any operative line also violates independence
  if (callerLine === 'Third' && (calleeLine === 'First' || calleeLine === 'Second')) return true;
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────
const cfg = readConfig();
const roster = parseRoster();

// --staged mode: check staged ROSTER/agent diffs (pre-commit path)
if (args.includes('--staged')) {
  // In staged mode we just verify the roster is parseable and config is present.
  // Actual per-dispatch enforcement happens at pipeline time.
  // This is the A7 guard path — only runs when ROSTER or .claude/agents/* staged.
  const agentCount = roster.size;
  if (agentCount === 0) {
    process.stderr.write('[cross-line] WARN: roster parse returned 0 agents — check AGENT_ROSTER.md\n');
    process.exit(0);
  }
  process.stdout.write(`[cross-line] staged check: roster loaded (${agentCount} agents), config ok\n`);
  process.exit(0);
}

// --caller / --callee mode
const callerIdx = args.indexOf('--caller');
const calleeIdx = args.indexOf('--callee');
const overrideIdx = args.indexOf('--override');

if (callerIdx === -1 || calleeIdx === -1) {
  process.stderr.write('[cross-line] ERROR: --caller and --callee are required\n');
  process.exit(1);
}

const callerName = args[callerIdx + 1];
const calleeName = args[calleeIdx + 1];
const overrideRaw = overrideIdx !== -1 ? args[overrideIdx + 1] : null;

const callerEntry = roster.get(callerName.toLowerCase());
const calleeEntry = roster.get(calleeName.toLowerCase());

if (!callerEntry) {
  process.stderr.write(`[cross-line] WARN: caller "${callerName}" not found in roster — check spelling\n`);
  process.exit(0);
}
if (!calleeEntry) {
  process.stderr.write(`[cross-line] WARN: callee "${calleeName}" not found in roster — check spelling\n`);
  process.exit(0);
}

const callerLine = callerEntry.line;
const calleeLine = calleeEntry.line;
const crossLine = isCrossLine(callerLine, calleeLine);

if (!crossLine) {
  // Same-line or non-violating pair — PASS
  const record = {
    timestamp: timestamp(),
    wave: 'wave-154',
    agent: calleeName,
    callerLine,
    calleeLine,
    verdict: 'PASS',
    principle: 'IIA Three Lines Model 2020',
    override: null,
  };
  appendVerdict(record);
  process.stdout.write(`[cross-line] PASS — ${callerName} (${callerLine}) → ${calleeName} (${calleeLine})\n`);
  process.exit(0);
}

// Cross-line detected — check override
const override = parseOverride(overrideRaw);

if (overrideRaw !== null && override === null) {
  // A3: override was provided but is invalid (missing approver/reason)
  const record = {
    timestamp: timestamp(),
    wave: 'wave-154',
    agent: calleeName,
    callerLine,
    calleeLine,
    verdict: 'BLOCK',
    principle: 'IIA Three Lines Model 2020 — anonymous bypass rejected (A3)',
    override: null,
  };
  appendVerdict(record);
  process.stderr.write(`[cross-line] BLOCK — cross-line override rejected: approver or reason is empty (A3)\n`);
  process.stderr.write(`  Caller: ${callerName} (${callerLine}) → Callee: ${calleeName} (${calleeLine})\n`);
  process.exit(1);
}

if (override !== null) {
  // A2: valid attributed override — LOG and exit 0
  const record = {
    timestamp: timestamp(),
    wave: 'wave-154',
    agent: calleeName,
    callerLine,
    calleeLine,
    verdict: 'LOG',
    principle: 'IIA Three Lines Model 2020 — attributed override accepted',
    override,
  };
  appendVerdict(record);
  process.stdout.write(`[cross-line] LOG — cross-line dispatch override accepted\n`);
  process.stdout.write(`  Caller: ${callerName} (${callerLine}) → Callee: ${calleeName} (${calleeLine})\n`);
  process.stdout.write(`  Approver: ${override.approver} | Reason: ${override.reason}\n`);
  process.exit(0);
}

// No override — check hard vs soft mode
if (cfg.hardBlockEnabled) {
  // A1, A9: hard BLOCK
  const record = {
    timestamp: timestamp(),
    wave: 'wave-154',
    agent: calleeName,
    callerLine,
    calleeLine,
    verdict: 'BLOCK',
    principle: 'IIA Three Lines Model 2020 — unattributed cross-line dispatch',
    override: null,
  };
  appendVerdict(record);
  process.stderr.write(`[cross-line] BLOCK — cross-line dispatch rejected (hardBlockEnabled: true)\n`);
  process.stderr.write(`  Caller: ${callerName} (${callerLine}) → Callee: ${calleeName} (${calleeLine})\n`);
  process.stderr.write(`  To override: add --override '{"approver":"<name>","reason":"<justification>"}'\n`);
  process.exit(1);
} else {
  // A8: soft-trial WARN — exit 0
  const record = {
    timestamp: timestamp(),
    wave: 'wave-154',
    agent: calleeName,
    callerLine,
    calleeLine,
    verdict: 'WARN',
    principle: 'IIA Three Lines Model 2020 — soft-trial warning',
    override: null,
  };
  appendVerdict(record);
  process.stderr.write(`[cross-line] WARN — cross-line dispatch detected (hardBlockEnabled: false, soft-trial)\n`);
  process.stderr.write(`  Caller: ${callerName} (${callerLine}) → Callee: ${calleeName} (${calleeLine})\n`);
  process.stderr.write(`  Set crossLineBlock.hardBlockEnabled: true in .sdd-config.json to enforce hard block.\n`);
  process.exit(0);
}
