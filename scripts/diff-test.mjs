#!/usr/bin/env node
// @ts-check
/**
 * Wave-180 — Differential (Golden/Approval) Testing Harness
 *
 * Runs each of the 6 deterministic validate-* scripts against their frozen
 * fixture descriptor in scripts/differential-fixtures/, captures stdout,
 * normalizes away genuinely nondeterministic fields (UUID v4, ISO timestamps),
 * and compares the normalized output against a committed golden baseline in
 * docs/differential-baselines/.
 *
 * Behavior:
 *   - Missing baseline file → [diff] SEED-REQUIRED <slug> + exit nonzero (NOT vacuous pass)
 *   - Output diff detected  → [diff] FAIL <slug> <case_id> + unified diff + exit 1
 *   - All match            → [diff] PASS <slug> <case_id> + exit 0
 *   - --update flag        → reseed all baseline files from real runs + exit 0
 *                            Does NOT git-commit or git-add (human reviews diff first)
 *
 * SCOPE IN (D2): validate-raci, validate-schema, validate-glossary,
 *   validate-runbooks, validate-gdpr-inventory, validate-dr-catalog.
 *
 * SCOPE OUT (D2): compute-slos, compute-dora, compute-cost, detect-recurrences,
 *   detect-drift — wall-clock / git-log dependencies make these non-diffable
 *   without time-pinning infrastructure. Hard block in v1.
 *
 * No telemetry emitted. No new JSONL stream. Exit code is the signal. (D7)
 *
 * Normalization (D4): declarative rules from scripts/normalize.json.
 *   strip_uuid_v4       — replaces UUID v4 pattern with <UUID>
 *   strip_iso_timestamps — replaces ISO 8601 timestamps with <TIMESTAMP>
 *   Nothing else is scrubbed — violation counts, PASS/FAIL labels, metric
 *   values all appear in the baseline unmodified.
 *
 * Baseline shape (mirrors scripts/.bundle-baseline.json):
 *   {
 *     "_comment": "Seeded wave-180 YYYY-MM-DD via npm run diff:update",
 *     "lastUpdated": "YYYY-MM-DD",
 *     "cases": {
 *       "[case_id]": {
 *         "fixture": "scripts/differential-fixtures/<slug>-case-01.json",
 *         "exit_code": 0,
 *         "stdout_normalized": "<normalized stdout string>"
 *       }
 *     }
 *   }
 *
 * Usage:
 *   node scripts/diff-test.mjs            # check — exits 0 (all match) or 1 (diff found)
 *   node scripts/diff-test.mjs --update   # reseed baselines from real runs
 *   npm run diff:run
 *   npm run diff:update
 *
 * Spec: docs/specs/wave-180_MASTER_SPEC.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────────
const FIXTURES_DIR = path.join(ROOT, 'scripts', 'differential-fixtures');
const BASELINES_DIR = path.join(ROOT, 'docs', 'differential-baselines');
const NORMALIZE_PATH = path.join(ROOT, 'scripts', 'normalize.json');

// ── CLI args ──────────────────────────────────────────────────────────────────
const updateMode = process.argv.includes('--update');

// ── Output helpers ────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── Load normalization config ─────────────────────────────────────────────────
/** @type {{ uuid_v4_pattern: string, uuid_v4_replacement: string, iso_timestamp_pattern: string, iso_timestamp_replacement: string, rules: Record<string, { strip_uuid_v4: boolean, strip_iso_timestamps: boolean }> }} */
let normalizeConfig;
try {
  normalizeConfig = JSON.parse(fs.readFileSync(NORMALIZE_PATH, 'utf8'));
} catch (err) {
  log(`[diff] ERROR: Failed to load normalize.json: ${err.message}`);
  process.exit(1);
}

// ── Normalization ─────────────────────────────────────────────────────────────
/**
 * Apply normalization rules for a given slug to a raw stdout string.
 * Scrubs UUID v4 and ISO 8601 timestamps per declarative config.
 * Does NOT scrub violation counts, metric values, or PASS/FAIL labels.
 *
 * @param {string} slug - Script slug (e.g. "validate-raci")
 * @param {string} text - Raw stdout string
 * @returns {string} Normalized string suitable for baseline comparison
 */
