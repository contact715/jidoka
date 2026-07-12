#!/usr/bin/env node
// ledger-schema-gate — mechanical schema gate for the meta-mistake ledger (2026-W28-G3).
//
// Class it gates: ledger-pollution (2× on 2026-06-06 — wave-judge-debias telemetry rows
// {ts,wave,run1,run2} landed in meta-mistakes.jsonl masquerading as logged mistakes; both
// were only caught DOWNSTREAM by meta-honesty). This gate moves the rejection to the
// ledger itself: every row must be valid JSON carrying the full mistake schema
// (date/class/claimed/real/caught_by — see validateLedgerEntry in meta-lib). Anything
// else blocks the commit/CI run until the row is removed or rewritten.
//
// Layered with, not replacing:
//   meta-log.mjs      — same validator at WRITE time (the legit append path)
//   meta-honesty.mjs  — signal QUALITY of valid rows (self-confirming / inflated / self-reported)
// A direct appendFileSync from a rogue script bypasses meta-log — this gate is what
// catches that side channel at the next commit.
//
// Usage:
//   node scripts/ledger-schema-gate.mjs               # audit the resolved ledger (META_LEDGER-overridable)
//   node scripts/ledger-schema-gate.mjs <path.jsonl>  # audit a specific file
//   node scripts/ledger-schema-gate.mjs --self-test

import { readFileSync, existsSync } from 'node:fs';
import { LEDGER, validateLedgerEntry, recordTrip } from './meta-lib.mjs';

// pure: audit raw jsonl text → { total, bad: [{line, class, problems}] }.
// Raw lines, NOT loadLedger — the loader silently skips malformed JSON, and a line that
// does not even parse is exactly the pollution this gate exists to block.
export function auditLedgerText(text) {
  const lines = text.split('\n').filter(l => l.trim() !== '');
  const bad = [];
  lines.forEach((line, i) => {
    let row;
    try { row = JSON.parse(line); }
    catch { bad.push({ line: i + 1, class: null, problems: ['not valid JSON'] }); return; }
    const problems = validateLedgerEntry(row);
    if (problems.length) bad.push({ line: i + 1, class: row?.class ?? null, problems });
  });
  return { total: lines.length, bad };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const valid = { date: '2026-06-06', class: 'ledger-pollution', claimed: 'telemetry writer fixed', real: 'it still appended run1/run2 rows into the ledger', caught_by: 'meta-honesty', project: 'jidoka' };
  const telemetry = { ts: '2026-06-06T05:26:00Z', wave: 'wave-judge-debias', class: 'position-sensitive', run1: 'PASS', run2: 'BLOCK' };

  ok('valid row passes', validateLedgerEntry(valid).length === 0);
  ok('telemetry row (the 2026-06-06 incident shape) is rejected', validateLedgerEntry(telemetry).length >= 3);
  ok('telemetry rejection names the missing fields', validateLedgerEntry(telemetry).join(' ').includes('"claimed"'));
  ok('missing caught_by is rejected', validateLedgerEntry({ ...valid, caught_by: undefined }).length === 1);
  ok('empty-string field is rejected', validateLedgerEntry({ ...valid, real: '   ' }).length === 1);
  ok('non-ISO date is rejected', validateLedgerEntry({ ...valid, date: '06.06.2026' }).length === 1);
  ok('non-object row is rejected', validateLedgerEntry('a string').length === 1);
  ok('extra fields (project) are allowed', validateLedgerEntry({ ...valid, extra: 'x' }).length === 0);

  const cleanFile = auditLedgerText(JSON.stringify(valid) + '\n' + JSON.stringify(valid) + '\n');
  ok('clean two-row file → 0 bad', cleanFile.total === 2 && cleanFile.bad.length === 0);
  const dirtyFile = auditLedgerText(JSON.stringify(valid) + '\n' + JSON.stringify(telemetry) + '\n{broken json\n');
  ok('dirty file → telemetry row AND malformed line both flagged', dirtyFile.bad.length === 2);
  ok('bad rows carry 1-based line numbers', dirtyFile.bad[0].line === 2 && dirtyFile.bad[1].line === 3);
  ok('blank lines are ignored, not flagged', auditLedgerText('\n\n' + JSON.stringify(valid) + '\n\n').bad.length === 0);
  ok('empty text → 0 rows, 0 bad', auditLedgerText('').total === 0 && auditLedgerText('').bad.length === 0);

  if (fails.length) { console.log(`\n\x1b[31mledger-schema-gate self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ ledger-schema-gate: schema validation + file audit correct (13 assertions)\x1b[0m`);
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  const path = process.argv.slice(2).find(a => !a.startsWith('--')) || LEDGER;
  if (!existsSync(path)) { console.log(`ledger-schema-gate: ${path} does not exist — nothing to pollute; OK`); process.exit(0); }

  const { total, bad } = auditLedgerText(readFileSync(path, 'utf8'));
  if (bad.length === 0) {
    console.log(`✓ ledger-schema-gate: ${total} row(s) in ${path} — all carry the full mistake schema; OK`);
    process.exit(0);
  }

  recordTrip('ledger-pollution', 'ledger-schema-gate');
  console.error(`\x1b[31m✗ LEDGER-POLLUTION: ${bad.length} of ${total} row(s) in ${path} violate the ledger schema:\x1b[0m`);
  for (const b of bad) {
    console.error(`  line ${b.line}${b.class ? ` [${b.class}]` : ''}:`);
    for (const p of b.problems) console.error(`    ✗ ${p}`);
  }
  console.error('\nA ledger row is a real incident: date/class/claimed/real/caught_by, all non-empty.');
  console.error('Telemetry/test output goes to its own sidecar file (e.g. judge-debias-telemetry.jsonl), never here.');
  console.error('Remove or rewrite the offending row(s), then re-run.');
  process.exit(1);
}
