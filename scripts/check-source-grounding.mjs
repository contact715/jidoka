#!/usr/bin/env node
// @ts-check
/**
 * Wave-163 — Source Grounding Checker
 *
 * Reads agent output JSON, extracts citations[], resolves each chunk_id against
 * the source registry, and emits a grounding verdict to the 10th telemetry stream
 * (docs/audits/halluc-events.jsonl).
 *
 * Gated by .sdd-config.json hallucination.enabled.
 * When enabled: false → exit 0, write nothing.
 *
 * Soft-fail default: script always exits 0 unless hardBlockEnabled: true and
 * a hallucination_detected event is emitted.
 *
 * Detection mechanism: regex-based citation extraction + chunk_id existence check.
 * Content-hash verification is deferred to wave-164 (STRIDE §12 Spoofing mitigation).
 *
 * Usage:
 *   node scripts/check-source-grounding.mjs [--dry-run] [--agent <name>] [--wave <wave>]
 *   node scripts/check-source-grounding.mjs --dry-run --fixture missing-citations
 *   npm run detect:hallucinations
 *
 * Schema: docs/GROUNDING_CONTRACT.md
 * Types:  lib/types/grounding.ts
 * EU AI Act: Art 15 Para 3 declarable accuracy metric
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  emitTelemetry,
  getCurrentTraceId,
} from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────
const SDD_CONFIG_PATH    = path.join(ROOT, '.sdd-config.json');
const HALLUC_EVENTS_PATH = path.join(ROOT, 'docs', 'audits', 'halluc-events.jsonl');

// ── Source registry (chunk_id existence check) ────────────────────────────
// In v1, the registry is a flat JSONL file of known source chunks.
// chunk_id resolution = existence check only (no content-hash in v1).
// wave-164 upgrade: add content-hash verification.
const SOURCE_REGISTRY_PATH = path.join(ROOT, 'docs', 'knowledge', 'source-registry.jsonl');

// ── Fixtures for dry-run testing ──────────────────────────────────────────
/** @type {Record<string, object>} */
const FIXTURES = {
  'all-resolved': {
    content: 'The last appointment was March 4.',
    citations: [
      { chunk_id: 'fixture-chunk-001', document_id: 'fixture-doc', start_char: 0, end_char: 30 },
    ],
  },
  'missing-citations': {
    content: 'The last appointment was March 4.',
    // No citations[] field — triggers hallucination_detected when citation_schema != 'none'
  },
  'unresolved-chunk': {
    content: 'The last appointment was March 4.',
    citations: [
      { chunk_id: 'nonexistent-chunk-xyz', document_id: 'fixture-doc', start_char: 0, end_char: 30 },
    ],
  },
  'empty-citations': {
    content: 'The last appointment was March 4.',
    citations: [],
  },
};

// ── Config reader ─────────────────────────────────────────────────────────

/**
 * @returns {{ enabled: boolean, hardBlockEnabled: boolean, sampleRate: number }}
 */
function readHallucinationConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
    const h = raw?.hallucination ?? {};
    return {
      enabled: Boolean(h.enabled),
      hardBlockEnabled: Boolean(h.hardBlockEnabled),
      sampleRate: typeof h.sampleRate === 'number' ? h.sampleRate : 1.0,
    };
  } catch {
    return { enabled: false, hardBlockEnabled: false, sampleRate: 1.0 };
  }
}

// ── Source registry loader ────────────────────────────────────────────────

/**
 * Load the set of known chunk_ids from the source registry.
 * Returns an empty set if the registry does not exist yet (non-fatal).
 * @returns {Set<string>}
 */