function normalize(slug, text) {
  const rules = normalizeConfig.rules[slug];
  if (!rules) return text;

  let out = text;

  if (rules.strip_uuid_v4) {
    // UUID v4 pattern: [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
    const uuidRe = new RegExp(normalizeConfig.uuid_v4_pattern, 'gi');
    out = out.replace(uuidRe, normalizeConfig.uuid_v4_replacement);
  }

  if (rules.strip_iso_timestamps) {
    // ISO 8601: YYYY-MM-DDTHH:MM:SS(.mmm)?Z?
    const tsRe = new RegExp(normalizeConfig.iso_timestamp_pattern, 'g');
    out = out.replace(tsRe, normalizeConfig.iso_timestamp_replacement);
  }

  return out;
}

// ── Unified diff (minimal inline implementation) ───────────────────────────────
/**
 * Generate a simple line-by-line unified diff between two strings.
 * Returns a string showing only differing lines with context.
 *
 * @param {string} expected - Baseline (normalized)
 * @param {string} actual - Current run (normalized)
 * @returns {string} Diff output
 */
function unifiedDiff(expected, actual) {
  const expLines = expected.split('\n');
  const actLines = actual.split('\n');
  const maxLen = Math.max(expLines.length, actLines.length);
  const diffLines = [];
  let hasDiff = false;

  for (let i = 0; i < maxLen; i++) {
    const e = expLines[i] ?? '(missing)';
    const a = actLines[i] ?? '(missing)';
    if (e !== a) {
      hasDiff = true;
      diffLines.push(`  line ${i + 1}:`);
      diffLines.push(`  - ${e}`);
      diffLines.push(`  + ${a}`);
    }
  }

  if (!hasDiff) return '(no text diff — possible exit_code mismatch)';
  return diffLines.join('\n');
}

// ── Baseline I/O ──────────────────────────────────────────────────────────────
/**
 * @param {string} slug
 * @returns {string}
 */
function baselinePath(slug) {
  return path.join(BASELINES_DIR, `${slug}.golden.json`);
}

/**
 * @param {string} slug
 * @returns {{ _comment: string, lastUpdated: string, cases: Record<string, { fixture: string, exit_code: number, stdout_normalized: string }> } | null}
 */
