#!/usr/bin/env node
// meta-decay — age out lessons that no longer earn their hard-gate status.
//
// A self-improving system that only ADDS gates eventually drowns in rules, most
// guarding risks that no longer occur. But removing a gate is Chesterton's fence:
// the gate may be silent precisely BECAUSE it works. So decay never removes a gate
// and never trusts silence alone. It uses trip data (gate-trips.jsonl, written when
// a gate actually fires) to tell the two cases apart:
//
//   🔒 KEEP-HARD  — the class regressed after the gate went live → it proved it is
//                   needed. Stays hard forever; not a decay candidate, ever.
//   🟢 WORKING    — the gate has tripped recently → the risk is live and the gate is
//                   catching it. Silence here would be a lie; keep it hard.
//   🟡 MATURE     — gate older than the decay horizon, no regressions, no recent
//                   trips → candidate to downgrade hard→monitor. If it has NEVER
//                   tripped, that's ambiguous: internalized risk OR an unwired gate —
//                   flagged to verify it actually runs before trusting the silence.
//   ⏳ ACTIVE     — younger than the decay horizon → too soon to judge.
//
// Output is advisory: a human decides the downgrade. Downgrade ≠ delete; a monitored
// gate still watches, and a recurrence flips it straight back to a meta-audit regression.
//
// Usage: node scripts/meta-decay.mjs        (META_TODAY/META_LEDGER/META_TRIP_LOG override)

import { loadLedger, loadTrips, groupByClass, daysBetween, todayISO, recurrencesAfter } from './meta-lib.mjs';
import { REMEDIES } from './meta-remedies.mjs';

const DECAY_DAYS = 90; // a quarter with no regression and no trips = candidate to age out
const today = todayISO();
const byClass = groupByClass(loadLedger());
const trips = loadTrips();

console.log(`meta-decay: aging report for ${Object.keys(REMEDIES).length} gate(s) (today=${today}, horizon=${DECAY_DAYS}d)\n`);

let keepHard = 0, working = 0, mature = 0, active = 0;

for (const [cls, r] of Object.entries(REMEDIES)) {
  if (!r.since) continue;
  const age = daysBetween(r.since, today);
  const regressed = recurrencesAfter(byClass[cls] || [], r.since).length > 0;
  const clsTrips = trips.filter(t => t.class === cls);
  const lastTrip = clsTrips.length ? clsTrips.reduce((m, t) => (t.date > m ? t.date : m), clsTrips[0].date) : null;
  const sinceTrip = lastTrip ? daysBetween(lastTrip, today) : null;

  if (regressed) {
    keepHard++;
    console.log(`\x1b[31m🔒 KEEP-HARD: ${cls}\x1b[0m`);
    console.log(`     regressed after going live → it proved necessary; never downgrade.\n`);
  } else if (sinceTrip !== null && sinceTrip < DECAY_DAYS) {
    working++;
    console.log(`\x1b[32m🟢 WORKING: ${cls}\x1b[0m`);
    console.log(`     tripped ${clsTrips.length}× (last ${sinceTrip}d ago) → risk is live, the gate is catching it. Keep hard.\n`);
  } else if (age >= DECAY_DAYS) {
    mature++;
    if (clsTrips.length === 0) {
      console.log(`\x1b[33m🟡 MATURE — verify wiring: ${cls}\x1b[0m`);
      console.log(`     gate live ${age}d but has NEVER tripped. Either the risk never occurred, or the gate`);
      console.log(`     isn't wired into the pipeline. Verify it actually runs before trusting the silence.\n`);
    } else {
      console.log(`\x1b[33m🟡 MATURE — review: ${cls}\x1b[0m`);
      console.log(`     gate live ${age}d, 0 regressions, last trip ${sinceTrip}d ago (${clsTrips.length} lifetime).`);
      console.log(`     → risk may be internalized; candidate to downgrade hard→monitor (human call).\n`);
    }
  } else {
    active++;
    console.log(`\x1b[36m⏳ ACTIVE: ${cls}\x1b[0m  gate live ${age}d, younger than the ${DECAY_DAYS}d horizon — too soon to judge.\n`);
  }
}

console.log(`  summary: ${keepHard} keep-hard, ${working} working, ${mature} mature(review), ${active} active`);
console.log('  \x1b[2mdecay is advisory: it never removes a gate. A gate that ever regressed stays hard forever.\x1b[0m');
process.exit(0);
