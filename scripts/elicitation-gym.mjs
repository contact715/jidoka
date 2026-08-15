#!/usr/bin/env node
// elicitation-gym — an OUTCOME score for clarify-engine: did the questions actually surface the
// implicit requirements a human labelled, or did they merely look like good questions?
//
// THE GAP (2026-W29-R2). Everything measuring clarify-engine today measures PROCESS: is the
// question well-formed, non-leading, one-at-a-time. Nothing measures the OUTCOME — whether the
// requirement a human knew was hiding in the brief actually came out. A set of impeccable
// questions that surfaces nothing scores perfectly on process and is worthless.
//
// ── THE HONEST BOUNDARY, AND WHY THIS SHIPS DORMANT ─────────────────────────
// The recommendation's whole value is SCARCE HUMAN-LABELLED MATERIAL: 101 scenarios with
// aspect-typed implicit requirements, vendored from a public benchmark AFTER CHECKING ITS LICENCE.
// That licence check is a human decision and the vendoring is a human act, so this ships with the
// scorer built and the dataset ABSENT.
//
// Generating plausible scenarios to fill it would be worse than shipping nothing. The property
// being bought is "labelled by a human who knew the answer"; synthetic scenarios written by the
// same system that is being scored are the system agreeing with itself, which is precisely
// `core-property-substituted-by-scaffold` — and this engine grew a tripwire for that class three
// hours before this file was written. So: DORMANT is reported as DORMANT, loudly, and the exit
// code stays 0 because an unfinished dataset is not a failing gate.
//
// TO ACTIVATE: put one JSON object per line in docs/evals/elicitation/scenarios.jsonl —
//   { "id": "S-01", "brief": "...", "implicit": ["retention policy", "who may export"] }
// and record the source + licence in that directory's README. Then this file starts scoring.
//
// FULL (scorer) & DORMANT (dataset). Usage:
//   node scripts/elicitation-gym.mjs --self-test
//   node scripts/elicitation-gym.mjs            # scores if the dataset exists, else says DORMANT

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATASET = process.env.ELICITATION_SET || join(ROOT, 'docs', 'evals', 'elicitation', 'scenarios.jsonl');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Did the asked questions surface this implicit requirement? Pure.
 * Deterministic containment, not a judge: a requirement counts as surfaced when its words appear
 * in what was asked. Crude on purpose — a fuzzy matcher here would be an unmeasured judge deciding
 * its own score, which is the failure this whole file exists to avoid.
 */
export function surfaced(requirement, questions = []) {
  const need = norm(requirement).split(' ').filter((w) => w.length > 2);
  if (!need.length) return false;
  const hay = questions.map(norm).join(' ');
  return need.every((w) => hay.includes(w));
}

/**
 * Score one scenario. Pure.
 * @returns {{id:string, found:string[], missed:string[], recall:number|null}}
 */
export function scoreScenario(scenario = {}, questions = []) {
  const implicit = Array.isArray(scenario.implicit) ? scenario.implicit : [];
  const found = implicit.filter((r) => surfaced(r, questions));
  const missed = implicit.filter((r) => !surfaced(r, questions));
  return {
    id: scenario.id ?? '(unnamed)',
    found, missed,
    // a scenario with nothing to find cannot score 100% — it scores NOTHING, and says so
    recall: implicit.length ? Math.round((found.length / implicit.length) * 100) / 100 : null,
  };
}

/**
 * Score a whole run. Pure.
 * An EMPTY dataset is `dormant`, never a perfect score — the vacuum-green rule this engine
 * already applies to req-trace and to task coverage.
 */
export function scoreRun(scenarios = [], askFn) {
  if (!scenarios.length) {
    return { state: 'dormant', scored: 0, recall: null, rows: [], reason: 'набора сценариев нет: это НЕ 100%, это «не измерено»' };
  }
  if (typeof askFn !== 'function') {
    return { state: 'dormant', scored: 0, recall: null, rows: [], reason: 'нет источника вопросов — измерять нечем' };
  }
  const rows = scenarios.map((s) => scoreScenario(s, askFn(s) || []));
  const scored = rows.filter((r) => r.recall !== null);
  const recall = scored.length ? Math.round((scored.reduce((a, r) => a + r.recall, 0) / scored.length) * 100) / 100 : null;
  return {
    state: 'measured',
    scored: scored.length,
    recall,
    rows,
    reason: `измерено сценариев: ${scored.length}, средняя полнота ${recall}`,
  };
}

export function loadScenarios(file = DATASET) {
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  // FIXTURES, not the dataset. They prove the scorer's arithmetic; they prove nothing about
  // clarify-engine, because a system scoring itself on its own examples measures nothing.
  const scenario = { id: 'S-01', brief: 'export tool', implicit: ['retention policy', 'who may export'] };

  ok('a requirement whose words were asked about counts as surfaced',
    surfaced('retention policy', ['What is the retention policy for exports?']) === true);
  ok('a requirement nobody asked about is missed',
    surfaced('retention policy', ['What format should the export use?']) === false);
  ok('matching ignores case and punctuation',
    surfaced('Retention-Policy', ['what is the retention policy?']) === true);
  ok('ALL words must appear, not just one',
    surfaced('who may export', ['who is the user?']) === false);
  ok('an empty requirement never counts as surfaced', surfaced('', ['anything']) === false);

  const half = scoreScenario(scenario, ['What is the retention policy?']);
  ok('recall counts only what was actually surfaced', half.recall === 0.5);
  ok('the missed requirement is named, not just counted', half.missed.join() === 'who may export');
  ok('all surfaced → recall 1', scoreScenario(scenario, ['retention policy', 'who may export']).recall === 1);
  // the vacuum-green rule: nothing to find is not everything found
  ok('a scenario with no implicit requirements scores NULL, never 100%',
    scoreScenario({ id: 'x', implicit: [] }, ['q']).recall === null);

  const run = scoreRun([scenario], () => ['What is the retention policy?']);
  ok('a run over real scenarios is measured', run.state === 'measured' && run.recall === 0.5);
  ok('an EMPTY dataset is dormant, never a perfect score',
    scoreRun([], () => []).state === 'dormant' && scoreRun([], () => []).recall === null);
  ok('the dormant reason says it is unmeasured rather than fine',
    /не измерено/.test(scoreRun([], () => []).reason));
  ok('no question source → dormant, not a zero score', scoreRun([scenario], null).state === 'dormant');

  ok('a missing dataset file loads as empty, not as a crash', loadScenarios('/nowhere/none.jsonl').length === 0);

  if (fails) { console.log(`\n\x1b[31melicitation-gym self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ elicitation-gym: outcome recall scored honestly; no dataset reads as DORMANT, never as 100%\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const scenarios = loadScenarios();
  if (!scenarios.length) {
    console.log('elicitation-gym: \x1b[33mDORMANT\x1b[0m — размеченного набора нет.');
    console.log(`  Ожидается: ${DATASET.replace(process.env.HOME || '', '~')}`);
    console.log('  Ценность этой меры — В ЧЕЛОВЕЧЕСКОЙ РАЗМЕТКЕ. Сгенерировать сценарии самому значило бы');
    console.log('  измерять систему её же выдумками: это подмена несущего свойства каркасом.');
    console.log('  Нужен человек: свериться с лицензией источника, положить набор, записать источник рядом.');
    process.exit(0);   // незаполненный набор — это не упавший гейт
  }
  const run = scoreRun(scenarios, () => []);
  console.log(`elicitation-gym: ${run.state} — ${run.reason}`);
  process.exit(0);
}
