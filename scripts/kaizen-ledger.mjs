#!/usr/bin/env node
// kaizen-ledger — the outcome memory of the weekly Kaizen engine (Phase 1a, see docs/KAIZEN_ENGINE.md).
//
// A JSON-lines registry, one recommendation per line, that survives week over week so the weekly
// process is ACCOUNTABLE for its own past proposals (audit tracks each to shipped/open/regressed).
// Pure, zero-dep. Default file: docs/research/weekly/_KAIZEN_LEDGER.jsonl (lives in the weekly
// clone; committed with the report). This module only reads/writes the ledger — kaizen-audit sets
// the status, kaizen-scorecard reads it.
//
// Usage:
//   node scripts/kaizen-ledger.mjs --list [--file <path>]
//   node scripts/kaizen-ledger.mjs --add '<json>' [--file <path>]     # upsert one entry
//   node scripts/kaizen-ledger.mjs --self-test

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_LEDGER = path.join(ROOT, 'docs', 'research', 'weekly', '_KAIZEN_LEDGER.jsonl');

export const KINDS = new Set(['recommendation', 'killer-feature', 'session-fix']);
export const TARGETS = new Set(['jidoka', 'global', 'product']);
export const PRIORITIES = new Set(['P0', 'P1', 'P2']);
export const EFFORTS = new Set(['low', 'medium', 'high']);
export const STATUSES = new Set(['proposed', 'shipped', 'open', 'rejected', 'regressed']);

/** Parse a JSON-lines ledger. Skips blank/comment lines; throws on a malformed data line. */
export function parseLedger(text = '') {
  const out = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { throw new Error(`kaizen-ledger: malformed JSON on line ${i + 1}`); }
    out.push(obj);
  }
  return out;
}

/** Serialize entries back to JSON-lines (stable key order, trailing newline). */
export function serializeLedger(entries = []) {
  const order = ['id', 'week', 'title', 'kind', 'target', 'pointOfIntegration', 'priority', 'effort', 'impact', 'status', 'shippedWeek', 'evidence'];
  return entries.map((e) => {
    const ordered = {};
    for (const k of order) if (k in e) ordered[k] = e[k];
    for (const k of Object.keys(e)) if (!(k in ordered)) ordered[k] = e[k]; // keep any extra keys
    return JSON.stringify(ordered);
  }).join('\n') + (entries.length ? '\n' : '');
}

/** Validate one entry. Returns a list of problem strings ([] = valid). */
export function validateEntry(e = {}) {
  const p = [];
  if (!e || typeof e !== 'object') return ['not an object'];
  if (!e.id || typeof e.id !== 'string') p.push('id (non-empty string) required');
  if (!e.week || !/^\d{4}-W\d{2}$/.test(e.week)) p.push('week must be ISO like 2026-W27');
  if (!e.title) p.push('title required');
  if (e.kind && !KINDS.has(e.kind)) p.push(`kind must be one of ${[...KINDS].join('|')}`);
  if (e.target && !TARGETS.has(e.target)) p.push(`target must be one of ${[...TARGETS].join('|')}`);
  if (e.priority && !PRIORITIES.has(e.priority)) p.push(`priority must be one of ${[...PRIORITIES].join('|')}`);
  if (e.effort && !EFFORTS.has(e.effort)) p.push(`effort must be one of ${[...EFFORTS].join('|')}`);
  if (e.status && !STATUSES.has(e.status)) p.push(`status must be one of ${[...STATUSES].join('|')}`);
  if (e.impact != null && !(Number.isInteger(e.impact) && e.impact >= 1 && e.impact <= 5)) p.push('impact must be an integer 1..5');
  return p;
}

/**
 * Upsert an entry by id. New id → appended (defaults: status 'proposed'). Existing id → shallow
 * merge (later fields win), preserving firstSeen semantics via the untouched original week.
 * Returns a NEW array (pure).
 */
