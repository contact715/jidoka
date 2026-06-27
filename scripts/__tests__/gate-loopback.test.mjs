import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNext, MAX_ROUNDS } from '../gate-loopback.mjs';

test('gate pass advances to memory', () => {
  const d = decideNext({ phase: 'gate', verdict: 'pass' });
  assert.equal(d.action, 'advance');
  assert.equal(d.next, 'memory');
});

test('gate fail loops back to debug and increments the round', () => {
  const d = decideNext({ phase: 'gate', verdict: 'fail', rounds: 0 });
  assert.equal(d.action, 'loopback');
  assert.equal(d.next, 'debug');
  assert.equal(d.rounds, 1);
});

test('debug re-enters the gate', () => {
  const d = decideNext({ phase: 'debug' });
  assert.equal(d.action, 'reenter');
  assert.equal(d.next, 'gate');
});

test('the round cap escalates instead of looping forever', () => {
  assert.equal(decideNext({ phase: 'gate', verdict: 'fail', rounds: MAX_ROUNDS - 1 }).action, 'escalate');
  assert.equal(decideNext({ phase: 'gate', verdict: 'fail', rounds: MAX_ROUNDS - 2 }).action, 'loopback');
});

test('a custom maxRounds is honoured', () => {
  assert.equal(decideNext({ phase: 'gate', verdict: 'fail', rounds: 1, maxRounds: 2 }).action, 'escalate');
});

test('non-gate/debug phases and missing verdicts are no-ops', () => {
  assert.equal(decideNext({ phase: 'spec', verdict: 'pass' }).action, 'noop');
  assert.equal(decideNext({ phase: 'gate' }).action, 'noop');
});
