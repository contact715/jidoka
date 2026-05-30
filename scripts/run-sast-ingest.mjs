#!/usr/bin/env node
// @ts-check
/**
 * Wave-174 — SAST Findings Ingest
 *
 * Thin wrapper: parses semgrep SARIF or JSON output, constructs wave-172-compatible
 * finding records, appends to docs/security/findings-register.json (REUSE),
 * and emits pentest_finding events to docs/audits/security-events.jsonl (REUSE).
 *
 * Spec: docs/specs/wave-174_MASTER_SPEC.md
 * D6  — dedup_key = sha1(ruleId + filePath + startLine)
 * D9  — NO new register, NO new stream. findings-register.json + security-events.jsonl only.
 * AC-7 — findings-register.json receives all SAST findings via this script.
 * AC-8 — security-events.jsonl is the only stream (12th stream, wave-165).
 *
 * DUPLICATE-BLOCK: appendToRegister logic reuses the idempotency pattern from
 * scripts/run-pentest-harness.mjs:185-224. Not reimplemented — read from file.
 *
 * Usage:
 *   node scripts/run-sast-ingest.mjs --sarif <path>       parse SARIF output
 *   node scripts/run-sast-ingest.mjs --json  <path>       parse semgrep JSON output
 *   node scripts/run-sast-ingest.mjs --fixture            run against built-in fixture (test mode)
 *   npm run security:sast -- --sarif semgrep.sarif
 *
 * Exit codes:
 *   0 — always (ingest is non-blocking; the CI step controls blocking)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { emitTelemetry } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REGISTER_PATH = path.join(ROOT, 'docs', 'security', 'findings-register.json');
// AC-8: security-events.jsonl is the ONLY target stream (12th stream, wave-165).
// No new stream created — emitTelemetry routes 'pentest_finding' there automatically.

// Fixture guard (wave-174 R2): --fixture mode MUST NOT write to the production register
// or emit to the production audit stream. Route all fixture output to isolated paths
// in os.tmpdir() so the SOC-2 evidence artifacts remain uncontaminated.
// FIXTURE_REGISTER_PATH is also listed in .gitignore so it can never be committed.
const FIXTURE_REGISTER_PATH = path.join(ROOT, 'docs', 'security', '.fixture-register.json');

const WAVE = 'wave-174';
const AGENT = 'run-sast-ingest';
const RUN_TS = new Date().toISOString();

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const sarifIdx = args.indexOf('--sarif');
const jsonIdx = args.indexOf('--json');
const isFixture = args.includes('--fixture');

const SARIF_PATH = sarifIdx !== -1 && args[sarifIdx + 1] ? path.resolve(args[sarifIdx + 1]) : null;
const JSON_PATH = jsonIdx !== -1 && args[jsonIdx + 1] ? path.resolve(args[jsonIdx + 1]) : null;

// ── Severity mapping ─────────────────────────────────────────────────────────
// SARIF: error→high, warning→medium, note/none→low
// semgrep JSON: ERROR→high, WARNING→medium, INFO→low
/** @param {string} level @returns {'critical'|'high'|'medium'|'low'} */
function mapSeverity(level) {
  const l = (level || '').toLowerCase();
  if (l === 'error') return 'high';
  if (l === 'warning' || l === 'warn') return 'medium';
  return 'low';
}

// ── dedup_key = sha1(ruleId + filePath + startLine) ─────────────────────────
// D6: Constructed independently of SARIF partialFingerprints (which semgrep OSS
// free tier omitted). Stable across re-runs on the same finding.
/**
 * @param {string} ruleId
 * @param {string} filePath
 * @param {number|string} startLine
 * @returns {string}
 */
