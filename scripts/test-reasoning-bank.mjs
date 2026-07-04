#!/usr/bin/env node
/**
 * test-reasoning-bank.mjs — zero-dep regression test for reasoning-bank.mjs (Part A capture).
 *
 * Runs in an isolated temp dir via REASONING_BANK_DIR so it never touches the real store.
 * Exit 0 = all assertions pass; exit 1 = a failure (prints which).
 *
 *   node scripts/test-reasoning-bank.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rbank-test-'));
process.env.REASONING_BANK_DIR = tmp;

const { persistArtifact, readBank, bankPath, MAX_CONTENT } = await import('./reasoning-bank.mjs');

let failed = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

// T1 — a real artifact is appended with the right shape.
const rec = persistArtifact({
  source: 'best-of-N',
  kind: 'attempt',
  key: 'wave-999',
  content: 'diff --git a/x b/x\n+hello',
  meta: { branch: 'wave-999-attempt-2' },
});
check('T1 persist returns a record for non-empty content', rec && rec.key === 'wave-999');
check('T1 store file created', fs.existsSync(bankPath()));
let bank = readBank();
check('T1 exactly one row stored', bank.length === 1);
check('T1 row carries source/kind/meta', bank[0].source === 'best-of-N' && bank[0].kind === 'attempt' && bank[0].meta.branch === 'wave-999-attempt-2');
check('T1 row has an ISO timestamp', typeof bank[0].ts === 'string' && bank[0].ts.includes('T'));

// T2 — empty / whitespace content is an HONEST no-op (no fabricated row).
const empty = persistArtifact({ source: 'reflexion', kind: 'reviewed', key: 'k', content: '   \n  ' });
check('T2 empty content returns null', empty === null);
check('T2 empty content appends nothing', readBank().length === 1);

// T3 — missing content field is also a no-op, and never throws.
let threw = false;
try {
  const none = persistArtifact({ source: 'reflexion', kind: 'reviewed', key: 'k' });
  check('T3 missing content returns null', none === null);
} catch {
  threw = true;
}
check('T3 missing content does not throw', threw === false);
check('T3 still one row', readBank().length === 1);

// T4 — oversized content is truncated, not stored whole.
const huge = 'x'.repeat(MAX_CONTENT + 5000);
persistArtifact({ source: 'best-of-N', kind: 'loser', key: 'wave-1000', content: huge });
bank = readBank();
const last = bank[bank.length - 1];
check('T4 oversized content truncated', last.content.length <= MAX_CONTENT + 64 && last.content.includes('[truncated'));

// T5 — append-only: a second write grows the store, keeps the first.
check('T5 store now has two rows', bank.length === 2);
check('T5 first row preserved', bank[0].key === 'wave-999');

// cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

if (failed === 0) {
  console.log('\n[test-reasoning-bank] PASS — all assertions green.');
  process.exit(0);
} else {
  console.error(`\n[test-reasoning-bank] FAIL — ${failed} assertion(s) failed.`);
  process.exit(1);
}
