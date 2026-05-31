#!/usr/bin/env node
// Diverse judge panel — removes the single-judge reward-hacking failure point.
//
// The frontier analysis flagged that a single LLM judge (best-of-N-judge / debate-judge) is
// itself reward-hackable: the implementer learns to fool one judge prompt. Fix: N judges with
// DISTINCT rubrics, aggregated by majority, with a safety veto — if ANY judge finds a real
// failure (FAIL/BLOCK), a silent PASS-majority becomes CONTESTED and escalates to a human.
//
// FULL (deterministic, self-tested): aggregation logic + rubric rotation (anti-overfit).
// DORMANT: the actual LLM judging — wired the same way run-evals invokes a model.
//
// Usage:
//   node scripts/judge-panel.mjs --self-test          # prove aggregation + rotation, zero-dep
//   node scripts/judge-panel.mjs --votes PASS,PASS,FAIL
//   node scripts/judge-panel.mjs --rubrics 3 --seed 7 # show which distinct rubrics would run

// Distinct evaluation lenses. A panel pulls N of these so judges don't share one framing.
export const RUBRICS = [
  { id: 'correctness',         frame: 'Does the change do what the spec says, correctly, with edge cases handled?' },
  { id: 'spec-compliance',     frame: 'Does every acceptance criterion map to something in the diff? Anything unaddressed?' },
  { id: 'adversarial-skeptic', frame: 'Assume it is wrong. Find the bug, the security hole, the missed case. Default REVISE if uncertain.' },
  { id: 'mission-alignment',   frame: 'Does it honour the Mission Compass and avoid reward-hacking shortcuts that fool a checker?' },
  { id: 'maintainability',     frame: 'Is it decomposed, readable, free of duplication a future wave will curse?' },
];

// Pick N distinct rubrics, rotated by seed so two runs differ (anti-overfit to one prompt).
// Deterministic (no Math.random — reproducible and testable).
export function pickRubrics(n, seed = 0) {
  const start = Math.abs(seed) % RUBRICS.length;
  const out = [];
  for (let i = 0; i < Math.min(n, RUBRICS.length); i++) out.push(RUBRICS[(start + i) % RUBRICS.length]);
  return out;
}

// Aggregate judge verdicts. Verdicts: PASS / REVISE / FAIL / BLOCK.
// Rule: consensus → that verdict. Clear majority → that verdict, EXCEPT a PASS-majority with any
// FAIL/BLOCK present becomes CONTESTED (a single real objection vetoes a silent pass). No majority → CONTESTED.
export function aggregate(votes) {
  const norm = votes.map(v => String(v).toUpperCase().trim()).filter(Boolean);
  const total = norm.length;
  if (!total) return { verdict: 'CONTESTED', mode: 'no-votes', counts: {} };
  const counts = {};
  for (const v of norm) counts[v] = (counts[v] || 0) + 1;
  const [topVerdict, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const hasVeto = norm.some(v => v === 'FAIL' || v === 'BLOCK');
  if (topCount === total) return { verdict: topVerdict, mode: 'consensus', counts };
  if (topCount > total / 2) {
    if (topVerdict === 'PASS' && hasVeto) return { verdict: 'CONTESTED', mode: 'majority-vetoed', counts };
    return { verdict: topVerdict, mode: 'majority', counts };
  }
  return { verdict: 'CONTESTED', mode: 'split', counts };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

if (process.argv.includes('--self-test')) {
  const T = [
    { votes: ['PASS', 'PASS', 'PASS'], expect: 'PASS', mode: 'consensus' },
    { votes: ['PASS', 'PASS', 'FAIL'], expect: 'CONTESTED', mode: 'majority-vetoed' },
    { votes: ['FAIL', 'FAIL', 'FAIL'], expect: 'FAIL', mode: 'consensus' },
    { votes: ['PASS', 'FAIL', 'REVISE'], expect: 'CONTESTED', mode: 'split' },
    { votes: ['PASS', 'PASS', 'REVISE'], expect: 'PASS', mode: 'majority' },
    { votes: ['REVISE', 'REVISE', 'PASS'], expect: 'REVISE', mode: 'majority' },
  ];
  let fails = 0;
  for (const t of T) {
    const r = aggregate(t.votes);
    const ok = r.verdict === t.expect && r.mode === t.mode;
    if (!ok) fails++;
    console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} [${t.votes.join(',')}] → ${r.verdict}/${r.mode} (expect ${t.expect}/${t.mode})`);
  }
  // rotation: two seeds give different rubric sets
  const a = pickRubrics(3, 0).map(r => r.id).join(',');
  const b = pickRubrics(3, 2).map(r => r.id).join(',');
  const rot = a !== b;
  console.log(`  ${rot ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} rubric rotation: seed0=[${a}] ≠ seed2=[${b}]`);
  if (fails || !rot) { console.log(`\n\x1b[31mjudge-panel self-test FAILED\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ judge-panel aggregation + rotation correct\x1b[0m');
  process.exit(0);
}

const votesArg = arg('--votes');
if (votesArg) {
  const r = aggregate(votesArg.split(','));
  console.log(`verdict: \x1b[1m${r.verdict}\x1b[0m (${r.mode})  counts: ${JSON.stringify(r.counts)}`);
  if (r.verdict === 'CONTESTED') console.log('  → judges disagree or a veto fired — escalate to a human, do not auto-merge.');
  process.exit(r.verdict === 'PASS' ? 0 : 1);
}

const n = parseInt(arg('--rubrics') || '3', 10);
const seed = parseInt(arg('--seed') || '0', 10);
console.log(`judge-panel: ${n} distinct rubrics for this run (seed ${seed}):`);
for (const r of pickRubrics(n, seed)) console.log(`  · ${r.id}: ${r.frame}`);
console.log('\nLLM judging is DORMANT (wire a model like run-evals). Aggregation/rotation logic is live & self-tested.');
process.exit(0);
