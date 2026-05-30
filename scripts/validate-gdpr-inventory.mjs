#!/usr/bin/env node
// @ts-check
/**
 * Wave-173 — GDPR Inventory Validator
 *
 * Checks the RoPA (docs/compliance/gdpr/data-inventory.md) against the live
 * stream registry (scripts/emit-telemetry.mjs ALL_STREAM_PATHS) for consistency.
 * Scans pre-wave-165 JSONL entries for unredacted PII tokens.
 * Emits gdpr_finding events to docs/audits/security-events.jsonl (12th stream).
 * Appends findings to docs/security/findings-register.json (wave-172 register REUSE).
 *
 * Invariants checked:
 *   G1 — Every stream in emit-telemetry.mjs ALL_STREAM_PATHS has a RoPA entry.
 *         [GDPR-G1-VIOLATION] <stream-path> — no RoPA entry
 *   G2 — Every RoPA stream entry has a declared retention_days (not blank, not TBD).
 *         [GDPR-G2-VIOLATION] <stream-path> — retention_days not declared
 *   G3 — Every RoPA entry references a stream path present in the live registry.
 *         [GDPR-G3-WARN] <stream-path> — RoPA entry has no matching stream definition
 *   G4 — Pre-wave-165 JSONL entries: scan first 50 lines of each .jsonl for PII tokens.
 *         gdpr_finding severity:warn emitted; human review required (not auto-deleted).
 *   G5 — Every RoPA entry has a declared lawful_basis (non-empty).
 *         [GDPR-G5-WARN] <stream-path> — lawful_basis not declared
 *
 * DUPLICATE-BLOCK: detectPiiTokens is IMPORTED from lib/redaction/redact-pii.mjs.
 * It is NOT redefined here.
 *
 * Flags:
 *   --dry          Validate only; no file writes, no telemetry events.
 *   --stream-only  Skip G4 pre-165 PII scan; check G1/G2/G3/G5 only.
 *
 * Exit codes:
 *   0 — no G1 or G2 violations (G3/G5 are warns; G4 is warn)
 *   1 — one or more G1 or G2 violations found
 *
 * Usage:
 *   node scripts/validate-gdpr-inventory.mjs
 *   node scripts/validate-gdpr-inventory.mjs --dry
 *   node scripts/validate-gdpr-inventory.mjs --stream-only
 *   npm run gdpr:validate
 *   npm run gdpr:validate-dry
 *
 * Spec: docs/specs/wave-173_MASTER_SPEC.md
 * GDPR: Art. 5(1)(e), Art. 17, Art. 30
 * SOC-2: C1.1, C1.2 (docs/compliance/soc-2/trust-services-mapping.md:73-74)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// DUPLICATE-BLOCK: IMPORT detectPiiTokens — do NOT reimplement.
import { detectPiiTokens } from '../lib/redaction/redact-pii.mjs';

// Wave-173: gdpr_finding routes to security-events.jsonl (12th stream) via emitTelemetry.
// Import after gdpr_finding added to SECURITY_TYPES in emit-telemetry.mjs.
import { emitTelemetry } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDry = args.includes('--dry');
const streamOnly = args.includes('--stream-only');

// ── Paths ─────────────────────────────────────────────────────────────────────
const INVENTORY_PATH = path.join(ROOT, 'docs', 'compliance', 'gdpr', 'data-inventory.md');
const EMIT_TELEMETRY_PATH = path.join(ROOT, 'scripts', 'emit-telemetry.mjs');
const AUDITS_DIR = path.join(ROOT, 'docs', 'audits');
const REGISTER_PATH = path.join(ROOT, 'docs', 'security', 'findings-register.json');
const SECURITY_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'security-events.jsonl');

const WAVE = 'wave-173';
const AGENT = 'validate-gdpr-inventory';
const RUN_TS = new Date().toISOString();

// ── Output helpers ─────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── Finding counter ────────────────────────────────────────────────────────────
let findingSeq = 0;
function nextFindingId() {
  findingSeq += 1;
  return `F-173-${String(findingSeq).padStart(3, '0')}`;
}

// ── Finding record (mirrors wave-172 FindingRecord schema) ────────────────────
/**
 * @param {object} opts
 * @param {string} opts.check_id
 * @param {string} opts.title
 * @param {'warn'|'medium'|'high'} opts.severity
 * @param {string} [opts.dedup_suffix]
 * @returns {object}
 */
