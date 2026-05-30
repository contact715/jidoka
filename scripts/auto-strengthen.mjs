#!/usr/bin/env node
// @ts-check
/**
 * Wave-149 — Auto-Strengthening Enforcement Daemon
 *
 * Reads 6 JSONL audit streams, evaluates rolling-7-day event counts against
 * per-flag thresholds defined in .sdd-config.json, and — when thresholds are
 * crossed — either auto-promotes flags (Level 1: observe->warn class) or opens
 * a GitHub issue (Level 2: warn->block class) for human approval.
 *
 * Two-tier human gate (T1 decision, EU AI Act Art 9 compliant):
 *   Level 1: observe->warn class — auto-applies when allowLevel1: true AND --apply
 *   Level 2: warn->block class  — NEVER auto-applies; requires GitHub issue with
 *                                  auto-strengthen-approve label (human decision)
 *
 * Usage:
 *   node scripts/auto-strengthen.mjs --dry-run   (default, safe — no config mutation)
 *   node scripts/auto-strengthen.mjs --apply     (mutations allowed; gates still apply)
 *
 * Config: .sdd-config.json autoStrengthen stanza
 * Output stream: docs/audits/strengthen-events.jsonl (7th stream, append-only)
 * Schema: docs/specs/telemetry-schema-v1.md §strengthen-events.jsonl
 *
 * STRIDE mitigations:
 *   T — ALLOWED_CONFIG_MUTATIONS is a const Set; no runtime override path.
 *   R — Every proposal/apply appends a timestamped prev_hash-chained record.
 *   E — No git push, no contents:write permission used.
 *   D — max-lines guard at 10,000 records per stream.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readJsonlStream,
  STRENGTHEN_EVENTS_PATH,
} from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');

// ── Safety whitelist (T4 + anti-pattern #6 scope-creep guard) ───────────────
// Any mutation attempt on a key outside this Set throws and exits non-zero.
// Changes to this Set require a code PR + review — no runtime override path.
const ALLOWED_CONFIG_MUTATIONS = new Set([
  'hard_block_ac',
  'cascade_hard_block',
  'crossLineBlock.hardBlockEnabled',
  'andonCord.hardBlockEnabled',
  'pfca.hardBlockEnabled',
  'recurrenceDetection.enabled',
  'recurrenceDetection.autoActionEnabled',
  'driftDetection.hardBlockEnabled',
]);

// ── Level classification ─────────────────────────────────────────────────────
// Level 1: observe->warn class (set an 'enabled' or non-hardBlock flag to true)
// Level 2: warn->block class  (set a 'hardBlockEnabled' or 'autoActionEnabled' to true)
const LEVEL_2_KEYS = new Set([
  'hard_block_ac',
  'cascade_hard_block',
  'crossLineBlock.hardBlockEnabled',
  'andonCord.hardBlockEnabled',
  'pfca.hardBlockEnabled',
  'recurrenceDetection.autoActionEnabled',
  'driftDetection.hardBlockEnabled',
]);

// ── Stream paths for reading input signals ───────────────────────────────────
const STREAM_PATHS = {
  'recurrence-events': path.join(ROOT, 'docs', 'audits', 'recurrence-events.jsonl'),
  'drift-events': path.join(ROOT, 'docs', 'audits', 'drift-events.jsonl'),
  'halt-events': path.join(ROOT, 'docs', 'audits', 'halt-events.jsonl'),
  'cross-line-verdicts': path.join(ROOT, 'docs', 'audits', 'cross-line-verdicts.jsonl'),
  'checklist-runs': path.join(ROOT, 'docs', 'audits', 'checklist-runs.jsonl'),
};

// Max records read per stream — DoS mitigation (§11 STRIDE D)
const MAX_LINES_PER_STREAM = 10_000;

// ── Config reader ────────────────────────────────────────────────────────────

/**
 * Read the autoStrengthen stanza from .sdd-config.json.
 * Returns safe all-off defaults if missing or malformed.
 * @returns {{ enabled: boolean, allowLevel1: boolean, allowLevel2: boolean, cooldownDays: number, thresholds: Record<string, { promote: number, window_days: number, demote_clear_days: number }> }}
 */
function readAutoStrengthenConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    const as = raw?.autoStrengthen;
    if (!as || typeof as !== 'object') {
      return { enabled: false, allowLevel1: false, allowLevel2: false, cooldownDays: 14, thresholds: {} };
    }
    return {
      enabled: Boolean(as.enabled),
      allowLevel1: Boolean(as.allowLevel1),
      allowLevel2: Boolean(as.allowLevel2),
      cooldownDays: typeof as.cooldownDays === 'number' ? as.cooldownDays : 14,
      thresholds: (as.thresholds && typeof as.thresholds === 'object') ? as.thresholds : {},
    };
  } catch {
    return { enabled: false, allowLevel1: false, allowLevel2: false, cooldownDays: 14, thresholds: {} };
  }
}

// ── prev_hash computation (modeled on emit-telemetry.mjs:145-168) ────────────

/**
 * Compute prev_hash for the next record in strengthen-events.jsonl.
 * @returns {string}
 */
function computeStrengthenPrevHash() {
  try {
    if (!fs.existsSync(STRENGTHEN_EVENTS_PATH)) return 'genesis';
    const records = readStrengthenStream();
    if (records.length === 0) return 'genesis';

    const chainActive = records.some(r => r.prev_hash !== null && r.prev_hash !== undefined);
    if (!chainActive) return 'genesis';

    const last = records[records.length - 1];
    return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(last)).digest('hex');
  } catch {
    return 'genesis';
  }
}

// ── Stream reader with max-lines guard ───────────────────────────────────────

/**
 * Read a JSONL stream with a hard cap at MAX_LINES_PER_STREAM.
 * @param {string} filePath
 * @returns {object[]}
 */
