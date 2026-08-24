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
  const s = String(text);
  let m = s.match(/\bWINNER:\s*([A-D])\b/i);                                 // best-of-N: explicit pick
  if (m) return m[1].toUpperCase();
  m = s.match(/\b(VIOLATION|DEADLOCK|CONTESTED|BLOCK|REVISE|PASS|FAIL)\b/);   // verdict words (before bare letter, so BLOCK ≠ B)
  if (m) return m[1];
  m = s.match(/\b([A-D])\b/);                                                // bare candidate letter (best-of-N golden text)
  return m ? m[1].toUpperCase() : null;
}

// diagnosis-passthrough (2026-W32-R12) — the run rows carry the agent's own reasoning, and
// score() threw it away, keeping a single boolean per case. So the only thing that reached the
// improvement loop was a number: "72%". A number cannot tell you what to change.
//
// GEPA's (gepa-ai/gepa) load-bearing detail is that mutation is driven by ACTIONABLE SIDE
// INFORMATION — the diagnostic text of why a case failed — not by a scalar. The system was
// already producing that text and discarding it one line later. This carries it through.
//
// A miss is also classified, because the three kinds need different fixes and used to look
// identical in the score:
//   no-run        the case was never executed — a harness problem, not an agent problem
//   no-verdict    the agent answered, but no verdict could be extracted — a format problem
//   wrong-verdict the agent decided, and decided wrong — the only kind a prompt patch addresses

/** Why a case did not match, in a form a prompt-evolver can act on. Pure. */
export function classifyMiss(expected, got, hasRun) {
  if (!hasRun) return 'no-run';
  if (got === null) return 'no-verdict';
  return 'wrong-verdict';
}

/**
 * 2026-W35-B3 — сгруппировать прогоны по кейсу, НЕ схлопывая их.
 *
 * Раньше здесь стояло `Object.fromEntries(runRows.map(r => [r.case_id, r]))`. У этой
 * записи есть тихое свойство: при нескольких прогонах одного кейса остаётся ПОСЛЕДНИЙ,
 * остальные молча исчезают. Прибор при этом печатает законную на вид точность,
 * посчитанную по одному произвольному прогону из N. Один прогон недетерминированной
 * системы это не измерение, а анекдот.
 *
 * @param {Array<{case_id:string}>} runRows
 * @returns {Map<string, object[]>}
 */
export function groupRuns(runRows = []) {
  const m = new Map();
  for (const r of runRows) {
    if (!r || !r.case_id) continue;
    if (!m.has(r.case_id)) m.set(r.case_id, []);
    m.get(r.case_id).push(r);
  }
  return m;
}

/**
 * 2026-W35-B3 — свести прогоны кейса по ИМЕНОВАННОМУ правилу.
 * Умолчание `all`: кейс засчитан, только если совпали ВСЕ прогоны. Самое строгое, а не
 * самое удобное — мягкое умолчание тихо превратилось бы в новое «не менее одного из двух».
 * @param {boolean[]} matches
 * @param {'all'|'majority'|'any'} rule
 */
export function reduceCase(matches = [], rule = 'all') {
  const n = matches.length, passed = matches.filter(Boolean).length;
  if (n === 0) return { match: false, rule, n, passed };
  if (rule === 'any') return { match: passed > 0, rule, n, passed };
  if (rule === 'majority') return { match: passed * 2 > n, rule, n, passed };
  return { match: passed === n, rule, n, passed };
}

