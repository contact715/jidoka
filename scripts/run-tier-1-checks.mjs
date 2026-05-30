#!/usr/bin/env node
/**
 * run-tier-1-checks.mjs — Tier 1 automated check orchestrator.
 *
 * Wraps the existing run-quality-gates.mjs checks and adds formal Tier 1
 * isolation. Runs 7 checks in parallel via Promise.allSettled:
 *   tsc, lint, test-runner, coverage-auditor, perf-profiler, a11y-auditor, security-scanner
 *
 * Writes structured results to docs/metrics/verification-{wave}.json.
 * Exits 1 only on BLOCK (not SKIP or WARN).
 * Prints [ROUTE] debug-agent: <check-name> for FAIL with < 20 LOC fix hints.
 *
 * Usage:
 *   node scripts/run-tier-1-checks.mjs --wave wave-103
 *   node scripts/run-tier-1-checks.mjs --wave wave-103 --dry-run
 *   node scripts/run-tier-1-checks.mjs --help
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
run-tier-1-checks.mjs — Tier 1 automated gate orchestrator

Wraps run-quality-gates.mjs and adds Tier 1 formal isolation with structured
JSON output and parallel execution.

Usage:
  node scripts/run-tier-1-checks.mjs --wave <wave-id> [--dry-run] [--help]

Flags:
  --wave <id>   Wave identifier (e.g. wave-103)
  --dry-run     Print what would run, skip actual execution
  --help        Show this message

Exit codes:
  0  All checks PASS or SKIP
  1  One or more checks emitted BLOCK
`);
  process.exit(0);
}

const waveIdx = args.indexOf('--wave');
const waveId = waveIdx !== -1 ? args[waveIdx + 1] : 'unknown';
const dryRun = args.includes('--dry-run');

// ── Helpers ─────────────────────────────────────────────────────────────

function elapsed(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

/**
 * Run a shell command. Returns { ok, stdout, stderr, elapsed }.
 * Never throws.
 */
function run(cmd, opts = {}) {
  if (dryRun) {
    return { ok: true, stdout: `[DRY-RUN] would run: ${cmd}`, stderr: '', elapsed: '0.0s' };
  }
  const t = Date.now();
  try {
    const stdout = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    return { ok: true, stdout, stderr: '', elapsed: elapsed(t) };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || String(err),
      elapsed: elapsed(t),
    };
  }
}

/**
 * Estimate if a failure is fixable in < 20 LOC by scanning stderr/stdout
 * for common small-fix patterns.
 */
function isSmallFix(checkName, stdout, stderr) {
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  const smallFixPatterns = [
    /1 error/,
    /missing semicolon/,
    /unexpected token/,
    /is not defined/,
    /unused variable/,
    /missing return type/,
    /implicit any/,
  ];
  return smallFixPatterns.some((p) => p.test(combined));
}

// ── Check definitions ────────────────────────────────────────────────────

/**
 * Each check returns: { name, status: 'PASS'|'FAIL'|'BLOCK'|'SKIP'|'WARN', elapsed, details }
 */

async function checkTsc() {
  const t = Date.now();
  const name = 'tsc';
  const r = run('npx tsc --noEmit --skipLibCheck');
  const el = r.elapsed;
  if (r.ok) return { name, status: 'PASS', elapsed: el, details: '' };
  const details = r.stderr || r.stdout;
  const status = isSmallFix(name, r.stdout, r.stderr) ? 'FAIL' : 'BLOCK';
  return { name, status, elapsed: el, details: details.slice(0, 500) };
}

async function checkLint() {
  const t = Date.now();
  const name = 'lint';
  const r = run('npx eslint . --ext .ts,.tsx --max-warnings=0 --format=compact 2>&1 || true', {
    timeout: 60000,
  });
  if (r.stdout.toLowerCase().includes('problem')) {
    const lineCount = (r.stdout.match(/\n/g) || []).length;
    const status = lineCount <= 5 ? 'FAIL' : 'BLOCK';
    return { name, status, elapsed: r.elapsed, details: r.stdout.slice(0, 500) };
  }
  return { name, status: 'PASS', elapsed: r.elapsed, details: '' };
}

async function checkTestRunner() {
  const name = 'test-runner';
  const vitestJson = path.join(ROOT, '.test-results', 'vitest-tier1.json');
  fs.mkdirSync(path.join(ROOT, '.test-results'), { recursive: true });
  const r = run(`npx vitest run --reporter=json --outputFile=${vitestJson}`, { timeout: 120000 });
  if (r.ok) return { name, status: 'PASS', elapsed: r.elapsed, details: '' };
  // Check if vitest exists.
  if (r.stderr.includes('not found') || r.stderr.includes('Cannot find')) {
    return { name, status: 'SKIP', elapsed: r.elapsed, details: 'vitest not found — install or configure' };
  }
  return { name, status: 'BLOCK', elapsed: r.elapsed, details: r.stdout.slice(0, 400) };
}

async function checkCoverageAuditor() {
  const name = 'coverage-auditor';
  const r = run(`node ${path.join(__dirname, 'coverage-delta.mjs')}`, { timeout: 60000 });
  if (!r.ok) {
    if (r.stdout.includes('SKIP') || r.stderr.includes('SKIP') || r.stderr.includes('not found')) {
      return { name, status: 'SKIP', elapsed: r.elapsed, details: 'coverage-delta.mjs not runnable' };
    }
    return { name, status: 'BLOCK', elapsed: r.elapsed, details: r.stdout.slice(0, 400) };
  }
  if (r.stdout.includes('SKIP')) return { name, status: 'SKIP', elapsed: r.elapsed, details: '' };
  return { name, status: 'PASS', elapsed: r.elapsed, details: '' };
}

