#!/usr/bin/env node
// @ts-check
/**
 * Wave-181 — Fuzz Testing Harness
 *
 * Fuzz domain: structurally malformed inputs — inputs that JSON.parse rejects
 * or that bypass JSON.parse to crash downstream JS traversal.
 * NOT wave-172 injection (valid-string semantic adversary).
 * NOT wave-130 property (valid-input invariants).
 * NOT wave-180 differential (exact stdout comparison on well-formed inputs).
 *
 * Targets: the 5 confirmed unguarded parse paths plus guarded paths for coverage.
 *   - validate-raci.mjs:58       parseRoster() — reads ROSTER_PATH (markdown)
 *   - validate-glossary.mjs:308  per-doc line-split — reads registry JSON + doc files
 *   - validate-runbooks.mjs:116-129  extractHaltTypes() — YAML regex on .md files
 *   - validate-gdpr-inventory.mjs:232  parseRopaEntries() — state machine on inventory .md
 *   - build-lineage-graph.mjs:217  extractYamlBlock() — frontmatter regex on spec files
 *
 * Oracle (D1): GRACEFUL = clean nonzero exit + error message, no uncaught stack trace.
 *   CRASH  = stderr contains uncaught-exception stack-trace marker without a [validate-*] prefix
 *   HANG   = spawnSync status null (timeout exceeded)
 *   SILENT-WRONG = exitCode 0 on a malformed input (validator claimed success)
 *
 * Injection strategy: each target reads from a hardcoded file path. The harness
 * temporarily substitutes the target input file with the malformed corpus fixture,
 * spawns the validator with a 5-second timeout, then restores the original file.
 * Backup + restore is atomic per spawn — the real file is never permanently altered.
 *
 * Corpus: scripts/fuzz-fixtures/corpus-*.json (8 canonical malformed classes).
 * Crash findings: appended to docs/security/findings-register.json via appendToRegister
 * (REUSE run-pentest-harness.mjs:201-223 pattern).
 * Regression fixtures: crash-<sha256>.json committed only if a real crash is found (D6).
 *
 * No telemetry emitted. No new JSONL stream. Exit code is the signal. (D7)
 * On-demand only — not wired to pre-commit hook (D8).
 *
 * Expected runtime: 8 corpus files x 5 targets = 40 spawns.
 * Most exit in <100ms (parse error is fast). Oversized fixture may take ~1-2s per spawn.
 * Worst-case ceiling: 40 spawns × 5s timeout = 200s.
 *
 * Usage:
 *   node scripts/run-fuzz.mjs
 *   npm run fuzz:run
 *
 * Spec: docs/specs/wave-181_MASTER_SPEC.md
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────────
const FIXTURES_DIR = path.join(ROOT, 'scripts', 'fuzz-fixtures');
const REGISTER_PATH = path.join(ROOT, 'docs', 'security', 'findings-register.json');

// ── Spawn timeout (5 seconds per spec D1) ─────────────────────────────────────
const TIMEOUT_MS = 5000;

// ── Output helpers ────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── Fuzz target definitions ───────────────────────────────────────────────────
/**
 * Each target defines:
 *   slug       — used in log output and dedup_key
 *   script     — relative path to the validator script
 *   args       — extra CLI args to pass (e.g. --dry to suppress writes)
 *   inputPath  — the file the validator reads that we will substitute with the corpus fixture
 *   note       — which unguarded parse path this exercises
 *
 * @type {Array<{slug: string, script: string, args: string[], inputPath: string, note: string}>}
 */