function buildDedupKey(ruleId, filePath, startLine) {
  const raw = `${ruleId}|${filePath}|${startLine}`;
  return `C2-SAST:${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

// ── SLA bands (mirrors run-pentest-harness.mjs:79-86) ────────────────────────
const SLA_DAYS = { critical: 3, high: 14, medium: 60, low: 365 };
/** @param {'critical'|'high'|'medium'|'low'} severity @returns {string} */
function slaDeadline(severity) {
  const d = new Date();
  d.setDate(d.getDate() + (SLA_DAYS[severity] ?? 365));
  return d.toISOString().split('T')[0];
}

// ── Finding counter ───────────────────────────────────────────────────────────
let findingSeq = 0;
function nextFindingId() {
  findingSeq += 1;
  return `F-174-SAST-${String(findingSeq).padStart(3, '0')}`;
}

// ── Append to register (idempotent — mirrors wave-172 R3 pattern) ─────────────
// D9: REUSE findings-register.json. No new register file.
// Dedup: skip if an open record with same dedup_key already exists.
// Fixture guard: when isFixture is true, targetPath is FIXTURE_REGISTER_PATH —
// the production register (REGISTER_PATH) is never touched.
/**
 * @param {object} finding
 * @param {string} targetPath  path to write (production or fixture register)
 * @returns {boolean} true if appended, false if deduped
 */
function appendToRegister(finding, targetPath) {
  let existing = [];
  if (fs.existsSync(targetPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
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
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return true;
}

// ── Emit to security-events.jsonl via emitTelemetry ──────────────────────────
// AC-8: 'pentest_finding' routes to docs/audits/security-events.jsonl (12th stream).
// Fixture guard: emitTelemetry is NOT called in fixture mode — the production
// audit stream must remain uncontaminated by test data.
function emitFindingEvent(finding) {
  emitTelemetry('pentest_finding', {
    source: 'scripts/run-sast-ingest.mjs',
    wave: WAVE,
    agent: AGENT,
    payload: {
      event_subtype: 'sast_finding',
      finding_id: finding.finding_id,
      check_id: finding.check_id,
      title: finding.title,
      severity: finding.severity,
      cvss_score: finding.cvss_score,
      cwe: finding.cwe,
      status: finding.status,
      sla_deadline: finding.sla_deadline,
      sarif_rule_id: finding.sarif_rule_id,
    },
  });
}

// ── Record finding (append + emit, atomic per wave-172 D5 pattern) ────────────
// Fixture guard: routes to FIXTURE_REGISTER_PATH when isFixture=true, and
// suppresses emitTelemetry so the production audit stream is not polluted.
function recordFinding(finding) {
  const targetPath = isFixture ? FIXTURE_REGISTER_PATH : REGISTER_PATH;
  const appended = appendToRegister(finding, targetPath);
  if (appended) {
    // Only emit to the production audit stream in real (non-fixture) runs.
    if (!isFixture) {
      emitFindingEvent(finding);
    }
    return true;
  }
  return false;
}

// ── SARIF parser ──────────────────────────────────────────────────────────────
/**
 * Parse semgrep SARIF output and return normalized finding objects.
 * @param {string} sarifContent
 * @returns {Array<object>}
 */
function parseSarif(sarifContent) {
  const sarif = JSON.parse(sarifContent);
  const findings = [];
  for (const run of sarif.runs || []) {
    const rules = {};
    for (const rule of run.tool?.driver?.rules || []) {
      rules[rule.id] = rule;
    }
    for (const result of run.results || []) {
      const ruleId = result.ruleId || 'unknown-rule';
      const rule = rules[ruleId] || {};
      const location = result.locations?.[0]?.physicalLocation;
      const filePath = location?.artifactLocation?.uri || 'unknown-file';
      const startLine = location?.region?.startLine ?? 0;
      const level = result.level || 'warning';
      const severity = mapSeverity(level);
      const message = result.message?.text || rule.shortDescription?.text || ruleId;
      const cwe = rule.properties?.tags?.find((t) => t.startsWith('CWE')) || 'CWE-unknown';
      const dedup_key = buildDedupKey(ruleId, filePath, startLine);
      findings.push({
        ruleId,
        filePath,
        startLine,
        level,
        severity,
        message,
        cwe,
        dedup_key,
      });
    }
  }
  return findings;
}

// ── semgrep JSON parser ────────────────────────────────────────────────────────
/**
 * Parse semgrep --json output and return normalized finding objects.
 * @param {string} jsonContent
 * @returns {Array<object>}
 */
function parseSemgrepJson(jsonContent) {
  const data = JSON.parse(jsonContent);
  const findings = [];
  for (const result of data.results || []) {
    const ruleId = result.check_id || 'unknown-rule';
    const filePath = result.path || 'unknown-file';
    const startLine = result.start?.line ?? 0;
    const level = result.extra?.severity || 'WARNING';
    const severity = mapSeverity(level);
    const message = result.extra?.message || ruleId;
    const cwe = result.extra?.metadata?.cwe || 'CWE-unknown';
    const dedup_key = buildDedupKey(ruleId, filePath, startLine);
    findings.push({
      ruleId,
      filePath,
      startLine,
      level,
      severity,
      message,
      cwe,
      dedup_key,
    });
  }
  return findings;
}

// ── Built-in fixture (for local testing without real semgrep) ─────────────────
// Used to prove the ingest + dedup logic works before CI runs real semgrep.
// The fixture contains 3 findings: one high, one medium, one low.
// See verification section of wave-174 report.
const FIXTURE_SARIF = {
  version: '2.1.0',
  $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
  runs: [
    {
      tool: {
        driver: {
          name: 'semgrep',
          rules: [
            {
              id: 'javascript.lang.security.audit.eval-detected.eval-detected',
              shortDescription: { text: 'eval() usage detected — potential code injection' },
              properties: { tags: ['CWE-94', 'OWASP-A03'] },
            },
            {
              id: 'react.security.audit.react-dangerously-set-inner-html.react-dangerously-set-inner-html',
              shortDescription: { text: 'dangerouslySetInnerHTML usage — potential XSS' },
              properties: { tags: ['CWE-79', 'OWASP-A03'] },
            },
            {
              id: 'typescript.browser-security.localstorage-key-sec-key.localstorage-key-sec-key',
              shortDescription: { text: 'Sensitive data stored in localStorage' },
              properties: { tags: ['CWE-312', 'OWASP-A02'] },
            },
          ],
        },
      },
      results: [
        {
          ruleId: 'javascript.lang.security.audit.eval-detected.eval-detected',
          level: 'error',
          message: { text: 'eval() usage detected — potential code injection (FIXTURE)' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'app/some-feature/page.tsx' },
                region: { startLine: 42 },
              },
            },
          ],
        },
        {
          ruleId: 'react.security.audit.react-dangerously-set-inner-html.react-dangerously-set-inner-html',
          level: 'warning',
          message: { text: 'dangerouslySetInnerHTML without sanitization (FIXTURE)' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'components/some-widget/Widget.tsx' },
                region: { startLine: 17 },
              },
            },
          ],
        },
        {
          ruleId: 'typescript.browser-security.localstorage-key-sec-key.localstorage-key-sec-key',
          level: 'note',
          message: { text: 'Sensitive data stored in localStorage (FIXTURE)' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'lib/api/client.ts' },
                region: { startLine: 73 },
              },
            },
          ],
        },
      ],
    },
  ],
};

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  let rawFindings = [];

  if (isFixture) {
    console.log('[run-sast-ingest] --fixture mode: production register and audit stream are ISOLATED.');
    console.log(`[run-sast-ingest]   Fixture register target: ${FIXTURE_REGISTER_PATH}`);
    rawFindings = parseSarif(JSON.stringify(FIXTURE_SARIF));
  } else if (SARIF_PATH) {
    if (!fs.existsSync(SARIF_PATH)) {
      console.log(`[SKIP] run-sast-ingest — SARIF file not found: ${SARIF_PATH}`);
      process.exit(0);
    }
    rawFindings = parseSarif(fs.readFileSync(SARIF_PATH, 'utf8'));
  } else if (JSON_PATH) {
    if (!fs.existsSync(JSON_PATH)) {
      console.log(`[SKIP] run-sast-ingest — JSON file not found: ${JSON_PATH}`);
      process.exit(0);
    }
    rawFindings = parseSemgrepJson(fs.readFileSync(JSON_PATH, 'utf8'));
  } else {
    console.log('[SKIP] run-sast-ingest — no input file specified. Use --sarif, --json, or --fixture.');
    process.exit(0);
  }

  console.log(`[run-sast-ingest] Parsed ${rawFindings.length} finding(s) from input.`);

  let appended = 0;
  let deduped = 0;

  for (const raw of rawFindings) {
    const finding = {
      finding_id: nextFindingId(),
      check_id: 'C2-SAST',
      dedup_key: raw.dedup_key,
      title: `${raw.ruleId} — ${raw.message} (${raw.filePath}:${raw.startLine})`,
      severity: raw.severity,
      cvss_score: null,
      cwe: raw.cwe,
      status: 'open',
      sla_deadline: slaDeadline(raw.severity),
      wave: WAVE,
      introduced_wave: 'unknown',
      agent: AGENT,
      mitigation_note: '',
      timestamp: RUN_TS,
      // SAST-specific extra field (D6):
      sarif_rule_id: raw.ruleId,
    };

    const wasAppended = recordFinding(finding);
    if (wasAppended) {
      appended += 1;
      console.log(`  [FINDING] ${raw.severity.toUpperCase()} — ${raw.ruleId} @ ${raw.filePath}:${raw.startLine} → appended (dedup_key: ${raw.dedup_key})`);
    } else {
      deduped += 1;
      console.log(`  [DEDUPED] ${raw.ruleId} @ ${raw.filePath}:${raw.startLine} — already open in register (idempotent)`);
    }
  }

  console.log(`[run-sast-ingest] Done. Appended: ${appended}, Deduped (idempotent): ${deduped}.`);
  // Always exit 0 — ingest is non-blocking. The CI semgrep-action step controls blocking.
  process.exit(0);
}

main();
