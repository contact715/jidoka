// Unit tests for the Meta-Mistake Engine shared core (scripts/meta-lib.mjs).
// Uses node:test — zero dependencies, runs on a clean clone with `node --test`,
// no npm install required (the engine is zero-dep, so its tests are too).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, monthOf, groupByClass, recurrencesAfter, decisionConflict, safeClassMerges } from '../meta-lib.mjs';

test('daysBetween counts whole days', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-08'), 7);
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 0);
  assert.equal(daysBetween('2026-05-29', '2026-06-15'), 17);
});

test('monthOf extracts YYYY-MM', () => {
  assert.equal(monthOf('2026-05-29'), '2026-05');
  assert.equal(monthOf('2026-12-01'), '2026-12');
});

test('groupByClass buckets rows by class', () => {
  const g = groupByClass([{ class: 'a' }, { class: 'b' }, { class: 'a' }]);
  assert.equal(g.a.length, 2);
  assert.equal(g.b.length, 1);
  assert.equal(Object.keys(g).length, 2);
});

test('recurrencesAfter returns only incidents STRICTLY after the gate date', () => {
  const items = [
    { date: '2026-05-01' }, // before
    { date: '2026-05-29' }, // same day as gate = provoked it, not a recurrence
    { date: '2026-06-15' }, // strictly after = recurrence through the gate
  ];
  const after = recurrencesAfter(items, '2026-05-29');
  assert.equal(after.length, 1);
  assert.equal(after[0].date, '2026-06-15');
});

test('recurrencesAfter is empty when no gate date (ungated class)', () => {
  assert.deepEqual(recurrencesAfter([{ date: '2026-01-01' }], null), []);
  assert.deepEqual(recurrencesAfter([{ date: '2026-01-01' }], undefined), []);
});

test('recurrencesAfter sorts results ascending', () => {
  const items = [{ date: '2026-08-01' }, { date: '2026-07-01' }];
  const after = recurrencesAfter(items, '2026-06-01');
  assert.equal(after[0].date, '2026-07-01');
  assert.equal(after[1].date, '2026-08-01');
});

// ── decision-conflict probe (2026-W33-R8, DeMem) ─────────────────────────────
// suggestClassMerges proposes a merge from SHARED WORDS. On the real ledger it proposes exactly
// one today, and that one is wrong: "read the spec BEFORE writing" and "make sure a spec covers
// what was written" share the words and prescribe different actions. Merging them deletes one of
// the two behaviours from memory, quietly.

test('a merge whose halves prescribe opposite timing is blocked', () => {
  const v = decisionConflict(
    { cls: 'code-first-in-spec-driven', text: 'read the controlling spec FIRST; code is derived' },
    { cls: 'spec-written-after-the-code', text: 'files written, no spec names them' },
  );
  assert.equal(v.conflict, true, 'before vs after must not be merged into one lesson');
  assert.match(v.reason, /момент действия/);
});

test('the class SLUG is read, not only the incident prose', () => {
  // the real case states its timing in the name and never in the text — reading prose alone
  // made the probe answer "safe" on the exact pair it exists for
  const v = decisionConflict(
    { cls: 'code-first-in-spec-driven', text: '' },
    { cls: 'spec-written-after-the-code', text: '' },
  );
  assert.equal(v.conflict, true);
});

test('two classes with DIFFERENT registered gates never merge', () => {
  const v = decisionConflict({ cls: 'a', text: 'x' }, { cls: 'b', text: 'x' },
    { a: { mechanism: 'hooks/one.mjs' }, b: { mechanism: 'hooks/two.mjs' } });
  assert.equal(v.conflict, true, 'two gates means two defects, whatever the words say');
});

test('the same gate on both sides is not a conflict', () => {
  const v = decisionConflict({ cls: 'a', text: 'x' }, { cls: 'b', text: 'x' },
    { a: { mechanism: 'hooks/one.mjs' }, b: { mechanism: 'hooks/one.mjs' } });
  assert.equal(v.conflict, false);
});

test('opposite polarity blocks a merge', () => {
  const v = decisionConflict(
    { cls: 'run-the-check', text: 'always run the check' },
    { cls: 'skip-the-check', text: 'never run the check' },
  );
  assert.equal(v.conflict, true);
});

test('genuinely identical lessons stay mergeable', () => {
  const v = decisionConflict(
    { cls: 'gate-bypass', text: 'the agent went around the gate' },
    { cls: 'gate-casing-bypass', text: 'the agent went around the gate' },
  );
  assert.equal(v.conflict, false, 'the probe must not block every merge — that would be useless');
});

test('blocked merges stay VISIBLE with their reason, never silently dropped', () => {
  const { safe, blocked } = safeClassMerges(
    [{ a: 'code-first-in-spec-driven', b: 'spec-written-after-the-code', shared: ['code', 'spec'] }],
    {}, {},
  );
  assert.equal(safe.length, 0);
  assert.equal(blocked.length, 1);
  assert.ok(blocked[0].reason.length > 10, 'a blocked merge must say why');
});


test('recurrencesAfter: запись о ПОЧИНКЕ протечкой не считается', () => {
  // Поле kind заведено (W32-R8), чтобы заметка о ремонте не считалась второй ошибкой, но
  // функция, решающая «протёк ли гейт», его не читала. Вскрылось 2026-08-22: два гейта попали
  // в REGRESSION из-за собственных записей о починке, датированных на день позже даты гейта.
  const items = [
    { date: '2026-07-25', kind: 'remediation', class: 'x', real: 'systemic fix: построен гейт' },
    { date: '2026-07-26', kind: 'incident', class: 'x', real: 'снова случилось' },
  ];
  const leaks = recurrencesAfter(items, '2026-07-24');
  assert.equal(leaks.length, 1, 'починка не должна попадать в протечки');
  assert.equal(leaks[0].date, '2026-07-26');
});

test('recurrencesAfter: запись без kind считается инцидентом (старые строки не теряются)', () => {
  const leaks = recurrencesAfter([{ date: '2026-07-25', class: 'x' }], '2026-07-24');
  assert.equal(leaks.length, 1);
});

test('recurrencesAfter: только починки после гейта означают ноль протечек', () => {
  const items = [
    { date: '2026-08-20', kind: 'remediation', class: 'y' },
    { date: '2026-08-21', kind: 'remediation', class: 'y' },
  ];
  assert.equal(recurrencesAfter(items, '2026-08-17').length, 0);
});