export function score(goldenRows, runRows, opts = {}) {
  const rule = opts.rule || 'all';
  const grouped = groupRuns(runRows);
  const results = goldenRows.map(g => {
    const expected = extractVerdict(g.expected_output ?? g.expected);
    const runs = grouped.get(g.case_id) || [];
    const run = runs[runs.length - 1] || null; // для диагностики берём последний
    // ВСЕ прогоны кейса, а не последний: доля считается по именованному правилу.
    const perRun = runs.map(r => {
      const v = extractVerdict(r.verdict ?? r.output);
      return v !== null && v === expected;
    });
    const red = reduceCase(perRun, rule);
    const got = run ? extractVerdict(run.verdict ?? run.output) : null;
    const match = red.match;
    // trials/rule печатаются рядом с исходом: без них «совпало» не отличить от
    // «совпало в одном прогоне из трёх».
    const row = { case_id: g.case_id, expected, got, match, trials: red.n, agreed: red.passed, rule: red.rule };
    if (!match) {
      row.missKind = classifyMiss(expected, got, !!run);
      // the agent's own words about this case, which is the only input a patch can be derived
      // from. Kept verbatim, only trimmed, so nothing is paraphrased away.
      const raw = run ? String(run.reasoning ?? run.output ?? run.verdict ?? '') : '';
      row.diagnosis = raw.replace(/\s+/g, ' ').trim().slice(0, 600) || null;
      row.input = String(g.input ?? g.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    }
    return row;
  });
  const matches = results.filter(r => r.match).length;
  return {
    results,
    matches,
    total: goldenRows.length,
    accuracy: goldenRows.length ? matches / goldenRows.length : 0,
    // ready-to-consume: every miss with its reason, so a caller never has to re-derive it
    misses: results.filter(r => !r.match),
  };
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
    ['extractVerdict reads DEADLOCK (not BLOCK)', extractVerdict('DEADLOCK — tie') === 'DEADLOCK'],
    ['extractVerdict reads WINNER line (best-of-N)', extractVerdict('WINNER: B') === 'B'],
    ['extractVerdict reads a bare candidate letter', extractVerdict('A — it is correct, B has a bug') === 'A'],
    ['BLOCK still beats bare-letter B', extractVerdict('BLOCK — unsafe') === 'BLOCK'],
    ['extractVerdict returns null on no verdict', extractVerdict('hmm not sure') === null],
    ['a perfect run scores 100%', score(golden, perfect).accuracy === 1],
    ['one wrong verdict scores 2/3', Math.abs(score(golden, oneOff).accuracy - 2 / 3) < 1e-9],
    ['a missing run case does not count as a match', score(golden, missing).matches === 2],

    // ── diagnosis passthrough (2026-W32-R12) ────────────────────────────────
    ['a perfect run reports no misses', score(golden, perfect).misses.length === 0],
    ['misses are collected ready to use', score(golden, oneOff).misses.length === 1],
    ['a wrong verdict is classified as wrong-verdict', score(golden, oneOff).misses[0].missKind === 'wrong-verdict'],
    ['an absent case is classified as no-run, not as a wrong answer', score(golden, missing).misses[0].missKind === 'no-run'],
    ['an unparseable answer is classified as no-verdict',
      score([{ case_id: 'a', expected_output: 'PASS' }], [{ case_id: 'a', verdict: 'мне кажется всё нормально' }]).misses[0].missKind === 'no-verdict'],
    ['the agent reasoning survives into the miss',
      score([{ case_id: 'a', expected_output: 'PASS' }], [{ case_id: 'a', verdict: 'BLOCK', reasoning: 'я счёл отсутствие теста нарушением' }]).misses[0].diagnosis === 'я счёл отсутствие теста нарушением'],
    ['reasoning falls back to output when there is no reasoning field',
      score([{ case_id: 'a', expected_output: 'PASS' }], [{ case_id: 'a', output: 'BLOCK потому что нет теста' }]).misses[0].diagnosis === 'BLOCK потому что нет теста'],
    ['the golden input travels with the miss so a patch has both sides',
      score([{ case_id: 'a', expected_output: 'PASS', input: 'диff добавляет тест' }], [{ case_id: 'a', verdict: 'BLOCK' }]).misses[0].input === 'диff добавляет тест'],
    ['a matched case carries no diagnosis (nothing to explain)',
      score(golden, perfect).results[0].diagnosis === undefined],
    ['a no-run miss has a null diagnosis rather than a fabricated one',
      score(golden, missing).misses[0].diagnosis === null],
    ['whitespace in reasoning is normalised, not dropped',
      score([{ case_id: 'a', expected_output: 'PASS' }], [{ case_id: 'a', verdict: 'BLOCK', reasoning: 'строка\n\nвторая   строка' }]).misses[0].diagnosis === 'строка вторая строка'],

    // ── 2026-W35-B3: эпохи больше не схлопываются «последний победил» ──────────
    ['несколько прогонов одного кейса СОХРАНЯЮТСЯ, а не схлопываются',
      groupRuns([{ case_id: 'a', verdict: 'PASS' }, { case_id: 'a', verdict: 'BLOCK' }]).get('a').length === 2],
    ['РАСХОЖДЕНИЕ: последний прогон совпал, но совпали не все — кейс НЕ засчитан',
      score([{ case_id: 'a', expected_output: 'PASS' }],
        [{ case_id: 'a', verdict: 'BLOCK' }, { case_id: 'a', verdict: 'PASS' }]).matches === 0],
    ['со старым правилом «последний победил» этот же вход дал бы совпадение',
      extractVerdict('PASS') === extractVerdict([{ case_id: 'a', verdict: 'BLOCK' }, { case_id: 'a', verdict: 'PASS' }].at(-1).verdict)],
    ['все прогоны совпали — кейс засчитан',
      score([{ case_id: 'a', expected_output: 'PASS' }],
        [{ case_id: 'a', verdict: 'PASS' }, { case_id: 'a', verdict: 'PASS' }]).matches === 1],
    ['правило majority: два из трёх засчитывают кейс',
      score([{ case_id: 'a', expected_output: 'PASS' }],
        [{ case_id: 'a', verdict: 'PASS' }, { case_id: 'a', verdict: 'BLOCK' }, { case_id: 'a', verdict: 'PASS' }],
        { rule: 'majority' }).matches === 1],
    ['число прогонов и правило едут вместе с исходом',
      (() => { const r = score([{ case_id: 'a', expected_output: 'PASS' }], [{ case_id: 'a', verdict: 'PASS' }, { case_id: 'a', verdict: 'PASS' }]).results[0]; return r.trials === 2 && r.agreed === 2 && r.rule === 'all'; })()],
    ['умолчание строгое: правило all, а не any', reduceCase([true, false]).rule === 'all' && reduceCase([true, false]).match === false],
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
  for (const x of r.results) {
    console.log(`  ${x.match ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${x.case_id}: expected ${x.expected}, got ${x.got ?? '(no run)'}${x.missKind ? `  [${x.missKind}]` : ''}`);
    // diagnosis-passthrough: print WHY, because a prompt patch cannot be derived from a number
    if (x.diagnosis) console.log(`      диагноз агента: ${x.diagnosis.slice(0, 200)}`);
  }
  if (r.misses.length) {
    const kinds = r.misses.reduce((a, m) => { a[m.missKind] = (a[m.missKind] || 0) + 1; return a; }, {});
    console.log(`\n  промахи по видам: ${Object.entries(kinds).map(([k, n]) => `${k}=${n}`).join(', ')}`);
    console.log('  \x1b[2mno-run это дефект прогона, no-verdict это формат ответа, и только wrong-verdict лечится правкой промпта.\x1b[0m');
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify({ accuracy: r.accuracy, misses: r.misses }, null, 2));
  console.log('  \x1b[2msnapshot of one LLM run on a small set — re-run the agent periodically; not a CI gate.\x1b[0m');
  process.exit(0);
}
