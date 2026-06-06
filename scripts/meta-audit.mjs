#!/usr/bin/env node
// Meta-Mistake Engine — the system that improves itself.
//
// Reads a ledger of PROCESS mistakes (things a human or a check caught that the
// orchestrator missed), detects RECURRING classes, and for any class that
// repeats it demands an architectural fix — a GATE, not another patch — and
// emits a concrete remedy. The premise: a repeated miss is not bad luck, it is
// a missing mechanism. The engine turns recurrence into a required gate.
//
// CLOSED LOOP: every gate carries its activation date. The engine then checks
// whether the class recurred AFTER the gate went live. Three states result:
//   🟢 holding    — gate live, zero recurrences since → does NOT block (loop closed)
//   🔴 regression — recurred after the gate → the gate leaked; outranks fresh recurrence
//   ⚠ ungated     — recurring with no gate yet → build the mechanism
// Without the date the loop is open: you can't tell "still broken" from "now fixed",
// and a leaky gate hides forever. The date is what makes the learning measurable.
//
// This is deliberately executable, not a document: the lesson it encodes is
// exactly "documents don't enforce; mechanisms do."
//
// Usage:
//   node scripts/meta-audit.mjs            # analyze, exit 1 if a class recurs
//   node scripts/meta-log.mjs ...          # append a mistake to the ledger

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { loadLedger, groupByClass, daysBetween, todayISO, recurrencesAfter } from './meta-lib.mjs';
import { REMEDIES } from './meta-remedies.mjs'; // single source of truth for gates

const rows = loadLedger();
if (rows.length === 0) { console.log('meta-audit: ledger empty — nothing to analyze.'); process.exit(0); }

const classes = Object.entries(groupByClass(rows)).sort((a, b) => b[1].length - a[1].length);
console.log(`meta-audit: ${rows.length} logged mistakes across ${classes.length} class(es)\n`);

const today = todayISO();
const QUARANTINE_DAYS = 14; // days a gate must hold with zero recurrences before we trust it
const incident = it => `    · ${it.date}: claimed "${it.claimed}"\n        → reality: ${it.real} [caught by ${it.caught_by}]`;

let ungated = 0, regressed = 0, holding = 0, brokenGate = 0;

for (const [cls, items] of classes) {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const remedy = REMEDIES[cls];
  const recurring = items.length >= 2;
  const after = recurrencesAfter(items, remedy?.since); // strictly-after = recurrence through the gate

  if (remedy?.since && after.length > 0) {
    // The gate existed and the class recurred anyway. Worst signal: not bad luck, a leaky gate.
    regressed++;
    console.log(`\x1b[31m🔴 REGRESSION (${after.length}× after gate): ${cls}\x1b[0m`);
    console.log(`    gate live since ${remedy.since} (${remedy.mechanism ?? 'documented-only'}), yet recurred:`);
    for (const it of after) console.log(incident(it));
    console.log(`  \x1b[31m→ The gate did NOT hold. Do not re-document — STRENGTHEN THE MECHANISM or add a stricter gate.`);
    console.log(`    A gate that leaks is a design defect; this outranks fresh recurrence.\x1b[0m\n`);
  } else if (recurring && !remedy) {
    // Recurring with no gate yet — build the mechanism.
    ungated++;
    console.log(`\x1b[33m⚠ RECURRING (${items.length}×, ungated): ${cls}\x1b[0m`);
    for (const it of sorted) console.log(incident(it));
    console.log(`  \x1b[36m→ REMEDY (gate, not patch):\x1b[0m NO GATE REGISTERED. This class recurred without a known gate —`);
    console.log(`    build a mechanism for it and register it (with its activation date) in REMEDIES.\n`);
  } else if (recurring && remedy) {
    // Was recurring; gate is in place; zero recurrences strictly after it — the loop is closing.
    holding++;
    const age = daysBetween(remedy.since, today);
    const verdict = age >= QUARANTINE_DAYS
      ? `held ${age}d through quarantine`
      : `under watch (${QUARANTINE_DAYS - age}d to clear)`;
    console.log(`\x1b[32m🟢 GATED — holding: ${cls}\x1b[0m`);
    console.log(`    ${items.length} past incident(s), gate live since ${remedy.since}, 0 recurrences after — ${verdict}.`);
    console.log(`    mechanism: ${remedy.mechanism ?? '\x1b[33m(none — documented gate only, weaker)\x1b[0m'}\n`);
  }

  // Self-consistency: the engine must not itself declare a gate it can't point to.
  // (This is the declaration-over-implementation class applied to the engine's own claims.)
  // Mechanism paths may carry a {HOME} placeholder (portable remedy entries) — expand
  // it before the existence check, otherwise a real gate reads as a broken one.
  const mech = remedy?.mechanism?.replace('{HOME}', homedir());
  if (mech && !existsSync(mech)) {
    brokenGate++;
    console.log(`\x1b[31m  ‼ gate for "${cls}" names ${mech}, but that file does not exist —`);
    console.log(`     the gate is a claim, not a mechanism. Build it or null the mechanism field.\x1b[0m\n`);
  }
}

console.log('\x1b[1m— meta-audit summary —\x1b[0m');
console.log(`  gated & holding: ${holding}    ungated recurring: ${ungated}    regressions: ${regressed}    broken gates: ${brokenGate}`);

const blocking = ungated + regressed + brokenGate;
if (regressed > 0)
  console.log(`\n\x1b[31m${regressed} regression(s): a gate that was supposed to hold did not. Fix the mechanism before anything else.\x1b[0m`);
if (brokenGate > 0)
  console.log(`\n\x1b[31m${brokenGate} broken gate(s): a remedy names a mechanism that isn't on disk.\x1b[0m`);
if (ungated > 0)
  console.log(`\n${ungated} ungated recurring class(es). A repeated miss = a missing mechanism. Build the gate.`);

if (blocking > 0) process.exit(1); // architectural work required, do not ignore
console.log('\n\x1b[32m✓ no ungated recurrences, no regressions — every recurring class has a gate that is holding.\x1b[0m');
process.exit(0);
