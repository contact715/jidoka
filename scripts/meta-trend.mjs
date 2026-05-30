#!/usr/bin/env node
// meta-trend — the learning curve of the Meta-Mistake Engine.
//
// meta-audit closes the loop PER CLASS (is this gate holding?). meta-trend reads
// the WHOLE ledger OVER TIME and answers the only question that matters for
// self-improvement: "are we getting better?" Not "did we catch this mistake" but
// "is the rate of repeat mistakes falling, is gate coverage rising, are our gates
// holding". Without a trend the engine is a smoke alarm; with one it is a
// thermometer — and you cannot improve what you cannot measure.
//
// Three measurable indicators, each with a direction that means "learning":
//   gate coverage      ↑  more recurring classes have a gate
//   mean time-to-gate  ↓  we build the gate sooner after the first incident
//   regression rate    ↓  fewer gates leak after going live
//
// Usage: node scripts/meta-trend.mjs        (META_LEDGER overrides the ledger path)

import { loadLedger, groupByClass, daysBetween, todayISO, monthOf, recurrencesAfter } from './meta-lib.mjs';
import { REMEDIES } from './meta-remedies.mjs';

const rows = loadLedger();
if (rows.length === 0) { console.log('meta-trend: ledger empty — no curve to plot yet.'); process.exit(0); }

const byClass = groupByClass(rows);
const firstSeen = {}; // class -> earliest incident date
for (const [cls, items] of Object.entries(byClass)) {
  firstSeen[cls] = items.reduce((min, it) => (it.date < min ? it.date : min), items[0].date);
}

// ---- timeline by month ----
const months = {};
const M = m => (months[m] ??= { incidents: 0, newClass: 0, repeat: 0, regression: 0, gates: 0 });

for (const [cls, items] of Object.entries(byClass)) {
  const remedy = REMEDIES[cls];
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  M(monthOf(sorted[0].date)).newClass++;                       // first sighting = a new class
  for (const it of sorted.slice(1)) M(monthOf(it.date)).repeat++;   // every later sighting = a repeat
  for (const it of sorted) M(monthOf(it.date)).incidents++;
  for (const it of recurrencesAfter(items, remedy?.since)) M(monthOf(it.date)).regression++;
  if (remedy?.since) M(monthOf(remedy.since)).gates++;          // the month the gate went live
}

// ---- learning indicators ----
const recurring = Object.entries(byClass).filter(([, it]) => it.length >= 2);
const gatedRecurring = recurring.filter(([cls]) => REMEDIES[cls]);
const coverage = recurring.length ? Math.round((100 * gatedRecurring.length) / recurring.length) : 100;

const ttg = Object.keys(byClass)
  .filter(cls => REMEDIES[cls]?.since)
  .map(cls => daysBetween(firstSeen[cls], REMEDIES[cls].since));
const meanTTG = ttg.length ? Math.round(ttg.reduce((a, b) => a + b, 0) / ttg.length) : null;

const gated = Object.keys(byClass).filter(cls => REMEDIES[cls]?.since);
const leaked = gated.filter(cls => recurrencesAfter(byClass[cls], REMEDIES[cls].since).length > 0);
const regRate = gated.length ? Math.round((100 * leaked.length) / gated.length) : 0;

// ---- render ----
const span = daysBetween(rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date), todayISO());
console.log(`meta-trend: ${rows.length} incident(s), ${Object.keys(byClass).length} class(es), ${span}d of history\n`);

const sortedMonths = Object.keys(months).sort();
const cell = (a, b, c, d, e, f) =>
  `  ${String(a).padEnd(9)}${String(b).padStart(9)}${String(c).padStart(5)}${String(d).padStart(8)}${String(e).padStart(9)}${String(f).padStart(7)}`;
console.log(cell('month', 'incidents', 'new', 'repeat', 'regress', 'gates'));
for (const m of sortedMonths) {
  const x = months[m];
  console.log(cell(m, x.incidents, x.newClass, x.repeat, x.regression, x.gates));
}

const freq = sortedMonths.map(m => months[m].incidents);
const arrow = freq.length < 2 ? '·' : freq.at(-1) < freq[0] ? '↓ falling' : freq.at(-1) > freq[0] ? '↑ rising' : '→ flat';
const pct = n => (n === null ? 'n/a' : `${n}%`);

console.log('\n\x1b[1m  learning indicators\x1b[0m');
console.log(`    gate coverage ......... ${pct(coverage)} (${gatedRecurring.length}/${recurring.length} recurring classes gated)   want ↑`);
console.log(`    mean time-to-gate ..... ${meanTTG === null ? 'n/a' : meanTTG + 'd'} (first incident → gate live)            want ↓`);
console.log(`    regression rate ....... ${pct(regRate)} (${leaked.length}/${gated.length} gates leaked after going live)   want ↓`);
console.log(`    incident frequency .... ${freq.join(' → ')}   ${arrow}`);

// ---- verdict ----
const latestRegressed = months[sortedMonths.at(-1)]?.regression > 0;
const falling = freq.length >= 2 && freq.at(-1) <= freq[0];
let verdict, why, color;
if (regRate > 0 && latestRegressed) {
  [verdict, why, color] = ['REGRESSING', 'gates are leaking in the most recent period — strengthen the mechanisms before adding new ones', 31];
} else if (coverage >= 80 && regRate === 0 && falling) {
  [verdict, why, color] = ['LEARNING', 'coverage high, no live regressions, incident frequency not rising', 32];
} else if (coverage >= 50) {
  [verdict, why, color] = ['HOLDING', 'gates cover most recurring classes; keep logging to sharpen the curve', 36];
} else {
  [verdict, why, color] = ['STALLING', 'recurring classes are outpacing the gates being built', 33];
}
console.log(`\n\x1b[${color}m  verdict: ${verdict}\x1b[0m — ${why}`);
process.exit(0);