export function upsert(entries = [], entry = {}) {
  if (!entry || typeof entry.id !== 'string' || !entry.id) throw new Error('kaizen-ledger: entry needs a string id');
  const idx = entries.findIndex((e) => e.id === entry.id);
  // Build the candidate (new: with defaults; update: merged onto the original), then validate the
  // RESULT — a partial update need not repeat required fields the existing row already has.
  const candidate = idx === -1
    ? { status: 'proposed', shippedWeek: null, evidence: '', ...entry }
    : { ...entries[idx], ...entry, week: entries[idx].week }; // keep original first-seen week
  const problems = validateEntry(candidate);
  if (problems.length) throw new Error(`kaizen-ledger: invalid entry — ${problems.join('; ')}`);
  return idx === -1 ? [...entries, candidate] : entries.map((e, i) => (i === idx ? candidate : e));
}

export function readLedger(file = DEFAULT_LEDGER) {
  try { return parseLedger(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export function writeLedger(entries, file = DEFAULT_LEDGER) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeLedger(entries), 'utf8');
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  const e1 = { id: '2026-W27-R5', week: '2026-W27', title: 'DAG planner', kind: 'recommendation', target: 'jidoka', pointOfIntegration: 'scripts/dag-schedule.mjs', priority: 'P2', effort: 'medium', impact: 4 };
  let led = upsert([], e1);
  ok('upsert appends a new entry with default status proposed', led.length === 1 && led[0].status === 'proposed');
  ok('new entry gets shippedWeek null + evidence ""', led[0].shippedWeek === null && led[0].evidence === '');

  led = upsert(led, { id: '2026-W27-R5', week: '2026-W28', status: 'shipped', shippedWeek: '2026-W28', evidence: 'file exists' });
  ok('upsert updates existing by id (status → shipped)', led.length === 1 && led[0].status === 'shipped');
  ok('upsert keeps the ORIGINAL first-seen week', led[0].week === '2026-W27');
  ok('upsert applied shippedWeek', led[0].shippedWeek === '2026-W28');

  ok('validate flags a bad status', validateEntry({ id: 'x', week: '2026-W27', title: 't', status: 'nope' }).some((p) => p.includes('status')));
  ok('validate flags a bad week', validateEntry({ id: 'x', week: 'monday', title: 't' }).some((p) => p.includes('week')));
  ok('validate flags impact out of range', validateEntry({ id: 'x', week: '2026-W27', title: 't', impact: 9 }).some((p) => p.includes('impact')));
  ok('validate passes a good entry', validateEntry(e1).length === 0);
  ok('upsert throws on an invalid entry', (() => { try { upsert([], { id: '', week: 'x', title: '' }); return false; } catch { return true; } })());

  const round = parseLedger(serializeLedger(led));
  // compare canonically (serialize imposes a stable key order, so re-serialize both sides)
  ok('serialize→parse round-trips', serializeLedger(round) === serializeLedger(led));
  ok('parseLedger skips blank + # comment lines', parseLedger('\n# c\n{"id":"a","week":"2026-W27","title":"t"}\n').length === 1);
  ok('parseLedger throws on a malformed data line', (() => { try { parseLedger('{bad'); return false; } catch { return true; } })());
  ok('empty ledger serializes to empty string', serializeLedger([]) === '');

  if (fails) { console.log('\n\x1b[31mkaizen-ledger self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-ledger: outcome memory upsert/validate/round-trip correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const file = arg('--file') || DEFAULT_LEDGER;

  if (process.argv.includes('--add')) {
    const entry = JSON.parse(arg('--add') || '{}');
    const next = upsert(readLedger(file), entry);
    writeLedger(next, file);
    console.log(`[kaizen-ledger] upserted ${entry.id} → ${path.relative(ROOT, file)} (${next.length} entries)`);
    process.exit(0);
  }
  const led = readLedger(file);
  console.log(`[kaizen-ledger] ${led.length} entrie(s) in ${path.relative(ROOT, file)}:`);
  for (const e of led) console.log(`  ${e.status?.padEnd(9) || '—'} ${e.id}  ${e.title}  → ${e.pointOfIntegration || ''}`);
  process.exit(0);
}
