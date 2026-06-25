#!/usr/bin/env node
// Diverse judge panel — removes single-judge reward-hacking failure point.
// N judges with DISTINCT rubrics, majority aggregation, safety veto (any FAIL/BLOCK vetoes a PASS majority).
// wave-judge-debias: aggregate() accepts optional swappedVotes; returns positionSensitive via debiasedVerdict().
// FULL (deterministic, self-tested). DORMANT: actual LLM judging.
// Usage:
//   node scripts/judge-panel.mjs --self-test
//   node scripts/judge-panel.mjs --votes PASS,PASS,FAIL
//   node scripts/judge-panel.mjs --rubrics 3 --seed 7

import { debiasedVerdict } from './debate-engine.mjs';

export const RUBRICS = [
  { id: 'correctness',         frame: 'Does the change do what the spec says, correctly, with edge cases handled?' },
  { id: 'spec-compliance',     frame: 'Does every acceptance criterion map to something in the diff? Anything unaddressed?' },
  { id: 'adversarial-skeptic', frame: 'Assume it is wrong. Find the bug, the security hole, the missed case. Default REVISE if uncertain.' },
  { id: 'mission-alignment',   frame: 'Does it honour the Mission Compass and avoid reward-hacking shortcuts that fool a checker?' },
  { id: 'maintainability',     frame: 'Is it decomposed, readable, free of duplication a future wave will curse?' },
];

export function pickRubrics(n, seed = 0) {
  const start = Math.abs(seed) % RUBRICS.length;
  const out = [];
  for (let i = 0; i < Math.min(n, RUBRICS.length); i++) out.push(RUBRICS[(start + i) % RUBRICS.length]);
  return out;
}

// AC-6: single-votes path is unchanged. AC-7: optional swappedVotes returns positionSensitive.
export function aggregate(votes, swappedVotes) {
  if (swappedVotes !== undefined) {
    const r1 = aggregateSingle(votes), r2 = aggregateSingle(swappedVotes);
    const m = debiasedVerdict(r1.verdict, r2.verdict);
    return { verdict: m.verdict, positionSensitive: m.positionSensitive, run1: m.run1, run2: m.run2, counts: r1.counts };
  }
  return aggregateSingle(votes);
}

function aggregateSingle(votes) {
  const norm = votes.map(v => String(v).toUpperCase().trim()).filter(Boolean);
  const total = norm.length;
  if (!total) return { verdict: 'CONTESTED', mode: 'no-votes', counts: {} };
  const counts = {};
  for (const v of norm) counts[v] = (counts[v] || 0) + 1;
  const [top, cnt] = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  const veto = norm.some(v => v==='FAIL'||v==='BLOCK');
  if (cnt === total) return { verdict: top, mode: 'consensus', counts };
  if (cnt > total/2) {
    if (top==='PASS' && veto) return { verdict: 'CONTESTED', mode: 'majority-vetoed', counts };
    return { verdict: top, mode: 'majority', counts };
  }
  return { verdict: 'CONTESTED', mode: 'split', counts };
}

const arg = (k) => { const i=process.argv.indexOf(k); return i!==-1?process.argv[i+1]:null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
if (process.argv.includes('--self-test')) {
  const T = [
    {votes:['PASS','PASS','PASS'],  expect:'PASS',      mode:'consensus'},
    {votes:['PASS','PASS','FAIL'],  expect:'CONTESTED',  mode:'majority-vetoed'},
    {votes:['FAIL','FAIL','FAIL'],  expect:'FAIL',       mode:'consensus'},
    {votes:['PASS','FAIL','REVISE'],expect:'CONTESTED',  mode:'split'},
    {votes:['PASS','PASS','REVISE'],expect:'PASS',       mode:'majority'},
    {votes:['REVISE','REVISE','PASS'],expect:'REVISE',   mode:'majority'},
  ];
  let fails=0;
  for (const t of T) {
    const r=aggregate(t.votes), ok=r.verdict===t.expect&&r.mode===t.mode;
    if(!ok)fails++;
    console.log(`  ${ok?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} [${t.votes.join(',')}] → ${r.verdict}/${r.mode} (expect ${t.expect}/${t.mode})`);
  }
  const a=pickRubrics(3,0).map(r=>r.id).join(','), b=pickRubrics(3,2).map(r=>r.id).join(','), rot=a!==b;
  console.log(`  ${rot?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} rubric rotation: seed0=[${a}] ≠ seed2=[${b}]`);
  // AC-7
  const r7a=aggregate(['PASS','PASS','PASS'],['BLOCK','BLOCK','BLOCK']);
  const ok7a=r7a.positionSensitive===true&&r7a.verdict==='BLOCK'&&'run1' in r7a;
  if(!ok7a)fails++;
  console.log(`  ${ok7a?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} AC-7a: aggregate(PASS×3,BLOCK×3) → positionSensitive:true,BLOCK`);
  const r7b=aggregate(['PASS','PASS','PASS'],['PASS','PASS','PASS']);
  const ok7b=r7b.positionSensitive===false&&r7b.verdict==='PASS';
  if(!ok7b)fails++;
  console.log(`  ${ok7b?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} AC-7b: aggregate(PASS×3,PASS×3) → positionSensitive:false,PASS`);
  if (fails||!rot) { console.log('\n\x1b[31mjudge-panel self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ judge-panel aggregation + rotation correct\x1b[0m');
  process.exit(0);
}
const votesArg=arg('--votes');
if (votesArg) {
  const r=aggregate(votesArg.split(','));
  console.log(`verdict: \x1b[1m${r.verdict}\x1b[0m (${r.mode})  counts: ${JSON.stringify(r.counts)}`);
  if (r.verdict==='CONTESTED') console.log('  → judges disagree or a veto fired — escalate to a human, do not auto-merge.');
  process.exit(r.verdict==='PASS'?0:1);
}
const n=parseInt(arg('--rubrics')||'3',10), seed=parseInt(arg('--seed')||'0',10);
console.log(`judge-panel: ${n} distinct rubrics for this run (seed ${seed}):`);
for (const r of pickRubrics(n,seed)) console.log(`  · ${r.id}: ${r.frame}`);
console.log('\nLLM judging is DORMANT (wire a model like run-evals). Aggregation/rotation logic is live & self-tested.');
process.exit(0);
}