function makeFinding({ check_id, title, severity, dedup_suffix }) {
  const dedup_key = `${check_id}:${(dedup_suffix ?? title).slice(0, 80)}`;
  return {
    finding_id: nextFindingId(),
    check_id,
    dedup_key,
    title,
    severity,
    cvss_score: null,
    cwe: 'CWE-200',
    status: 'open',
    sla_deadline: null,
    wave: WAVE,
    introduced_wave: WAVE,
    agent: AGENT,
    mitigation_note: '',
    timestamp: RUN_TS,
  };
}

// ── Register append (append-only, idempotent dedup — mirrors wave-172 D5) ─────
/**
 * @param {object} finding
 * @returns {boolean} true if appended, false if deduped
 */
function appendToRegister(finding) {
  if (isDry) return false;
  // Wave-181 D4: the register is treated as authoritative — a malformed register is an
  // error signal, not a recoverable condition. Before D4: catch branch silently fell back
  // to existing=[]. After D4: any parse failure or type mismatch exits 1 with a clear error.
  /** @type {Array<object>} */
  let existing;
  if (fs.existsSync(REGISTER_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
      if (!Array.isArray(parsed)) {
        process.stderr.write(`[validate-gdpr-inventory] ERROR: malformed findings-register at ${REGISTER_PATH} — expected JSON array, got ${typeof parsed}\n`);
        process.exit(1);
      }
      existing = parsed;
    } catch (parseErr) {
      process.stderr.write(`[validate-gdpr-inventory] ERROR: malformed findings-register at ${REGISTER_PATH} — ${parseErr.message}\n`);
      process.exit(1);
    }
  } else {
    existing = /** @type {Array<object>} */ ([]);
  }
  const alreadyOpen = existing.some(
    (r) => r.status === 'open' && r.dedup_key === finding.dedup_key
  );
  if (alreadyOpen) return false;
  existing.push(finding);
  fs.mkdirSync(path.dirname(REGISTER_PATH), { recursive: true });
  fs.writeFileSync(REGISTER_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return true;
}

// ── Telemetry emit (gdpr_finding → security-events.jsonl, 12th stream) ────────
/** @param {object} finding */
function emitFindingEvent(finding) {
  if (isDry) return;
  emitTelemetry('gdpr_finding', {
    source: 'scripts/validate-gdpr-inventory.mjs',
    wave: WAVE,
    agent: AGENT,
    payload: {
      event_subtype: 'gdpr_finding',
      finding_id: finding.finding_id,
      check_id: finding.check_id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
    },
  });
}

/** @param {object} finding */
function recordFinding(finding) {
  const appended = appendToRegister(finding);
  if (appended) {
    emitFindingEvent(finding);
  }
}

// ── Parse ALL_STREAM_PATHS from emit-telemetry.mjs ────────────────────────────
/**
 * Reads emit-telemetry.mjs source and extracts the relative paths from
 * ALL_STREAM_PATHS array. Looks for lines matching:
 *   path.join(ROOT, 'docs', 'audits', '<filename>.jsonl')
 * or the constant name assignments above that array.
 *
 * @returns {string[]} array of absolute paths
 */
function parseStreamRegistry() {
  if (!fs.existsSync(EMIT_TELEMETRY_PATH)) {
    process.stderr.write(`[validate-gdpr-inventory] ERROR: ${EMIT_TELEMETRY_PATH} not found\n`);
    process.exit(1);
  }

  const source = fs.readFileSync(EMIT_TELEMETRY_PATH, 'utf8');

  // Extract all constant assignments: const SOMETHING_PATH = path.join(ROOT, 'docs', ...)
  // Match patterns like: path.join(ROOT, 'docs', 'audits', 'halt-events.jsonl')
  const pathPattern = /path\.join\(ROOT,\s*'docs',\s*'audits',\s*'([^']+\.jsonl)'\)/g;
  const seen = new Set();
  const paths = [];

  let m;
  while ((m = pathPattern.exec(source)) !== null) {
    const filename = m[1];
    const abs = path.join(ROOT, 'docs', 'audits', filename);
    if (!seen.has(abs)) {
      seen.add(abs);
      paths.push(abs);
    }
  }

  // Verify we found the expected count (ALL_STREAM_PATHS has 16 entries)
  if (paths.length === 0) {
    process.stderr.write(`[validate-gdpr-inventory] ERROR: could not parse stream paths from emit-telemetry.mjs\n`);
    process.exit(1);
  }

  return paths;
}

