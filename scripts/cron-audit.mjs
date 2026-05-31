#!/usr/bin/env node
// cron-audit — periodic self-checkup. Meant to run on a schedule (e.g. weekly) so the framework
// audits ITSELF without a human asking. Runs the cheap deterministic checks, appends a dated row to
// docs/audits/cron-runs.jsonl, and exits non-zero if anything regressed (so a cron wrapper can
// surface it). Reading the log shows drift over time.
//
// FULL & self-tested (the parse/verdict logic is pure; the CLI runs the real checks).
// Usage:
//   node scripts/cron-audit.mjs --self-test
//   node scripts/cron-audit.mjs            # run the checkup, append to the log

import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';

const run = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };

// pure: turn the three command outputs into a verdict row
export function summarize(evalOut, ghostsOut, auditOut, today) {
  const num = (re, s) => { const m = String(s).match(re); return m ? Number(m[1]) : NaN; };
  const evalPct = num(/(\d+(?:\.\d+)?)%/, evalOut);
  const ghosts = num(/ghosts:\s*(\d+)/, ghostsOut);
  const regressions = num(/regressions:\s*(\d+)/, auditOut);
  const ok = evalPct === 100 && ghosts === 0 && regressions === 0;
  return { date: today, evalPct, ghosts, regressions, ok };
}

function selfTest() {
  const T = [
    ['all-green → ok', summarize('passed (100.0%)', 'ghosts: 0', 'regressions: 0', '2026-01-01').ok === true],
    ['eval drop → not ok', summarize('passed (90.0%)', 'ghosts: 0', 'regressions: 0', 'x').ok === false],
    ['a ghost → not ok', summarize('100%', 'ghosts: 2', 'regressions: 0', 'x').ok === false],
    ['a regression → not ok', summarize('100%', 'ghosts: 0', 'regressions: 1', 'x').ok === false],
    ['parses eval pct', summarize('passed (100.0%)', 'ghosts: 0', 'regressions: 0', 'x').evalPct === 100],
    ['parses ghosts', summarize('100%', 'ghosts: 3', 'regressions: 0', 'x').ghosts === 3],
    ['carries the date', summarize('100%', 'ghosts: 0', 'regressions: 0', '2026-05-31').date === '2026-05-31'],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mcron-audit self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ cron-audit: summary logic correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const today = process.env.META_TODAY || new Date().toISOString().slice(0, 10);
  const row = summarize(run('node scripts/eval-suite.mjs'), run('node scripts/instantiation-audit.mjs'), run('node scripts/meta-audit.mjs'), today);
  mkdirSync('docs/audits', { recursive: true });
  appendFileSync('docs/audits/cron-runs.jsonl', JSON.stringify(row) + '\n');
  const icon = row.ok ? '\x1b[32m🟢\x1b[0m' : '\x1b[31m🔴\x1b[0m';
  console.log(`${icon} cron-audit ${today}: eval ${row.evalPct}% · ghosts ${row.ghosts} · regressions ${row.regressions} → docs/audits/cron-runs.jsonl`);
  if (!row.ok) { console.error('  ✗ something regressed — surface it (this is why cron exists).'); process.exit(1); }
  process.exit(0);
}