function readBaseline(slug) {
  const bPath = baselinePath(slug);
  if (!fs.existsSync(bPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(bPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} slug
 * @param {Record<string, { fixture: string, exit_code: number, stdout_normalized: string }>} cases
 */
function writeBaseline(slug, cases) {
  const today = new Date().toISOString().slice(0, 10);
  const bPath = baselinePath(slug);
  const payload = {
    _comment: `Seeded wave-180 ${today} via npm run diff:update`,
    lastUpdated: today,
    cases,
  };
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  fs.writeFileSync(bPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

// ── Fixture discovery ─────────────────────────────────────────────────────────
/**
 * Read all fixture descriptor files from differential-fixtures/ directory.
 * Returns them sorted by slug then case_id for deterministic ordering.
 *
 * @returns {Array<{ slug: string, case_id: string, script: string, args: string[], fixturePath: string }>}
 */
function loadFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    log(`[diff] ERROR: Fixtures directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const fixtures = [];
  for (const f of files) {
    const fixturePath = path.join(FIXTURES_DIR, f);
    let descriptor;
    try {
      descriptor = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    } catch (err) {
      log(`[diff] ERROR: Failed to parse fixture ${f}: ${err.message}`);
      process.exit(1);
    }
    fixtures.push({
      slug: descriptor.slug,
      case_id: descriptor.case_id,
      script: descriptor.script,
      args: descriptor.args ?? [],
      fixturePath: path.relative(ROOT, fixturePath),
    });
  }

  return fixtures;
}

// ── Run a target script ───────────────────────────────────────────────────────
/**
 * Spawns the target script and captures its stdout.
 * stderr is inherited (printed to console but not captured in baseline).
 *
 * @param {string} scriptRelPath - e.g. "scripts/validate-raci.mjs"
 * @param {string[]} args - Extra CLI arguments
 * @returns {{ stdout: string, exitCode: number }}
 */
function runScript(scriptRelPath, args) {
  const scriptAbs = path.join(ROOT, scriptRelPath);
  const result = spawnSync(process.execPath, [scriptAbs, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // stdout captured; stderr inherited so it appears in console during harness run
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env },
  });

  return {
    stdout: result.stdout ?? '',
    exitCode: result.status ?? 1,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(`[diff] Wave-180 Differential Testing Harness`);
  log(`[diff] Mode: ${updateMode ? '--update (reseed baselines)' : 'check'}`);
  log('');

  const fixtures = loadFixtures();

  if (fixtures.length === 0) {
    log('[diff] ERROR: No fixture descriptors found in scripts/differential-fixtures/');
    process.exit(1);
  }

  // Group fixtures by slug to write one baseline file per slug
  /** @type {Map<string, Array<{ case_id: string, script: string, args: string[], fixturePath: string }>>} */
  const bySlug = new Map();
  for (const fx of fixtures) {
    if (!bySlug.has(fx.slug)) bySlug.set(fx.slug, []);
    bySlug.get(fx.slug)?.push(fx);
  }

  let anyFail = false;
  let anySeedRequired = false;

  if (updateMode) {
    // ── Seed mode: run all scripts, capture, write baselines ──────────────
    log('[diff] Seeding baselines from real validator runs...');
    log('');

    for (const [slug, cases] of bySlug) {
      /** @type {Record<string, { fixture: string, exit_code: number, stdout_normalized: string }>} */
      const caseMap = {};

      for (const fx of cases) {
        log(`[diff] Running ${fx.script} (${fx.args.join(' ') || 'no extra args'})...`);
        const { stdout, exitCode } = runScript(fx.script, fx.args);
        const normalizedStdout = normalize(slug, stdout);

        caseMap[fx.case_id] = {
          fixture: fx.fixturePath,
          exit_code: exitCode,
          stdout_normalized: normalizedStdout,
        };

        log(`[diff] Captured ${slug} ${fx.case_id} — exit_code=${exitCode}, ${normalizedStdout.split('\n').length} line(s)`);
      }

      writeBaseline(slug, caseMap);
      log(`[diff] Wrote docs/differential-baselines/${slug}.golden.json`);
      log('');
    }

    log('[diff] Baseline seeding complete. Review git diff docs/differential-baselines/ before committing.');
    log('[diff] Do NOT commit without human review of the baseline changes. This is the Q3 gate.');
    process.exit(0);

  } else {
    // ── Check mode: compare current output against committed baselines ────
    for (const [slug, cases] of bySlug) {
      const baseline = readBaseline(slug);

      if (!baseline) {
        // D3: missing baseline is NOT a vacuous pass — it is a SEED-REQUIRED error
        log(`[diff] SEED-REQUIRED ${slug} — no committed baseline at docs/differential-baselines/${slug}.golden.json`);
        log(`[diff]   Run: npm run diff:update   then review git diff and commit.`);
        anySeedRequired = true;
        continue;
      }

      for (const fx of cases) {
        const baselineCase = baseline.cases[fx.case_id];

        if (!baselineCase) {
          log(`[diff] SEED-REQUIRED ${slug} ${fx.case_id} — case not found in baseline`);
          log(`[diff]   Run: npm run diff:update   then review git diff and commit.`);
          anySeedRequired = true;
          continue;
        }

        const { stdout, exitCode } = runScript(fx.script, fx.args);
        const normalizedStdout = normalize(slug, stdout);

        // Compare both exit code and normalized stdout
        const stdoutMatch = normalizedStdout === baselineCase.stdout_normalized;
        const exitCodeMatch = exitCode === baselineCase.exit_code;

        if (stdoutMatch && exitCodeMatch) {
          log(`[diff] PASS ${slug} ${fx.case_id}`);
        } else {
          anyFail = true;
          log(`[diff] FAIL ${slug} ${fx.case_id}`);

          if (!exitCodeMatch) {
            log(`[diff]   exit_code: expected=${baselineCase.exit_code} got=${exitCode}`);
          }

          if (!stdoutMatch) {
            log('[diff]   stdout diff (normalized):');
            const diff = unifiedDiff(baselineCase.stdout_normalized, normalizedStdout);
            for (const line of diff.split('\n')) {
              log(`[diff]   ${line}`);
            }
          }

          log(`[diff]   To accept this change: review it, then run npm run diff:update and commit.`);
        }
      }
    }

    log('');

    if (anySeedRequired) {
      log('[diff] RESULT: SEED-REQUIRED — one or more baselines are missing.');
      log('[diff]   Run: npm run diff:update   then review git diff docs/differential-baselines/ and commit.');
      process.exit(1);
    }

    if (anyFail) {
      log('[diff] RESULT: FAIL — one or more scripts produced output that differs from the committed baseline.');
      log('[diff]   If the change is intentional: npm run diff:update   then review and commit.');
      log('[diff]   If the change is a regression: revert the script change.');
      process.exit(1);
    }

    log('[diff] RESULT: PASS — all scripts match their committed baselines.');
    process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`[diff] Unexpected error: ${err.message}\n`);
  process.exit(1);
});
