#!/usr/bin/env node
// memory-eval — scores the retriever against golden cases. Deterministic, no LLM, no network.
//
// abstention-cases (2026-W32-R14, gives 2026-W31-R11 its external form)
//
// Until now the only evidence that memory-retrieve worked was its own self-test: the code that
// wrote the ranking also wrote the expectation. That is not evidence, it is agreement with
// oneself. LongMemEval (xiaowu0162, 976 stars) names five things a memory has to be able to do
// — information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and
// ABSTENTION — and the fifth is the one a retriever built on ranking can never pass by accident.
//
// Abstention is the honest negative case. `retrieve()` always returns k items: when nothing in
// the corpus overlaps the query it falls back to recency, so it answers a question it has no
// information about, confidently, with whatever was written most recently. A self-test would
// never catch that, because returning something IS what the function is for.
//
// Zero dependencies. Usage:
//   node scripts/memory-eval.mjs --self-test
//   node scripts/memory-eval.mjs [--file docs/evals/memory-retrieve/golden-cases.jsonl] [--json]

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieve } from './memory-retrieve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = 'docs/evals/memory-retrieve/golden-cases.jsonl';

// ── pure core ────────────────────────────────────────────────────────────────

/**
 * Judge one case against what the retriever returned. Pure.
 * @param {object} c        the golden case
 * @param {object[]} ranked what retrieve() gave back, best first
 */
export function judgeCase(c, ranked) {
  const exp = c.expect || {};
  const top = ranked[0];

  if (exp.abstain) {
    // The only honest answer to a question the corpus cannot answer is "I have nothing".
    // Anything with zero lexical overlap is not an answer, it is the most recent note.
    const abstained = !top || top.relevance === 0;
    return {
      pass: abstained,
      got: abstained ? '(воздержался)' : `${top.title} (релевантность ${top.relevance.toFixed(3)})`,
      why: abstained ? 'нет пересечения с корпусом, ответа не дано' : 'выдан ответ на вопрос, которого нет в памяти',
    };
  }
  if (!top) return { pass: false, got: '(пусто)', why: 'ничего не вернулось' };

  if (exp.top) return { pass: top.title === exp.top, got: top.title, why: `ожидался «${exp.top}»` };
  if (exp.topIn) return { pass: exp.topIn.includes(top.title), got: top.title, why: `ожидался один из ${exp.topIn.join(' | ')}` };
  if (exp.topRecencyWins) {
    // two items with the same title: the fresher one must win
    const fresher = [...ranked].sort((a, b) => (b.recency || 0) - (a.recency || 0))[0];
    return { pass: top.recency === fresher.recency, got: `recency=${top.recency}`, why: `свежая запись должна была выиграть (recency=${fresher.recency})` };
  }
  return { pass: false, got: top.title, why: 'у случая нет проверяемого ожидания' };
}

/** Aggregate per competency. Pure. */
export function summarize(rows) {
  const by = {};
  for (const r of rows) {
    const k = r.competency || '(без категории)';
    by[k] ??= { total: 0, passed: 0 };
    by[k].total++;
    if (r.pass) by[k].passed++;
  }
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  return { total, passed, accuracy: total ? passed / total : 0, byCompetency: by };
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('a correct top hit passes', judgeCase({ expect: { top: 'a' } }, [{ title: 'a', relevance: 0.5 }]).pass === true);
  ok('a wrong top hit fails', judgeCase({ expect: { top: 'a' } }, [{ title: 'b', relevance: 0.5 }]).pass === false);
  ok('the failure says what was expected', /ожидался «a»/.test(judgeCase({ expect: { top: 'a' } }, [{ title: 'b', relevance: 0.5 }]).why));
  ok('topIn accepts any of the listed', judgeCase({ expect: { topIn: ['a', 'b'] } }, [{ title: 'b', relevance: 0.4 }]).pass === true);
  ok('topIn rejects one outside the list', judgeCase({ expect: { topIn: ['a', 'b'] } }, [{ title: 'c', relevance: 0.4 }]).pass === false);

  // abstention: the case the whole file exists for
  ok('zero relevance counts as abstention', judgeCase({ expect: { abstain: true } }, [{ title: 'x', relevance: 0 }]).pass === true);
  ok('an empty result counts as abstention', judgeCase({ expect: { abstain: true } }, []).pass === true);
  ok('answering an unanswerable question fails', judgeCase({ expect: { abstain: true } }, [{ title: 'x', relevance: 0.3 }]).pass === false);
  ok('the abstention failure says what went wrong',
    /ответ на вопрос, которого нет/.test(judgeCase({ expect: { abstain: true } }, [{ title: 'x', relevance: 0.3 }]).why));

  ok('recency tiebreak: fresher wins', judgeCase({ expect: { topRecencyWins: true } }, [{ title: 'a', recency: 10 }, { title: 'a', recency: 1 }]).pass === true);
  ok('recency tiebreak: stale on top fails', judgeCase({ expect: { topRecencyWins: true } }, [{ title: 'a', recency: 1 }, { title: 'a', recency: 10 }]).pass === false);
  ok('a case with no expectation cannot silently pass', judgeCase({ expect: {} }, [{ title: 'a', relevance: 1 }]).pass === false);

  const s = summarize([
    { competency: 'abstention', pass: false }, { competency: 'abstention', pass: false },
    { competency: 'information-extraction', pass: true },
  ]);
  ok('summary counts overall', s.total === 3 && s.passed === 1);
  ok('summary splits by competency', s.byCompetency.abstention.passed === 0 && s.byCompetency['information-extraction'].passed === 1);
  ok('accuracy is a fraction, not a percentage', Math.abs(s.accuracy - 1 / 3) < 1e-9);

  if (fails) { console.log(`\n\x1b[31mmemory-eval self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ memory-eval: judging correct, abstention is a real failure mode\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('memory-eval.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const i = argv.indexOf('--file');
  const file = path.join(ROOT, i !== -1 ? argv[i + 1] : DEFAULT_FILE);
  if (!existsSync(file)) { console.error(`memory-eval: нет файла случаев ${file}`); process.exit(2); }

  // the first line is a _meta record (it carries the point-of-integration anchor), not a case
  const cases = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => !c._meta);
  const rows = cases.map((c) => {
    // retrieve() returns { results, relevanceDriven }, not a bare array. Getting this wrong made
    // every case read as 'nothing returned', which silently PASSED the abstention cases for the
    // wrong reason. A green that comes from a broken harness is worse than a red.
    const { results: ranked } = retrieve(c.corpus || [], c.query || '', 5);
    const v = judgeCase(c, ranked);
    return { case_id: c.case_id, competency: c.competency, ...v };
  });
  const s = summarize(rows);

  if (argv.includes('--json')) { console.log(JSON.stringify({ ...s, rows }, null, 2)); process.exit(s.passed === s.total ? 0 : 1); }

  console.log(`memory-eval: ${s.passed}/${s.total} (${Math.round(s.accuracy * 100)}%)\n`);
  for (const r of rows) {
    console.log(`  ${r.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.case_id.padEnd(16)} ${String(r.competency).padEnd(24)} ${r.got}`);
    if (!r.pass) console.log(`      ${r.why}`);
  }
  console.log('\n  по способностям:');
  for (const [k, v] of Object.entries(s.byCompetency)) console.log(`    ${k.padEnd(26)} ${v.passed}/${v.total}`);
  process.exit(s.passed === s.total ? 0 : 1);
}
