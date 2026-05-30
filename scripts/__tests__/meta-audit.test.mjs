// Integration test for the closed-loop Meta-Mistake Engine (scripts/meta-audit.mjs).
// Drives the real script via execSync against a synthetic ledger (META_LEDGER) and
// asserts the EXIT CODE for each of the three loop states. This is the executable
// proof that the closed loop holds — not a manual run, a regression-guarded test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function auditExitCode(rows, today = '2026-06-20') {
  const dir = mkdtempSync(join(tmpdir(), 'meta-audit-'));
  const ledger = join(dir, 'ledger.jsonl');
  writeFileSync(ledger, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  try {
    execSync('node scripts/meta-audit.mjs', {
      cwd: ROOT,
      env: { ...process.env, META_LEDGER: ledger, META_TODAY: today },
      stdio: 'ignore',
    });
    return 0;
  } catch (e) {
    return e.status ?? -1;
  }
}

const GATED = 'declaration-over-implementation'; // a class with a gate registered since 2026-05-29

test('holding: gated class, recurrences only ON/before gate date → exit 0', () => {
  const code = auditExitCode([
    { date: '2026-05-29', class: GATED, claimed: 'x', real: 'history still leaked paths', caught_by: 'user' },
    { date: '2026-05-29', class: GATED, claimed: 'wired', real: 'no executable mechanism existed', caught_by: 'user' },
  ]);
  assert.equal(code, 0, 'a gate that has not been breached must not block');
});

test('regression: recurrence STRICTLY AFTER the gate date → exit 1', () => {
  const code = auditExitCode([
    { date: '2026-05-29', class: GATED, claimed: 'x', real: 'history leaked paths', caught_by: 'user' },
    { date: '2026-06-15', class: GATED, claimed: 'gate wired', real: 'no proof shipped; gate leaked', caught_by: 'user' },
  ]);
  assert.equal(code, 1, 'a gate breached after going live is a regression and must block');
});

test('ungated: recurring class with no registered gate → exit 1', () => {
  const code = auditExitCode([
    { date: '2026-06-01', class: 'silent-error-swallow', claimed: 'handled', real: 'empty catch block', caught_by: 'reviewer' },
    { date: '2026-06-10', class: 'silent-error-swallow', claimed: 'covered', real: 'second empty catch', caught_by: 'reviewer' },
  ]);
  assert.equal(code, 1, 'a recurring class with no gate must demand one');
});