// ── Parse RoPA stream entries from data-inventory.md ─────────────────────────
/**
 * Extracts declared stream entries from the RoPA markdown file.
 * Looks for rows in stream tables containing:
 *   | **stream_path** | `docs/audits/<filename>.jsonl` |
 *   | **file_path** | `docs/memory-<name>.md` |
 *   | **retention_days** | <value> |
 *   | **lawful_basis** | <value> |
 *
 * Returns a map of streamPath -> { retention_days, has_lawful_basis }.
 * @returns {Map<string, {retention_days: string|null, has_lawful_basis: boolean}>}
 */
function parseRopaEntries() {
  if (!fs.existsSync(INVENTORY_PATH)) {
    process.stderr.write(`[validate-gdpr-inventory] ERROR: ${INVENTORY_PATH} not found.\n`);
    process.stderr.write(`  Expected at: ${INVENTORY_PATH}\n`);
    process.stderr.write(`  Create it per docs/specs/wave-173_MASTER_SPEC.md §5 item 2.\n`);
    process.exit(1);
  }

  const text = fs.readFileSync(INVENTORY_PATH, 'utf8');
  const lines = text.split('\n');

  /** @type {Map<string, {retention_days: string|null, has_lawful_basis: boolean}>} */
  const entries = new Map();

  // State machine: track current stream being parsed
  let currentStream = null;
  let currentRetention = null;
  let currentHasLawfulBasis = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match stream_path or file_path table rows
    const streamMatch = trimmed.match(/\|\s*\*\*stream_path\*\*\s*\|\s*`([^`]+)`\s*\|/) ||
                        trimmed.match(/\|\s*\*\*file_path\*\*\s*\|\s*`([^`]+)`\s*\|/);
    if (streamMatch) {
      // Save previous entry if any
      if (currentStream) {
        entries.set(currentStream, {
          retention_days: currentRetention,
          has_lawful_basis: currentHasLawfulBasis,
        });
      }
      // Start new entry
      currentStream = streamMatch[1];
      currentRetention = null;
      currentHasLawfulBasis = false;
      continue;
    }

    // Match retention_days row
    if (currentStream) {
      const retMatch = trimmed.match(/\|\s*\*\*retention_days\*\*\s*\|\s*([^|]+)\s*\|/);
      if (retMatch) {
        const val = retMatch[1].trim();
        // Check for TBD/TODO/undefined/blank
        if (val && val !== '' && !/^(TBD|TODO|undefined|N\/A\s*$)/.test(val)) {
          currentRetention = val;
        } else if (/^N\/A/.test(val)) {
          // "N/A — no personal data" is an acceptable declared value
          currentRetention = val;
        } else {
          currentRetention = null; // blank or TBD — G2 violation
        }
        continue;
      }

      // Match lawful_basis row
      const lbMatch = trimmed.match(/\|\s*\*\*lawful_basis\*\*\s*\|\s*([^|]+)\s*\|/);
      if (lbMatch) {
        const val = lbMatch[1].trim();
        currentHasLawfulBasis = val.length > 0 && val !== 'N/A';
        continue;
      }
    }
  }

  // Save last entry
  if (currentStream) {
    entries.set(currentStream, {
      retention_days: currentRetention,
      has_lawful_basis: currentHasLawfulBasis,
    });
  }

  return entries;
}

// ── G4: Pre-165 PII scan ───────────────────────────────────────────────────────
/**
 * Scans the first 50 lines of each .jsonl in docs/audits/ using detectPiiTokens.
 * Emits gdpr_finding severity:warn for any line where PII tokens are detected.
 * Does NOT auto-delete (D7 — blocked by hash-chain).
 *
 * @param {Array<{check_id: string, title: string, severity: string, dedup_suffix: string}>} findings - accumulator
 */
