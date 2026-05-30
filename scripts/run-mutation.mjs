#!/usr/bin/env node
// @ts-check
/**
 * wave-131: inject synthetic faults, measure test-kill rate.
 * NOT wave-130 property (valid-input invariants).
 * NOT wave-181 fuzz (malformed inputs, crash oracle).
 * NOT wave-180 differential (frozen fixtures, stdout comparison).
 *
 * Hand-rolled mutation harness — v1 default (no Stryker dependency).
 * D1: No new devDependencies. D6: temp-copy + restore (write mutant to
 * original path, run tests, restore — bulletproof SIGINT handler included).
 * D7: reporting-only — exits 0 even if mutants survive. D8: no telemetry stream.
 *
 * Safety: lib/ source is NEVER left mutated.
 *   - Each mutant cycle: read original → write mutant → run tests → restore.
 *   - SIGINT/SIGTERM/unhandledRejection handler always restores before exit.
 *   - After any run: git diff lib/ returns empty.
 *
 * Spec: docs/specs/wave-131_MASTER_SPEC.md
 * Usage: node scripts/run-mutation.mjs  |  npm run mutation:run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── File paths ────────────────────────────────────────────────────────────────

const URL_FILE = path.join(ROOT, 'lib', 'validation', 'url.ts');
const CALC_FILE = path.join(ROOT, 'lib', 'partners', 'commissionCalculator.ts');
const REPORT_PATH = path.join(ROOT, 'docs', 'metrics', 'mutation-report.json');

// ── Restore registry (safety) ─────────────────────────────────────────────────
//
// Maps absolute file path → original content. Populated before each mutant write.
// The SIGINT/SIGTERM/unhandledRejection handler flushes this map to disk before exit.

/** @type {Map<string, string>} */
const pendingRestores = new Map();

function restoreAll() {
  for (const [filePath, content] of pendingRestores) {
    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (e) {
      process.stderr.write(`[mutation] CRITICAL: failed to restore ${filePath}: ${e.message}\n`);
    }
  }
  pendingRestores.clear();
}

// Register restore-on-interrupt handlers (D6 — SIGINT handler requirement)
function safeExit(code) {
  restoreAll();
  process.exit(code);
}

process.on('SIGINT', () => {
  process.stderr.write('\n[mutation] SIGINT received — restoring lib/ sources before exit\n');
  safeExit(0);
});
process.on('SIGTERM', () => {
  process.stderr.write('\n[mutation] SIGTERM received — restoring lib/ sources before exit\n');
  safeExit(0);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`\n[mutation] unhandledRejection: ${reason} — restoring lib/ sources\n`);
  safeExit(1);
});
process.on('uncaughtException', (err) => {
  process.stderr.write(`\n[mutation] uncaughtException: ${err.message} — restoring lib/ sources\n`);
  restoreAll();
  // Don't call safeExit here — rethrow path; let Node print the error
  process.exit(1);
});

// ── Output helpers ────────────────────────────────────────────────────────────

/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── Mutant application + restore (D6) ────────────────────────────────────────

/**
 * Write the mutated source to the original file path, run the test suite,
 * then restore the original. Returns 'killed' | 'survived'.
 *
 * @param {string} filePath - Absolute path to the source file
 * @param {string} originalContent - The original file content (pre-mutation)
 * @param {string} mutantContent - The mutated file content
 * @param {string[]} testFiles - Relative paths to test files to run
 * @returns {'killed' | 'survived'}
 */
function runMutant(filePath, originalContent, mutantContent, testFiles) {
  // Register in restore map BEFORE writing mutant (safety first)
  pendingRestores.set(filePath, originalContent);

  // Write mutant to the original path
  fs.writeFileSync(filePath, mutantContent, 'utf8');

  // Run vitest against the target test files
  // --run: single-pass (no watch)
  // --reporter=verbose: shows pass/fail per test
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', '.bin', 'vitest'),
      'run',
      '--reporter=verbose',
      ...testFiles,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: 60000, // 60s per mutant
    },
  );

  // Restore immediately after test run
  fs.writeFileSync(filePath, originalContent, 'utf8');
  pendingRestores.delete(filePath);

  // Killed = tests failed (exit code != 0); Survived = tests passed (exit code 0)
  const killed = (result.status ?? 1) !== 0;
  return killed ? 'killed' : 'survived';
}

