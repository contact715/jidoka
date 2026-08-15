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

// Dates are DERIVED from the live registry, never typed in. This file went red on 2026-08-14
// because it hard-coded "a gate registered since 2026-05-29" for a class whose registry entry had
// moved on: `strengthened` was added on 2026-08-11 and the fixture's 2026-06-15 recurrence stopped
// being an open regression. The assertion was still right; only its arithmetic was stale. A test
// that restates a fact the registry owns will keep breaking every time the registry is edited.
const { REMEDIES } = await import(join(ROOT, 'scripts', 'meta-remedies.mjs'));
const dayAfter = (iso, days = 1) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
// a plain gated class: registered, never strengthened — the simple "breach blocks" case
const GATED = Object.keys(REMEDIES).find((k) => REMEDIES[k].since && !REMEDIES[k].strengthened);
const GATE_SINCE = REMEDIES[GATED].since;

test('holding: gated class, recurrences only ON/before gate date → exit 0', () => {
  const code = auditExitCode([
    { date: GATE_SINCE, class: GATED, claimed: 'x', real: 'history still leaked paths', caught_by: 'user' },
    { date: GATE_SINCE, class: GATED, claimed: 'wired', real: 'no executable mechanism existed', caught_by: 'user' },
  ], dayAfter(GATE_SINCE, 14));
  assert.equal(code, 0, 'a gate that has not been breached must not block');
});

test('regression: recurrence STRICTLY AFTER the gate date → exit 1', () => {
  const breach = dayAfter(GATE_SINCE, 9);
  const code = auditExitCode([
    { date: GATE_SINCE, class: GATED, claimed: 'x', real: 'history leaked paths', caught_by: 'user' },
    { date: breach, class: GATED, claimed: 'gate wired', real: 'no proof shipped; gate leaked', caught_by: 'user' },
  ], dayAfter(breach, 5));
  assert.equal(code, 1, 'a gate breached after going live is a regression and must block');
});

// ── the `strengthened` field (shipped 2026-08-11 with no test of its own) ────
// It changes the verdict of a real state, so it needs both halves proven: a leak the strengthening
// answered stops blocking, and a leak the strengthening did NOT answer still blocks. Shipping the
// first half untested is what put main red — the behaviour was right, nothing guarded its edges.
const STRENGTHENED = Object.keys(REMEDIES).find((k) => REMEDIES[k].strengthened);

test('a leak BETWEEN the gate date and the strengthening no longer blocks', { skip: !STRENGTHENED }, () => {
  const r = REMEDIES[STRENGTHENED];
  const code = auditExitCode([
    { date: r.since, class: STRENGTHENED, claimed: 'wired', real: 'leaked at the old mechanism', caught_by: 'user' },
    { date: dayAfter(r.since, 9), class: STRENGTHENED, claimed: 'fixed', real: 'leaked again at the old mechanism', caught_by: 'user' },
  ], dayAfter(r.strengthened, 3));
  assert.equal(code, 0, 'a regression already answered by a strengthening is closed, not open forever');
});

test('a leak AFTER the strengthening blocks again', { skip: !STRENGTHENED }, () => {
  const r = REMEDIES[STRENGTHENED];
  const breach = dayAfter(r.strengthened, 4);
  const code = auditExitCode([
    { date: r.since, class: STRENGTHENED, claimed: 'wired', real: 'leaked at the old mechanism', caught_by: 'user' },
    { date: breach, class: STRENGTHENED, claimed: 'strengthened', real: 'leaked THROUGH the strengthening', caught_by: 'user' },
  ], dayAfter(breach, 5));
  assert.equal(code, 1, 'if the strengthening leaks too, the class is red again');
});

test('ungated: recurring class with no registered gate → exit 1', () => {
  const code = auditExitCode([
    { date: '2026-06-01', class: 'silent-error-swallow', claimed: 'handled', real: 'empty catch block', caught_by: 'reviewer' },
    { date: '2026-06-10', class: 'silent-error-swallow', claimed: 'covered', real: 'second empty catch', caught_by: 'reviewer' },
  ]);
  assert.equal(code, 1, 'a recurring class with no gate must demand one');
});
