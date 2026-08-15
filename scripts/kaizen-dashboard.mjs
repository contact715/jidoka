#!/usr/bin/env node
// kaizen-dashboard — renders the outcome ledger as the Kaizen panel. One renderer, two callers.
//
// WHY THIS IS ITS OWN MODULE. The renderer used to live inside kaizen-engine.mjs, which imports
// kaizen-audit.mjs. When kaizen-audit tried to redraw the panel after writing the ledger
// (2026-W33-R9), the lazy `import('./kaizen-engine.mjs')` never settled: kaizen-audit was still
// being evaluated, so the cycle deadlocked and node exited with "unsettled top-level await" —
// silently, exit code 0, no panel written. A gate that fails open and prints nothing is the exact
// shape this engine keeps legislating against, so the cycle is removed rather than worked around.
//
// It imports kaizen-scorecard only, which imports nothing from either caller. No cycle is possible.

import { readFileSync } from 'node:fs';
import { summarize } from './kaizen-scorecard.mjs';

/**
 * Render the panel from a scorecard plus the audited entries. Pure — no I/O, no clock.
 * The counts line is what readers quote, so it is produced by `summarize` and never hand-written.
 */
export function renderDashboard(card, audited = [], week = '') {
  const rows = audited.map((e) => `| ${e.status || ''} | ${e.id || ''} | ${(e.title || '').replace(/\|/g, '/')} | ${e.pointOfIntegration || ''} | ${(e.evidence || '').replace(/\|/g, '/')} |`);
  return [
    `# Kaizen Dashboard${week ? ` — ${week}` : ''}`,
    '',
    '_Generated from the outcome ledger. Regenerate: `node scripts/kaizen-engine.mjs --dashboard` (or any `node scripts/kaizen-audit.mjs` run)._',
    '',
    `**${summarize(card)}**`,
    '',
    '| status | id | recommendation | point-of-integration | evidence |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  const card = { shippedCount: 2, attestedCount: 0, openCount: 1, regressedCount: 0, actionable: 3, adoptionRate: 0.67 };
  const md = renderDashboard(card, [
    { status: 'shipped', id: 'a', title: 'first', pointOfIntegration: 'scripts/a.mjs#cap', evidence: 'present (symbol): scripts/a.mjs#cap' },
    { status: 'open', id: 'b', title: 'second', pointOfIntegration: 'scripts/b.mjs#cap', evidence: 'not yet present' },
  ], '2026-W33');

  ok('the week reaches the heading', md.includes('# Kaizen Dashboard — 2026-W33'));
  ok('the counts line comes from summarize, not from hand-writing', md.includes('shipped 2/3'));
  ok('every audited entry gets a row', md.includes('| a |') && md.includes('| b |'));
  ok('a pipe inside a title cannot break the table', renderDashboard(card, [{ id: 'x', title: 'a|b' }]).includes('a/b'));
  ok('no entries still renders a valid table header', renderDashboard(card, []).includes('| --- |'));
  // the cycle this module exists to prevent: it must not reach back into either caller
  ok('imports neither kaizen-engine nor kaizen-audit', !/from '\.\/kaizen-(engine|audit)\.mjs'/.test(
    readFileSync(new URL(import.meta.url), 'utf8')));

  if (fails) { console.log('\n\x1b[31mkaizen-dashboard self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-dashboard: panel renders from the ledger, no import cycle\x1b[0m');
  process.exit(0);
}

if (process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  console.log('usage: imported by kaizen-engine / kaizen-audit; run with --self-test to verify');
  process.exit(0);
}
