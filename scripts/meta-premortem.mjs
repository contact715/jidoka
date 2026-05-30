#!/usr/bin/env node
// meta-premortem — run a PLANNED action against known mistake classes BEFORE doing it.
//
// The rest of the family is reactive: it learns AFTER a miss is logged. This is the
// active arm. It takes a description of what you are about to do, matches it against
// the `premortem` signature of every known class, and warns when the action carries
// the language that historically precedes a class — UNLESS it also carries the token
// that clears the risk (a proof, a history scan, an explicit boundary). A lesson is
// only "learned" if it changes what you do next time; this is where that happens.
//
// It also reads `git diff --cached --name-only`, so "added foo.test.ts" in the
// staged set clears the proof token even if you didn't say "test" in the description.
//
// Usage:
//   node scripts/meta-premortem.mjs "fixed the auth bug, ready to publish"
//   (wire into a pre-commit hook to check the commit subject + staged files)

import { execSync } from 'node:child_process';
import { REMEDIES } from './meta-remedies.mjs';

const argText = process.argv.slice(2).join(' ');
let staged = '';
try { staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }); } catch { /* not a git repo / nothing staged */ }
const action = `${argText}\n${staged}`.trim();

if (!action) {
  console.error('usage: meta-premortem.mjs "<description of the action you are about to take>"');
  console.error('       (also reads staged file names as context)');
  process.exit(2);
}

const gated = Object.entries(REMEDIES).filter(([, r]) => r.premortem);
console.log(`meta-premortem: checking planned action against ${gated.length} known mistake class(es)\n`);
console.log(`  action: "${argText || '(staged changes only)'}"\n`);

let risks = 0, acknowledged = 0;
for (const [cls, r] of gated) {
  const { risk, clears, advise } = r.premortem;
  if (!risk.test(action)) continue;
  const hit = action.match(risk)[0];
  if (clears.test(action)) {
    acknowledged++;
    console.log(`\x1b[32m  ✓ ${cls}: risk word "${hit}" present, but a clearing token is too — risk acknowledged.\x1b[0m`);
  } else {
    risks++;
    console.log(`\x1b[33m🟡 RISK — ${cls}\x1b[0m`);
    console.log(`     trigger: "${hit}" with no clearing token in the action`);
    console.log(`     gate: ${r.gate}`);
    console.log(`     before you proceed: ${advise}\n`);
  }
}

if (risks > 0) {
  console.log(`\x1b[33m${risks} known-class risk(s) detected (${acknowledged} acknowledged). These are PRE-mortem warnings —`);
  console.log(`addressing them now is cheaper than logging the mistake afterward.\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m✓ planned action carries no unaddressed signature of a known mistake class${acknowledged ? ` (${acknowledged} acknowledged)` : ''}.\x1b[0m`);
process.exit(0);