const TARGETS = [
  {
    slug: 'validate-raci',
    script: 'scripts/validate-raci.mjs',
    args: ['--dry'],
    // parseRoster() at :58 reads ROSTER_PATH = docs/AGENT_ROSTER.md (unguarded)
    // The harness substitutes this file with the malformed fixture.
    inputPath: path.join(ROOT, 'docs', 'AGENT_ROSTER.md'),
    note: 'parseRoster():58 — readFileSync(ROSTER_PATH) unguarded',
  },
  {
    slug: 'validate-glossary',
    script: 'scripts/validate-glossary.mjs',
    args: [],
    // :308 reads the registry JSON file for per-doc line-split
    // docs/quality/glossary-registry.json is the primary parse entry
    inputPath: path.join(ROOT, 'docs', 'quality', 'glossary-registry.json'),
    note: 'readFileSync(REGISTRY_PATH):308 — line-split state machine unguarded',
  },
  {
    slug: 'validate-runbooks',
    script: 'scripts/validate-runbooks.mjs',
    args: ['--dry'],
    // extractHaltTypes() at :116-129 applies YAML regex to each .md file in the runbooks dir.
    // Substitute an actual runbook file so the YAML regex path is exercised on malformed content.
    // change-management.md is the first non-underscore file in the glob, always present.
    inputPath: path.join(ROOT, 'docs', 'runbooks', 'change-management.md'),
    note: 'extractHaltTypes():116-129 — YAML regex state machine unguarded',
  },
  {
    slug: 'validate-gdpr-inventory',
    script: 'scripts/validate-gdpr-inventory.mjs',
    // --stream-only skips G4 PII scan; no --dry so the invariant checks and appendToRegister fire.
    // The malformed findings-register.json triggers the D4 hardening: before D4 it silently
    // fell back to existing=[] and continued writing (SILENT-WRONG); after D4 it exits 1 with
    // a [validate-gdpr-inventory] ERROR message (GRACEFUL). The injected file is the
    // findings-register.json — when appendToRegister is called on the first G1 violation,
    // it reads the malformed register, hits the D4 catch branch, and exits 1 cleanly.
    // The real data-inventory.md is untouched, so G1 violations fire as expected.
    args: ['--stream-only'],
    inputPath: path.join(ROOT, 'docs', 'security', 'findings-register.json'),
    note: 'appendToRegister():127-132 — D4 hardened: malformed findings-register now exits 1',
  },
  {
    slug: 'build-lineage-graph',
    script: 'scripts/build-lineage-graph.mjs',
    args: ['--dry'],
    // extractYamlBlock() at :217 reads each spec file and applies frontmatter regex
    // Substitute the master spec file so we get a real parse attempt on malformed content
    inputPath: path.join(ROOT, 'docs', 'specs', 'wave-181_MASTER_SPEC.md'),
    note: 'extractYamlBlock():217 — frontmatter regex unguarded',
  },
];

// ── Load fuzz corpus ──────────────────────────────────────────────────────────
/**
 * @returns {Array<{name: string, path: string, inputClass: string, content: Buffer}>}
 */
