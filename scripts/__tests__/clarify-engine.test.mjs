import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAXONOMY, newCoverage, questionPlan, applyAnswer, summary, renderClarificationsMd,
} from '../clarify-engine.mjs';
import {
  featureFromSpecPath, isMasterSpec, parseSince, coverageComplete,
} from '../clarify-gate.mjs';

test('fresh coverage: every category missing, not complete', () => {
  const cov = newCoverage('demo');
  const s = summary(cov);
  assert.equal(s.missing, TAXONOMY.length);
  assert.equal(s.complete, false);
});

test('question plan is ordered by impact × uncertainty', () => {
  const cov = newCoverage('demo');
  const plan = questionPlan(cov);
  assert.equal(plan.length, TAXONOMY.length);
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i - 1].score >= plan[i].score);
});

test('short answer is partial, substantive answer is clear', () => {
  const cov = newCoverage('demo');
  applyAnswer(cov, 'problem', 'short');
  assert.equal(cov.categories.problem.state, 'partial');
  applyAnswer(cov, 'problem', 'A concrete, substantive description of the actual problem and the current workaround.');
  assert.equal(cov.categories.problem.state, 'clear');
});

test('clear answers drop out of the plan, partial stay (lower score)', () => {
  const cov = newCoverage('demo');
  applyAnswer(cov, 'problem', 'A concrete, substantive description long enough to be considered clear.');
  const plan = questionPlan(cov);
  assert.ok(!plan.find((c) => c.key === 'problem'), 'clear category leaves the plan');
});

test('unknown category and reasonless defer throw', () => {
  const cov = newCoverage('demo');
  assert.throws(() => applyAnswer(cov, 'nope', 'x'));
  assert.throws(() => applyAnswer(cov, 'data', '', { defer: true }));
});

test('defer-with-reason counts toward completeness', () => {
  const cov = newCoverage('demo');
  for (const c of TAXONOMY) applyAnswer(cov, c.key, 'A substantive, concrete answer of sufficient length to be clear.');
  assert.equal(summary(cov).complete, true);
  applyAnswer(cov, 'data', 'not needed for MVP', { defer: true });
  assert.equal(cov.categories.data.state, 'deferred');
  assert.equal(summary(cov).complete, true);
});

test('markdown render contains the section and every category title', () => {
  const cov = newCoverage('demo');
  const md = renderClarificationsMd(cov);
  assert.ok(md.includes('## Clarifications'));
  for (const c of TAXONOMY) assert.ok(md.includes(c.title));
});

test('gate: feature derivation from spec paths', () => {
  assert.equal(featureFromSpecPath('docs/specs/wave-foo_MASTER_SPEC.md'), 'wave-foo');
  assert.equal(featureFromSpecPath('docs/specs/sub/My_Thing_MASTER_SPEC.md'), 'my-thing');
});

test('gate: master-spec recognition', () => {
  assert.ok(isMasterSpec('docs/specs/x_MASTER_SPEC.md'));
  assert.ok(!isMasterSpec('docs/specs/_LINEAGE.md'));
  assert.ok(!isMasterSpec('scripts/foo.mjs'));
});

test('gate: since-window parsing with fallback', () => {
  assert.equal(parseSince('48h'), 48 * 3600_000);
  assert.equal(parseSince('garbage'), 24 * 3600_000);
});

test('gate: coverage completeness rules', () => {
  const rd = (obj) => () => JSON.stringify(obj);
  const yes = () => true;
  assert.ok(coverageComplete('x', rd({ categories: { a: { state: 'clear' }, b: { state: 'deferred', reason: 'r' } } }), yes).complete);
  assert.ok(!coverageComplete('x', rd({ categories: { a: { state: 'clear' }, b: { state: 'missing' } } }), yes).complete);
  assert.ok(!coverageComplete('x', rd({ categories: { a: { state: 'deferred', reason: '' } } }), yes).complete);
  assert.ok(!coverageComplete('x', () => '', () => false).complete);
});
