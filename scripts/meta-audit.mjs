#!/usr/bin/env node
// Meta-Mistake Engine — the system that improves itself.
//
// Reads a ledger of PROCESS mistakes (things a human or a check caught that the
// orchestrator missed), detects RECURRING classes, and for any class that
// repeats it demands an architectural fix — a GATE, not another patch — and
// emits a concrete remedy. The premise: a repeated miss is not bad luck, it is
// a missing mechanism. The engine turns recurrence into a required gate.
//
// This is deliberately executable, not a document: the lesson it encodes is
// exactly "documents don't enforce; mechanisms do."
//
// Usage:
//   node scripts/meta-audit.mjs            # analyze, exit 1 if a class recurs
//   node scripts/meta-log.mjs ...          # append a mistake to the ledger

import { readFileSync, existsSync } from 'node:fs';

const LEDGER = 'docs/audits/meta-mistakes.jsonl';

// class -> concrete architectural remedy. Grows as new classes recur; an
// unregistered recurring class is itself escalated (see bottom).
const REMEDIES = {
  'declaration-over-implementation':
    'A claim of "implemented / wired / mechanical / fixed / done" MUST ship an EXECUTABLE proof in the same turn: ' +
    'a test that passes, a hook that blocks, or a command whose output is shown. No proof artifact in the turn → ' +
    'status is NOT done. Enforce as a done-gate; do not rely on the agent recalling verification-before-completion. ' +
    'Reference mechanism: scripts/proof-gate.mjs.',
  'tree-not-history':
    'Cleanup/security claims must scan full history, not current state. Mechanism: scripts/pre-publish-guard.mjs (scans git log -p).',
  'scope-narrowed-silently':
    'If a task is bounded (top-N, sampled, partial), the boundary must be stated explicitly in the same turn. Silent truncation reads as full coverage.',
};

function load() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); }
    catch { console.error(`meta-audit: skipping malformed ledger line ${i + 1}`); return null; }
  }).filter(Boolean);
}

const rows = load();
if (rows.length === 0) { console.log('meta-audit: ledger empty — nothing to analyze.'); process.exit(0); }

const byClass = {};
for (const r of rows) (byClass[r.class] ??= []).push(r);

const classes = Object.entries(byClass).sort((a, b) => b[1].length - a[1].length);
console.log(`meta-audit: ${rows.length} logged mistakes across ${classes.length} class(es)\n`);

let recurring = 0;
for (const [cls, items] of classes) {
  if (items.length >= 2) {
    recurring++;
    console.log(`\x1b[33m⚠ RECURRING (${items.length}×): ${cls}\x1b[0m`);
    for (const it of items) console.log(`    · ${it.date}: claimed "${it.claimed}"\n        → reality: ${it.real} [caught by ${it.caught_by}]`);
    const remedy = REMEDIES[cls];
    console.log(`  \x1b[36m→ REMEDY (gate, not patch):\x1b[0m ${remedy
      ?? 'NO REMEDY REGISTERED. This class recurred without a known gate — escalate to architectural design: build a mechanism for this class and register it here.'}\n`);
  }
}

if (recurring > 0) {
  console.log(`${recurring} recurring class(es). A repeated miss = a missing mechanism. Build the gate.`);
  process.exit(1); // non-zero signals: architectural work required, do not ignore
}
console.log('\x1b[32m✓ no recurring classes\x1b[0m');
process.exit(0);
