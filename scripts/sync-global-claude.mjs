#!/usr/bin/env node
// @ts-check
/**
 * Wave-145 — Sync proactive-holistic-analysis rule to ~/.claude/CLAUDE.md
 *
 * Reads docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md (the trigger phrases +
 * 6-step protocol), checks if the section already exists in ~/.claude/CLAUDE.md,
 * and prompts the user interactively before writing.
 *
 * Safety guarantees:
 *   - Exits 1 with error if stdin is not a TTY (prevents unattended/cron writes)
 *   - Prints the proposed addition before prompting
 *   - Writes only on explicit "y" response
 *   - Never truncates ~/.claude/CLAUDE.md — appends only
 *
 * Usage:
 *   node scripts/sync-global-claude.mjs
 *
 * Exit codes:
 *   0 — user confirmed and write succeeded, OR already in sync
 *   1 — user declined, or non-TTY, or fatal error
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TRIGGER_DOC = path.join(ROOT, 'docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md');
const GLOBAL_CLAUDE = path.join(os.homedir(), '.claude', 'CLAUDE.md');

const SECTION_MARKER = '# Proactive Holistic Analysis';

/**
 * Extract the trigger section from the PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md.
 * Returns the full section content formatted for appending to CLAUDE.md.
 * @returns {string}
 */
function buildSectionToAppend() {
  if (!fs.existsSync(TRIGGER_DOC)) {
    throw new Error(`Source doc not found: ${TRIGGER_DOC}`);
  }
  const raw = fs.readFileSync(TRIGGER_DOC, 'utf8');

  // Extract trigger phrases block and 6-step protocol block
  // We grab from "## Trigger phrases" through "## Examples" (exclusive) as the core rule
  const triggerStart = raw.indexOf('## Trigger phrases');
  const protocolStart = raw.indexOf('## The 6-step protocol');
  const examplesStart = raw.indexOf('## Examples');

  if (triggerStart === -1 || protocolStart === -1) {
    throw new Error('Could not find expected sections in PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md');
  }

  const end = examplesStart !== -1 ? examplesStart : raw.length;

  const extracted = raw.slice(triggerStart, end).trim();

  return `
# Proactive Holistic Analysis

> Synced from the-app/docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md
> MANDATORY rule for every Claude session in this project the-app.

${extracted}

Full rule: the-app/docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md
Skill: the-app/.claude/skills/proactive-holistic-analysis.md
`;
}

/**
 * Check if the section already exists in the target file.
 * @param {string} targetContent
 * @returns {boolean}
 */
function sectionExists(targetContent) {
  return targetContent.includes(SECTION_MARKER);
}

function main() {
  // Guard: must be running interactively
  if (!process.stdin.isTTY) {
    process.stderr.write(
      '[sync-global-claude] Non-interactive mode detected — re-run in a terminal to confirm global CLAUDE.md update\n',
    );
    process.exit(1);
  }

  // Read source section
  let section;
  try {
    section = buildSectionToAppend();
  } catch (/** @type {any} */ err) {
    process.stderr.write(`[sync-global-claude] ERROR reading source: ${err.message}\n`);
    process.exit(1);
  }

  // Read target
  let targetContent = '';
  if (fs.existsSync(GLOBAL_CLAUDE)) {
    targetContent = fs.readFileSync(GLOBAL_CLAUDE, 'utf8');
  } else {
    process.stdout.write(`[sync-global-claude] ${GLOBAL_CLAUDE} does not exist — will create it.\n`);
  }

  // Check if already in sync
  if (sectionExists(targetContent)) {
    // Check if content matches (basic: just check marker presence, not byte-for-byte)
    process.stdout.write('[sync-global-claude] Already in sync — Proactive Holistic Analysis section found in ~/.claude/CLAUDE.md\n');
    process.exit(0);
  }

  // Print proposed addition
  process.stdout.write('\n=== Proposed addition to ~/.claude/CLAUDE.md ===\n');
  process.stdout.write(section);
  process.stdout.write('\n=== End of proposed addition ===\n\n');
  process.stdout.write(`Target file: ${GLOBAL_CLAUDE}\n`);
  process.stdout.write(`Characters to append: ${section.length}\n\n`);

  // Prompt user
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Write to ~/.claude/CLAUDE.md? [y/N]: ', (answer) => {
    rl.close();
    if (answer.trim().toLowerCase() === 'y') {
      try {
        fs.mkdirSync(path.dirname(GLOBAL_CLAUDE), { recursive: true });
        fs.appendFileSync(GLOBAL_CLAUDE, section, 'utf8');
        process.stdout.write(`[sync-global-claude] Written to ${GLOBAL_CLAUDE}\n`);
        process.exit(0);
      } catch (/** @type {any} */ err) {
        process.stderr.write(`[sync-global-claude] ERROR writing: ${err.message}\n`);
        process.exit(1);
      }
    } else {
      process.stdout.write('[sync-global-claude] Skipped — no changes made\n');
      process.exit(1);
    }
  });
}

main();
