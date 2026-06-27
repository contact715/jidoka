// Wires claim-wave-id's built-in self-test into the engine battery (npm run test:engine).
// The real scenarios (unit parsing, first claim, second claimer, rejected-push race,
// registry-only source, no-remote fallback, uncommitted-local-spec source) live inside
// scripts/claim-wave-id.mjs --self-test so the installed copy stays self-verifying in
// any target project; this wrapper asserts that battery exits 0 here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

test('claim-wave-id --self-test passes (claim races resolve to distinct wave numbers)', () => {
  const out = execSync('node scripts/claim-wave-id.mjs --self-test', {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.match(out, /self-test/i);
});