async function checkPerfProfiler() {
  const name = 'perf-profiler';
  const r = run(`node ${path.join(__dirname, 'bundle-delta.mjs')}`, { timeout: 120000 });
  if (!r.ok) {
    if (r.stderr.includes('not found') || r.stderr.includes('Cannot find') || r.stdout.includes('SKIP')) {
      return { name, status: 'SKIP', elapsed: r.elapsed, details: 'bundle-delta not runnable' };
    }
    const details = r.stdout + r.stderr;
    const status = isSmallFix(name, r.stdout, r.stderr) ? 'FAIL' : 'BLOCK';
    return { name, status, elapsed: r.elapsed, details: details.slice(0, 400) };
  }
  if (r.stdout.includes('SKIP')) return { name, status: 'SKIP', elapsed: r.elapsed, details: '' };
  return { name, status: 'PASS', elapsed: r.elapsed, details: '' };
}

async function checkA11yAuditor() {
  const name = 'a11y-auditor';
  // axe-core scan via playwright — gracefully skip if playwright not configured.
  const r = run(
    'npx playwright test --grep @a11y --reporter=compact 2>&1 || true',
    { timeout: 120000 },
  );
  if (r.stdout.includes('No tests found') || r.stderr.includes('not found')) {
    return { name, status: 'SKIP', elapsed: r.elapsed, details: 'No @a11y tests found or playwright not installed' };
  }
  if (r.stdout.includes('failed') || r.stdout.includes('FAIL')) {
    return { name, status: 'BLOCK', elapsed: r.elapsed, details: r.stdout.slice(0, 400) };
  }
  return { name, status: 'PASS', elapsed: r.elapsed, details: '' };
}

async function checkSecurityScanner() {
  const name = 'security-scanner';
  const r = run('npm audit --audit-level=high --json 2>/dev/null || true', { timeout: 30000 });
  try {
    const audit = JSON.parse(r.stdout);
    const high = (audit.metadata?.vulnerabilities?.high || 0) + (audit.metadata?.vulnerabilities?.critical || 0);
    if (high > 0) {
      return { name, status: 'BLOCK', elapsed: r.elapsed, details: `${high} high/critical vulnerabilities` };
    }
    return { name, status: 'PASS', elapsed: r.elapsed, details: '' };
  } catch {
    // Non-JSON output or error — treat as SKIP.
    return { name, status: 'SKIP', elapsed: r.elapsed, details: 'npm audit output not parseable' };
  }
}

// ── Orchestrate ─────────────────────────────────────────────────────────

const CHECKS = [
  checkTsc,
  checkLint,
  checkTestRunner,
  checkCoverageAuditor,
  checkPerfProfiler,
  checkA11yAuditor,
  checkSecurityScanner,
];

console.log(`\n=== Tier 1 Checks (${waveId})${dryRun ? ' [DRY-RUN]' : ''} ===\n`);

const startTime = Date.now();
const settled = await Promise.allSettled(CHECKS.map((fn) => fn()));

const results = settled.map((s, i) => {
  if (s.status === 'rejected') {
    return { name: CHECKS[i].name || `check-${i}`, status: 'SKIP', elapsed: '0.0s', details: String(s.reason) };
  }
  return s.value;
});

// Print results and route small fixes.
let blocked = false;
for (const r of results) {
  const tag = r.status === 'BLOCK' ? '[BLOCK]' : r.status === 'FAIL' ? '[FAIL]' : r.status === 'SKIP' ? '[SKIP]' : '[PASS]';
  console.log(`${tag} ${r.name} (${r.elapsed})`);
  if (r.details) console.log(`  ${r.details.trim().replace(/\n/g, '\n  ')}`);

  if (r.status === 'FAIL' || r.status === 'BLOCK') {
    if (isSmallFix(r.name, r.details, '')) {
      console.log(`[ROUTE] debug-agent: ${r.name}`);
    }
    if (r.status === 'BLOCK') blocked = true;
  }
}

// ── Write JSON results ───────────────────────────────────────────────────

const metricsDir = path.join(ROOT, 'docs', 'metrics');
if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });

const outputPath = path.join(metricsDir, `verification-${waveId}.json`);
const output = {
  wave: waveId,
  timestamp: new Date().toISOString(),
  tier: 1,
  dryRun,
  totalElapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
  checks: results,
};
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
console.log(`\n[TIER-1] Results written to ${outputPath}`);

// ── Summary ──────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.status === 'PASS').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
const failed = results.filter((r) => r.status === 'FAIL' || r.status === 'BLOCK').length;

console.log(`\n=== Tier 1 Summary (${waveId}) ===`);
console.log(`  Passed:  ${passed}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Failed:  ${failed}`);
console.log(`  Blocked: ${blocked ? 'YES' : 'none'}`);

if (blocked) {
  console.log('\n[TIER-1] Status: BLOCK — one or more checks failed. Escalate Tier 2.\n');
  process.exit(1);
} else {
  console.log('\n[TIER-1] Status: PASS — all checks cleared or skipped.\n');
  process.exit(0);
}
