#!/usr/bin/env node
// llm-eval-score — the DETERMINISTIC half of the LLM-agent eval track.
//
// The split is honest: running an LLM agent on a golden case is an LLM call (done via the Task
// tool / a dispatched subagent — non-deterministic, costs tokens, recorded to a run-<date>.jsonl).
// SCORING that run against the known-correct golden verdicts is pure and deterministic — that is
// this script. It turns "we have golden cases" (scaffolding) into "the agent scored N/M on them"
// (a measured number), which is what lifts an agent from DORMANT to MEASURED.
//
// It does NOT run the model itself (that would be non-deterministic and can't live in the eval
// suite). It scores a recorded run. Re-run the agent periodically; score is a snapshot, not a gate.
//
// FULL & self-tested. Usage:
//   node scripts/llm-eval-score.mjs --self-test
//   node scripts/llm-eval-score.mjs --golden docs/evals/<agent>/golden-cases.jsonl --run docs/evals/<agent>/run-<date>.jsonl

import { readFileSync, existsSync } from 'node:fs';

const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// pull the categorical verdict out of either a golden expected_output or a run verdict field
export function extractVerdict(text) {
  const m = String(text).match(/\b(VIOLATION|BLOCK|REVISE|PASS|FAIL)\b/);
  return m ? m[1] : null;
}

export function score(goldenRows, runRows) {
  const byId = Object.fromEntries(runRows.map(r => [r.case_id, r]));
  const results = goldenRows.map(g => {
    const expected = extractVerdict(g.expected_output ?? g.expected);
    const run = byId[g.case_id];
    const got = run ? extractVerdict(run.verdict ?? run.output) : null;
    return { case_id: g.case_id, expected, got, match: got !== null && got === expected };
  });
  const matches = results.filter(r => r.match).length;
  return { results, matches, total: goldenRows.length, accuracy: goldenRows.length ? matches / goldenRows.length : 0 };
}

function selfTest() {
  const golden = [
    { case_id: 'a', expected_output: 'VIOLATION — privacy' },
    { case_id: 'b', expected_output: 'PASS — aligns' },
    { case_id: 'c', expected_output: 'VIOLATION — human approval' },
  ];
  const perfect = [{ case_id: 'a', verdict: 'VIOLATION' }, { case_id: 'b', verdict: 'PASS' }, { case_id: 'c', verdict: 'VIOLATION' }];
  const oneOff = [{ case_id: 'a', verdict: 'VIOLATION' }, { case_id: 'b', verdict: 'VIOLATION' }, { case_id: 'c', verdict: 'VIOLATION' }];
  const missing = [{ case_id: 'a', verdict: 'VIOLATION' }, { case_id: 'b', verdict: 'PASS' }]; // c absent
  const T = [
    ['extractVerdict reads a golden line', extractVerdict('VIOLATION — privacy') === 'VIOLATION'],
    ['extractVerdict reads a VERDICT: line', extractVerdict('VERDICT: PASS') === 'PASS'],
    ['extractVerdict returns null on no verdict', extractVerdict('hmm not sure') === null],
    ['a perfect run scores 100%', score(golden, perfect).accuracy === 1],
    ['one wrong verdict scores 2/3', Math.abs(score(golden, oneOff).accuracy - 2 / 3) < 1e-9],
    ['a missing run case does not count as a match', score(golden, missing).matches === 2],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mllm-eval-score self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ llm-eval-score: scoring correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const goldenPath = arg('--golden'), runPath = arg('--run');
  if (!goldenPath || !runPath || !existsSync(goldenPath) || !existsSync(runPath)) {
    console.error('usage: --golden <golden-cases.jsonl> --run <run-<date>.jsonl>  (both must exist)'); process.exit(2);
  }
  const r = score(readJsonl(goldenPath), readJsonl(runPath));
  console.log(`llm-eval-score: ${r.matches}/${r.total} correct (${(r.accuracy * 100).toFixed(0)}% on this golden set)`);
  for (const x of r.results) console.log(`  ${x.match ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${x.case_id}: expected ${x.expected}, got ${x.got ?? '(no run)'}`);
  console.log('  \x1b[2msnapshot of one LLM run on a small set — re-run the agent periodically; not a CI gate.\x1b[0m');
  process.exit(0);
}
