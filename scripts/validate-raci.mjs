#!/usr/bin/env node
// @ts-check
/**
 * Wave-170 — RACI Responsibility Matrix Validator
 *
 * Reads docs/governance/raci.json, enforces per-row invariants, exits 0/1.
 * Mirrors the parse-table → apply-invariant → exit-code pattern from
 * scripts/check-cross-line-dispatch.mjs:68-106 and the file shape of
 * scripts/cascade-validate.mjs:1-30.
 *
 * Invariant rules enforced:
 *   R1 — Every activities[] entry has exactly one `accountable` field.
 *   R2 — The `accountable` value MUST start with `human:` prefix. Any value
 *         that resolves to an agent name in docs/AGENT_ROSTER.md:34-65 without
 *         the `human:` prefix is a VIOLATION with exit 1.  (D1 — EU AI Act Art 14)
 *   R3 — `accountable !== responsible[*]` — self-approval is a hard violation. (D6)
 *   R4 — Every agent slug in raci.json must exist in docs/AGENT_ROSTER.md:34-65. (D5)
 *   R5 — DACI daci_decisions[] entries must have exactly one `approver` field,
 *         also a `human:` slug.
 *   R6 — WARN (exit 0) when `consulted[]` length exceeds 3 for any activity.
 *
 * Flags:
 *   --emit-md   Write docs/governance/raci.md generated from raci.json.
 *   --dry       Validate only; no file writes (default behaviour; kept for parity).
 *
 * Exit codes:
 *   0 — PASS (or WARN-only — consulted bottleneck warnings do not block)
 *   1 — VIOLATION (any hard invariant failed)
 *
 * Usage:
 *   node scripts/validate-raci.mjs
 *   node scripts/validate-raci.mjs --emit-md
 *   node scripts/validate-raci.mjs --dry
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────
const RACI_JSON_PATH = path.join(ROOT, 'docs', 'governance', 'raci.json');
const RACI_MD_PATH = path.join(ROOT, 'docs', 'governance', 'raci.md');
const ROSTER_PATH = path.join(ROOT, 'docs', 'AGENT_ROSTER.md');

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const emitMd = args.includes('--emit-md');
const isDry = args.includes('--dry');

// ── Roster parser ──────────────────────────────────────────────────────────
// Reads the 30-agent table from docs/AGENT_ROSTER.md.
// Table format: | Agent | L-tier | Line: |
// Returns a Set of normalized (lowercase) agent name slugs.
function parseRoster() {
  const text = fs.readFileSync(ROSTER_PATH, 'utf8');
  const lines = text.split('\n');
  const rosterNames = new Set(); // lowercase agent name

  let inTable = false;
  for (const line of lines) {
    if (line.includes('| Agent |') && line.includes('Line:')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (
        line.startsWith('#') ||
        (line.startsWith('|') === false && line.trim() !== '' && !line.startsWith('|---'))
      ) {
        break;
      }
      if (!line.startsWith('|') || line.startsWith('|---')) continue;
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 1) continue;
      rosterNames.add(cells[0].toLowerCase());
    }
  }
  return rosterNames;
}

// ── Slug normalisation ─────────────────────────────────────────────────────
// raci.json uses kebab-case slugs; AGENT_ROSTER.md has mixed-case names.
// Build a lookup from slug → roster name for validation.
// Strategy: exact lowercase match, then fuzzy via removing spaces and dashes.
function buildSlugToRoster(rosterNames) {
  const map = new Map(); // slug -> lowercased roster entry
  for (const name of rosterNames) {
    // exact lowercase
    map.set(name, name);
    // kebab slug: replace spaces with dashes
    const kebab = name.replace(/\s+/g, '-');
    map.set(kebab, name);
    // also strip all separators for fuzzy match
    const flat = name.replace(/[\s\-]/g, '');
    map.set(flat, name);
  }
  return map;
}

// Check if a given slug resolves to a roster entry (AI agent, not human gate).
// Returns true if the slug IS a known agent (meaning it must NOT appear as accountable).
function isAgentSlug(slug, slugMap) {
  if (typeof slug !== 'string') return false;
  const lower = slug.toLowerCase();
  return slugMap.has(lower);
}

// Check if a given slug exists in the roster at all (agent OR human gate).
// human: prefixed values are NOT agent slugs and are always valid for accountable.
function slugExistsInRoster(slug, slugMap) {
  if (typeof slug !== 'string') return false;
  if (slug.startsWith('human:')) return true; // human gates are always valid
  const lower = slug.toLowerCase();
  return slugMap.has(lower);
}

// ── Collect all agent slugs from a raci.json structure ─────────────────────
function collectAllAgentSlugs(raci) {
  const slugs = new Set();
  for (const activity of (raci.activities || [])) {
    if (activity.accountable) slugs.add(activity.accountable);
    for (const s of (activity.responsible || [])) slugs.add(s);
    for (const s of (activity.consulted || [])) slugs.add(s);
    for (const s of (activity.informed || [])) slugs.add(s);
  }
  for (const decision of (raci.daci_decisions || [])) {
    if (decision.approver) slugs.add(decision.approver);
    if (decision.driver) slugs.add(decision.driver);
    for (const s of (decision.contributors || [])) slugs.add(s);
    for (const s of (decision.informed || [])) slugs.add(s);
  }
  return slugs;
}

// ── Markdown emitter ──────────────────────────────────────────────────────
function emitMarkdown(raci) {
  const lines = [];
  lines.push('<!-- Generated from docs/governance/raci.json. DO NOT EDIT BY HAND. -->');
  lines.push('<!-- To regenerate: npm run raci:validate -- --emit-md -->');
  lines.push('');
  lines.push('# RACI Responsibility Matrix — this project Agent Roster');
  lines.push('');
  lines.push('> **Generated** — do not edit by hand. Source of truth: `docs/governance/raci.json`.');
  lines.push('> Run `npm run raci:validate -- --emit-md` to regenerate.');
  lines.push('>');
  lines.push('> **Scope**: dev-governance agents only. For product user roles see `docs/ROLE_PERMISSION_MATRIX.md`.');
  lines.push('> Note: agent slugs in raci.json may become stale when new agents are added to AGENT_ROSTER.md.');
  lines.push('> The validator catches slugs in raci.json that have been removed from the roster (AC-4),');
  lines.push('> but new agents not yet assigned to any row are not auto-detected. Review raci.json on roster changes.');
  lines.push('');

  // RACI Activities table
  lines.push('## RACI Activity Rows');
  lines.push('');
  lines.push('| ID | Activity | Frame | Accountable | Responsible | Consulted | Informed |');
  lines.push('|---|---|---|---|---|---|---|');

  for (const act of (raci.activities || [])) {
    const id = act.id || '';
    const label = act.label || '';
    const frame = act.frame || 'RACI';
    const accountable = act.accountable || '';
    const responsible = (act.responsible || []).join(', ');
    const consulted = (act.consulted || []).join(', ');
    const informed = (act.informed || []).join(', ');
    lines.push(`| ${id} | ${label} | ${frame} | ${accountable} | ${responsible} | ${consulted} | ${informed} |`);
  }

  lines.push('');

  // DACI Decisions table
  lines.push('## DACI Decision Rows');
  lines.push('');
  lines.push('| ID | Decision | Frame | Driver | Approver | Contributors | Informed |');
  lines.push('|---|---|---|---|---|---|---|');

  for (const dec of (raci.daci_decisions || [])) {
    const id = dec.id || '';
    const label = dec.label || '';
    const frame = dec.frame || 'DACI';
    const driver = dec.driver || '';
    const approver = dec.approver || '';
    const contributors = (dec.contributors || []).join(', ');
    const informed = (dec.informed || []).join(', ');
    lines.push(`| ${id} | ${label} | ${frame} | ${driver} | ${approver} | ${contributors} | ${informed} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*This file was generated by `scripts/validate-raci.mjs --emit-md`.*');
  lines.push('');

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  // Load raci.json
  if (!fs.existsSync(RACI_JSON_PATH)) {
    process.stderr.write(`[validate-raci] ERROR: ${RACI_JSON_PATH} not found.\n`);
    process.exit(1);
  }

  let raci;
  try {
    raci = JSON.parse(fs.readFileSync(RACI_JSON_PATH, 'utf8'));
  } catch (err) {
    process.stderr.write(`[validate-raci] ERROR: Failed to parse raci.json: ${err.message}\n`);
    process.exit(1);
  }

  // Load roster
  let rosterNames;
  try {
    rosterNames = parseRoster();
  } catch (err) {
    process.stderr.write(`[validate-raci] ERROR: Failed to parse AGENT_ROSTER.md: ${err.message}\n`);
    process.exit(1);
  }

  const slugMap = buildSlugToRoster(rosterNames);

  const violations = [];
  const warnings = [];

  // ── R4 — Unknown slug check ────────────────────────────────────────────
  const allSlugs = collectAllAgentSlugs(raci);
  for (const slug of allSlugs) {
    if (slug.startsWith('human:')) continue; // human gates are valid
    if (!slugExistsInRoster(slug, slugMap)) {
      violations.push(
        `VIOLATION [R4/D5]: slug "${slug}" in raci.json is not present in AGENT_ROSTER.md:34-65 (unknown agent / typo)`
      );
    }
  }

  // ── R1, R2, R3, R6 — Activities invariants ────────────────────────────
  for (const activity of (raci.activities || [])) {
    const id = activity.id || '(unnamed)';

    // R1 — exactly one accountable
    const aCount = activity.accountable === undefined ? 0 : 1;
    if (aCount === 0) {
      violations.push(
        `VIOLATION [R1]: activity "${id}" — accountable field is missing (0 Accountable entries)`
      );
    } else if (Array.isArray(activity.accountable)) {
      violations.push(
        `VIOLATION [R1]: activity "${id}" — accountable must be a single string, got array (${activity.accountable.length} entries)`
      );
    }

    // R2 — human: prefix (D1 — EU AI Act Art 14)
    if (activity.accountable !== undefined && !Array.isArray(activity.accountable)) {
      const acc = activity.accountable;
      if (!acc.startsWith('human:')) {
        // Check if it resolves to an agent slug (hard violation)
        if (isAgentSlug(acc, slugMap)) {
          violations.push(
            `VIOLATION [R2/D1]: activity "${id}" — accountable "${acc}" resolves to an AI agent slug without "human:" prefix (EU AI Act Art 14)`
          );
        } else {
          // Unknown non-human: prefix value — also a violation
          violations.push(
            `VIOLATION [R2/D1]: activity "${id}" — accountable "${acc}" does not start with "human:" prefix`
          );
        }
      }
    }

    // R3 — no self-approval (D6)
    if (
      activity.accountable &&
      !Array.isArray(activity.accountable) &&
      Array.isArray(activity.responsible)
    ) {
      const accLower = activity.accountable.toLowerCase();
      for (const resp of activity.responsible) {
        if (resp.toLowerCase() === accLower) {
          violations.push(
            `VIOLATION [R3/D6]: activity "${id}" — accountable "${activity.accountable}" also appears in responsible[] (self-approval control failure)`
          );
          break;
        }
      }
    }

    // R6 — consulted bottleneck warning
    if (Array.isArray(activity.consulted) && activity.consulted.length > 3) {
      warnings.push(
        `WARN [R6]: activity "${id}" — consulted[] has ${activity.consulted.length} entries (>3 may bottleneck automated pipeline)`
      );
    }
  }

  // ── R5 — DACI decisions invariants ────────────────────────────────────
  for (const decision of (raci.daci_decisions || [])) {
    const id = decision.id || '(unnamed)';

    // exactly one approver
    if (decision.approver === undefined) {
      violations.push(
        `VIOLATION [R5]: daci_decision "${id}" — approver field is missing`
      );
    } else if (Array.isArray(decision.approver)) {
      violations.push(
        `VIOLATION [R5]: daci_decision "${id}" — approver must be a single string, got array`
      );
    } else if (!decision.approver.startsWith('human:')) {
      violations.push(
        `VIOLATION [R5/D1]: daci_decision "${id}" — approver "${decision.approver}" does not start with "human:" prefix`
      );
    }
  }

  // ── Print results ──────────────────────────────────────────────────────
  for (const warn of warnings) {
    process.stdout.write(`${warn}\n`);
  }

  if (violations.length > 0) {
    for (const v of violations) {
      process.stdout.write(`${v}\n`);
    }
    const actCount = (raci.activities || []).length;
    const decCount = (raci.daci_decisions || []).length;
    process.stdout.write(
      `\nFAIL — ${actCount} activities, ${decCount} decisions, ${violations.length} violation(s).\n`
    );
    process.exit(1);
  }

  const actCount = (raci.activities || []).length;
  const decCount = (raci.daci_decisions || []).length;
  process.stdout.write(
    `PASS — ${actCount} activities, ${decCount} decisions, 0 violations.\n`
  );

  // ── --emit-md ──────────────────────────────────────────────────────────
  if (emitMd && !isDry) {
    const md = emitMarkdown(raci);
    fs.mkdirSync(path.dirname(RACI_MD_PATH), { recursive: true });
    fs.writeFileSync(RACI_MD_PATH, md, 'utf8');
    process.stdout.write(`raci.md written to ${RACI_MD_PATH}\n`);
  }
}

main();
