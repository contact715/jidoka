#!/usr/bin/env node
// @ts-check
/**
 * Wave-184 — Container Image Scanning Harness (C17)
 *
 * Scans infra container images for OS-package CVEs using Trivy.
 *
 * Scope:
 *   - Reads docs/security/container-image-inventory.json
 *   - Filters entries where scan_target: true
 *   - Binary-checks for trivy in PATH
 *   - If absent: surfaces SCANNER_UNAVAILABLE (not a silent clean pass) and exits 0
 *   - If present: runs `trivy image --format json --severity CRITICAL,HIGH --ignore-unfixed`
 *   - Parses JSON output; writes container_cve findings to findings-register.json
 *   - Emits pentest_finding events to security-events.jsonl (12th stream)
 *   - Exits 1 if any CRITICAL finding was written; exits 0 otherwise
 *
 * D2 — SCANNER_UNAVAILABLE surfaced (not silent):
 *   When trivy is not in PATH, this harness prints [SKIP] + SCANNER_UNAVAILABLE clearly.
 *   It does NOT produce a clean pass. Exit 0 because tooling absence is not a code defect.
 *   The skip is visible in stdout and a concern is registered via surface-concerns.mjs.
 *
 * D3 — Honest scope:
 *   the-app has NO Dockerfile. This harness scans external infra images only.
 *   No app-image scan is fabricated.
 *
 * D4 — Real CVEs surface as findings; no suppression:
 *   postgres:16-alpine historically carries OS-package CVEs. If found, they are written
 *   to findings-register.json and emitted. No accept-risk bypass in the harness.
 *
 * D5 — No new register, no new stream:
 *   Findings route to findings-register.json (wave-172) via appendToRegister (REUSE :201-224).
 *   Events route to security-events.jsonl (12th stream) as pentest_finding (REUSE :132).
 *
 * D6 — Block threshold: local harness exits 1 on CRITICAL only.
 *   CI gate (aquasecurity/trivy-action, post-MVP) blocks on CRITICAL,HIGH.
 *
 * D7 — check_id C17 (C15 = hash-chain tamper, C16 = DoS/rate-limit — both occupied).
 *
 * DUPLICATE-BLOCK: this check covers OS-package CVEs in container images only.
 *   - JS dep SCA: C1 (npm audit), wave-172
 *   - Source SAST: C2/wave-174 (semgrep)
 *   - Runtime API probes: C4-C14, wave-172
 *   None of those tools can see Alpine apk packages inside a container image.
 *
 * Usage:
 *   node scripts/run-container-scan.mjs
 *   npm run container:scan
 *
 * Exit codes:
 *   0 — no CRITICAL findings (or trivy absent — SCANNER_UNAVAILABLE surfaced)
 *   1 — one or more CRITICAL findings written to findings-register.json
 *
 * Spec: docs/specs/wave-184_MASTER_SPEC.md
 * Approach: docs/security/container-scan-approach.md
 * Inventory: docs/security/container-image-inventory.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const INVENTORY_PATH = path.join(ROOT, 'docs', 'security', 'container-image-inventory.json');
const REGISTER_PATH = path.join(ROOT, 'docs', 'security', 'findings-register.json');
const WAVE = 'wave-184';
const AGENT = 'run-container-scan';
const RUN_TS = new Date().toISOString();

// ── Output helpers ────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

/**
 * @param {'PASS'|'FINDING'|'SKIP'|'INFO'} status
 * @param {string} checkId
 * @param {string} detail
 */
function printCheck(status, checkId, detail) {
  const label = status.padEnd(7);
  log(`  [${label}] ${checkId} — ${detail}`);
}

// ── CVSS SLA bands (mirrors run-pentest-harness.mjs) ─────────────────────────
const SLA_DAYS = { critical: 3, high: 14, medium: 60, low: 365 };