// ── Mutant generation helpers ─────────────────────────────────────────────────

/**
 * Generate a list of mutants from a source string by applying a single
 * find-and-replace at each occurrence of `from`.
 *
 * Returns an array of { id, description, operator, mutantContent } objects.
 *
 * @param {string} id - Mutant id prefix
 * @param {string} source - Original source content
 * @param {string} from - Token to replace
 * @param {string} to - Replacement token
 * @param {string} operator - Operator class name (for report)
 * @param {string} description - Human-readable description
 * @returns {Array<{id: string, description: string, operator: string, mutantContent: string}>}
 */
function makeMutants(id, source, from, to, operator, description) {
  const mutants = [];
  let searchStart = 0;
  let occurrence = 0;

  while (true) {
    const idx = source.indexOf(from, searchStart);
    if (idx === -1) break;

    // Make sure this is not a substring of a longer token.
    // Check character before and after the match for word-boundary safety.
    const before = source[idx - 1] ?? ' ';
    const after = source[idx + from.length] ?? ' ';

    // For operator tokens (===, !==, >=, >, &&, ||, .some, .every),
    // check that the surrounding characters are not alphanumeric or underscore.
    const isWordChar = (c) => /[a-zA-Z0-9_]/.test(c);

    // For tokens starting/ending with word characters (like .some, .every),
    // ensure they are followed by non-word characters (e.g. '(').
    // This prevents 'some' inside a variable name from being mutated.
    let isSafe = true;
    if (from === '.some(') {
      // Already includes the paren, so match is exact enough
      isSafe = true;
    } else if (from === '.every(') {
      isSafe = true;
    } else if (from === '=== "https:"') {
      isSafe = true;
    } else if (from === '!== "https:"') {
      isSafe = true;
    } else if (from === '||') {
      // Don't match inside //
      isSafe = before !== '/' && after !== '/';
    } else if (from === '&&') {
      isSafe = true;
    } else if (from === '>=') {
      isSafe = true;
    } else if (from === '>') {
      // Avoid matching inside >=, => , >>
      isSafe = after !== '=' && before !== '=' && before !== '>' && after !== '>';
    } else if (from === 'return false') {
      isSafe = true;
    } else if (from === 'return true') {
      isSafe = true;
    }

    if (isSafe) {
      occurrence++;
      const mutantContent = source.slice(0, idx) + to + source.slice(idx + from.length);
      mutants.push({
        id: `${id}-occ${occurrence}`,
        description: description + (occurrence > 1 ? ` (occurrence ${occurrence})` : ''),
        operator,
        mutantContent,
      });
    }

    searchStart = idx + from.length;
  }

  return mutants;
}

// ── Mutant definitions ────────────────────────────────────────────────────────

/**
 * Build the mutant set for isSafeRedirectUrl (lib/validation/url.ts).
 * Operator classes from D2 applied to the actual code clauses:
 *   - protocol check: !== "https:" → === "https:"  (equality flip)
 *   - userinfo check: || → &&                       (boolean combinator swap)
 *   - allowlist quantifier: .some( → .every(        (quantifier swap)
 *   - guard return false → return true              (return-value inversion)
 *     (line 29: if (!url...) return false)
 *
 * @param {string} source
 */