function readStreamCapped(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .slice(0, MAX_LINES_PER_STREAM)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Read strengthen-events.jsonl specifically (used for cooldown lookups).
 * @returns {object[]}
 */
function readStrengthenStream() {
  return readJsonlStream(STRENGTHEN_EVENTS_PATH).slice(0, MAX_LINES_PER_STREAM);
}

// ── Threshold evaluator (pure function — no I/O) ─────────────────────────────

/**
 * @typedef {{ flag_path: string, from_value: boolean, to_value: boolean, threshold_crossed: number, count_7d: number, level: 1 | 2 }} Proposal
 */

/**
 * Read current flag value from .sdd-config.json by dot-path.
 * @param {object} config - parsed .sdd-config.json
 * @param {string} flagPath - e.g. "driftDetection.hardBlockEnabled"
 * @returns {boolean}
 */
function readFlagValue(config, flagPath) {
  const parts = flagPath.split('.');
  let obj = config;
  for (const part of parts) {
    if (obj == null || typeof obj !== 'object') return false;
    obj = /** @type {any} */ (obj)[part];
  }
  return Boolean(obj);
}

/**
 * Map a flag_path to the stream that provides its signal events.
 * Returns null if no specific stream maps to this flag.
 * @param {string} flagPath
 * @returns {string | null}
 */
function resolveSignalStream(flagPath) {
  if (flagPath.startsWith('driftDetection')) return 'drift-events';
  if (flagPath.startsWith('recurrenceDetection')) return 'recurrence-events';
  if (flagPath.startsWith('andonCord')) return 'halt-events';
  if (flagPath.startsWith('crossLineBlock')) return 'cross-line-verdicts';
  if (flagPath.startsWith('pfca')) return 'checklist-runs';
  if (flagPath === 'hard_block_ac') return 'checklist-runs';
  if (flagPath === 'cascade_hard_block') return 'recurrence-events';
  // fallback: scan all streams
  return null;
}

/**
 * Count events in a stream within the rolling window_days.
 * @param {object[]} records
 * @param {number} windowDays
 * @returns {number}
 */
function countInWindow(records, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return records.filter(r => {
    const ts = r.timestamp || r.time;
    if (!ts) return false;
    return new Date(ts).getTime() >= cutoff;
  }).length;
}

/**
 * Check if a flag is in cooldown (promotion happened within cooldownDays).
 * @param {string} flagPath
 * @param {object[]} strengthenRecords
 * @param {number} cooldownDays
 * @returns {boolean}
 */
function isInCooldown(flagPath, strengthenRecords, cooldownDays) {
  const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
  return strengthenRecords.some(r =>
    r.event === 'promotion_applied' &&
    r.flag_path === flagPath &&
    new Date(r.timestamp).getTime() >= cutoff
  );
}

/**
 * Evaluate all thresholds and return proposal set.
 * Pure function — no I/O, no side effects.
 *
 * @param {{ enabled: boolean, allowLevel1: boolean, allowLevel2: boolean, cooldownDays: number, thresholds: Record<string, any> }} asConfig
 * @param {object} rawSddConfig - full parsed .sdd-config.json
 * @param {Record<string, object[]>} streams - pre-loaded stream records keyed by stream name
 * @param {object[]} strengthenRecords - strengthen-events.jsonl records (for cooldown)
 * @returns {Proposal[]}
 */
function evaluateThresholds(asConfig, rawSddConfig, streams, strengthenRecords) {
  /** @type {Proposal[]} */
  const proposals = [];

  for (const [flagPath, threshConfig] of Object.entries(asConfig.thresholds)) {
    const promote = threshConfig.promote ?? 5;
    const windowDays = threshConfig.window_days ?? 7;

    const currentValue = readFlagValue(rawSddConfig, flagPath);

    // Only propose promotion if currently false
    if (currentValue === true) {
      process.stdout.write(`[auto-strengthen] SKIP ${flagPath} — already promoted (value: true)\n`);
      continue;
    }

    // Resolve signal stream
    const streamName = resolveSignalStream(flagPath);
    let records = [];
    if (streamName) {
      records = streams[streamName] || [];
    } else {
      // Aggregate all streams
      records = Object.values(streams).flat();
    }

    const count = countInWindow(records, windowDays);
    process.stdout.write(
      `[auto-strengthen] ${flagPath}: ${count} qualifying events found in window (threshold: ${promote}, window: ${windowDays}d)\n`
    );

    if (count < promote) continue;

    // Threshold crossed — check cooldown using strengthen-events.jsonl
    // A7: if file absent and cooldown evaluation needed, refuse promotion
    if (!fs.existsSync(STRENGTHEN_EVENTS_PATH)) {
      process.stdout.write(
        `[auto-strengthen] SKIP ${flagPath} — strengthen-events.jsonl absent; cooldown state unknown; refusing promotion (conservative default, A7)\n`
      );
      continue;
    }

    if (isInCooldown(flagPath, strengthenRecords, asConfig.cooldownDays)) {
      process.stdout.write(
        `[auto-strengthen] SKIP ${flagPath} — in cooldown (promoted within last ${asConfig.cooldownDays} days)\n`
      );
      continue;
    }

    const level = LEVEL_2_KEYS.has(flagPath) ? 2 : 1;

    proposals.push({
      flag_path: flagPath,
      from_value: false,
      to_value: true,
      threshold_crossed: promote,
      count_7d: count,
      level,
    });
  }

  return proposals;
}

// ── strengthen-events.jsonl append ───────────────────────────────────────────

/**
 * Append one record to strengthen-events.jsonl (append-only, prev_hash chained).
 * @param {object} record
 */
function appendStrengthenEvent(record) {
  const prev_hash = computeStrengthenPrevHash();
  const full = { ...record, prev_hash };
  try {
    fs.mkdirSync(path.dirname(STRENGTHEN_EVENTS_PATH), { recursive: true });
    fs.appendFileSync(STRENGTHEN_EVENTS_PATH, JSON.stringify(full) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`[auto-strengthen] ERROR appending strengthen event: ${err}\n`);
  }
}

// ── GitHub issue creation (Level 2 human gate) ───────────────────────────────

/**
 * Open a GitHub issue for a Level 2 promotion proposal.
 * Returns the issue URL or null if GH_TOKEN is absent or creation fails.
 * @param {Proposal} proposal
 * @param {object[]} recentEvents - last 5 matching events for the body
 * @returns {string | null}
 */
function openGitHubIssue(proposal, recentEvents) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    process.stderr.write(
      `[auto-strengthen] WARN — GH_TOKEN missing; issue creation skipped for ${proposal.flag_path}\n`
    );
    return null;
  }

  const last5 = recentEvents.slice(-5);
  const eventsBlock = last5
    .map(e => JSON.stringify(e).slice(0, 200))
    .join('\n');

  const body = [
    `## Auto-Strengthen — Level 2 Promotion Proposal`,
    ``,
    `**Flag**: \`${proposal.flag_path}\``,
    `**Proposed change**: \`${proposal.from_value}\` → \`${proposal.to_value}\``,
    `**Threshold crossed**: ${proposal.threshold_crossed} events in ${7} days`,
    `**Actual count (7d)**: ${proposal.count_7d}`,
    ``,
    `### Last 5 qualifying events`,
    `\`\`\``,
    eventsBlock,
    `\`\`\``,
    ``,
    `### Approval`,
    ``,
    `To approve this promotion, add the label \`auto-strengthen-approve\` to this issue.`,
    `The next cron run (daily 07:00 UTC) will detect the label and apply the mutation.`,
    ``,
    `> This issue was opened automatically by \`.github/workflows/auto-strengthen.yml\` (wave-149).`,
    `> Level 2 (warn->block class) promotions NEVER auto-apply without human approval.`,
    `> EU AI Act Art 9 compliant — human review before hard enforcement.`,
  ].join('\n');

  const title = `Auto-Strengthen: promote ${proposal.flag_path} (${proposal.count_7d}/${proposal.threshold_crossed} events, 7d)`;

  try {
    const result = execSync(
      `gh issue create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label "auto-strengthen,meta-process"`,
      { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token } }
    ).trim();
    process.stdout.write(`[auto-strengthen] Level 2 issue created: ${result}\n`);
    return result;
  } catch (err) {
    process.stderr.write(
      `[auto-strengthen] WARN — gh issue create failed for ${proposal.flag_path}: ${err}\n` +
      `[auto-strengthen] WARN — Label 'auto-strengthen,meta-process' may not exist. Issue creation skipped.\n`
    );
    return null;
  }
}

