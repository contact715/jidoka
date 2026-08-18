#!/usr/bin/env node
// Append a process mistake to the meta-mistake ledger. Where the ledger lives is
// decided by meta-lib (project-local in a repo, GLOBAL cross-project in the
// ~/.claude/jidoka install — a lesson logged in ANY project is then visible to
// the engine in ALL projects). Each entry is tagged with the project it came
// from (cwd basename), so the global ledger stays attributable.
//
// Usage: node scripts/meta-log.mjs <class> <claimed> <real> [caught_by] [kind]
//   class    — short kebab-case mistake class (e.g. declaration-over-implementation)
//   claimed  — what was asserted as done/true
//   real     — what was actually the case
//   caught_by — who/what caught it (default: user)
//   kind     — incident | remediation (default: incident)
//
// `kind` is required by the ledger schema (validateLedgerEntry). It defaults to
// "incident" because that is what this CLI logs: a mistake that happened. A
// remediation row (the fix that closed a class) is written by the remedy path,
// which passes kind explicitly. Without this default the writer and the validator
// disagree and every plain 4-arg call is rejected — the exact drift that broke CI
// on 2026-08-04.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { LEDGER, validateLedgerEntry, MAST_MODES } from './meta-lib.mjs';
import { fileURLToPath } from 'node:url';

// Позиционные аргументы сохранены дословно: их форма записана в ~/.claude/CLAUDE.md и
// вызывается из session-pattern-log. Режим отказа добавлен ФЛАГАМИ, чтобы старая форма вызова
// не сломалась молча, а отказала громко с подсказкой.
const argv = process.argv.slice(2);
const flagAt = argv.findIndex((a) => a.startsWith('--'));
const positional = flagAt === -1 ? argv : argv.slice(0, flagAt);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const [cls, claimed, real, caught = 'user', kind = 'incident'] = positional;
const modeArg = flag('--mode');
const noteArg = flag('--note');

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

function modeHelp() {
  console.error('\nРежим отказа обязателен (--mode). Один из:');
  for (const m of MAST_MODES) console.error(`  ${m.id.padEnd(7)} ${m.name}`);
  console.error('  none    ни один не подходит — тогда нужен --note с объяснением\n');
  console.error('Зачем: пока разметка неполная, распределение режимов посчитать нельзя, а без него');
  console.error('нечем ответить «что чинить первым» иначе как впечатлением. Разбор 2026-08-18 показал,');
  console.error('что 65% наших отказов приходится на проверку результата — это видно только на 100%.');
}

if (isMain) {
  if (!cls || !claimed || !real) {
    console.error('usage: meta-log.mjs <class> <claimed> <real> [caught_by] [kind] --mode <FM-x.y|none> [--note "<почему none>"]');
    process.exit(2);
  }
  if (!modeArg) {
    console.error('meta-log: REJECTED — не указан режим отказа.');
    modeHelp();
    process.exit(2);
  }

  const date = new Date().toISOString().slice(0, 10);
  const project = basename(process.cwd());
  const entry = { date, class: cls, claimed, real, caught_by: caught, project, kind };
  entry.mastMode = modeArg === 'none' ? null : modeArg;
  if (noteArg) entry.mastNote = noteArg;

  // ledger-pollution write-path guard: a row that does not carry the full mistake schema
  // (date/class/claimed/real/caught_by, all non-empty) is rejected HERE, not caught later
  // by meta-honesty. Telemetry belongs in its own sidecar stream, never in this ledger.
  const problems = validateLedgerEntry(entry);
  if (problems.length) {
    console.error('meta-log: REJECTED — row violates the ledger schema (ledger-pollution guard):');
    for (const p of problems) console.error(`  ✗ ${p}`);
    if (problems.some((x) => /mastMode|mastNote/.test(x))) modeHelp();
    process.exit(2);
  }

  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(entry) + '\n');
  console.log(`logged [${cls}] from project "${project}" → ${LEDGER} — run meta-audit to check for recurrence`);
}