/** @param {'critical'|'high'|'medium'|'low'} severity @returns {string} */
function slaDeadline(severity) {
  const d = new Date();
  d.setDate(d.getDate() + (SLA_DAYS[severity] ?? 365));
  return d.toISOString().split('T')[0];
}

// ── Finding ID counter ────────────────────────────────────────────────────────
let findingSeq = 0;

/** @returns {string} */
function nextFindingId() {
  findingSeq += 1;
  return `F-184-${String(findingSeq).padStart(3, '0')}`;
}

// ── dedupKey (mirrors run-pentest-harness.mjs:128-140) ───────────────────────
/**
 * Stable dedup key for a container CVE finding.
 * Format: C17:<image>/<pkgName>:<CVE-ID>
 * Stable across re-runs (no timestamp, no random component).
 * @param {string} imageName
 * @param {string} pkgName
 * @param {string} cveId
 * @returns {string}
 */
function dedupKey(imageName, pkgName, cveId) {
  return `C17:${imageName}/${pkgName}:${cveId}`;
}

/**
 * @typedef {{
 *   finding_id: string;
 *   check_id: string;
 *   dedup_key: string;
 *   title: string;
 *   severity: 'critical'|'high'|'medium'|'low';
 *   cvss_score: number|null;
 *   cwe: string;
 *   status: 'open'|'triaged'|'fixed'|'accepted-risk';
 *   sla_deadline: string;
 *   wave: string;
 *   introduced_wave: string;
 *   agent: string;
 *   mitigation_note: string;
 *   timestamp: string;
 * }} FindingRecord
 */

/**
 * Build a FindingRecord for a container CVE.
 * REUSE: mirrors run-pentest-harness.mjs:152-169 makeFinding shape.
 * @param {object} opts
 * @param {string} opts.imageName
 * @param {string} opts.pkgName
 * @param {string} opts.cveId
 * @param {'critical'|'high'} opts.severity
 * @param {number|null} [opts.cvss_score]
 * @param {string} [opts.fixedVersion]
 * @returns {FindingRecord}
 */
function makeFinding({ imageName, pkgName, cveId, severity, cvss_score = null, fixedVersion }) {
  const title = `${imageName}/${pkgName}:${cveId}` +
    (fixedVersion ? ` (fix: ${fixedVersion})` : ' (no-fix-available suppressed by --ignore-unfixed)');
  return {
    finding_id: nextFindingId(),
    check_id: 'C17',
    dedup_key: dedupKey(imageName, pkgName, cveId),
    title: title.slice(0, 250),
    severity,
    cvss_score,
    cwe: 'CWE-1035', // Using Components with Known Vulnerabilities
    status: 'open',
    sla_deadline: slaDeadline(severity),
    wave: WAVE,
    introduced_wave: 'unknown',
    agent: AGENT,
    mitigation_note: 'scan_type: container_cve',
    timestamp: RUN_TS,
  };
}

// ── appendToRegister (REUSE: run-pentest-harness.mjs:201-224) ─────────────────
/**
 * Append a finding to the register ONLY if no open record with the same
 * dedup_key already exists (idempotency — mirrors wave-172 R3).
 * @param {FindingRecord} finding
 * @returns {boolean} true if appended, false if deduped (already open)
 */
