import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushRing, detect, DEFAULT_CAP } from '../stuck-detector.mjs';

test('pushRing appends and caps to the most recent', () => {
  assert.deepEqual(pushRing([], 'a', 3), ['a']);
  assert.deepEqual(pushRing(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
  assert.equal(pushRing(Array(40).fill('x'), 'y').length, DEFAULT_CAP);
});

test('short ring is never stuck', () => {
  assert.equal(detect([]).stuck, false);
  assert.equal(detect(['a', 'b']).stuck, false);
});

test('repeated-action', () => {
  assert.equal(detect(['x', 'x', 'x', 'x']).pattern, 'repeated-action');
  assert.equal(detect(['a', 'a', 'a']).stuck, false); // below ×4
});

test('monologue (empty steps)', () => {
  assert.equal(detect(['', '', '', '']).pattern, 'monologue');
});

test('repeated-error', () => {
  assert.equal(detect(['do', 'error: boom', 'do', 'error: boom', 'do', 'error: boom']).pattern, 'repeated-error');
});

test('ping-pong oscillation', () => {
  assert.equal(detect(['a', 'b', 'a', 'b', 'a', 'b']).pattern, 'ping-pong');
});

test('repeating cycle window', () => {
  assert.equal(detect(['p', 'q', 'r', 'p', 'q', 'r']).pattern, 'cycle');
  assert.equal(detect(['p', 'p', 'p', 'p', 'p', 'p']).pattern, 'repeated-action'); // single-element window is not a cycle
});

test('healthy varied progress is not stuck', () => {
  assert.equal(detect(['a', 'b', 'c', 'd', 'e', 'f']).stuck, false);
});
