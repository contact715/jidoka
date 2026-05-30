#!/usr/bin/env node
/**
 * Parses Vitest and Playwright JSON reporter output.
 *
 * Reads:
 *   .test-results/vitest.json    — Vitest --reporter=json output
 *   .test-results/playwright.json — Playwright --reporter=json output
 *
 * Emits one line per failure:
 *   [FAIL] <file> :: <test name> — <error first line>
 *
 * Exit 0 always (parsing errors are reported, not fatal).
 *
 * Usage:
 *   node scripts/extract-test-failures.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, '.test-results');

let totalFails = 0;

// ── Vitest JSON parser ────────────────────────────────────────────────────
function parseVitest() {
  const jsonPath = path.join(RESULTS_DIR, 'vitest.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('SKIP: .test-results/vitest.json not found — run vitest with --reporter=json first');
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (err) {
    console.log(`WARN: Could not parse vitest.json — ${err.message}`);
    return;
  }

  // Vitest JSON shape: { testResults: [{ testFilePath, status, assertionResults: [...] }] }
  // Also supports { files: [...] } shape from vitest v2+
  const files = data.testResults || data.files || [];

  for (const file of files) {
    const filePath = file.testFilePath || file.filepath || file.name || '(unknown file)';
    const relative = filePath.startsWith(ROOT)
      ? filePath.slice(ROOT.length + 1)
      : filePath;

    const assertions = file.assertionResults || file.tasks || [];
    for (const assertion of flattenAssertions(assertions)) {
      if (assertion.status === 'failed' || assertion.status === 'fail') {
        const name = assertion.fullName || assertion.name || '(unnamed test)';
        const msgs = assertion.failureMessages || assertion.errors || [];
        const firstLine = msgs.length > 0
          ? String(msgs[0]).split('\n')[0].trim().slice(0, 120)
          : '(no message)';
        console.log(`[FAIL] ${relative} :: ${name} — ${firstLine}`);
        totalFails++;
      }
    }
  }
}

/** Flatten vitest task tree (nested suites) into a flat assertion list */
function flattenAssertions(tasks) {
  const result = [];
  for (const t of tasks) {
    if (t.type === 'suite' && t.tasks) {
      result.push(...flattenAssertions(t.tasks));
    } else {
      result.push(t);
    }
  }
  return result;
}

// ── Playwright JSON parser ───────────────────────────────────────────────
function parsePlaywright() {
  const jsonPath = path.join(RESULTS_DIR, 'playwright.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('SKIP: .test-results/playwright.json not found — run playwright with --reporter=json first');
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (err) {
    console.log(`WARN: Could not parse playwright.json — ${err.message}`);
    return;
  }

  // Playwright JSON shape: { suites: [{ file, specs: [{ ok, title, tests: [{ results: [...] }] }] }] }
  const suites = data.suites || [];
  for (const suite of suites) {
    const file = suite.file || suite.title || '(unknown file)';
    walkPlaywrightSuite(suite, file);
  }
}

function walkPlaywrightSuite(suite, file) {
  const specs = suite.specs || [];
  for (const spec of specs) {
    if (!spec.ok) {
      const title = spec.title || spec.fullTitle || '(unnamed spec)';
      const tests = spec.tests || [];
      for (const test of tests) {
        const results = test.results || [];
        for (const result of results) {
          if (result.status === 'failed' || result.status === 'timedOut') {
            const errors = result.errors || result.attachments || [];
            const firstMsg = errors.length > 0 && errors[0].message
              ? String(errors[0].message).split('\n')[0].trim().slice(0, 120)
              : `status: ${result.status}`;
            console.log(`[FAIL] ${file} :: ${title} — ${firstMsg}`);
            totalFails++;
          }
        }
      }
    }
  }

  // Recursive: suites may be nested
  const nestedSuites = suite.suites || [];
  for (const nested of nestedSuites) {
    walkPlaywrightSuite(nested, file);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
parseVitest();
parsePlaywright();

if (totalFails > 0) {
  console.log(`\nTotal failures: ${totalFails}`);
} else {
  console.log('No failures found in test results.');
}

process.exit(0); // always 0 — failures are reported as output, not exit code
