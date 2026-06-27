import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utilityFactor, surfacePriorOf, computeUtility } from '../memory-curator.mjs';

test('utilityFactor: Laplace-smoothed, neutral at no evidence', () => {
  assert.equal(utilityFactor(0, 0), 0.5);
  assert.ok(utilityFactor(5, 0) > 0.5);
  assert.ok(utilityFactor(0, 5) < 0.5);
});

test('surfacePriorOf: live risks surface above solved lessons, clamped', () => {
  assert.ok(surfacePriorOf({ tier: 'ACTIVE', gated: false, recurAfter: 0 }) >
            surfacePriorOf({ tier: 'DORMANT', gated: true, recurAfter: 0 }));
  assert.ok(surfacePriorOf({ tier: 'WATCH', gated: true, recurAfter: 2 }) >
            surfacePriorOf({ tier: 'WATCH', gated: true, recurAfter: 0 }));
  assert.ok(surfacePriorOf({ tier: 'ACTIVE', gated: false, recurAfter: 9 }) <= 1);
});

const remedies = { leak: { since: '2026-01-10', mechanism: 'm', family: ['leak-2'] } };

test('computeUtility: recurrence after gate-since marks the class harmful', () => {
  const rows = [
    { date: '2026-01-05', class: 'leak', claimed: 'a', real: 'b' }, // provoked the gate
    { date: '2026-02-01', class: 'leak', claimed: 'c', real: 'd' }, // recurrence after gate
  ];
  const u = computeUtility(rows, remedies, {}, '2026-02-10');
  assert.equal(u.classes.leak.recurAfter, 1);
  assert.ok(u.classes.leak.harmful >= 1);
});

test('computeUtility: a holding gate (no recurrence) is helpful', () => {
  // incident BEFORE the gate went live, none after → the gate is holding.
  const rows = [{ date: '2026-01-05', class: 'leak', claimed: 'x', real: 'y' }];
  const u = computeUtility(rows, remedies, {}, '2026-02-10');
  assert.equal(u.classes.leak.recurAfter, 0);
  assert.equal(u.classes.leak.helpful, 1);
});

test('computeUtility: family member inherits the gate; unknown class is ungated', () => {
  const rows = [
    { date: '2026-02-09', class: 'leak-2', claimed: 'p', real: 'q' },
    { date: '2026-02-09', class: 'mystery', claimed: 'r', real: 's' },
  ];
  const u = computeUtility(rows, remedies, {}, '2026-02-10');
  assert.equal(u.classes['leak-2'].gated, true);
  assert.equal(u.classes.mystery.gated, false);
});

test('computeUtility: manual overrides are layered on top', () => {
  // before-since date → autoHarmful 0, so the harmful count is exactly the manual override.
  const rows = [{ date: '2026-01-05', class: 'leak', claimed: 'x', real: 'y' }];
  const u = computeUtility(rows, remedies, { leak: { helpful: 0, harmful: 4 } }, '2026-02-10');
  assert.equal(u.classes.leak.harmful, 4);
});