/**
 * Check if a pending Level 2 proposal has received 'auto-strengthen-approve' label.
 * Returns an array of approved flag_paths.
 * @returns {string[]}
 */
function findApprovedLevel2Proposals() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return [];

  try {
    const result = execSync(
      `gh issue list --label "auto-strengthen-approve" --json number,title,labels --limit 50`,
      { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token } }
    );
    const issues = JSON.parse(result);
    const flagPaths = [];
    for (const issue of issues) {
      // Extract flag_path from issue title: "Auto-Strengthen: promote <flag_path> ..."
      const match = issue.title.match(/Auto-Strengthen: promote ([^\s(]+)/);
      if (match) {
        flagPaths.push(match[1]);
      }
    }
    return flagPaths;
  } catch {
    return [];
  }
}

// ── Config mutation (ALLOWED_CONFIG_MUTATIONS whitelist enforced) ─────────────

/**
 * Write a flag value to .sdd-config.json using dot-path notation.
 * Throws and exits non-zero if flagPath is not in ALLOWED_CONFIG_MUTATIONS (A5).
 * @param {string} flagPath
 * @param {boolean} value
 */
function mutateSddConfig(flagPath, value) {
  // A5: whitelist guard
  if (!ALLOWED_CONFIG_MUTATIONS.has(flagPath)) {
    process.stderr.write(
      `[auto-strengthen] ERROR — attempted mutation of disallowed key: "${flagPath}". ` +
      `Key not in ALLOWED_CONFIG_MUTATIONS. Aborting.\n`
    );
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
  const parts = flagPath.split('.');

  if (parts.length === 1) {
    raw[flagPath] = value;
  } else if (parts.length === 2) {
    const [parent, child] = parts;
    if (!raw[parent] || typeof raw[parent] !== 'object') {
      raw[parent] = {};
    }
    raw[parent][child] = value;
  } else {
    process.stderr.write(
      `[auto-strengthen] ERROR — flag_path depth > 2 not supported: "${flagPath}"\n`
    );
    process.exit(1);
  }

  fs.writeFileSync(SDD_CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  process.stdout.write(`[auto-strengthen] APPLIED: ${flagPath} = ${value}\n`);
}

// ── Load all input streams ────────────────────────────────────────────────────

/**
 * Load all 5 input signal streams.
 * @returns {Record<string, object[]>}
 */
function loadStreams() {
  /** @type {Record<string, object[]>} */
  const streams = {};
  for (const [name, filePath] of Object.entries(STREAM_PATHS)) {
    streams[name] = readStreamCapped(filePath);
  }
  return streams;
}

// ── Dry-run path ─────────────────────────────────────────────────────────────

/**
 * Evaluate thresholds and print proposals. Append dry_run: true records.
 * Never mutates .sdd-config.json.
 */
function runDryRun() {
  process.stdout.write('[auto-strengthen] Mode: --dry-run (no config mutations)\n');

  const asConfig = readAutoStrengthenConfig();
  const rawSddConfig = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
  const streams = loadStreams();
  const strengthenRecords = fs.existsSync(STRENGTHEN_EVENTS_PATH)
    ? readStrengthenStream()
    : [];

  const proposals = evaluateThresholds(asConfig, rawSddConfig, streams, strengthenRecords);

  if (proposals.length === 0) {
    process.stdout.write('[auto-strengthen] No threshold crossings found. Nothing to propose.\n');

    // Append evaluation_clean record
    appendStrengthenEvent({
      timestamp: new Date().toISOString(),
      event: 'strengthen_evaluated',
      flag_path: null,
      from_value: null,
      to_value: null,
      threshold_crossed: null,
      count_7d: 0,
      dry_run: true,
      issue_url: null,
    });
    return;
  }

  for (const p of proposals) {
    process.stdout.write(
      `[auto-strengthen] DRY-RUN PROPOSAL: ${p.flag_path} ` +
      `${p.from_value} -> ${p.to_value} ` +
      `(level ${p.level}, count_7d=${p.count_7d}, threshold=${p.threshold_crossed})\n`
    );

    appendStrengthenEvent({
      timestamp: new Date().toISOString(),
      event: p.level === 2 ? 'promotion_proposed' : 'promotion_proposed',
      flag_path: p.flag_path,
      from_value: p.from_value,
      to_value: p.to_value,
      threshold_crossed: p.threshold_crossed,
      count_7d: p.count_7d,
      dry_run: true,
      issue_url: null,
    });
  }
}

// ── Apply path ────────────────────────────────────────────────────────────────

/**
 * Evaluate thresholds and apply Level 1 promotions (if allowLevel1: true).
 * Level 2 promotions open GitHub issues — never auto-apply.
 * Also checks for approved Level 2 proposals (auto-strengthen-approve label).
 * Requires --apply CLI flag to be present.
 */
function runApply() {
  process.stdout.write('[auto-strengthen] Mode: --apply\n');

  const asConfig = readAutoStrengthenConfig();

  if (!asConfig.enabled) {
    process.stdout.write(
      '[auto-strengthen] autoStrengthen.enabled is false in .sdd-config.json. ' +
      'Set enabled: true to allow auto-strengthening. Exiting.\n'
    );
    process.exit(0);
  }

  if (!asConfig.allowLevel1 && !asConfig.allowLevel2) {
    process.stdout.write(
      '[auto-strengthen] WARN — --apply passed but allowLevel1 and allowLevel2 are both false. ' +
      'No mutations will be applied. Set allowLevel1: true in .sdd-config.json to enable Level 1 promotions.\n'
    );
  }

  const rawSddConfig = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
  const streams = loadStreams();
  const strengthenRecords = fs.existsSync(STRENGTHEN_EVENTS_PATH)
    ? readStrengthenStream()
    : [];

  const proposals = evaluateThresholds(asConfig, rawSddConfig, streams, strengthenRecords);

  // Check for pending Level 2 approvals (auto-strengthen-approve label)
  const approvedFlagPaths = findApprovedLevel2Proposals();
  if (approvedFlagPaths.length > 0) {
    process.stdout.write(
      `[auto-strengthen] Found ${approvedFlagPaths.length} approved Level 2 proposal(s): ${approvedFlagPaths.join(', ')}\n`
    );
  }

  for (const p of proposals) {
    if (p.level === 1) {
      if (!asConfig.allowLevel1) {
        process.stdout.write(
          `[auto-strengthen] SKIP Level 1 ${p.flag_path} — allowLevel1 is false\n`
        );
        appendStrengthenEvent({
          timestamp: new Date().toISOString(),
          event: 'promotion_proposed',
          flag_path: p.flag_path,
          from_value: p.from_value,
          to_value: p.to_value,
          threshold_crossed: p.threshold_crossed,
          count_7d: p.count_7d,
          dry_run: false,
          issue_url: null,
        });
        continue;
      }

      // Level 1 auto-apply
      mutateSddConfig(p.flag_path, p.to_value);
      appendStrengthenEvent({
        timestamp: new Date().toISOString(),
        event: 'promotion_applied',
        flag_path: p.flag_path,
        from_value: p.from_value,
        to_value: p.to_value,
        threshold_crossed: p.threshold_crossed,
        count_7d: p.count_7d,
        dry_run: false,
        issue_url: null,
      });

    } else {
      // Level 2 — NEVER auto-apply; open GitHub issue (A4)
      process.stdout.write(
        `[auto-strengthen] Level 2 proposal: ${p.flag_path} — opening GitHub issue (human approval required)\n`
      );

      const streamName = resolveSignalStream(p.flag_path);
      const recentEvents = streamName ? streams[streamName] || [] : [];

      const issueUrl = openGitHubIssue(p, recentEvents);

      appendStrengthenEvent({
        timestamp: new Date().toISOString(),
        event: 'promotion_proposed',
        flag_path: p.flag_path,
        from_value: p.from_value,
        to_value: p.to_value,
        threshold_crossed: p.threshold_crossed,
        count_7d: p.count_7d,
        dry_run: false,
        issue_url: issueUrl,
      });
    }
  }

  // Apply approved Level 2 proposals
  for (const flagPath of approvedFlagPaths) {
    if (!ALLOWED_CONFIG_MUTATIONS.has(flagPath)) {
      process.stderr.write(
        `[auto-strengthen] WARN — approved Level 2 proposal for disallowed key: "${flagPath}". Skipping.\n`
      );
      continue;
    }

    const currentValue = readFlagValue(rawSddConfig, flagPath);
    if (currentValue === true) {
      process.stdout.write(
        `[auto-strengthen] SKIP approved Level 2 ${flagPath} — already promoted\n`
      );
      continue;
    }

    process.stdout.write(
      `[auto-strengthen] APPLYING approved Level 2 proposal: ${flagPath} false -> true\n`
    );
    mutateSddConfig(flagPath, true);
    appendStrengthenEvent({
      timestamp: new Date().toISOString(),
      event: 'promotion_applied',
      flag_path: flagPath,
      from_value: false,
      to_value: true,
      threshold_crossed: null,
      count_7d: null,
      dry_run: false,
      issue_url: null,
    });
  }

  if (proposals.length === 0 && approvedFlagPaths.length === 0) {
    process.stdout.write('[auto-strengthen] No threshold crossings and no approved proposals. Nothing to apply.\n');
    appendStrengthenEvent({
      timestamp: new Date().toISOString(),
      event: 'strengthen_evaluated',
      flag_path: null,
      from_value: null,
      to_value: null,
      threshold_crossed: null,
      count_7d: 0,
      dry_run: false,
      issue_url: null,
    });
  }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const dryRunMode = args.includes('--dry-run') || !applyMode;

if (applyMode) {
  runApply();
} else {
  runDryRun();
}
