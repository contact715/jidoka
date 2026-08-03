// Shared primitives for the Meta-Mistake Engine family (meta-audit, meta-trend,
// meta-premortem, meta-generalize, meta-decay). One loader, one date math, one
// grouping — so the engines can't drift apart on how they read the ledger.
//
// LEDGER is env-overridable (META_LEDGER) so every engine is testable against a
// synthetic ledger without mutating production data.

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Where this engine is INSTALLED decides where the ledger lives — no install-time
// path rewriting needed:
//   - framework repo / project install (.jidoka/scripts/) → the project-local ledger
//   - global install (~/.claude/jidoka/scripts/) → the GLOBAL cross-project ledger,
//     so a class caught in one repo is known to the engine in all repos.
// Both stay env-overridable (META_LEDGER / META_TRIP_LOG) so every engine is
// testable against a synthetic ledger without mutating production data.
const JIDOKA_HOME = process.env.JIDOKA_HOME || join(homedir(), '.claude', 'jidoka');
const IS_GLOBAL = dirname(fileURLToPath(import.meta.url)).startsWith(JIDOKA_HOME);
export const LEDGER = process.env.META_LEDGER || (IS_GLOBAL ? join(JIDOKA_HOME, 'meta-mistakes.jsonl') : 'docs/audits/meta-mistakes.jsonl');
export const TRIP_LOG = process.env.META_TRIP_LOG || (IS_GLOBAL ? join(JIDOKA_HOME, 'gate-trips.jsonl') : 'docs/audits/gate-trips.jsonl');

function loadJsonl(path, who) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); }
    catch { console.error(`${who}: skipping malformed line ${i + 1}`); return null; }
  }).filter(Boolean);
}

// union-ledger-read (2026-W32-R2) — the ledger address is decided by WHERE THIS FILE SITS
// (line 22), so the same engine reads two different histories depending on how it was invoked.
// Measured 2026-08-03: the global install held 40 incidents / 33 classes, the repo canon 23 / 15.
// meta-trend printed LEARNING with 100% gate coverage on one and HOLDING with 50% coverage and a
// 50% regression rate on the other. Every published health number came from the optimistic half.
//
// So the engines read the UNION of both addresses, de-duplicated on (date|class|claimed). The
// repo canon stays the thing that gets committed; the global file stays the cross-project inbox.
// COUNTERPART is the other address than LEDGER, empty when both resolve to the same file.
export const GLOBAL_LEDGER = join(JIDOKA_HOME, 'meta-mistakes.jsonl');
export const REPO_LEDGER = 'docs/audits/meta-mistakes.jsonl';
export const ledgerKey = (r) => `${r?.date || ''}|${r?.class || ''}|${(r?.claimed || '').slice(0, 120)}`;

/** Merge ledger row-sets, keeping first-seen order and dropping exact duplicates. Pure. */
export function mergeLedgers(...rowSets) {
  const seen = new Set(); const out = [];
  for (const rows of rowSets) for (const r of rows || []) {
    const k = ledgerKey(r);
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

/** Rows present in `from` but missing from `into` — what the canon has not yet absorbed. Pure. */
export function missingFrom(into = [], from = []) {
  const have = new Set(into.map(ledgerKey));
  return from.filter(r => !have.has(ledgerKey(r)));
}

export const loadLedger = (path = LEDGER) => loadJsonl(path, 'meta-lib');

// The reader every ENGINE should use. An explicit META_LEDGER still wins outright, so all the
// synthetic-ledger self-tests keep working unchanged.
export function loadLedgerUnion() {
  if (process.env.META_LEDGER) return loadLedger(process.env.META_LEDGER);
  const primary = loadLedger(LEDGER);
  const other = LEDGER === GLOBAL_LEDGER ? REPO_LEDGER : GLOBAL_LEDGER;
  if (other === LEDGER || !existsSync(other)) return primary;
  return mergeLedgers(primary, loadJsonl(other, 'meta-lib(union)'));
}

// A gate TRIP = the gate fired and blocked something. This is the data that tells
// decay "the risk is still live and this gate is catching it" vs "nothing has
// tried this in months". Recording must never break the gate it instruments.
export const loadTrips = (path = TRIP_LOG) => loadJsonl(path, 'meta-lib(trips)');
export function recordTrip(cls, mechanism) {
  try { appendFileSync(TRIP_LOG, JSON.stringify({ date: todayISO(), class: cls, mechanism }) + '\n'); }
  catch { /* instrumentation is best-effort; a gate must work even if logging fails */ }
}

// META_TODAY lets the whole family be tested across time (aging, quarantine, decay)
// without waiting real days or mutating real dates.
export const todayISO = () => process.env.META_TODAY || new Date().toISOString().slice(0, 10);
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

// ── Ledger row schema (ledger-pollution write-path gate) ─────────────────────
// A ledger row is a REAL INCIDENT only if it carries all five fields. Telemetry rows
// ({ts,wave,run1,run2}) leaked into the ledger twice on 2026-06-06 and were only caught
// downstream by meta-honesty; this schema rejects them AT WRITE TIME (meta-log) and at
// commit/CI (ledger-schema-gate). One function, shared by both, so the layers can't drift.
export const LEDGER_REQUIRED = ['date', 'class', 'claimed', 'real', 'caught_by'];
export function validateLedgerEntry(e) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return ['row is not an object'];
  const problems = [];
  for (const k of LEDGER_REQUIRED) {
    if (!(k in e)) problems.push(`missing required field "${k}"`);
    else if (typeof e[k] !== 'string' || e[k].trim() === '') problems.push(`field "${k}" must be a non-empty string`);
  }
  if (typeof e.date === 'string' && e.date.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
    problems.push(`field "date" must be ISO YYYY-MM-DD (got "${e.date}")`);
  }
  return problems;
}
