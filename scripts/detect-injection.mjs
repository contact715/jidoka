#!/usr/bin/env node
// @ts-check
/**
 * Wave-165 — OWASP LLM01:2025 Prompt Injection Scanner
 *
 * Scans an input string against a regex battery covering canonical OWASP LLM01
 * injection patterns: role-override directives, delimiter escapes, ignore-previous
 * variants, and jailbreak prefixes.
 *
 * Behavior:
 *   - Soft-flag default (securityScan.hardBlockEnabled: false or absent):
 *     emits injection_detected event to security-events.jsonl, exits 0.
 *   - Hard-block (securityScan.hardBlockEnabled: true):
 *     calls writeHaltState and exits 42.
 *   - No match: exits 0, emits no event.
 *   - Empty / missing --input: writes usage to stderr, exits 1.
 *
 * Usage:
 *   node scripts/detect-injection.mjs --input "<string>" [--wave <wave-id>] [--agent <agent-id>]
 *   echo "text" | node scripts/detect-injection.mjs --stdin
 *
 * Exit codes:
 *   0  — no injection detected (or soft-flag: injection flagged but not blocked)
 *   1  — usage error (missing/empty --input)
 *   42 — hard-block: injection detected and securityScan.hardBlockEnabled is true
 *
 * Spec: docs/specs/wave-165_MASTER_SPEC.md §7 A7–A11
 * OWASP LLM01:2025: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { emitTelemetry } from './emit-telemetry.mjs';
import { writeHaltState } from './andon-halt-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');

// ── OWASP LLM01:2025 pattern battery ─────────────────────────────────────────
//
// Patterns are intentionally full-phrase anchored (not single-word) to reduce
// false positives on legitimate customer complaint text (spec §14 Risk row 3).
// Matching is case-insensitive.
//
// Categories:
//   IGNORE_PREV   — "ignore previous instructions" variants
//   ROLE_OVERRIDE — "you are now", "act as", "pretend you are" role hijack
//   DELIMITER_ESC — token-boundary escapes (chat-template delimiters)
//   INDIRECT      — indirect injection via system prompt replacement phrases
//   JAILBREAK     — common DAN / bypass prefixes
//
/** @type {Array<{ label: string; pattern: RegExp; severity: 'low'|'medium'|'high' }>} */
const INJECTION_PATTERNS = [
  // ── IGNORE_PREV ──────────────────────────────────────────────────────────
  {
    label: 'IGNORE_PREV:ignore_previous_instructions',
    pattern: /ignore\s+(?:all\s+)?previous\s+instructions?/i,
    severity: 'high',
  },
  {
    label: 'IGNORE_PREV:disregard_prior_instructions',
    pattern: /disregard\s+(?:all\s+)?(?:prior|previous|above)\s+instructions?/i,
    severity: 'high',
  },
  {
    label: 'IGNORE_PREV:forget_previous_instructions',
    pattern: /forget\s+(?:all\s+)?(?:previous|prior)\s+instructions?/i,
    severity: 'high',
  },
  // ── ROLE_OVERRIDE ────────────────────────────────────────────────────────
  {
    label: 'ROLE_OVERRIDE:you_are_now',
    pattern: /you\s+are\s+now\s+(?:a\s+|an\s+)?(?:\w+\s+){0,3}(?:assistant|bot|ai|model|system|gpt)/i,
    severity: 'high',
  },
  {
    label: 'ROLE_OVERRIDE:act_as',
    pattern: /(?:^|\s)act\s+as\s+(?:a\s+|an\s+)?(?:\w+\s+){0,3}(?:assistant|bot|ai|model|system|gpt|jailbreak|dan)/i,
    severity: 'high',
  },
  {
    label: 'ROLE_OVERRIDE:pretend_you_are',
    pattern: /pretend\s+(?:you\s+are|to\s+be)\s+/i,
    severity: 'medium',
  },
  {
    label: 'ROLE_OVERRIDE:roleplay_as',
    pattern: /roleplay\s+as\s+/i,
    severity: 'medium',
  },
  {
    label: 'ROLE_OVERRIDE:your_role_is_now',
    pattern: /your\s+(?:role|persona|identity)\s+is\s+now\s+/i,
    severity: 'high',
  },
  // ── DELIMITER_ESC ────────────────────────────────────────────────────────
  {
    label: 'DELIMITER_ESC:im_start_token',
    pattern: /<\|im_start\|>/i,
    severity: 'high',
  },
  {
    label: 'DELIMITER_ESC:endoftext_token',
    pattern: /<\|endoftext\|>/i,
    severity: 'high',
  },
  {
    label: 'DELIMITER_ESC:system_block_triple_backtick',
    pattern: /```\s*(?:system|System)\s*\n/,
    severity: 'high',
  },
  {
    label: 'DELIMITER_ESC:human_turn_token',
    pattern: /<\|(?:human|user|assistant)\|>/i,
    severity: 'high',
  },
  // ── INDIRECT ─────────────────────────────────────────────────────────────
  {
    label: 'INDIRECT:new_system_prompt',
    pattern: /new\s+system\s+prompt\s*:/i,
    severity: 'high',
  },
  {
    label: 'INDIRECT:your_new_instructions',
    pattern: /your\s+new\s+instructions?\s+(?:are|is)\s+/i,
    severity: 'high',
  },
  {
    label: 'INDIRECT:updated_instructions',
    pattern: /updated\s+instructions?\s*:\s*/i,
    severity: 'medium',
  },
  // ── JAILBREAK ────────────────────────────────────────────────────────────
  {
    label: 'JAILBREAK:dan_prefix',
    pattern: /(?:^|\s)DAN[\s:,]/,
    severity: 'high',
  },
  {
    label: 'JAILBREAK:do_anything_now',
    pattern: /do\s+anything\s+now/i,
    severity: 'high',
  },
  {
    label: 'JAILBREAK:jailbreak_prefix',
    pattern: /(?:^|\s)jailbreak\s*[\s:,]/i,
    severity: 'high',
  },
];

// ── Config reader ─────────────────────────────────────────────────────────────

/**
 * Read securityScan.hardBlockEnabled from .sdd-config.json.
 * Defaults to false if config is absent or malformed.
 * @returns {boolean}
 */
function readHardBlockEnabled() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    return Boolean(raw?.securityScan?.hardBlockEnabled);
  } catch {
    return false;
  }
}

// ── CLI argument parser ───────────────────────────────────────────────────────

/**
 * @returns {{ input: string; wave: string; agent: string }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  /** @type {Record<string, string>} */
  const parsed = {};

  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      const key = argv[i].slice(2);
      parsed[key] = argv[i + 1];
      i++;
    }
  }

  return {
    input: parsed['input'] ?? '',
    wave: parsed['wave'] ?? 'wave-unknown',
    agent: parsed['agent'] ?? 'unknown',
  };
}

// ── Core scan function ────────────────────────────────────────────────────────

/**
 * Scan `text` against the INJECTION_PATTERNS battery.
 * Returns matched pattern labels and highest severity.
 *
 * @param {string} text
 * @returns {{ matched: boolean; patterns: string[]; severity: 'low'|'medium'|'high' }}
 */
function scanForInjection(text) {
  /** @type {string[]} */
  const matchedLabels = [];
  /** @type {'low'|'medium'|'high'} */
  let highestSeverity = 'low';

  const severityRank = { low: 0, medium: 1, high: 2 };

  for (const { label, pattern, severity } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      matchedLabels.push(label);
      if (severityRank[severity] > severityRank[highestSeverity]) {
        highestSeverity = severity;
      }
    }
  }

  return {
    matched: matchedLabels.length > 0,
    patterns: matchedLabels,
    severity: matchedLabels.length > 0 ? highestSeverity : 'low',
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const { input, wave, agent } = parseArgs();

  // A10: empty or missing --input → usage error, exit 1, no event
  if (!input || input.trim().length === 0) {
    process.stderr.write(
      'Usage: node scripts/detect-injection.mjs --input "<string>" [--wave <wave-id>] [--agent <agent-id>]\n' +
      'Error: --input argument is required and must be non-empty.\n'
    );
    process.exit(1);
  }

  const result = scanForInjection(input);

  // No match — clean exit, no event
  if (!result.matched) {
    process.exit(0);
  }

  // Match detected — emit security event
  emitTelemetry('injection_detected', {
    source: 'scripts/detect-injection.mjs',
    wave,
    agent,
    payload: {
      event_subtype: 'injection_detected',
      patterns_matched: result.patterns,
      severity: result.severity,
      source_script: 'scripts/detect-injection.mjs',
    },
  });

  process.stdout.write(
    `[detect-injection] injection_detected — patterns: ${result.patterns.join(', ')} (severity: ${result.severity})\n`
  );

  // A8/A9: hard-block or soft-flag
  const hardBlock = readHardBlockEnabled();
  if (hardBlock) {
    writeHaltState(wave, agent, `injection_detected: ${result.patterns.join(', ')}`);
    // writeHaltState exits 42
  }

  // Soft-flag: event emitted, continue normally
  process.exit(0);
}

// ── CLI entrypoint guard ──────────────────────────────────────────────────────

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main();
}

// Export for testing
export { scanForInjection, INJECTION_PATTERNS };