function loadCorpus() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    log(`[fuzz] ERROR: Fixtures directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }

  // The oversized fixture (~10 MB) is generated on demand rather than committed,
  // to avoid bloating git history with a repeated-content blob. gitignored.
  const oversizedPath = path.join(FIXTURES_DIR, 'corpus-oversized.json');
  if (!fs.existsSync(oversizedPath)) {
    log('[fuzz] Generating corpus-oversized.json (~10 MB, not committed)...');
    fs.writeFileSync(oversizedPath, `{"oversized":"${'x'.repeat(10_000_000)}"}`);
  }

  const files = fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.startsWith('corpus-') && !f.startsWith('corpus-.'))
    .sort();

  if (files.length === 0) {
    log('[fuzz] ERROR: No corpus-*.json files found in scripts/fuzz-fixtures/');
    process.exit(1);
  }

  return files.map((f) => {
    const inputClass = f.replace(/^corpus-/, '').replace(/\.json$/, '');
    return {
      name: f,
      path: path.join(FIXTURES_DIR, f),
      inputClass,
      content: fs.readFileSync(path.join(FIXTURES_DIR, f)),
    };
  });
}

// ── Spawn target with injected malformed input ────────────────────────────────
/**
 * Temporarily substitute the target input file with the malformed corpus content,
 * spawn the validator, then restore the original file.
 *
 * REUSE: spawnSync invocation shape from diff-test.mjs:235-249.
 *
 * @param {string} scriptRelPath
 * @param {string[]} args
 * @param {string} targetInputPath  — path the validator reads from
 * @param {Buffer} malformedContent — content to inject
 * @param {number} timeoutMs
 * @returns {{ stdout: string, stderr: string, exitCode: number | null, timedOut: boolean }}
 */
function runWithInjection(scriptRelPath, args, targetInputPath, malformedContent, timeoutMs) {
  const scriptAbs = path.join(ROOT, scriptRelPath);
  const backupPath = targetInputPath + '.fuzz-backup';

  // Step 1: back up the real file (if it exists)
  const realFileExists = fs.existsSync(targetInputPath);
  if (realFileExists) {
    fs.copyFileSync(targetInputPath, backupPath);
  }

  let result;
  try {
    // Step 2: write malformed content to the target path
    fs.writeFileSync(targetInputPath, malformedContent);

    // Step 3: spawn the validator — REUSE diff-test.mjs:235-249 shape
    const spawnResult = spawnSync(process.execPath, [scriptAbs, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: timeoutMs,
    });

    result = {
      stdout: spawnResult.stdout ?? '',
      stderr: spawnResult.stderr ?? '',
      exitCode: spawnResult.status,
      timedOut: spawnResult.status === null && spawnResult.signal === null,
    };
  } finally {
    // Step 4: restore the original file regardless of what happened
    if (realFileExists) {
      fs.copyFileSync(backupPath, targetInputPath);
      fs.unlinkSync(backupPath);
    } else {
      // File didn't exist before — remove the injected malformed file
      try { fs.unlinkSync(targetInputPath); } catch { /* ignore */ }
    }
  }

  return result;
}

// ── Oracle classification ─────────────────────────────────────────────────────
/**
 * Classify the spawn result against the crash oracle (D1).
 *
 * GRACEFUL      — exitCode nonzero AND output does not contain an unhandled
 *                 stack-trace marker without a clean [validate-*] prefix
 * CRASH         — stderr contains "Error:" at the top of a stack trace WITHOUT
 *                 a preceding [validate-*] / [diff] / [fuzz] / [glossary] etc prefix
 * HANG          — spawnSync status null (timed out)
 * SILENT-WRONG  — exitCode 0 on a malformed input (validator claimed success)
 *
 * @param {{ stdout: string, stderr: string, exitCode: number | null, timedOut: boolean }} result
 * @returns {'GRACEFUL' | 'CRASH' | 'HANG' | 'SILENT-WRONG'}
 */
function classifyResult(result) {
  if (result.timedOut || result.exitCode === null) {
    return 'HANG';
  }

  // Check for uncaught exception stack trace in STDERR only.
  // Node.js uncaught exceptions print to stderr in this form:
  //   file:///path/to/file.mjs:NN
  //   <source line>
  //   ^
  //   ErrorType: message
  //       at Function.name (/path/:NN:MM)
  //       at ...
  //       at async ...
  //   Node.js vXX.X.X
  //
  // The definitive markers: a line starting with 4 spaces + "at " (stack frame)
  // combined with a line matching "^ErrorType: " (e.g. "TypeError: ...", "SyntaxError: ...")
  // in stderr — this indicates an uncaught exception regardless of any clean output
  // that may have appeared before the crash.
  //
  // Note: a clean nonzero exit (graceful) may also have "    at " lines IF the
  // validator explicitly logs a stack trace as part of a caught error message.
  // Distinguisher: uncaught = Node.js prints the error WITHOUT a [validate-*] prefix
  // on the ERROR TYPE line itself (the "TypeError: " / "SyntaxError: " line).
  const hasStackFrame = /^\s{4}at\s+\S/m.test(result.stderr);
  // The error type line in an uncaught exception: starts with an uppercase ErrorName
  const hasUncaughtErrorType = /^[A-Z][a-zA-Z]+Error:/m.test(result.stderr);
  // A clean [validate-*] ERROR line on the SAME STDERR stream (not stdout) means the
  // validator caught the error and logged it cleanly before exiting
  const hasCleanPrefixInStderr = /\[(validate-[a-z-]+|build-lineage-graph|glossary|runbooks|raci|GDPR|fuzz)\]\s+(ERROR|FAIL|VIOLATION|WARN)/i.test(result.stderr);

  if (hasStackFrame && hasUncaughtErrorType && !hasCleanPrefixInStderr) {
    return 'CRASH';
  }

  // exitCode 0 with malformed input = silent wrong behavior
  if (result.exitCode === 0) {
    return 'SILENT-WRONG';
  }

  // exitCode nonzero, no uncaught stack trace = graceful failure
  return 'GRACEFUL';
}

// ── Findings register (REUSE run-pentest-harness.mjs:201-223) ─────────────────
/**
 * @typedef {{ finding_id: string, dedup_key: string, status: string, wave: string,
 *             severity: string, target: string, input_class: string, timestamp: string,
 *             title: string, agent: string }} FuzzFinding
 */

/**
 * Append a fuzz finding to the register, dedup'd by dedup_key.
 * REUSE: appendToRegister pattern from run-pentest-harness.mjs:201-223.
 *
 * @param {FuzzFinding} finding
 * @returns {boolean} true if appended, false if already open (deduped)
 */
function appendToRegister(finding) {
  let existing = [];
  if (fs.existsSync(REGISTER_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
    } catch {
      existing = [];
    }
  }

  // Idempotency: skip if an open record with the same dedup_key exists
  const alreadyOpen = existing.some(
    (r) => r.status === 'open' && r.dedup_key === finding.dedup_key
  );
  if (alreadyOpen) return false;

  existing.push(finding);
  fs.mkdirSync(path.dirname(REGISTER_PATH), { recursive: true });
  fs.writeFileSync(REGISTER_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return true;
}

// ── Build finding ID ──────────────────────────────────────────────────────────
function nextFindingId(existingRegister) {
  const wave181Entries = existingRegister.filter((r) => r.wave === 'wave-181');
  const nextNum = wave181Entries.length + 1;
  return `F-181-${String(nextNum).padStart(3, '0')}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('[fuzz] Wave-181 Fuzz Testing Harness');
  log('[fuzz] Fuzz domain: structurally malformed inputs (see spec §3 + D1)');
  log(`[fuzz] Targets: ${TARGETS.length} validators | Timeout: ${TIMEOUT_MS}ms per spawn`);
  log('');

  const corpus = loadCorpus();
  log(`[fuzz] Corpus: ${corpus.length} fixture(s) loaded from scripts/fuzz-fixtures/`);
  for (const fx of corpus) {
    log(`[fuzz]   ${fx.name} (class: ${fx.inputClass}, ${fx.content.length} bytes)`);
  }
  log('');

  // Load existing register for ID generation
  let existingRegister = [];
  if (fs.existsSync(REGISTER_PATH)) {
    try {
      existingRegister = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
    } catch {
      existingRegister = [];
    }
  }

  let totalRuns = 0;
  let gracefulCount = 0;
  let failCount = 0;

  /** @type {Array<{target: string, inputClass: string, oracle: string}>} */
  const failures = [];

  for (const target of TARGETS) {
    log(`[fuzz] --- Target: ${target.slug} ---`);
    log(`[fuzz]   Parse path: ${target.note}`);

    for (const fx of corpus) {
      totalRuns++;

      const runResult = runWithInjection(
        target.script,
        target.args,
        target.inputPath,
        fx.content,
        TIMEOUT_MS,
      );

      const oracle = classifyResult(runResult);

      if (oracle === 'GRACEFUL') {
        gracefulCount++;
        log(`[fuzz] GRACEFUL ${target.slug} class=${fx.inputClass} exit=${runResult.exitCode}`);
      } else {
        failCount++;
        log(`[fuzz] FAIL ${target.slug} class=${fx.inputClass} oracle=${oracle} exit=${runResult.exitCode}`);

        // Print the first 200 chars of stderr for diagnostics
        if (runResult.stderr) {
          const preview = runResult.stderr.slice(0, 300).replace(/\n/g, ' ↵ ');
          log(`[fuzz]   stderr: ${preview}`);
        }

        failures.push({ target: target.slug, inputClass: fx.inputClass, oracle });

        // Append to findings register (D5)
        const dedupKey = `fuzz-${target.slug}-${fx.inputClass}`;
        const severityMap = { CRASH: 'high', HANG: 'high', 'SILENT-WRONG': 'medium' };
        const severity = severityMap[oracle] ?? 'medium';

        const finding = {
          finding_id: nextFindingId(existingRegister),
          dedup_key: dedupKey,
          status: 'open',
          wave: 'wave-181',
          severity,
          target: target.slug,
          input_class: fx.inputClass,
          title: `[fuzz] ${oracle}: ${target.slug} did not fail gracefully on ${fx.inputClass} input`,
          agent: 'run-fuzz',
          timestamp: new Date().toISOString(),
        };

        const appended = appendToRegister(finding);
        if (appended) {
          existingRegister.push(finding);
          log(`[fuzz]   Finding appended: ${finding.finding_id} dedup_key=${dedupKey}`);

          // Commit the crashing input as a regression fixture (D5, D6)
          // Only if a real crash/hang/silent-wrong was observed
          const sha = crypto.createHash('sha256').update(fx.content).digest('hex').slice(0, 16);
          const crashFixturePath = path.join(FIXTURES_DIR, `crash-${sha}.json`);
          if (!fs.existsSync(crashFixturePath)) {
            fs.writeFileSync(crashFixturePath, fx.content);
            log(`[fuzz]   Regression fixture: scripts/fuzz-fixtures/crash-${sha}.json`);
          }
        } else {
          log(`[fuzz]   Finding deduped (already open): ${dedupKey}`);
        }
      }
    }
    log('');
  }

  log(`[fuzz] --- Summary ---`);
  log(`[fuzz] Total runs: ${totalRuns} (${TARGETS.length} targets x ${corpus.length} fixtures)`);
  log(`[fuzz] GRACEFUL: ${gracefulCount} | FAIL: ${failCount}`);

  if (failCount > 0) {
    log('[fuzz] RESULT: FAIL — one or more targets did not handle malformed input gracefully.');
    for (const f of failures) {
      log(`[fuzz]   ${f.target} class=${f.inputClass} oracle=${f.oracle}`);
    }
    log('[fuzz] See docs/security/findings-register.json for tracked findings.');
    process.exit(1);
  } else {
    log('[fuzz] RESULT: ALL GRACEFUL — all targets handled the malformed corpus gracefully.');
    log('[fuzz] Corpus classes tested: ' + corpus.map((fx) => fx.inputClass).join(', '));
    process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`[fuzz] Unexpected harness error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
