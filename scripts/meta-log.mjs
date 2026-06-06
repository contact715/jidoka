#!/usr/bin/env node
// Append a process mistake to the meta-mistake ledger. Where the ledger lives is
// decided by meta-lib (project-local in a repo, GLOBAL cross-project in the
// ~/.claude/jidoka install — a lesson logged in ANY project is then visible to
// the engine in ALL projects). Each entry is tagged with the project it came
// from (cwd basename), so the global ledger stays attributable.
//
// Usage: node scripts/meta-log.mjs <class> <claimed> <real> [caught_by]
//   class    — short kebab-case mistake class (e.g. declaration-over-implementation)
//   claimed  — what was asserted as done/true
//   real     — what was actually the case
//   caught_by — who/what caught it (default: user)

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { LEDGER } from './meta-lib.mjs';

const [, , cls, claimed, real, caught = 'user'] = process.argv;
if (!cls || !claimed || !real) {
  console.error('usage: meta-log.mjs <class> <claimed> <real> [caught_by]');
  process.exit(2);
}

const date = new Date().toISOString().slice(0, 10);
const project = basename(process.cwd());
const entry = { date, class: cls, claimed, real, caught_by: caught, project };
mkdirSync(dirname(LEDGER), { recursive: true });
appendFileSync(LEDGER, JSON.stringify(entry) + '\n');
console.log(`logged [${cls}] from project "${project}" → ${LEDGER} — run meta-audit to check for recurrence`);
