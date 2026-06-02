#!/usr/bin/env node
// adaptive-verify — inference-time scaling of verification (frontier: test-time rubric-guided checking,
// arxiv 2601.15808). jidoka's best-of-N used a fixed N; the frontier scales verification COMPUTE to the
// task's difficulty (more samples + harder checking on risky/hard tasks, one on trivial), then selects
// the winner by a RUBRIC score, not by first-pass. This plans the N and selects by rubric.
//
//   planN(task)         → how many attempts/verifications to spend (scaled to risk × hardness, bounded)
//   selectByRubric(...) → pick the variant with the best weighted rubric score (ties → first/stable)
//
// HONEST boundary: planN is a deterministic policy (risk tier × hardness, capped at 8); it sits ABOVE
// the LLM work — the orchestrator runs that many attempts and scores each against the rubric; this file
// decides HOW MANY and picks the winner. Aligns with the N-policy the best-of-N-judge already enforces
// (critical ≥ 3).
//
// FULL & self-tested. Usage:
//   node scripts/adaptive-verify.mjs --self-test
//   node scripts/adaptive-verify.mjs --task '{"risk":"critical","hard":true}'

const TIER = { trivial: 1, normal: 2, critical: 5 };
const WEIGHTS = { correctness: 0.4, safety: 0.3, completeness: 0.2, efficiency: 0.1 };

// pure: how many verification samples this task earns (risk tier × hardness, bounded 1..8)
export function planN(task = {}) {
  const base = TIER[task.risk] ?? 2;
  const hard = task.hard ? 2 : 1;
  return Math.max(1, Math.min(8, base * hard));
}

// pure: weighted rubric score of one variant (rubric: {criterion: 1..5})
export function rubricScore(rubric = {}, weights = WEIGHTS) {
  let sum = 0, wsum = 0;
  for (const [k, w] of Object.entries(weights)) { if (k in rubric) { sum += rubric[k] * w; wsum += w; } }
  return wsum ? +(sum / wsum).toFixed(3) : 0;
}

// pure: pick the best variant by rubric score; ties resolve to the EARLIEST (stable)
export function selectByRubric(variants = [], weights = WEIGHTS) {
  let best = null, bestScore = -Infinity;
  variants.forEach((v, i) => {
    const s = rubricScore(v.rubric, weights);
    if (s > bestScore) { bestScore = s; best = { ...v, index: i, score: s }; }
  });
  return best;
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('planN: trivial → 1', planN({ risk: 'trivial' }) === 1);
  ok('planN: normal → 2', planN({ risk: 'normal' }) === 2);
  ok('planN: critical → 5 (≥3, the N-policy floor)', planN({ risk: 'critical' }) === 5 && planN({ risk: 'critical' }) >= 3);
  ok('planN: a HARD task scales up (more verification compute)', planN({ risk: 'critical', hard: true }) > planN({ risk: 'critical' }));
  ok('planN: capped at 8 (no runaway)', planN({ risk: 'critical', hard: true }) <= 8);
  ok('planN: unknown risk defaults to 2', planN({}) === 2);

  ok('rubricScore: all-5s → 5.0', rubricScore({ correctness: 5, safety: 5, completeness: 5, efficiency: 5 }) === 5);
  ok('rubricScore: correctness weighs more than efficiency', rubricScore({ correctness: 5, safety: 1, completeness: 1, efficiency: 1 }) > rubricScore({ correctness: 1, safety: 1, completeness: 1, efficiency: 5 }));
  const variants = [
    { id: 'A', rubric: { correctness: 3, safety: 3, completeness: 3, efficiency: 5 } },
    { id: 'B', rubric: { correctness: 5, safety: 5, completeness: 4, efficiency: 2 } },
    { id: 'C', rubric: { correctness: 2, safety: 4, completeness: 3, efficiency: 3 } },
  ];
  ok('selectByRubric: picks the highest weighted variant (B, strong on correctness/safety)', selectByRubric(variants).id === 'B');
  ok('selectByRubric: ties resolve to the earliest (stable)', selectByRubric([{ id: 'X', rubric: { correctness: 4 } }, { id: 'Y', rubric: { correctness: 4 } }]).id === 'X');
  ok('selectByRubric: empty → null', selectByRubric([]) === null);

  if (fails.length) { console.log(`\n\x1b[31madaptive-verify self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ adaptive-verify: N-scaling + rubric selection correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const task = JSON.parse(arg('--task') || '{}');
  console.log(`adaptive-verify: task risk=${task.risk || 'normal'}${task.hard ? ' (hard)' : ''} → spend N=${planN(task)} verification sample(s), select the winner by weighted rubric.`);
  process.exit(0);
}