function runPre165Scan(findings) {
  log('\nG4 — Pre-wave-165 PII scan (first 50 lines of each .jsonl in docs/audits/)');
  log('     NOTE: detectPiiTokens IMPORTED from lib/redaction/redact-pii.mjs (not redefined)');
  log('     NOTE: Auto-deletion blocked by hash-chain integrity constraint (Art. 17(3)(b)/(e) exemption applies)');

  if (!fs.existsSync(AUDITS_DIR)) {
    log('  [SKIP ] G4 — docs/audits/ directory not found');
    return;
  }

  const jsonlFiles = fs.readdirSync(AUDITS_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(AUDITS_DIR, f));

  let totalPiiLines = 0;

  for (const filePath of jsonlFiles) {
    const relPath = path.relative(ROOT, filePath);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n').filter(Boolean).slice(0, 50);
    let filePiiCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Only scan lines that appear to be pre-wave-165 (no schema_version field or old flat format)
      // Pre-165 entries lack the 'schema_version' envelope field
      const isPre165 = !line.includes('"schema_version"');

      if (!isPre165) continue;

      const tokens = detectPiiTokens(line);
      if (tokens.length > 0) {
        filePiiCount++;
        totalPiiLines++;
        const lineNum = i + 1;
        log(`  [G4-WARN] ${relPath}:${lineNum} — pre-wave-165 entry, PII tokens detected: ${tokens.join(', ')}`);
        log(`            Human review required. Auto-deletion blocked (hash-chain integrity).`);
        log(`            Art. 17(3)(b)/(e) exemption applies. See retention-policy.md §Hash-chain and Art. 17 Erasure.`);

        const finding = makeFinding({
          check_id: 'G4',
          title: `Pre-wave-165 entry with PII tokens in ${relPath}:${lineNum} — tokens: ${tokens.join(', ')}`,
          severity: 'warn',
          dedup_suffix: `${relPath}:${lineNum}`,
        });
        findings.push(finding);
      }
    }

    if (filePiiCount === 0) {
      log(`  [G4-PASS] ${relPath} — no PII tokens in pre-wave-165 entries (first 50 lines)`);
    }
  }

  log(`\n  G4 summary: ${totalPiiLines} pre-wave-165 line(s) with PII tokens detected across ${jsonlFiles.length} stream(s)`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  const mode = isDry ? ' [DRY-RUN — no writes, no events]' : '';
  const scope = streamOnly ? ' [--stream-only: G4 scan skipped]' : '';
  log(`\n=== Wave-173 GDPR Inventory Validator${mode}${scope} ===`);
  log(`  RoPA:      ${INVENTORY_PATH}`);
  log(`  Registry:  ${EMIT_TELEMETRY_PATH}`);
  log(`  Register:  ${REGISTER_PATH}`);
  log(`  Timestamp: ${RUN_TS}`);

  if (isDry) {
    // In dry mode: parse and print inventory summary, then exit 0. No checks executed,
    // no files written, no telemetry events emitted.
    log('\n  --dry mode: parsing inventory sources and printing summary. No checks run.\n');
    const dryRegistry = parseStreamRegistry();
    log(`  Registry streams: ${dryRegistry.length}`);
    for (const p of dryRegistry) log(`    - ${path.relative(ROOT, p)}`);
    const dryRopa = parseRopaEntries();
    log(`\n  RoPA entries: ${dryRopa.size}`);
    for (const [sp, meta] of dryRopa.entries()) {
      log(`    - ${sp} | retention: ${meta.retention_days ?? '[MISSING]'} | lawful_basis: ${meta.has_lawful_basis ? 'declared' : '[MISSING]'}`);
    }
    log('\n=== Dry-run complete (exit 0) — no files written, no events emitted ===\n');
    process.exit(0);
  }

  // ── Parse stream registry (authoritative source: emit-telemetry.mjs ALL_STREAM_PATHS)
  log('\nParsing stream registry from emit-telemetry.mjs...');
  const registryPaths = parseStreamRegistry();
  log(`  Found ${registryPaths.length} stream path(s) in registry`);
  for (const p of registryPaths) {
    log(`    - ${path.relative(ROOT, p)}`);
  }

  // ── Parse RoPA entries
  log('\nParsing RoPA entries from data-inventory.md...');
  const ropaEntries = parseRopaEntries();
  log(`  Found ${ropaEntries.size} RoPA entry/entries`);
  for (const [streamPath, meta] of ropaEntries.entries()) {
    const retLabel = meta.retention_days ?? '[MISSING]';
    const lbLabel = meta.has_lawful_basis ? 'declared' : '[MISSING]';
    log(`    - ${streamPath} | retention: ${retLabel} | lawful_basis: ${lbLabel}`);
  }

  // ── Collect all findings
  /** @type {Array<object>} */
  const allFindings = [];
  const violations = []; // G1, G2 block (exit 1)
  const warnings = [];   // G3, G4, G5 warn (exit 0)

  log('\n--- Running invariant checks ---');

  // ── G1: Every stream in registry has a RoPA entry ─────────────────────────
  // Also: every on-disk .jsonl in docs/audits/ should be in the registry.
  // An on-disk stream not in the registry and not in the RoPA is an undeclared
  // data stream — a GDPR Art. 30 gap (cannot be lawfully processed without inventory).
  log('\nG1 — Every stream in registry has a RoPA entry');
  log('     (also checks for on-disk .jsonl files not in registry — undeclared streams)');
  let g1Pass = 0;
  let g1Fail = 0;
  for (const absPath of registryPaths) {
    const relPath = path.relative(ROOT, absPath);
    // Check if RoPA has an entry for this stream path
    const hasEntry = ropaEntries.has(relPath) || ropaEntries.has(absPath);
    if (!hasEntry) {
      g1Fail++;
      const msg = `[GDPR-G1-VIOLATION] ${relPath} — no RoPA entry`;
      log(`  ${msg}`);
      violations.push(msg);
      const finding = makeFinding({
        check_id: 'G1',
        title: `${relPath} — no RoPA entry in data-inventory.md`,
        severity: 'high',
        dedup_suffix: relPath,
      });
      allFindings.push(finding);
    } else {
      g1Pass++;
      log(`  [G1-PASS] ${relPath} — RoPA entry found`);
    }
  }

  // G1b — On-disk .jsonl files not in the registry (undeclared streams)
  if (fs.existsSync(AUDITS_DIR)) {
    const onDiskJsonl = fs.readdirSync(AUDITS_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(AUDITS_DIR, f));
    const registryAbsSet = new Set(registryPaths);
    for (const absPath of onDiskJsonl) {
      if (!registryAbsSet.has(absPath)) {
        const relPath = path.relative(ROOT, absPath);
        g1Fail++;
        const msg = `[GDPR-G1-VIOLATION] ${relPath} — on-disk .jsonl stream not in emit-telemetry.mjs registry and not in RoPA (undeclared data stream)`;
        log(`  ${msg}`);
        violations.push(msg);
        const finding = makeFinding({
          check_id: 'G1',
          title: `${relPath} — undeclared stream: exists on disk but not in emit-telemetry.mjs ALL_STREAM_PATHS or data-inventory.md`,
          severity: 'high',
          dedup_suffix: `undeclared:${relPath}`,
        });
        allFindings.push(finding);
      }
    }
  }

  log(`  G1 summary: ${g1Pass} PASS, ${g1Fail} VIOLATION`);

  // ── G2: Every RoPA stream entry has a declared retention_days ─────────────
  log('\nG2 — Every RoPA entry has a declared retention_days (not blank, not TBD)');
  let g2Pass = 0;
  let g2Fail = 0;
  for (const [streamPath, meta] of ropaEntries.entries()) {
    // Only check JSONL stream entries (not memory snapshots) against the registry
    // for G2; all entries must have a retention_days value
    if (!meta.retention_days) {
      g2Fail++;
      const msg = `[GDPR-G2-VIOLATION] ${streamPath} — retention_days not declared`;
      log(`  ${msg}`);
      violations.push(msg);
      const finding = makeFinding({
        check_id: 'G2',
        title: `${streamPath} — retention_days not declared in data-inventory.md`,
        severity: 'high',
        dedup_suffix: streamPath,
      });
      allFindings.push(finding);
    } else {
      g2Pass++;
      log(`  [G2-PASS] ${streamPath} — retention_days: ${meta.retention_days}`);
    }
  }
  log(`  G2 summary: ${g2Pass} PASS, ${g2Fail} VIOLATION`);

  // ── G3: Every RoPA entry has a matching stream in the registry ─────────────
  log('\nG3 — Every RoPA JSONL entry references a stream in the live registry');
  let g3Pass = 0;
  let g3Warn = 0;
  const registryRelPaths = new Set(registryPaths.map((p) => path.relative(ROOT, p)));
  for (const streamPath of ropaEntries.keys()) {
    // Only check JSONL stream entries (skip memory-*.md snapshots)
    if (!streamPath.endsWith('.jsonl')) continue;
    if (!registryRelPaths.has(streamPath)) {
      g3Warn++;
      const msg = `[GDPR-G3-WARN] ${streamPath} — RoPA entry has no matching stream definition`;
      log(`  ${msg}`);
      warnings.push(msg);
    } else {
      g3Pass++;
      log(`  [G3-PASS] ${streamPath} — matched in stream registry`);
    }
  }
  log(`  G3 summary: ${g3Pass} PASS, ${g3Warn} WARN`);

  // ── G4: Pre-wave-165 PII scan ─────────────────────────────────────────────
  if (!streamOnly) {
    /** @type {Array<object>} */
    const g4Findings = [];
    runPre165Scan(g4Findings);
    allFindings.push(...g4Findings);
    if (g4Findings.length > 0) {
      warnings.push(`G4: ${g4Findings.length} pre-wave-165 PII finding(s) — human review required`);
    }
  } else {
    log('\nG4 — Pre-wave-165 PII scan: SKIPPED (--stream-only flag)');
  }

  // ── G5: Every RoPA entry has a declared lawful_basis ─────────────────────
  log('\nG5 — Every RoPA entry has a declared lawful_basis');
  let g5Pass = 0;
  let g5Warn = 0;
  for (const [streamPath, meta] of ropaEntries.entries()) {
    if (!meta.has_lawful_basis) {
      g5Warn++;
      const msg = `[GDPR-G5-WARN] ${streamPath} — lawful_basis not declared`;
      log(`  ${msg}`);
      warnings.push(msg);
    } else {
      g5Pass++;
      log(`  [G5-PASS] ${streamPath} — lawful_basis declared`);
    }
  }
  log(`  G5 summary: ${g5Pass} PASS, ${g5Warn} WARN`);

  // ── Record findings ───────────────────────────────────────────────────────
  if (!isDry && allFindings.length > 0) {
    log('\n--- Recording findings ---');
    for (const finding of allFindings) {
      recordFinding(finding);
      log(`  Recorded: ${finding.finding_id} [${finding.check_id}] ${finding.severity} — ${finding.title.slice(0, 80)}`);
    }
  } else if (isDry && allFindings.length > 0) {
    log('\n--- [DRY] Findings (not written) ---');
    for (const finding of allFindings) {
      log(`  Would record: [${finding.check_id}] ${finding.severity} — ${finding.title.slice(0, 80)}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log('\n=== Wave-173 GDPR Inventory Validator — Run Summary ===');
  log(`  Registry streams: ${registryPaths.length}`);
  log(`  RoPA entries:     ${ropaEntries.size}`);
  log(`  Findings total:   ${allFindings.length}`);
  log(`  Violations (G1/G2, exit 1): ${violations.length}`);
  log(`  Warnings (G3/G4/G5, exit 0): ${warnings.length}`);

  if (violations.length > 0) {
    log('\n  --- VIOLATIONS (require resolution before compliance claim) ---');
    for (const v of violations) {
      log(`  ${v}`);
    }
    log('\n  EXIT 1 — G1/G2 violations present. Update data-inventory.md.');
    log('  Register: docs/security/findings-register.json');
    log('  Stream:   docs/audits/security-events.jsonl (12th stream)\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    log('\n  --- WARNINGS (non-blocking; require human review) ---');
    for (const w of warnings) {
      log(`  ${w}`);
    }
  }

  log('\n  EXIT 0 — No G1/G2 violations. Warnings above require human review.\n');
  process.exit(0);
}

// Guard: only run when this file is the entry point
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
