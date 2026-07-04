#!/usr/bin/env node
// kaizen-audit — deterministic outcome auditor of the weekly Kaizen engine (Phase 1b).
//
// Closes the loop: for each ledger entry it checks the LIVE repo whether the recommendation's
// point-of-integration actually landed, and sets status shipped / open / regressed with evidence.
// No LLM, no guessing — a recommendation is "shipped" only when its concrete artifact is really
// present (a script file exists, or its name is referenced in the CI workflow). This is what makes
// the weekly adoption-rate honest instead of self-reported.
//
// pointOfIntegration forms understood:
//   - a path        "scripts/dag-schedule.mjs" / "docs/X.md"     → present iff the file exists
//   - a bare token  "map-ac-coverage" / "button-has-type"        → present iff CI text references
//                                                                    it OR scripts/<token>.mjs exists
//
// Pure core (auditEntry / auditLedger) takes injected probes so it is fully testable offline.
//
// Usage:
//   node scripts/kaizen-audit.mjs [--file <ledger>] [--week 2026-W27] [--dry]
//   node scripts/kaizen-audit.mjs --self-test

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedger, writeLedger, upsert, DEFAULT_LEDGER } from './kaizen-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const looksLikePath = (poi) => /[\\/]/.test(poi) || /\.[a-z0-9]+$/i.test(poi);

/**
 * Decide whether a point-of-integration is present in the repo.
 * @param {string} poi
 * @param {{exists:(rel:string)=>boolean, ciText?:string}} probes
 */
export function isPresent(poi, probes) {
  if (!poi) return false;
  const exists = probes.exists || (() => false);
  const ciText = probes.ciText || '';
  if (looksLikePath(poi)) return exists(poi);
  // bare token → a gate/rule name: referenced in CI, or backed by a same-named script
  return ciText.includes(poi) || exists(`scripts/${poi}.mjs`);
}

/**
 * Audit one entry against the live repo. Pure.
 * @returns {object} a possibly-updated entry (never mutates the input)
 */
export function auditEntry(entry, probes = {}, week = '') {
  if (!entry || entry.status === 'rejected') return { ...entry }; // never re-audit a rejected one
  const present = isPresent(entry.pointOfIntegration, probes);
  const wasShipped = entry.status === 'shipped' || !!entry.shippedWeek;

  if (present) {
    return { ...entry, status: 'shipped', shippedWeek: entry.shippedWeek || week || entry.week, evidence: `present: ${entry.pointOfIntegration}` };
  }
  if (wasShipped) {
    return { ...entry, status: 'regressed', evidence: `MISSING now (was shipped): ${entry.pointOfIntegration}` };
  }
  // audited and absent, never shipped → open (distinct from the initial 'proposed')
  return { ...entry, status: 'open', evidence: `not yet present: ${entry.pointOfIntegration}` };
}

export function auditLedger(entries = [], probes = {}, week = '') {
  return entries.map((e) => auditEntry(e, probes, week));
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  const exists = (p) => p === 'scripts/dag-schedule.mjs' || p === 'scripts/map-ac-coverage.mjs';
  const ciText = 'run: node scripts/dag-schedule.mjs --self-test\n- name: button-has-type gate';
  const probes = { exists, ciText };
  const W = '2026-W28';

  // present by path → shipped, stamps shippedWeek
  const a = auditEntry({ id: 'r1', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs', status: 'proposed', shippedWeek: null }, probes, W);
  ok('present-by-path → shipped', a.status === 'shipped');
  ok('shipped stamps shippedWeek (audit week)', a.shippedWeek === W);
  ok('shipped carries evidence', /present:/.test(a.evidence));

  // present by bare token in CI → shipped
  const b = auditEntry({ id: 'r2', week: '2026-W27', title: 't', pointOfIntegration: 'button-has-type', status: 'proposed', shippedWeek: null }, probes, W);
  ok('bare token referenced in CI → shipped', b.status === 'shipped');

  // present by bare token backed by a same-named script → shipped
  const c = auditEntry({ id: 'r3', week: '2026-W27', title: 't', pointOfIntegration: 'map-ac-coverage', status: 'proposed', shippedWeek: null }, probes, W);
  ok('bare token backed by scripts/<token>.mjs → shipped', c.status === 'shipped');

  // absent, never shipped → open
  const d = auditEntry({ id: 'r4', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/ghost.mjs', status: 'proposed', shippedWeek: null }, probes, W);
  ok('absent + never shipped → open', d.status === 'open');

  // absent, was shipped → regressed
  const e = auditEntry({ id: 'r5', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/ghost.mjs', status: 'shipped', shippedWeek: '2026-W20' }, probes, W);
  ok('absent + was shipped → regressed', e.status === 'regressed');
  ok('regressed keeps evidence of the loss', /MISSING now/.test(e.evidence));

  // rejected is never re-audited
  const f = auditEntry({ id: 'r6', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs', status: 'rejected' }, probes, W);
  ok('rejected entry is left untouched', f.status === 'rejected');

  // shipped stays shipped, keeps original shippedWeek
  const g = auditEntry({ id: 'r7', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs', status: 'shipped', shippedWeek: '2026-W27' }, probes, W);
  ok('already-shipped keeps its original shippedWeek', g.shippedWeek === '2026-W27');

  // purity: input not mutated
  const input = { id: 'r8', week: '2026-W27', title: 't', pointOfIntegration: 'scripts/dag-schedule.mjs', status: 'proposed', shippedWeek: null };
  auditEntry(input, probes, W);
  ok('auditEntry does not mutate its input', input.status === 'proposed');

  // audited entries still validate against the ledger schema (compose with upsert)
  ok('audited entry round-trips through upsert', (() => { try { upsert([], { ...a }); return true; } catch { return false; } })());

  if (fails) { console.log('\n\x1b[31mkaizen-audit self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-audit: deterministic shipped/open/regressed detection correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const file = arg('--file') || DEFAULT_LEDGER;
  const week = arg('--week') || isoWeek(new Date());
  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  let ciText = '';
  try { ciText = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'); } catch { /* no CI file */ }

  const before = readLedger(file);
  const after = auditLedger(before, { exists, ciText }, week);
  const changed = after.filter((e, i) => e.status !== before[i].status).length;
  console.log(`[kaizen-audit] ${after.length} entrie(s) audited @ ${week} — ${changed} status change(s):`);
  for (const e of after) console.log(`  ${e.status.padEnd(9)} ${e.id}  ${e.pointOfIntegration || ''}`);
  const shipped = after.filter((e) => e.status === 'shipped').length;
  console.log(`  adoption: ${shipped}/${after.length} shipped`);
  if (!process.argv.includes('--dry')) { writeLedger(after, file); console.log(`[kaizen-audit] ledger updated: ${path.relative(ROOT, file)}`); }
  else console.log('[kaizen-audit] --dry: ledger not written');
  process.exit(0);
}

// ISO-8601 week string for the CLI (deterministic self-test injects the week instead).
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