function loadSourceRegistry() {
  const known = new Set();
  try {
    if (!fs.existsSync(SOURCE_REGISTRY_PATH)) return known;
    const raw = fs.readFileSync(SOURCE_REGISTRY_PATH, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (typeof record.chunk_id === 'string') {
          known.add(record.chunk_id);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Non-fatal: missing registry means all chunk_ids are unresolvable
  }
  return known;
}

// ── Citation extractor ────────────────────────────────────────────────────

/**
 * Extract citations[] from a parsed agent output object.
 * Returns null if the field is absent (not the same as an empty array).
 *
 * @param {Record<string, unknown>} agentOutput
 * @returns {Array<{ chunk_id: string, document_id?: string }> | null}
 */
function extractCitations(agentOutput) {
  if (!('citations' in agentOutput)) return null;
  const raw = agentOutput.citations;
  if (!Array.isArray(raw)) return null;
  return raw.filter(c => c && typeof c.chunk_id === 'string');
}

// ── Agent definition reader ───────────────────────────────────────────────

/**
 * Read the citation_schema and hard_fail_on_missing from an agent definition file.
 * Validates that the path is within the known agents/ directory (STRIDE §12 EoP mitigation).
 *
 * @param {string} agentName
 * @returns {{ citation_schema: 'anthropic_citations' | 'structured_output' | 'none', hard_fail_on_missing: boolean }}
 */
function readAgentGroundingConfig(agentName) {
  const defaults = { citation_schema: /** @type {'none'} */ ('none'), hard_fail_on_missing: false };

  if (!agentName) return defaults;

  // Path-traversal guard: agent definition must be within .claude/agents/ only
  const agentsDir = path.resolve(ROOT, '.claude', 'agents');
  const agentFile = path.resolve(agentsDir, `${path.basename(agentName)}.md`);
  if (!agentFile.startsWith(agentsDir + path.sep) && agentFile !== agentsDir) {
    process.stderr.write(
      `[check-source-grounding] WARN — agent path traversal rejected for: ${agentName}\n`
    );
    return defaults;
  }

  try {
    if (!fs.existsSync(agentFile)) return defaults;
    const content = fs.readFileSync(agentFile, 'utf8');

    // Extract source_grounding block via regex
    const schemaMatch = content.match(/citation_schema:\s*(anthropic_citations|structured_output|none)/);
    const hardFailMatch = content.match(/hard_fail_on_missing:\s*(true|false)/);

    const citation_schema = schemaMatch
      ? /** @type {'anthropic_citations' | 'structured_output' | 'none'} */ (schemaMatch[1])
      : 'none';
    const hard_fail_on_missing = hardFailMatch ? hardFailMatch[1] === 'true' : false;

    return { citation_schema, hard_fail_on_missing };
  } catch {
    return defaults;
  }
}

// ── Verdict computation ────────────────────────────────────────────────────

/**
 * @typedef {'grounding_pass' | 'hallucination_detected' | 'grounding_unverifiable'} GroundingVerdict
 */

/**
 * @typedef {object} GroundingResult
 * @property {GroundingVerdict} verdict
 * @property {number} citation_count
 * @property {number} unresolved_count
 * @property {string[]} unresolved_chunk_ids
 * @property {string} reason
 */

/**
 * Compute the grounding verdict for a single agent output.
 *
 * @param {Record<string, unknown>} agentOutput
 * @param {'anthropic_citations' | 'structured_output' | 'none'} citation_schema
 * @param {Set<string>} sourceRegistry
 * @returns {GroundingResult}
 */
function computeVerdict(agentOutput, citation_schema, sourceRegistry) {
  // A4: citation_schema 'none' — skip, grounding_pass with zero counts
  if (citation_schema === 'none') {
    return {
      verdict: 'grounding_pass',
      citation_count: 0,
      unresolved_count: 0,
      unresolved_chunk_ids: [],
      reason: 'citation_schema is none — grounding check skipped (opt-out audited)',
    };
  }

  const citations = extractCitations(agentOutput);

  // A7: no citations[] field present and schema is not 'none'
  if (citations === null) {
    return {
      verdict: 'hallucination_detected',
      citation_count: 0,
      unresolved_count: 0,
      unresolved_chunk_ids: [],
      reason: 'citations[] field absent in agent output',
    };
  }

  const citation_count = citations.length;

  // Empty citations[] — treated same as absent when schema requires citations
  if (citation_count === 0) {
    return {
      verdict: 'hallucination_detected',
      citation_count: 0,
      unresolved_count: 0,
      unresolved_chunk_ids: [],
      reason: 'citations[] array is empty — no source citations provided',
    };
  }

  // A5/A6: resolve each chunk_id against the source registry.
  // If the registry is empty/unseeded we CANNOT verify — return an honest "unverifiable" verdict
  // instead of silently claiming all citations resolved (that let a FABRICATED chunk_id pass as
  // grounding_pass). Non-blocking (the caller blocks only on hallucination_detected), but truthful.
  if (sourceRegistry.size === 0) {
    return {
      verdict: 'grounding_unverifiable',
      citation_count,
      unresolved_count: 0,
      unresolved_chunk_ids: [],
      reason: `source registry empty/unseeded — ${citation_count} citation(s) NOT verified (gate inactive until docs/knowledge/source-registry.jsonl is seeded)`,
    };
  }
  const unresolvedIds = [];
  for (const citation of citations) {
    if (!sourceRegistry.has(citation.chunk_id)) unresolvedIds.push(citation.chunk_id);
  }

  if (unresolvedIds.length > 0) {
    return {
      verdict: 'hallucination_detected',
      citation_count,
      unresolved_count: unresolvedIds.length,
      unresolved_chunk_ids: unresolvedIds,
      reason: `${unresolvedIds.length} of ${citation_count} citation(s) have unresolvable chunk_id`,
    };
  }

  return {
    verdict: 'grounding_pass',
    citation_count,
    unresolved_count: 0,
    unresolved_chunk_ids: [],
    reason: `all ${citation_count} citation(s) resolved`,
  };
}

// ── Main grounding check ───────────────────────────────────────────────────

/**
 * @typedef {object} CheckOptions
 * @property {boolean} dryRun
 * @property {string} agentName
 * @property {string} wave
 * @property {string | null} fixture
 * @property {Record<string, unknown> | null} agentOutput
 */

/**
 * Run the grounding check for a single agent output.
 * @param {CheckOptions} opts
 * @returns {void}
 */
function runGroundingCheck(opts) {
  const { dryRun, agentName, wave, fixture, agentOutput: providedOutput } = opts;

  const config = readHallucinationConfig();

  // A3: config gate — enabled: false exits immediately
  if (!config.enabled && !dryRun) {
    process.stdout.write(
      '[check-source-grounding] hallucination.enabled is false — exiting (no records written)\n'
    );
    process.exit(0);
  }

  // A8: sampling gate (skip when not dry-run and random draw fails)
  if (!dryRun && config.sampleRate < 1.0) {
    if (Math.random() > config.sampleRate) {
      process.stdout.write(
        `[check-source-grounding] SAMPLE-SKIP — sampleRate=${config.sampleRate}, this call not sampled\n`
      );
      process.exit(0);
    }
  }

  // Resolve agent output: fixture > provided > empty sentinel
  /** @type {Record<string, unknown>} */
  let agentOutput;
  if (fixture && FIXTURES[fixture]) {
    agentOutput = /** @type {Record<string, unknown>} */ (FIXTURES[fixture]);
    process.stdout.write(`[check-source-grounding] using fixture: ${fixture}\n`);
  } else if (providedOutput) {
    agentOutput = providedOutput;
  } else {
    // No output provided — emit a grounding_pass sentinel (nothing to check)
    agentOutput = {};
  }

  // Read agent grounding config
  const { citation_schema, hard_fail_on_missing } = readAgentGroundingConfig(agentName);

  // Load source registry
  const sourceRegistry = loadSourceRegistry();

  // Compute verdict
  const result = computeVerdict(agentOutput, citation_schema, sourceRegistry);

  const logPrefix = dryRun ? '[check-source-grounding] DRY-RUN' : '[check-source-grounding]';
  process.stdout.write(
    `${logPrefix} ${result.verdict.toUpperCase()} agent=${agentName || 'unknown'} wave=${wave} ` +
    `citation_count=${result.citation_count} unresolved=${result.unresolved_count} ` +
    `schema=${citation_schema} reason="${result.reason}"\n`
  );

  if (!dryRun) {
    const traceId = getCurrentTraceId();
    emitTelemetry(result.verdict, {
      source: 'scripts/check-source-grounding.mjs',
      wave,
      agent: agentName || 'unknown',
      trace_id: traceId,
      parent_span_id: null,
      payload: {
        citation_count: result.citation_count,
        unresolved_count: result.unresolved_count,
        citation_schema,
        sample_rate: config.sampleRate,
        // unresolved_chunk_ids are opaque identifiers — safe per GROUNDING_CONTRACT.md §6
        unresolved_chunk_ids: result.unresolved_chunk_ids,
        reason: result.reason,
      },
    });
  }

  // Hard-fail path: exit 42 only when hardBlockEnabled AND verdict is hallucination_detected
  if (
    result.verdict === 'hallucination_detected' &&
    hard_fail_on_missing &&
    config.hardBlockEnabled &&
    !dryRun
  ) {
    process.stderr.write(
      `[check-source-grounding] HARD-BLOCK — hallucination_detected with hardBlockEnabled:true\n`
    );
    process.exit(42);
  }

  // Soft-fail default: always exit 0
}

// ── CLI entrypoint ─────────────────────────────────────────────────────────
// Guard: only run when executed directly (not when imported as a module).

const isDirectExecution = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const args = process.argv.slice(2);

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'Usage: node scripts/check-source-grounding.mjs [options]',
      '',
      'Options:',
      '  --dry-run                 Log verdict to stdout, do not write to halluc-events.jsonl',
      '  --fixture <name>          Use a built-in test fixture as agent output',
      '                            Available: all-resolved, missing-citations, unresolved-chunk, empty-citations',
      '  --agent <name>            Agent name (looks up .claude/agents/<name>.md for citation_schema)',
      '  --wave <wave>             Wave identifier (default: wave-163)',
      '  --help                    Show this help',
      '',
      'Config gate: .sdd-config.json hallucination.enabled',
      'Stream: docs/audits/halluc-events.jsonl (10th telemetry stream)',
      'Schema: docs/GROUNDING_CONTRACT.md',
      '',
    ].join('\n'));
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');

  const fixtureIdx = args.indexOf('--fixture');
  const fixture = fixtureIdx !== -1 ? args[fixtureIdx + 1] ?? null : null;

  const agentIdx = args.indexOf('--agent');
  const agentName = agentIdx !== -1 ? args[agentIdx + 1] ?? '' : '';

  const waveIdx = args.indexOf('--wave');
  const wave = waveIdx !== -1 ? args[waveIdx + 1] ?? 'wave-163' : 'wave-163';

  runGroundingCheck({
    dryRun,
    agentName,
    wave,
    fixture,
    agentOutput: null,
  });
}