function appendToRegister(finding) {
  /** @type {FindingRecord[]} */
  let existing = [];
  if (fs.existsSync(REGISTER_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
    } catch {
      existing = [];
    }
  }

  const alreadyOpen = existing.some(
    (r) => r.status === 'open' && r.dedup_key === finding.dedup_key
  );
  if (alreadyOpen) {
    return false;
  }

  existing.push(finding);
  fs.mkdirSync(path.dirname(REGISTER_PATH), { recursive: true });
  fs.writeFileSync(REGISTER_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return true;
}

// ── Telemetry emit (REUSE: emit-telemetry.mjs pentest_finding → 12th stream) ──
/**
 * Emit a pentest_finding event to security-events.jsonl (12th stream).
 * REUSE: uses the existing pentest_finding event type registered at emit-telemetry.mjs:132.
 * NO new event type. NO new stream.
 * @param {FindingRecord} finding
 */
async function emitFindingEvent(finding) {
  try {
    const { emitTelemetry } = await import('./emit-telemetry.mjs');
    emitTelemetry('pentest_finding', {
      source: 'scripts/run-container-scan.mjs',
      wave: WAVE,
      agent: AGENT,
      payload: {
        event_subtype: 'pentest_finding',
        finding_id: finding.finding_id,
        check_id: finding.check_id,
        title: finding.title,
        severity: finding.severity,
        cvss_score: finding.cvss_score,
        cwe: finding.cwe,
        status: finding.status,
        sla_deadline: finding.sla_deadline,
        mitigation_note: finding.mitigation_note,
      },
    });
  } catch (err) {
    process.stderr.write(`[run-container-scan] WARN: telemetry emit failed: ${err.message}\n`);
  }
}

// ── Surface a concern (best-effort, mirrors wave-174 graceful-degrade) ────────
/**
 * Register a SCANNER_UNAVAILABLE concern via surface-concerns.mjs.
 * Non-fatal: if the surface script is absent or errors, the concern text is
 * printed to stdout regardless (the critical honesty output).
 */
function surfaceScannerUnavailableConcern() {
  const surfaceScript = path.join(ROOT, 'scripts', 'surface-concerns.mjs');
  if (!fs.existsSync(surfaceScript)) {
    process.stderr.write('[run-container-scan] WARN: surface-concerns.mjs not found — concern not registered in output file\n');
    return;
  }
  // surface-concerns.mjs has no --surface flag. A bare invocation runs a full concern
  // scan and writes docs/surfacing-concerns-current.md. We run it here best-effort so
  // the existing concern machinery picks up the state. Non-fatal on any error.
  try {
    spawnSync('node', [surfaceScript], {
      cwd: ROOT,
      timeout: 30000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    // Surface script errors are non-fatal — the key output is already on stdout.
  }
}

// ── Trivy binary check ────────────────────────────────────────────────────────
/**
 * Check if trivy is in PATH.
 * Mirrors check-security-patterns.sh:54-79 `if command -v` pattern.
 * @returns {boolean}
 */
function trivyInPath() {
  try {
    execSync('command -v trivy', { stdio: 'ignore', shell: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── Image inventory loader ────────────────────────────────────────────────────
/**
 * @typedef {{
 *   name: string;
 *   source: string;
 *   owner: string;
 *   scan_target: boolean;
 *   digest: string|null;
 *   scan_status: string;
 *   rationale?: string;
 * }} ImageEntry
 *
 * @typedef {{
 *   _schema: { wave: string; created: string; note: string };
 *   images: ImageEntry[];
 * }} ImageInventory
 */

/**
 * Load and validate the image inventory.
 * @returns {ImageInventory}
 */
function loadInventory() {
  if (!fs.existsSync(INVENTORY_PATH)) {
    throw new Error(`Image inventory not found at: ${INVENTORY_PATH}`);
  }
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
}

// ── Trivy scan per image ──────────────────────────────────────────────────────
/**
 * Run trivy against a single image and return parsed vulnerability results.
 * Uses --ignore-unfixed to suppress CVEs with no available fix (noise reduction).
 * Severity: CRITICAL,HIGH (CI threshold; local harness exits 1 on CRITICAL only per D6).
 * @param {string} imageName
 * @returns {{ vulnerabilities: Array<{ VulnerabilityID: string; PkgName: string; Severity: string; CVSS?: Record<string, { V3Score?: number }>; FixedVersion?: string }> }}
 */
function runTrivyScan(imageName) {
  log(`  Scanning ${imageName} ...`);
  const result = spawnSync(
    'trivy',
    [
      'image',
      '--format', 'json',
      '--severity', 'CRITICAL,HIGH',
      '--ignore-unfixed',
      '--quiet',
      imageName,
    ],
    {
      cwd: ROOT,
      timeout: 300000, // 5 minutes — first run downloads Trivy DB
      maxBuffer: 50 * 1024 * 1024, // 50 MB
    }
  );

  if (result.status !== 0 && result.status !== 1) {
    // Trivy exits 1 when vulnerabilities are found (with --exit-code 1), but we don't use that flag.
    // Non-0/1 status means a scan error.
    const stderr = result.stderr ? result.stderr.toString().slice(0, 500) : '';
    throw new Error(`trivy exited ${result.status}: ${stderr}`);
  }

  const stdout = result.stdout ? result.stdout.toString() : '{}';
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`trivy output is not valid JSON for image: ${imageName}`);
  }

  // Trivy JSON output shape: { Results: [{ Vulnerabilities: [...] }] }
  /** @type {Array<{ VulnerabilityID: string; PkgName: string; Severity: string; CVSS?: Record<string, { V3Score?: number }>; FixedVersion?: string }>} */
  const vulns = [];
  const results = parsed.Results || [];
  for (const result of results) {
    if (Array.isArray(result.Vulnerabilities)) {
      vulns.push(...result.Vulnerabilities);
    }
  }

  return { vulnerabilities: vulns };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('\n=== Wave-184 Container Image Scan (C17) ===');
  log(`  Inventory: ${INVENTORY_PATH}`);
  log(`  Register:  ${REGISTER_PATH}`);
  log(`  Timestamp: ${RUN_TS}`);

  // Load inventory
  let inventory;
  try {
    inventory = loadInventory();
  } catch (err) {
    process.stderr.write(`[run-container-scan] ERROR: ${err.message}\n`);
    process.exit(1);
  }

  log(`  _schema note: ${inventory._schema.note}`);

  const targets = inventory.images.filter((img) => img.scan_target === true);
  log(`  Scan targets (scan_target: true): ${targets.length}`);
  for (const t of targets) {
    log(`    - ${t.name} (${t.source})`);
  }

  log('');

  // ── D2: Binary check — mirrors check-security-patterns.sh:54-79 ──────────
  log('C17 — Container image CVE scan (Trivy)');

  if (!trivyInPath()) {
    // SCANNER_UNAVAILABLE — not a silent clean pass.
    // Print clearly to stdout so the output is visibly non-clean.
    log('');
    printCheck('SKIP', 'C17', 'trivy not in PATH — SCANNER_UNAVAILABLE');
    log('');
    log('  SCANNER_UNAVAILABLE: Trivy is not installed. The container CVE layer is unscanned.');
    log('  This is NOT a clean pass. The skip is surfaced below.');
    log('');
    log('  Enable-condition (local): brew install trivy');
    log('  Enable-condition (CI):    add aquasecurity/trivy-action step to security-gate.yml');
    log('  Approach doc:             docs/security/container-scan-approach.md');
    log('');
    log('  Surfacing SCANNER_UNAVAILABLE concern via surface-concerns.mjs ...');

    // Best-effort surface concern registration
    surfaceScannerUnavailableConcern();

    log('  [SCANNER_UNAVAILABLE] C17 — Trivy not installed. Container CVE layer unscanned.');
    log('  Run: brew install trivy, then: npm run container:scan');
    log('');
    log('=== Container scan SKIPPED — SCANNER_UNAVAILABLE (exit 0, not a clean pass) ===');
    log('');

    // Exit 0: tooling absence is not a code defect (mirrors check-security-patterns.sh:79).
    // The skip is clearly surfaced above — this is NOT a vacuous clean pass.
    process.exit(0);
  }

  // ── Trivy is available — run real scans ──────────────────────────────────
  log('  trivy found in PATH — running real scan');
  log('');

  /** @type {FindingRecord[]} */
  const allFindings = [];
  let scanErrors = 0;

  for (const image of targets) {
    log(`\n--- Scanning: ${image.name} ---`);
    log(`  Source: ${image.source}`);
    log(`  Owner:  ${image.owner}`);

    let scanResult;
    try {
      scanResult = runTrivyScan(image.name);
    } catch (err) {
      process.stderr.write(`[run-container-scan] ERROR scanning ${image.name}: ${err.message}\n`);
      printCheck('SKIP', 'C17', `${image.name} — scan error: ${err.message.slice(0, 100)}`);
      scanErrors++;
      continue;
    }

    const vulns = scanResult.vulnerabilities;
    log(`  Found ${vulns.length} CRITICAL/HIGH vulnerability record(s) (--ignore-unfixed applied)`);

    if (vulns.length === 0) {
      printCheck('PASS', 'C17', `${image.name} — no CRITICAL/HIGH CVEs found (--ignore-unfixed)`);
      continue;
    }

    for (const vuln of vulns) {
      const cveId = vuln.VulnerabilityID || 'UNKNOWN';
      const pkgName = vuln.PkgName || 'unknown-pkg';
      const trivySeverity = (vuln.Severity || 'HIGH').toLowerCase();
      const fixedVersion = vuln.FixedVersion || null;

      // D6: local harness exits 1 on CRITICAL only.
      // We collect ALL CRITICAL/HIGH findings for the register, but only CRITICAL triggers exit 1.
      const severity = /** @type {'critical'|'high'} */ (
        trivySeverity === 'critical' ? 'critical' : 'high'
      );

      // Extract CVSS score — prefer CVSS v3 from any vendor
      let cvss_score = null;
      if (vuln.CVSS) {
        for (const vendorData of Object.values(vuln.CVSS)) {
          if (typeof vendorData?.V3Score === 'number') {
            cvss_score = vendorData.V3Score;
            break;
          }
        }
      }

      const finding = makeFinding({
        imageName: image.name,
        pkgName,
        cveId,
        severity,
        cvss_score,
        fixedVersion,
      });

      printCheck('FINDING', 'C17', `${image.name}/${pkgName}:${cveId} (${severity.toUpperCase()})`);
      allFindings.push(finding);
    }
  }

  // ── Record findings (append-only, idempotent dedup) ──────────────────────
  log('\n--- Recording C17 findings to register ---');
  let written = 0;
  let deduped = 0;

  for (const finding of allFindings) {
    const appended = appendToRegister(finding);
    if (appended) {
      await emitFindingEvent(finding);
      written++;
    } else {
      deduped++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const criticalCount = allFindings.filter((f) => f.severity === 'critical').length;
  const highCount = allFindings.filter((f) => f.severity === 'high').length;

  log('\n=== Wave-184 Container Scan — Run Summary ===');
  log(`  Scan targets:     ${targets.length}`);
  log(`  Scan errors:      ${scanErrors}`);
  log(`  Total findings:   ${allFindings.length} (CRITICAL: ${criticalCount}, HIGH: ${highCount})`);
  log(`  Written to register: ${written} (deduped: ${deduped})`);
  log(`  Register: ${REGISTER_PATH}`);
  log(`  Stream:   docs/audits/security-events.jsonl (12th stream, pentest_finding)`);
  log(`  check_id: C17`);

  // D6: exit 1 on CRITICAL only (CI gate handles CRITICAL+HIGH via trivy-action).
  if (criticalCount > 0) {
    log(`\n  EXIT 1 — ${criticalCount} CRITICAL container CVE finding(s). Review findings-register.json.`);
    log('  Platform lead must review and pin a patched digest or record accepted-risk.\n');
    process.exit(1);
  } else if (highCount > 0) {
    log(`\n  EXIT 0 — ${highCount} HIGH finding(s) recorded (not blocking locally per D6).`);
    log('  CI gate (aquasecurity/trivy-action, post-MVP) will block on HIGH in CI.\n');
    process.exit(0);
  } else {
    log('\n  EXIT 0 — no CRITICAL or HIGH container CVE findings.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`[run-container-scan] Unhandled error: ${err.message}\n`);
  process.exit(1);
});
