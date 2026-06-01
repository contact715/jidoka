#!/usr/bin/env node
// debate-engine — the runnable structure for adversarial verification. The roles (debate-prosecutor,
// debate-defender, debate-judge) existed only as prompts with no orchestrator and no recorded
// debates (docs/debates/ did not exist — a declared-but-empty artifact). This engine makes debate a
// SYSTEM: it lays out the rounds, validates a debate actually happened (both adversaries spoke, the
// judge ruled), applies a safety override on the final verdict, and writes the transcript to
// docs/debates/.
//
// HONEST SPLIT: round structure + completeness check + verdict aggregation + transcript write = FULL
// (deterministic, here). The arguments themselves (prosecutor/defender/judge content) are LLM calls
// the orchestrator runs via Task — the engine sequences and records them, it does not fake them.
//
// FULL & self-tested. Usage:
//   node scripts/debate-engine.mjs --self-test
//   node scripts/debate-engine.mjs --plan "claim under debate"        # print the round plan + open a transcript

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

export function debatePlan() {
  return [
    { round: 1, name: 'opening', speakers: ['debate-prosecutor', 'debate-defender'] },
    { round: 2, name: 'cross-examination', speakers: ['debate-prosecutor', 'debate-defender'] },
    { round: 3, name: 'closing', speakers: ['debate-prosecutor', 'debate-defender', 'debate-judge'] },
  ];
}

// a debate is real only if both adversaries opened (round 1) AND the judge ruled (round 3)
export function isComplete(transcript) {
  const byRound = {};
  for (const t of transcript) (byRound[t.round] ??= new Set()).add(t.role);
  const opened = byRound[1]?.has('debate-prosecutor') && byRound[1]?.has('debate-defender');
  const ruled = byRound[3]?.has('debate-judge');
  return Boolean(opened && ruled);
}

// final verdict = the judge's call, with a safety override: an unrefuted security/correctness
// finding can never be waved through as PASS, even if the judge said PASS.
export function finalVerdict(judgeVerdict, { unrefutedBlocker = false } = {}) {
  if (unrefutedBlocker && judgeVerdict === 'PASS') return 'BLOCK';
  return judgeVerdict;
}

function selfTest() {
  const full = [
    { round: 1, role: 'debate-prosecutor' }, { round: 1, role: 'debate-defender' },
    { round: 3, role: 'debate-judge' },
  ];
  const noJudge = [{ round: 1, role: 'debate-prosecutor' }, { round: 1, role: 'debate-defender' }];
  const T = [
    ['plan has 3 rounds', debatePlan().length === 3],
    ['closing round includes the judge', debatePlan()[2].speakers.includes('debate-judge')],
    ['a complete debate (both opened + judge ruled) validates', isComplete(full) === true],
    ['a debate with no judge ruling is incomplete', isComplete(noJudge) === false],
    ['judge PASS stays PASS', finalVerdict('PASS') === 'PASS'],
    ['unrefuted blocker overrides PASS → BLOCK (safety)', finalVerdict('PASS', { unrefutedBlocker: true }) === 'BLOCK'],
    ['judge BLOCK stays BLOCK', finalVerdict('BLOCK') === 'BLOCK'],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mdebate-engine self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ debate-engine: round structure + verdict aggregation correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const claim = arg('--plan') || arg('--claim');
  if (!claim) { console.error('usage: --plan "<claim under debate>" | --self-test'); process.exit(2); }
  console.log(`debate-engine: adversarial verification of — "${claim}"\n`);
  for (const r of debatePlan()) console.log(`  round ${r.round} (${r.name}): ${r.speakers.join(' vs ')}`);
  console.log('\n  The orchestrator dispatches each speaker (Task) per round, appends to the transcript,');
  console.log('  then debate-engine isComplete() + finalVerdict() decide. Transcript → docs/debates/.');
  mkdirSync('docs/debates', { recursive: true });
  const slug = claim.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-$/, '');
  const path = `docs/debates/${slug || 'debate'}.md`;
  if (!existsSync(path)) {
    writeFileSync(path, `# Debate — ${claim}\n\n> Transcript skeleton opened by debate-engine. The orchestrator fills each round.\n\n## Round 1 — opening\n- prosecutor: \n- defender: \n\n## Round 2 — cross-examination\n- prosecutor: \n- defender: \n\n## Round 3 — closing\n- prosecutor: \n- defender: \n- judge VERDICT: \n`);
    console.log(`\n  opened transcript: ${path}`);
  }
  process.exit(0);
}
