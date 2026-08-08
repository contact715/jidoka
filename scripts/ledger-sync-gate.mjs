#!/usr/bin/env node
// ledger-sync-gate — keeps the learning ledger from living two lives (2026-W32-R2).
//
// THE DEFECT IT CLOSES. meta-lib decides the ledger address by where the engine file sits:
// a global install writes ~/.claude/jidoka/meta-mistakes.jsonl, a repo checkout writes
// docs/audits/meta-mistakes.jsonl. That was deliberate (a cross-project inbox), but nothing
// ever carried the inbox back into version control. Measured 2026-08-03: the global file held
// 40 incidents / 33 classes, the committed canon 23 / 15, and the SAME meta-trend printed
// LEARNING with 100% gate coverage on the canon while printing HOLDING with 50% coverage and a
// 50% regression rate on the live data. Every health number ever published came off the
// optimistic half, and the split had been widening week over week (W31: 23 vs 31, W32: 23 vs 40).
//
// WHAT THIS DOES. Compares the two addresses and BLOCKS the push when the committed canon is
// missing incidents the live inbox already knows about. `--sync` absorbs them (schema-checked)
// so the fix is one command, not a chore.
//
// HONEST BOUNDARY, and it is the important part: this gate can only speak where BOTH files
// exist. In CI, on a fresh clone, or on a machine with no global install there is nothing to
// compare, so it reports "n/a" and exits 0. It is a LOCAL pre-push gate, not a CI gate, and it
// is deliberately silent rather than falsely green about a comparison it could not make.
//
// Usage:
//   node scripts/ledger-sync-gate.mjs              # check; exit 1 if the canon is behind
//   node scripts/ledger-sync-gate.mjs --sync       # absorb the missing rows into the canon
//   node scripts/ledger-sync-gate.mjs --self-test

import { existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadLedger, mergeLedgers, missingFrom, ledgerKey, validateLedgerEntry,
  GLOBAL_LEDGER, REPO_LEDGER,
} from './meta-lib.mjs';

/**
 * Decide the gate's verdict. Pure — takes rows, returns a verdict object.
 * @param {object[]|null} canon  rows of the committed ledger (null = file absent)
 * @param {object[]|null} inbox  rows of the global cross-project ledger (null = file absent)
 */
export function syncVerdict(canon, inbox) {
  if (!Array.isArray(canon) || !Array.isArray(inbox)) {
    return { status: 'na', reason: 'only one ledger address exists here — nothing to compare', missing: [], invalid: [] };
  }
  const missing = missingFrom(canon, inbox);
  const invalid = missing.filter(r => validateLedgerEntry(r).length > 0);
  if (missing.length === 0) return { status: 'ok', reason: 'canon carries every incident the inbox knows', missing, invalid };
  return {
    status: 'behind',
    reason: `canon is missing ${missing.length} incident(s) the live inbox already recorded`,
    missing, invalid,
  };
}

/** Rows that may be absorbed: present in the inbox, absent from the canon, schema-valid. Pure. */
export function absorbable(canon, inbox) {
  return missingFrom(canon, inbox).filter(r => validateLedgerEntry(r).length === 0);
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const row = (date, cls, claimed = 'c') => ({ date, class: cls, claimed, real: 'r', caught_by: 'owner', kind: 'incident' });

  const a = row('2026-08-01', 'x');
  const b = row('2026-08-02', 'y');
  const c = row('2026-08-03', 'z');

  // merge / key
  ok('mergeLedgers drops exact duplicates', mergeLedgers([a, b], [b, c]).length === 3);
  ok('mergeLedgers keeps first-seen order', mergeLedgers([a], [c, b]).map(r => r.class).join(',') === 'x,z,y');
  ok('ledgerKey separates same-day different-class rows', ledgerKey(a) !== ledgerKey(row('2026-08-01', 'other')));
  ok('ledgerKey treats identical rows as one', ledgerKey(a) === ledgerKey(row('2026-08-01', 'x')));
  ok('mergeLedgers tolerates a null set', mergeLedgers([a], null).length === 1);

  // missingFrom direction — this is the bug that would silently invert the gate
  ok('missingFrom reports inbox rows absent from canon', missingFrom([a], [a, b]).length === 1);
  ok('missingFrom is directional, not symmetric', missingFrom([a, b], [a]).length === 0);

  // verdict
  ok('canon behind the inbox → behind', syncVerdict([a], [a, b, c]).status === 'behind');
  ok('behind names how many are missing', /missing 2 incident/.test(syncVerdict([a], [a, b, c]).reason));
  ok('canon complete → ok', syncVerdict([a, b], [a, b]).status === 'ok');
  ok('canon ahead of the inbox is NOT a failure', syncVerdict([a, b, c], [a]).status === 'ok');
  ok('one address missing → n/a, never a false red', syncVerdict([a], null).status === 'na');
  ok('both addresses missing → n/a', syncVerdict(null, null).status === 'na');

  // schema safety — a malformed inbox row must never be absorbed into the canon
  const junk = { ts: 1, wave: 7 }; // the 2026-06-06 telemetry-row shape
  ok('malformed inbox row is flagged invalid', syncVerdict([], [junk]).invalid.length === 1);
  ok('malformed row is NOT absorbable', absorbable([], [junk]).length === 0);
  ok('valid rows remain absorbable alongside a malformed one', absorbable([], [a, junk]).length === 1);

  if (fails) { console.log('\n\x1b[31mledger-sync-gate self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ ledger-sync-gate: divergence detection + safe absorption correct (16 assertions)\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  const canon = existsSync(REPO_LEDGER) ? loadLedger(REPO_LEDGER) : null;
  const inbox = existsSync(GLOBAL_LEDGER) ? loadLedger(GLOBAL_LEDGER) : null;
  const v = syncVerdict(canon, inbox);

  if (v.status === 'na') {
    console.log(`\x1b[2m○ ledger-sync-gate: n/a — ${v.reason}\x1b[0m`);
    process.exit(0);
  }
  if (v.status === 'ok') {
    console.log(`\x1b[32m✓ ledger-sync-gate: ${v.reason} (${canon.length} incident(s))\x1b[0m`);
    process.exit(0);
  }

  if (process.argv.includes('--sync')) {
    const rows = absorbable(canon, inbox);
    if (rows.length) appendFileSync(REPO_LEDGER, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    console.log(`\x1b[32m✓ ledger-sync-gate: absorbed ${rows.length} incident(s) into ${REPO_LEDGER}\x1b[0m`);
    if (v.invalid.length) {
      console.log(`\x1b[33m⚠ ${v.invalid.length} inbox row(s) left behind — they fail the mistake schema:\x1b[0m`);
      for (const r of v.invalid.slice(0, 5)) console.log(`    ${JSON.stringify(r).slice(0, 120)}`);
    }
    process.exit(0);
  }

  console.log(`\x1b[31m✗ ledger-sync-gate: ${v.reason}\x1b[0m`);
  console.log('  the committed canon and the live cross-project inbox have diverged, so every');
  console.log('  verdict computed from the canon alone (meta-trend, meta-audit, the weekly');
  console.log('  scorecard) is reading the optimistic half of the history.');
  for (const r of v.missing.slice(0, 8)) console.log(`    ${r.date}  ${r.class}`);
  if (v.missing.length > 8) console.log(`    ... and ${v.missing.length - 8} more`);
  console.log('\n  fix: node scripts/ledger-sync-gate.mjs --sync   (then commit docs/audits/meta-mistakes.jsonl)');
  process.exit(1);
}
