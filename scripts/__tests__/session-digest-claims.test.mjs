// Wires the session-start-digest claim-warning self-test into the engine battery.
// The scenario (fresh foreign claim surfaces, stale claim filtered, local+upstream
// registry union deduped) lives inside hooks/session-start-digest.mjs --self-test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

test('session-start-digest --self-test passes (fresh claims warned, stale filtered)', () => {
  const out = execSync('node hooks/session-start-digest.mjs --self-test', {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.match(out, /клейм/i);
  assert.match(out, /✓/);
});
