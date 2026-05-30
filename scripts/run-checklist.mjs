#!/usr/bin/env node
/**
 * run-checklist.mjs — Wave-159 PFCA (Pre-Flight Checklist Agent) enforcement.
 *
 * Reads pfca config from .sdd-config.json, evaluates 5 universal killer items
 * (K1-K5) plus optional per-tier additions from docs/checklists/phase-{phase}.md,
 * appends every result to docs/audits/checklist-runs.jsonl (append-only),
 * and either warns (soft mode) or hard-blocks (config toggled) when any killer
 * item is unmet.
 *
 * Usage:
 *   node scripts/run-checklist.mjs --phase <dor|dod|spec-review|task-decomp|closure> \
 *     --wave wave-NNN [--tier <L0|L1|L2|L3|L4>] [--dry-run] [--staged]
 *   node scripts/run-checklist.mjs --help
 *
 * Exit codes:
 *   0   PASS or WARN (soft mode, pfca.hardBlockEnabled: false)
 *   0   SKIP (pfca.enabled: false)
 *   1   Usage error (no --phase provided)
 *   42  BLOCK (pfca.hardBlockEnabled: true, any killer item returns no)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(ROOT, '.sdd-config.json');
const CHECKLIST_DIR = path.join(ROOT, 'docs', 'checklists');
const AUDIT_LOG_PATH = path.join(ROOT, 'docs', 'audits', 'checklist-runs.jsonl');

// ── Valid phases ───────────────────────────────────────────────────────────
const VALID_PHASES = ['dor', 'dod', 'spec-review', 'task-decomp', 'closure', 'impl', 'premortem'];
const VALID_TIERS = ['L0', 'L1', 'L2', 'L3', 'L4'];

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

function hasFlag(flag) {
  return args.includes(flag);
}

// ── Usage ──────────────────────────────────────────────────────────────────
if (hasFlag('--help') || args.length === 0) {
  process.stderr.write(`
[pfca] Pre-Flight Checklist Agent — Wave-159

Usage:
  node scripts/run-checklist.mjs --phase <phase> --wave <wave-NNN> [options]

Required:
  --phase <phase>    One of: ${VALID_PHASES.join(', ')}
  --wave <wave-NNN>  Wave identifier (e.g., wave-159)

Options:
  --tier <tier>      Per-tier additions: ${VALID_TIERS.join(', ')}
  --dry-run          Evaluate but do not append to audit log
  --staged           Pre-commit mode: auto-derive phase from staged file pattern
  --help             Show this help message

Exit codes:
  0   PASS or WARN (soft mode) or SKIP (disabled)
  1   Usage error
  42  BLOCK (hard mode, killer item failed)

Config (.sdd-config.json):
  pfca.enabled: false        -> skip all evaluation (SKIP)
  pfca.hardBlockEnabled: false -> WARN on failure, exit 0 (default)
  pfca.hardBlockEnabled: true  -> BLOCK on failure, exit 42

`);
  process.exit(1);
}

// ── Staged mode: auto-derive phase from staged file pattern ────────────────
let phase = getArg('--phase');
let wave = getArg('--wave');
const isDryRun = hasFlag('--dry-run');
const isStaged = hasFlag('--staged');
const tier = getArg('--tier');

if (isStaged && !phase) {
  // Hook calls: MASTER_SPEC staged -> dor, TASKS staged -> task-decomp
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' });
  const stagedFiles = (result.stdout || '').split('\n').filter(Boolean);

  if (stagedFiles.some(f => /^docs\/specs\/wave-.*_TASKS\.md$/.test(f))) {
    phase = 'task-decomp';
  } else if (stagedFiles.some(f => /^docs\/specs\/wave-.*_MASTER_SPEC\.md$/.test(f))) {
    phase = 'dor';
  } else {
    phase = 'dor'; // default
  }

  if (!wave) {
    wave = 'wave-staged';
  }
}

// Validate --phase
if (!phase || !VALID_PHASES.includes(phase)) {
  process.stderr.write(`[pfca] ERROR: --phase is required. Valid values: ${VALID_PHASES.join(', ')}\n`);
  process.stderr.write(`  Run with --help for usage.\n`);
  process.exit(1);
}

if (!wave) {
  wave = 'wave-unknown';
}

// ── Config ─────────────────────────────────────────────────────────────────
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      enabled: raw?.pfca?.enabled === true,
      hardBlockEnabled: raw?.pfca?.hardBlockEnabled === true,
    };
  } catch {
    // Missing stanza or malformed config -> treat as disabled
    return { enabled: false, hardBlockEnabled: false };
  }
}

const cfg = readConfig();

// ── A6: Disabled check ─────────────────────────────────────────────────────
if (!cfg.enabled) {
  process.stderr.write(`[pfca] disabled — set pfca.enabled: true in .sdd-config.json to activate\n`);
  process.exit(0);
}

// ── Checklist reader ───────────────────────────────────────────────────────
/**
 * Parse items from a phase checklist markdown file.
 * Items are lines matching ^- **K/D/SR/TD/C identifier** under a section.
 * Returns [{ id, question, section }]
 */
