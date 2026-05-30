// Shared primitives for the Meta-Mistake Engine family (meta-audit, meta-trend,
// meta-premortem, meta-generalize, meta-decay). One loader, one date math, one
// grouping — so the engines can't drift apart on how they read the ledger.
//
// LEDGER is env-overridable (META_LEDGER) so every engine is testable against a
// synthetic ledger without mutating production data.

import { readFileSync, existsSync } from 'node:fs';

export const LEDGER = process.env.META_LEDGER || 'docs/audits/meta-mistakes.jsonl';

export function loadLedger(path = LEDGER) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); }
    catch { console.error(`meta-lib: skipping malformed ledger line ${i + 1}`); return null; }
  }).filter(Boolean);
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const monthOf = iso => iso.slice(0, 7); // YYYY-MM

export function groupByClass(rows) {
  const by = {};
  for (const r of rows) (by[r.class] ??= []).push(r);
  return by;
}

// Incidents strictly AFTER a gate's activation date are recurrences the gate
// failed to stop. Same-day incidents are what provoked the gate (a "before" case).
export function recurrencesAfter(items, since) {
  if (!since) return [];
  return items.filter(it => it.date > since).sort((a, b) => a.date.localeCompare(b.date));
}
