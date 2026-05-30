// Unit tests for the PII redaction utility (lib/redaction/redact-pii.mjs).
// node:test, zero-dep. This module is imported by emit-telemetry (→ 31 scripts),
// so its correctness is load-bearing for the whole telemetry layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactPiiString, detectPiiTokens } from '../../lib/redaction/redact-pii.mjs';

test('redactPiiString masks home paths', () => {
  assert.equal(redactPiiString('at /Users/alice/code'), 'at [path]/code');
  assert.equal(redactPiiString('/home/bob/x'), '[path]/x');
});

test('redactPiiString masks emails and tokens', () => {
  assert.match(redactPiiString('mail alice@example.com'), /\[email\]/);
  assert.match(redactPiiString('tok ghp_' + 'A'.repeat(30)), /\[token\]/);
  assert.match(redactPiiString('key sk-' + 'B'.repeat(30)), /\[token\]/);
});

test('redactPiiString passes through non-strings unchanged', () => {
  assert.equal(redactPiiString(42), 42);
  assert.equal(redactPiiString(null), null);
  assert.deepEqual(redactPiiString({ a: 1 }), { a: 1 });
});

test('detectPiiTokens finds each PII class with type+value', () => {
  const tokens = detectPiiTokens('/Users/x and a@b.com');
  assert.equal(tokens.length, 2);
  const types = tokens.map(t => t.type).sort();
  assert.deepEqual(types, ['email', 'home-path']);
  assert.ok(tokens.every(t => typeof t.value === 'string'));
});

test('detectPiiTokens returns empty for clean input', () => {
  assert.deepEqual(detectPiiTokens('just plain words here'), []);
  assert.deepEqual(detectPiiTokens(42), []);
});