function readChecklist(phaseArg) {
  const filePath = path.join(CHECKLIST_DIR, `phase-${phaseArg}.md`);
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`[pfca] WARN: checklist file not found: ${filePath}\n`);
    return [];
  }

  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const items = [];
  let currentSection = 'Universal';

  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentSection = line.replace(/^## /, '').trim();
      continue;
    }
    if (line.startsWith('### ')) {
      currentSection = line.replace(/^### /, '').trim();
      continue;
    }

    // Match: - **K1** ... or - **D1 — ...** ... or - **I1** ... or - **PM1** ... (premortem phase)
    // Supported prefixes: K, D, SR, TD, C, I, PM
    const itemMatch = line.match(/^- \*\*(K\d+|D\d+|SR\d+|TD\d+|C\d+|I\d+|PM\d+)/);
    if (itemMatch) {
      items.push({
        id: itemMatch[1],
        question: line.replace(/^- /, '').trim(),
        section: currentSection,
      });
    }
  }

  return items;
}

// ── Tier item reader ───────────────────────────────────────────────────────
/**
 * For DOR phase with --tier, read the tier-specific additions from phase-dor.md.
 */
function readTierItems(tierLabel) {
  if (!tierLabel || phase !== 'dor') return [];

  const filePath = path.join(CHECKLIST_DIR, 'phase-dor.md');
  if (!fs.existsSync(filePath)) return [];

  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const items = [];
  let inTierSection = false;
  let tierSectionTitle = '';

  for (const line of lines) {
    if (line.startsWith('### ')) {
      const sectionTitle = line.replace(/^### /, '').trim();
      inTierSection = sectionTitle.startsWith(tierLabel + ' ') || sectionTitle.startsWith(tierLabel + ' —');
      tierSectionTitle = sectionTitle;
      continue;
    }

    // Stop at next ## section
    if (inTierSection && line.startsWith('## ')) {
      inTierSection = false;
      continue;
    }

    if (inTierSection && line.startsWith('- ')) {
      items.push({
        id: `${tierLabel}-${items.length + 1}`,
        question: line.replace(/^- /, '').trim(),
        section: tierSectionTitle,
      });
    }
  }

  return items;
}

// ── Impl criteria doc resolver (wave-162) ─────────────────────────────────
/**
 * Returns the resolved absolute path for an impl criteria doc, or null if
 * the doc cannot be found. Emits FILE_NOT_FOUND error and returns null when
 * the path does not exist on disk.
 */
function resolveCriteriaDoc(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    process.stderr.write(
      `[pfca] FILE_NOT_FOUND: criteria doc missing: ${relPath} (resolved: ${abs})\n`
    );
    return null;
  }
  return abs;
}

// Criteria doc paths for I1-I4 (from docs/checklists/phase-impl.md)
const IMPL_CRITERIA = {
  I1: 'docs/quality/code-review-checklist.md',
  I2: 'docs/quality/stride-template.md',
  I3: 'docs/quality/wcag-2.2-checklist.md',
  I4: 'docs/quality/perf-budget.json',
};