function buildUrlMutants(source) {
  /** @type {Array<{id: string, description: string, operator: string, mutantContent: string}>} */
  const mutants = [];

  // M-URL-1: Protocol check flip: !== "https:" → === "https:"
  // Effect: allows non-https URLs through (http://, ftp://, etc.)
  mutants.push(...makeMutants(
    'M-URL-1',
    source,
    '!== "https:"',
    '=== "https:"',
    'equality-flip',
    'isSafeRedirectUrl: protocol check !== "https:" → === "https:" (allows non-https through)',
  ));

  // M-URL-2: Userinfo check combinator: || → &&
  // Effect: requires BOTH username AND password to reject — a URL with only
  // username (http://user@evil.com) passes userinfo check
  mutants.push(...makeMutants(
    'M-URL-2',
    source,
    'parsed.username || parsed.password',
    'parsed.username && parsed.password',
    'boolean-combinator-swap',
    'isSafeRedirectUrl: userinfo check || → && (requires both username AND password to reject)',
  ));

  // M-URL-3: Allowlist quantifier: .some( → .every(
  // Effect: requires ALL allowlist hosts to match (impossible — returns false for all URLs)
  mutants.push(...makeMutants(
    'M-URL-3',
    source,
    'ALLOWED_REDIRECT_HOSTS.some(',
    'ALLOWED_REDIRECT_HOSTS.every(',
    'quantifier-swap',
    'isSafeRedirectUrl: allowlist .some( → .every( (requires ALL hosts to match — always false)',
  ));

  // M-URL-4: Guard return-value flip: return false → return true (first occurrence — the !url guard)
  // Effect: null/empty/non-string inputs return true (open redirect via null coercion)
  // We target specifically the first 'return false' which is the null/type guard
  mutants.push(...makeMutants(
    'M-URL-4',
    source,
    'return false',
    'return true',
    'return-value-flip',
    'isSafeRedirectUrl: return false → return true (guard + catch both flipped)',
  ));

  return mutants;
}

/**
 * Build the mutant set for resolveTier (lib/partners/commissionCalculator.ts).
 * Operator classes from D2 applied to the actual code clauses:
 *   - dual >= boundary: activeClients >= → activeClients >   (boundary relaxation)
 *   - dual >= boundary: grossMrr >= → grossMrr >             (boundary relaxation)
 *   - boolean combinator: && → ||                            (boolean combinator swap)
 *
 * @param {string} source - Full file source
 */
function buildResolveTierMutants(source) {
  // Extract just the resolveTier function body for targeted mutation.
  // The function spans lines 26-34 in the source file.
  // Strategy: generate mutants on the full source but use line-scoped tokens
  // that are unique enough (the function body contains specific patterns).

  /** @type {Array<{id: string, description: string, operator: string, mutantContent: string}>} */
  const mutants = [];

  // The resolveTier function uses: activeClients >= threshold.minActiveClients && grossMrr >= threshold.minMonthlyGrossMrr
  // M-TIER-1: First >= (activeClients) → >
  // We need to mutate only within resolveTier, not getTierProgress.
  // The resolveTier function body has a unique clause: 'activeClients >= threshold.minActiveClients'
  mutants.push(...makeMutants(
    'M-TIER-1',
    source,
    'activeClients >= threshold.minActiveClients && grossMrr >= threshold.minMonthlyGrossMrr',
    'activeClients > threshold.minActiveClients && grossMrr >= threshold.minMonthlyGrossMrr',
    'boundary-relaxation',
    'resolveTier: activeClients >= threshold → > (excludes exact boundary clients count)',
  ));

  // M-TIER-2: Second >= (grossMrr) → >
  mutants.push(...makeMutants(
    'M-TIER-2',
    source,
    'activeClients >= threshold.minActiveClients && grossMrr >= threshold.minMonthlyGrossMrr',
    'activeClients >= threshold.minActiveClients && grossMrr > threshold.minMonthlyGrossMrr',
    'boundary-relaxation',
    'resolveTier: grossMrr >= threshold → > (excludes exact boundary MRR value)',
  ));

  // M-TIER-3: && → || in the tier condition
  // Effect: promotes to a tier if EITHER clients OR mrr meet the threshold
  mutants.push(...makeMutants(
    'M-TIER-3',
    source,
    'activeClients >= threshold.minActiveClients && grossMrr >= threshold.minMonthlyGrossMrr',
    'activeClients >= threshold.minActiveClients || grossMrr >= threshold.minMonthlyGrossMrr',
    'boolean-combinator-swap',
    'resolveTier: && → || (promotes tier if EITHER clients OR mrr meets threshold)',
  ));

  return mutants;
}

