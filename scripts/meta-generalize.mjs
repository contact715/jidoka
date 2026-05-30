#!/usr/bin/env node
// meta-generalize — make a lesson cover its whole family, not a single class.
//
// Left alone, every class is an island: you gate declaration-over-implementation,
// then later "claim-without-test" recurs and you build a SECOND gate for what is
// really the same lesson. That's how a system accretes redundant rules and still
// gets surprised. Each gate in the registry declares a `family` of adjacent
// classes the same gate logic already covers. This engine uses it two ways:
//
//   overview         — map every gate to its family, then label each ledger class
//                       as directly-gated / covered-by-family / orphan
//   <class> argument  — answer "do we already have a lesson for this?": if the
//                       class is in some gate's family, reuse that mechanism
//                       (exit 0); if it's an orphan, it needs its own gate (exit 1)
//
// Usage:
//   node scripts/meta-generalize.mjs                      # family map + ledger labels
//   node scripts/meta-generalize.mjs wired-without-trace  # is this already covered?

import { loadLedger, groupByClass } from './meta-lib.mjs';
import { REMEDIES } from './meta-remedies.mjs';

// adjacent class -> the gated parent classes whose gate also covers it
const coveredBy = {};
for (const [parent, r] of Object.entries(REMEDIES)) {
  for (const fam of r.family || []) (coveredBy[fam] ??= []).push(parent);
}

const arg = process.argv.slice(2).join(' ').trim();

if (arg) {
  if (REMEDIES[arg]) {
    console.log(`\x1b[32m✓ "${arg}" is directly gated by ${REMEDIES[arg].mechanism ?? 'a documented gate'}.\x1b[0m`);
    process.exit(0);
  }
  const parents = coveredBy[arg];
  if (parents?.length) {
    console.log(`\x1b[32m✓ "${arg}" is already in the family of: ${parents.join(', ')}\x1b[0m`);
    for (const p of parents) {
      console.log(`     → reuse ${REMEDIES[p].mechanism ?? 'the documented gate'} of "${p}" — do not build a new gate for the same lesson.`);
    }
    process.exit(0);
  }
  console.log(`\x1b[33m✗ "${arg}" is not covered by any existing gate or family.\x1b[0m`);
  console.log(`   It needs its own gate — or, if it is a variant of a gated class, add it to that`);
  console.log(`   class's family in scripts/meta-remedies.mjs so the existing lesson generalizes.`);
  process.exit(1);
}

// ---- overview ----
console.log(`meta-generalize: lesson families across ${Object.keys(REMEDIES).length} gate(s)\n`);
for (const [parent, r] of Object.entries(REMEDIES)) {
  console.log(`  \x1b[1m${parent}\x1b[0m  ·  gate: ${r.mechanism ?? '(documented-only)'}`);
  console.log(`    └─ also covers: ${(r.family || []).join(', ') || '(no family registered)'}`);
}

const rows = loadLedger();
if (rows.length) {
  console.log(`\n  ledger classes (${rows.length} incident(s)):`);
  let orphans = 0;
  for (const cls of Object.keys(groupByClass(rows))) {
    if (REMEDIES[cls]) {
      console.log(`    \x1b[32m${cls}\x1b[0m → directly gated`);
    } else if (coveredBy[cls]?.length) {
      console.log(`    \x1b[36m${cls}\x1b[0m → covered by family of ${coveredBy[cls].join(', ')} (reuse that gate)`);
    } else {
      orphans++;
      console.log(`    \x1b[33m${cls}\x1b[0m → ORPHAN: no gate, not in any family — needs a new lesson`);
    }
  }
  console.log(`\n  ${orphans} orphan class(es); every other ledger class is covered directly or by family.`);
}
process.exit(0);
