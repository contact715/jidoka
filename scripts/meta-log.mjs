#!/usr/bin/env node
// Append a process mistake to the meta-mistake ledger (docs/audits/meta-mistakes.jsonl).
// This makes logging a mistake a one-command mechanism, not manual file editing.
//
// Usage: node scripts/meta-log.mjs <class> <claimed> <real> [caught_by]
//   class    — short kebab-case mistake class (e.g. declaration-over-implementation)
//   claimed  — what was asserted as done/true
//   real     — what was actually the case
//   caught_by — who/what caught it (default: user)

import { appendFileSync } from 'node:fs';

const [, , cls, claimed, real, caught = 'user'] = process.argv;
if (!cls || !claimed || !real) {
  console.error('usage: meta-log.mjs <class> <claimed> <real> [caught_by]');
  process.exit(2);
}

const date = new Date().toISOString().slice(0, 10);
const entry = { date, class: cls, claimed, real, caught_by: caught };
appendFileSync('docs/audits/meta-mistakes.jsonl', JSON.stringify(entry) + '\n');
console.log(`logged [${cls}] — run "node scripts/meta-audit.mjs" to check for recurrence`);
