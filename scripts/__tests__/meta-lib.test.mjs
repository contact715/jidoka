// Unit tests for the Meta-Mistake Engine shared core (scripts/meta-lib.mjs).
// Uses node:test — zero dependencies, runs on a clean clone with `node --test`,
// no npm install required (the engine is zero-dep, so its tests are too).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, monthOf, groupByClass, recurrencesAfter } from '../meta-lib.mjs';

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