/**
 * Evaluate I1-I4 impl items. Each check verifies the criteria doc exists
 * and reports FILE_NOT_FOUND if not. Trust-based answer = "yes" when doc
 * exists (semantic gate enforcement is wave-163+ per spec T6).
 */
function evaluateImplItems(items, waveArg, dryRun) {
  const results = [];
  let hasFileMissing = false;

  for (const item of items) {
    // Match I1-I4 by id prefix
    const implMatch = item.id.match(/^(I\d+)$/);
    if (implMatch) {
      const implId = implMatch[1];
      const criteriaRel = IMPL_CRITERIA[implId];

      if (criteriaRel) {
        const resolved = resolveCriteriaDoc(criteriaRel);
        if (!resolved) {
          hasFileMissing = true;
          results.push({
            question: item.question,
            answer: 'no',
            evidence: `FILE_NOT_FOUND: ${criteriaRel} — criteria doc missing`,
          });
        } else {
          results.push({
            question: item.question,
            answer: 'yes',
            evidence: `criteria doc found: ${criteriaRel} (trust-based v1 — semantic check wave-163+)`,
          });
        }
      } else {
        // Unknown impl item — trust-based yes
        results.push({
          question: item.question,
          answer: 'yes',
          evidence: 'auto-evaluated (v1 trust-based)',
        });
      }
    } else {
      // Non-I-prefix tier item (e.g. L4 additions) — trust-based yes
      results.push({
        question: item.question,
        answer: 'yes',
        evidence: 'auto-evaluated (v1 trust-based — tier addition)',
      });
    }
  }

  if (hasFileMissing) {
    process.stderr.write(
      `[pfca] FILE_NOT_FOUND: one or more impl criteria docs are missing — see above. Exiting non-zero.\n`
    );
  }

  return { results, hasFileMissing };
}

// ── Item evaluator ─────────────────────────────────────────────────────────
/**
 * Wave-159 v1: trust-based evaluation. Items default to "yes" except:
 * - K1: check whether the wave's spec file actually exists on disk.
 * Semantic evaluation of K2-K5 requires AI agent analysis (wave-161+).
 */
function evaluateItems(items, waveArg, dryRun) {
  const results = [];

  for (const item of items) {
    let answer = 'yes';
    let evidence = 'auto-evaluated (v1 trust-based — semantic checks in wave-161+)';

    // K1: physical spec file existence check
    if (item.id === 'K1') {
      const placeholderWaves = ['wave-unknown', 'wave-staged', 'wave-test-fixture'];
      if (placeholderWaves.includes(waveArg) || dryRun) {
        answer = 'yes';
        evidence = `placeholder/dry-run wave "${waveArg}" — K1 physical check skipped`;
      } else {
        const specPath = path.join(ROOT, 'docs', 'specs', `${waveArg}_MASTER_SPEC.md`);
        const tasksPath = path.join(ROOT, 'docs', 'specs', `${waveArg}_TASKS.md`);
        if (fs.existsSync(specPath)) {
          answer = 'yes';
          evidence = `docs/specs/${waveArg}_MASTER_SPEC.md exists`;
        } else if (fs.existsSync(tasksPath)) {
          answer = 'yes';
          evidence = `docs/specs/${waveArg}_TASKS.md exists`;
        } else {
          answer = 'no';
          evidence = `spec file not found: docs/specs/${waveArg}_MASTER_SPEC.md`;
        }
      }
    }

    results.push({ question: item.question, answer, evidence });
  }

  return results;
}

// ── Audit log appender ─────────────────────────────────────────────────────
// A7: ONLY appendFileSync — never writeFileSync/truncate/unlink on checklist-runs.jsonl
function appendAuditLog(record) {
  const dir = path.dirname(AUDIT_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(AUDIT_LOG_PATH)) {
    fs.appendFileSync(AUDIT_LOG_PATH, '# checklist-runs.jsonl — append-only. See wave-159 spec §5 D7.\n', 'utf8');
  }
  fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
}