/**
 * Build the mutant set for forecastMrr (lib/partners/commissionCalculator.ts).
 * Operator classes from D2 applied to the actual code clauses:
 *   - loop boundary: i < months → i <= months    (boundary shift — extra iteration)
 *   - Math.max guard removal: Math.max(0, ...) → just the inner expression
 *   - return-value: Math.round → no rounding (would change output values)
 *
 * @param {string} source
 */
function buildForecastMrrMutants(source) {
  /** @type {Array<{id: string, description: string, operator: string, mutantContent: string}>} */
  const mutants = [];

  // M-FORECAST-1: Loop boundary: i < months → i <= months
  // Effect: produces months+1 elements instead of months — extra phantom month
  mutants.push(...makeMutants(
    'M-FORECAST-1',
    source,
    'i < months',
    'i <= months',
    'boundary-relaxation',
    'forecastMrr: loop i < months → i <= months (produces one extra phantom month)',
  ));

  // M-FORECAST-2: Remove Math.max(0, ...) floor on clients
  // Effect: clients can go negative, producing negative MRR in the series
  mutants.push(...makeMutants(
    'M-FORECAST-2',
    source,
    'clients = Math.max(0, clients + newClientsPerMonth - clients * churnRatePerMonth)',
    'clients = clients + newClientsPerMonth - clients * churnRatePerMonth',
    'guard-removal',
    'forecastMrr: remove Math.max(0,...) floor — clients can go negative, producing negative MRR',
  ));

  // M-FORECAST-3: Remove Math.round from the push — raw float instead of integer
  // This is a semantic change: series contains fractional values instead of integers.
  // The property test checks series[i] >= 0 but NOT that values are integers.
  // This is an honest test of whether the tests enforce the integer contract.
  mutants.push(...makeMutants(
    'M-FORECAST-3',
    source,
    'series.push(Math.round(clients * avgClientMrr))',
    'series.push(clients * avgClientMrr)',
    'return-value-change',
    'forecastMrr: remove Math.round — series contains raw floats instead of integers',
  ));

  return mutants;
}

// ── Target definitions ────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   file: string,
 *   function: string,
 *   testFiles: string[],
 *   buildMutants: (source: string) => Array<{id: string, description: string, operator: string, mutantContent: string}>
 * }} MutationTarget
 */

/** @type {MutationTarget[]} */
const TARGETS = [
  {
    file: 'lib/validation/url.ts',
    function: 'isSafeRedirectUrl',
    testFiles: [
      'tests/property/validators.property.test.ts',
      'lib/validation/__tests__/url.test.ts',
    ],
    buildMutants: buildUrlMutants,
  },
  {
    file: 'lib/partners/commissionCalculator.ts',
    function: 'resolveTier',
    testFiles: [
      'tests/property/commission.property.test.ts',
      'tests/commissionCalculator.test.ts',
    ],
    buildMutants: buildResolveTierMutants,
  },
  {
    file: 'lib/partners/commissionCalculator.ts',
    function: 'forecastMrr',
    testFiles: [
      'tests/property/commission.property.test.ts',
      'tests/commissionCalculator.test.ts',
    ],
    buildMutants: buildForecastMrrMutants,
  },
];

// ── Equivalent mutant registry ────────────────────────────────────────────────
//
// D4: Equivalent mutants are documented with a reason — they are NOT counted
// in the kill score denominator after triage, but MUST be explicitly listed.
//
// Key: mutant id | Value: reason string

