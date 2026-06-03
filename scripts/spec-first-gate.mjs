#!/usr/bin/env node
/**
 * check-spec-first — the mechanical Spec-First Read Gate.
 *
 * Mirrors the reuse-scan / pfca-K7 pattern: a behavioral rule is only real if a
 * mechanism fires without voluntary compliance (ANTI_PATTERNS_CATALOG #2
 * partial-closure-via-documentation, #5 over-documentation).
 *
 * Failure class this closes (root cause, 2026-06-02): in this spec-driven
 * project the controlling spec is the source of truth and code is derived, yet
 * an implementation task can begin by reading/writing product code WITHOUT first
 * reading the controlling spec via `get-spec-context.mjs`. The tool to read the
 * spec existed (wave-117); the forcing function to require it did not.
 *
 * This gate: when staged changes touch product code (app/, components/, lib/),
 * confirm a get-spec-context run was recorded recently
 * (docs/audits/spec-context-runs.jsonl, written by get-spec-context.mjs).
 *
 * Usage:
 *   node scripts/check-spec-first.mjs --staged            # gate a commit (WARN)
 *   node scripts/check-spec-first.mjs --staged --block     # exit 1 instead of WARN
 *   node scripts/check-spec-first.mjs --staged --since 8h  # window (default 6h)
 *
 * Honest limit: like reuse-scan, this verifies the gate-script was RUN, not that
 * the spec was truly internalised. It is the SAME strength of enforcement the
 * project already trusts for reuse — a forcing function, not a proof. The
 * behavioral half lives in CLAUDE.md "Spec-First Read Gate"; this is the
 * mechanical half that makes the rule non-voluntary.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const staged = args.includes('--staged');
const block = args.includes('--block');
const sinceArg = args.find((_, i) => args[i - 1] === '--since') ?? '6h';

// Product-code roots that REQUIRE a controlling spec read first.
const PRODUCT_DIRS = ['app/', 'components/', 'lib/', 'src/'];
// Process / meta / infra paths — exempt (the meta-engine governs these, not the
// product spec hierarchy; fixing a forcing function is not a product feature).
const EXEMPT = ['scripts/', 'docs/', 'tests/', 'test/', '.husky/', '.githooks/', '.jidoka/', '.github/'];

function parseSince(s) {
  const m = /^(\d+)([hmd])$/.exec(String(s).trim());
  if (!m) return 6 * 3600_000;
  return Number(m[1]) * { m: 60_000, h: 3600_000, d: 86_400_000 }[m[2]];
}

function stagedFiles() {
  try {
    return execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isProductCode(file) {
  if (EXEMPT.some((e) => file.startsWith(e))) return false;
  return PRODUCT_DIRS.some((d) => file.startsWith(d));
}

function recentSpecRun(windowMs) {
  const LOG = 'docs/audits/spec-context-runs.jsonl';
  if (!existsSync(LOG)) return null;
  const now = Date.now();
  let latest = null;
  for (const line of readFileSync(LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      const t = Date.parse(rec.ts);
      if (Number.isFinite(t) && now - t <= windowMs) {
        if (!latest || t > Date.parse(latest.ts)) latest = rec;
      }
    } catch {
      /* skip malformed line */
    }
  }
  return latest;
}

function main() {
  if (!staged) {
    console.log('check-spec-first: pass --staged to gate a commit. (dry mode, no-op)');
    process.exit(0);
  }

  const productTouched = stagedFiles().filter(isProductCode);
  if (productTouched.length === 0) {
    console.log('check-spec-first: no product-code changes staged — gate N/A.');
    process.exit(0);
  }

  const run = recentSpecRun(parseSince(sinceArg));
  if (run) {
    console.log(
      `check-spec-first: PASS — get-spec-context run found (${run.feature} → ${run.matched ?? 'not-found'}) within ${sinceArg}.`,
    );
    process.exit(0);
  }

  const shown = productTouched.slice(0, 5).join(', ') + (productTouched.length > 5 ? ', …' : '');
  const msg =
    `check-spec-first: SPEC-FIRST GATE\n` +
    `  Product code staged (${shown}) but NO get-spec-context run in the last ${sinceArg}.\n` +
    `  This is a spec-driven project: the spec is the source of truth, code is derived. Read the spec first.\n` +
    `  Run:  node scripts/get-spec-context.mjs --feature <keyword>\n` +
    `  Then read the controlling spec, find what it mandates that code has not implemented, THEN edit code.`;

  if (block) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
  process.exit(0);
}

main();