function timestamp() {
  return new Date().toISOString();
}

// ── Main ───────────────────────────────────────────────────────────────────

// Read universal items for this phase
const universalItems = readChecklist(phase);

// Read tier additions (DOR phase only)
const tierItems = tier ? readTierItems(tier) : [];

// Total items (capped at 8 per Miller's Law)
const allItems = [...universalItems, ...tierItems].slice(0, 8);

if (allItems.length === 0) {
  process.stderr.write(`[pfca] WARN: no checklist items found for phase "${phase}" — check docs/checklists/phase-${phase}.md\n`);
  process.exit(0);
}

// Evaluate items — impl phase uses criteria-doc-aware evaluator (wave-162)
let results;
let implFileMissing = false;

if (phase === 'impl') {
  const implEval = evaluateImplItems(allItems, wave, isDryRun);
  results = implEval.results;
  implFileMissing = implEval.hasFileMissing;
} else {
  results = evaluateItems(allItems, wave, isDryRun);
}

// Determine verdict
const failingItems = results.filter(r => r.answer === 'no');
const hasFailures = failingItems.length > 0;

let verdict;
if (!hasFailures) {
  verdict = 'PASS';
} else if (cfg.hardBlockEnabled) {
  verdict = 'BLOCK';
} else {
  verdict = 'WARN';
}

// Build audit record
const record = {
  timestamp: timestamp(),
  wave,
  phase,
  tier: tier || 'universal',
  checklist: tier || 'universal',
  verdict,
  items: results,
  dispatcher: 'pfca-agent',
  haltStateWritten: false,
};

// ── FILE_NOT_FOUND hard exit for impl phase ────────────────────────────────
// A2: if any criteria doc is missing, exit non-zero before soft/hard-block logic
if (implFileMissing && !isDryRun) {
  appendAuditLog(record);
  process.exit(1);
} else if (implFileMissing && isDryRun) {
  process.stderr.write(`[pfca] dry-run — FILE_NOT_FOUND detected; would exit 1 in live mode\n`);
  // continue to print dry-run verdict below
}

// ── Act on verdict ─────────────────────────────────────────────────────────

if (verdict === 'PASS') {
  process.stdout.write(`[pfca] PASS — phase=${phase} wave=${wave} items=${results.length} all-yes\n`);

  if (!isDryRun) {
    appendAuditLog(record);
  } else {
    process.stdout.write(`[pfca] dry-run — audit log not written\n`);
  }
  process.exit(0);
}

if (verdict === 'WARN') {
  process.stderr.write(`[pfca] WARN — phase=${phase} wave=${wave} ${failingItems.length} item(s) returned no:\n`);
  for (const item of failingItems) {
    process.stderr.write(`  [no] ${item.question}\n       evidence: ${item.evidence}\n`);
  }
  process.stderr.write(`  Set pfca.hardBlockEnabled: true in .sdd-config.json to enforce hard block.\n`);

  if (!isDryRun) {
    appendAuditLog(record);
  }
  process.exit(0);
}

if (verdict === 'BLOCK') {
  // D4: call writeHaltState from andon-halt-helpers.mjs
  record.haltStateWritten = true;

  process.stderr.write(`[pfca] BLOCK — phase=${phase} wave=${wave} ${failingItems.length} killer item(s) unmet:\n`);
  for (const item of failingItems) {
    process.stderr.write(`  [no] ${item.question}\n       evidence: ${item.evidence}\n`);
  }

  if (!isDryRun) {
    appendAuditLog(record);
    // Import writeHaltState (calls process.exit(42))
    const { writeHaltState } = await import('./andon-halt-helpers.mjs');
    writeHaltState(
      wave,
      'pfca-agent',
      `PFCA BLOCK — killer item(s) unmet: ${failingItems.map(i => i.question.substring(0, 60)).join('; ')}`
    );
    // writeHaltState calls process.exit(42) — unreachable
  } else {
    process.stderr.write(`[pfca] dry-run — halt state NOT written (would exit 42 in live mode)\n`);
    process.exit(42);
  }
}