/** @type {Record<string, string>} */
const EQUIVALENT_MUTANTS = {
  // M-URL-4-occ2 and M-URL-4-occ3 — the 'catch { return false }' flips.
  // url.ts has: (1) guard return false, (2) protocol return false, (3) catch return false.
  // When .some(...) for return-value-flip targets ALL 'return false' occurrences,
  // the third occurrence (catch block) combined with the second (protocol check)
  // produce variants that are already covered by M-URL-1. However, the second
  // occurrence (parsed.protocol !== "https:" guard) IS a distinct security-relevant
  // mutation — it is NOT equivalent. The catch-block return false (third occurrence)
  // IS equivalent: if the URL parse throws, returning true instead of false is caught
  // by the non-https property test (the thrown URL would not be parseable as a valid
  // https URL from the allowlist anyway), BUT it actually changes behavior for
  // unparseable URLs — so it is NOT equivalent either. No equivalent mutants declared
  // for URL target.
  //
  // M-FORECAST-3: Math.round removal — this mutant SURVIVES because the property tests
  // only check series[i] >= 0 and series.length === months, not that values are integers.
  // This is an honest test-gap finding (not an equivalent mutant) — the behavior IS
  // observably different (floats vs integers). Reported as surviving mutant, not equivalent.
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('[mutation] wave-131 — Hand-rolled Mutation Testing Harness');
  log('[mutation] Targets: isSafeRedirectUrl, resolveTier, forecastMrr');
  log('[mutation] Safety: lib/ sources restored after every mutant cycle (SIGINT handler active)');
  log('');

  const timestamp = new Date().toISOString();

  /**
   * @type {Array<{
   *   file: string,
   *   function: string,
   *   testFilesRun: string[],
   *   totalMutants: number,
   *   killed: number,
   *   survived: number,
   *   score: number,
   *   survivingMutants: Array<{id: string, description: string, operator: string, testFilesRun: string[]}>,
   *   equivalentMutants: Array<{id: string, description: string, reason: string}>
   * }>}
   */
  const targetResults = [];

  // Track which files have been read (we share commissionCalculator.ts across 2 targets)
  /** @type {Map<string, string>} */
  const sourceCache = new Map();

  function readSource(filePath) {
    if (!sourceCache.has(filePath)) {
      sourceCache.set(filePath, fs.readFileSync(filePath, 'utf8'));
    }
    return sourceCache.get(filePath);
  }

  for (const target of TARGETS) {
    const absFilePath = path.join(ROOT, target.file);
    const originalSource = readSource(absFilePath);

    log(`[mutation] ── Target: ${target.function} (${target.file})`);
    log(`[mutation]    Test files: ${target.testFiles.join(', ')}`);

    const rawMutants = target.buildMutants(originalSource);

    if (rawMutants.length === 0) {
      log(`[mutation]    WARNING: No mutants generated for ${target.function}`);
      targetResults.push({
        file: target.file,
        function: target.function,
        testFilesRun: target.testFiles,
        totalMutants: 0,
        killed: 0,
        survived: 0,
        score: 1,
        survivingMutants: [],
        equivalentMutants: [],
      });
      continue;
    }

    // Separate equivalent mutants from real mutants
    const equivalentMutantResults = [];
    const realMutants = rawMutants.filter((m) => {
      if (EQUIVALENT_MUTANTS[m.id]) {
        equivalentMutantResults.push({
          id: m.id,
          description: m.description,
          reason: EQUIVALENT_MUTANTS[m.id],
        });
        return false;
      }
      return true;
    });

    log(`[mutation]    Mutants: ${realMutants.length} real, ${equivalentMutantResults.length} equivalent`);
    log('');

    let killed = 0;
    let survived = 0;
    const survivingMutants = [];

    for (const mutant of realMutants) {
      process.stdout.write(`[mutation]    [${mutant.id}] ${mutant.description.substring(0, 80)}...`);

      // Verify the mutant actually changes the source (sanity check)
      if (mutant.mutantContent === originalSource) {
        process.stdout.write(' SKIP (no change — mutant target not found)\n');
        continue;
      }

      const outcome = runMutant(absFilePath, originalSource, mutant.mutantContent, target.testFiles);

      if (outcome === 'killed') {
        killed++;
        process.stdout.write(' KILLED\n');
      } else {
        survived++;
        survivingMutants.push({
          id: mutant.id,
          description: mutant.description,
          operator: mutant.operator,
          testFilesRun: target.testFiles,
        });
        process.stdout.write(' SURVIVED (test gap)\n');
      }
    }

    // Score = killed / (totalMutants - equivalentMutants) per D5
    const totalReal = realMutants.length;
    const score = totalReal > 0 ? killed / totalReal : 1;

    log('');
    log(`[mutation]    Result: ${killed}/${totalReal} killed, ${survived} survived`);
    log(`[mutation]    Score: ${(score * 100).toFixed(1)}%`);

    if (survivingMutants.length > 0) {
      log(`[mutation]    Surviving mutants (test gaps):`);
      for (const m of survivingMutants) {
        log(`[mutation]      - ${m.id}: ${m.description}`);
      }
    }
    log('');

    // Update source cache to always use the restored original
    // (important: the file is already restored by runMutant — re-read to confirm)
    const restoredContent = fs.readFileSync(absFilePath, 'utf8');
    if (restoredContent !== originalSource) {
      process.stderr.write(`[mutation] CRITICAL SAFETY FAILURE: ${target.file} not restored after mutant cycle!\n`);
      process.exit(1);
    }

    targetResults.push({
      file: target.file,
      function: target.function,
      testFilesRun: target.testFiles,
      totalMutants: totalReal,
      killed,
      survived,
      score,
      survivingMutants,
      equivalentMutants: equivalentMutantResults,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const totalMutants = targetResults.reduce((s, t) => s + t.totalMutants, 0);
  const totalKilled = targetResults.reduce((s, t) => s + t.killed, 0);
  const totalSurvived = targetResults.reduce((s, t) => s + t.survived, 0);
  const overallScore = totalMutants > 0 ? totalKilled / totalMutants : 1;

  log('[mutation] ══════════════════════════════════════════════');
  log('[mutation] SUMMARY');
  log(`[mutation]   Total mutants: ${totalMutants}`);
  log(`[mutation]   Killed:        ${totalKilled}`);
  log(`[mutation]   Survived:      ${totalSurvived} ${totalSurvived > 0 ? '(test gaps — see report)' : ''}`);
  log(`[mutation]   Overall score: ${(overallScore * 100).toFixed(1)}%`);
  log('');

  if (totalSurvived > 0) {
    log('[mutation] SURVIVING MUTANTS (honest test-gap findings):');
    for (const t of targetResults) {
      for (const m of t.survivingMutants) {
        log(`[mutation]   [${m.id}] ${m.description}`);
        log(`[mutation]      Test files ran: ${m.testFilesRun.join(', ')}`);
      }
    }
    log('');
  }

  // ── Write mutation-report.json (D5) ──────────────────────────────────────

  const report = {
    timestamp,
    wave: 'wave-131',
    harness: 'hand-rolled-v1',
    targets: targetResults,
    summary: {
      totalMutants,
      killed: totalKilled,
      survived: totalSurvived,
      overallScore,
    },
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');

  log(`[mutation] Report written: docs/metrics/mutation-report.json`);
  log('[mutation] D7: reporting-only — exit 0 regardless of surviving mutants (threshold gate is v2)');
  log('');

  // Final safety verification: confirm all lib/ sources are restored
  for (const target of TARGETS) {
    const absFilePath = path.join(ROOT, target.file);
    const originalSource = sourceCache.get(absFilePath);
    const currentContent = fs.readFileSync(absFilePath, 'utf8');
    if (currentContent !== originalSource) {
      process.stderr.write(`[mutation] SAFETY FAILURE: ${target.file} differs from original — manual restore required!\n`);
      process.exit(1);
    }
  }

  log('[mutation] Safety check passed: all lib/ sources match originals (git diff lib/ will be empty)');

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[mutation] Unexpected error: ${err.message}\n${err.stack}\n`);
  restoreAll();
  process.exit(1);
});
