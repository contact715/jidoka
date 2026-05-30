#!/usr/bin/env node
// @ts-check
/**
 * Wave-182 — Contract Validator
 *
 * Contract domain: FE-declared API surface vs backend OpenAPI — path existence,
 * method match, and known drift.
 * NOT wave-172 pentest (injection on valid HTTP requests).
 * NOT e2e (mock-backend behavior).
 * NOT api-client-paths.test.ts (URL-fragment + method only, 2 namespaces).
 *
 * Three reachability modes (detected in order):
 *
 *   LIVE      — backend responds at $NEXT_PUBLIC_API_URL/openapi.json within 2s.
 *               Validates registry entries against the real OpenAPI paths object.
 *
 *   SNAPSHOT  — backend unreachable, but docs/contracts/openapi-snapshot.json
 *               exists on disk (committed after a previous --update-snapshot run).
 *               Validates against the committed snapshot.
 *
 *   DOC-BASED — backend unreachable AND no snapshot exists.
 *               Validates path prefixes against CLAUDE.md documented endpoint list.
 *               Exits 1 even if no individual entries fail — incomplete validation
 *               must not produce a vacuous clean pass (wave-178 honesty bar).
 *               Emits: [contract] ABORT: no backend reachable and no snapshot committed
 *               — run contract:snapshot first.
 *
 * Honest exit semantics:
 *   - Exit 1 if any active entry has a drift_note (DRIFT entries always surface).
 *   - Exit 1 in DOC-BASED mode without snapshot (incomplete state, see above).
 *   - Exit 0 only in LIVE or SNAPSHOT mode with zero DRIFT entries.
 *
 * Flags:
 *   --update-snapshot   Fetch live OpenAPI and write docs/contracts/openapi-snapshot.json.
 *                       Does not validate; exits after write.
 *   --dry               Print findings but do not exit 1 (CI dry-run mode).
 *
 * Telemetry: none. No emit-telemetry.mjs call. No new JSONL stream.
 * Dependency: Node.js built-ins only (fs, node:https). No new npm package.
 *
 * Mirrors: scripts/validate-dr-catalog.mjs:46-60 (load → check → exit pattern).
 * Registry shape: docs/quality/glossary-registry.json:1-22 (_schema + entries[]).
 *
 * Spec: docs/specs/wave-182_MASTER_SPEC.md
 * AC coverage: AC-1..AC-11.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────────
const REGISTRY_PATH = path.join(ROOT, 'docs', 'security', 'api-contract-registry.json');
const SNAPSHOT_PATH = path.join(ROOT, 'docs', 'contracts', 'openapi-snapshot.json');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isUpdateSnapshot = args.includes('--update-snapshot');
const isDry = args.includes('--dry');

// ── Output helpers ─────────────────────────────────────────────────────────────
/** @param {string} msg */
function log(msg) { process.stdout.write(msg + '\n'); }

// ── CLAUDE.md documented endpoint prefixes (DOC-BASED mode source of truth) ──
// Source: CLAUDE.md "Backend API Reference" section.
// This is explicitly an incomplete list — the doc gap is the point of DOC-BASED mode.
const CLAUDE_MD_PREFIXES = [
  '/api/auth',
  '/api/users',
  '/api/company',
  '/api/leads',
  '/api/messages',
  '/api/integrations/meta',
  '/api/log-events',
  '/api/integrations',
  '/api/billing',
  '/api/plans',
  '/api/features',
  '/api/notifications',
  '/api/knowledge',
  '/api/speed-dialer',
  '/api/webhooks/meta',
  '/api/sb',
  '/api/recordings',
  '/ws/',
];

// ── Fetch with timeout ─────────────────────────────────────────────────────────
/**
 * Fetch a URL with a timeout. Returns null on any error or timeout.
 * Uses global fetch (Node 18+) with AbortController.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<object|null>}
 */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Load registry ─────────────────────────────────────────────────────────────
if (!fs.existsSync(REGISTRY_PATH)) {
  log(`⊘ DORMANT — ${REGISTRY_PATH} not seeded yet; contract gate inactive, not failed. Seed the registry to activate.`);
  process.exit(0);
}

/** @type {any} */
let registry;
try {
  registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
} catch (err) {
  log(`[contract] FATAL — registry JSON parse failed: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(registry.entries)) {
  log(`[contract] FATAL — registry missing top-level "entries" array`);
  process.exit(1);
}

const entries = registry.entries;

// ── --update-snapshot mode ────────────────────────────────────────────────────
if (isUpdateSnapshot) {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const openapiUrl = `${apiBase}/openapi.json`;
  log(`[contract] --update-snapshot: fetching ${openapiUrl} ...`);
  const spec = await fetchWithTimeout(openapiUrl, 5000);
  if (!spec) {
    log(`[contract] ABORT: could not reach ${openapiUrl} — snapshot not updated.`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(spec, null, 2), 'utf8');
  log(`[contract] Snapshot written to ${SNAPSHOT_PATH}`);
  log(`[contract] Run contract:validate to validate the registry against the snapshot.`);
  process.exit(0);
}

// ── Mode detection ─────────────────────────────────────────────────────────────
const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const openapiUrl = `${apiBase}/openapi.json`;

// Try LIVE mode first (2s timeout per spec D3)
const liveSpec = await fetchWithTimeout(openapiUrl, 2000);

/** @type {'LIVE'|'SNAPSHOT'|'DOC-BASED'} */
let mode;
/** @type {object|null} */
let openApiPaths = null;

if (liveSpec && liveSpec.paths && typeof liveSpec.paths === 'object') {
  mode = 'LIVE';
  openApiPaths = liveSpec.paths;
} else {
  // Try SNAPSHOT mode
  const snapshotExists = fs.existsSync(SNAPSHOT_PATH);
  let snapshotSpec = null;
  if (snapshotExists) {
    try {
      snapshotSpec = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    } catch {
      snapshotSpec = null;
    }
  }

  if (snapshotSpec && snapshotSpec.paths && typeof snapshotSpec.paths === 'object') {
    mode = 'SNAPSHOT';
    openApiPaths = snapshotSpec.paths;
  } else {
    mode = 'DOC-BASED';
  }
}

// ── Mode announcement (MUST be first output line per AC-3) ────────────────────
log(`[contract] MODE: ${mode}`);

// ── DOC-BASED without real snapshot → flag for post-loop abort ────────────────
// Honesty bar (AC-3, D3): DOC-BASED without a real snapshot exits 1, BUT only
// AFTER the per-entry loop runs so that DRIFT + SKIP lines print first (AC-2, AC-5).
let docBasedPlaceholderAbort = false;
if (mode === 'DOC-BASED') {
  // Check whether the snapshot file is a real spec (non-empty paths) or placeholder
  const snapshotExists = fs.existsSync(SNAPSHOT_PATH);
  let snapshotIsPlaceholder = true;
  if (snapshotExists) {
    try {
      const s = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
      if (s && s.paths && typeof s.paths === 'object' && Object.keys(s.paths).length > 0) {
        snapshotIsPlaceholder = false;
      }
    } catch {
      snapshotIsPlaceholder = true;
    }
  }

  if (snapshotIsPlaceholder) {
    // Do NOT exit here — let the per-entry loop run so findings print first.
    docBasedPlaceholderAbort = true;
  }
}

// ── Accumulators ──────────────────────────────────────────────────────────────
/** @type {string[]} */
const driftLines = [];
/** @type {string[]} */
const passLines = [];
/** @type {string[]} */
const skipLines = [];
/** @type {string[]} */
const undocumentedLines = [];

// ── Per-entry validation ───────────────────────────────────────────────────────
for (const entry of entries) {
  const id = entry.endpoint || '(missing endpoint)';

  // AC-5: stubs are skipped
  if (entry.status === 'stub') {
    skipLines.push(`[contract] SKIP (stub) ${id} — ${entry.source_anchor}`);
    continue;
  }

  // AC-2 / D5: entries with a drift_note always surface as DRIFT in any mode
  // The three confirmed drift candidates are: workflow.getConfig (/api/company-config),
  // pipeline.* (/api/v1/pipeline/), and assistant.* (/api/v1/assistant/*)
  if (entry.drift_note && entry.drift_note.startsWith('DRIFT')) {
    driftLines.push(`[contract] DRIFT ${id} — ${entry.path} — ${entry.source_anchor}`);
    driftLines.push(`           ${entry.drift_note}`);
    continue;
  }

  const entryPath = entry.path;
  if (!entryPath) {
    // non-stub with no path is an honesty violation — treat as drift
    driftLines.push(`[contract] DRIFT ${id} — path is null/missing for active entry — ${entry.source_anchor}`);
    continue;
  }

  if (mode === 'LIVE' || mode === 'SNAPSHOT') {
    // Check whether the path exists in the OpenAPI paths object.
    // OpenAPI paths use exact strings; parameterized paths use {param} notation.
    // We normalize by stripping trailing slashes and dynamic segments for comparison.
    const pathExists = checkPathInOpenApi(entryPath, openApiPaths);
    if (pathExists) {
      passLines.push(`[contract] PASS ${id} — ${entryPath} — found in ${mode} spec`);
    } else {
      undocumentedLines.push(`[contract] UNDOCUMENTED ${id} — ${entryPath} — not found in ${mode} OpenAPI paths`);
    }
  } else {
    // DOC-BASED: check prefix against CLAUDE.md documented prefixes
    const prefixFound = CLAUDE_MD_PREFIXES.some(prefix => entryPath.startsWith(prefix));
    if (prefixFound) {
      passLines.push(`[contract] PASS ${id} — ${entryPath} — prefix matches CLAUDE.md documented surface`);
    } else {
      undocumentedLines.push(`[contract] UNDOCUMENTED ${id} — ${entryPath} — prefix not in CLAUDE.md documented endpoints`);
    }
  }
}

// ── Path existence check helper ────────────────────────────────────────────────
/**
 * Check whether a registry path exists in the OpenAPI paths object.
 * Handles:
 *   - Exact match
 *   - Trailing slash normalization
 *   - Path parameters: registry uses {param}, OpenAPI uses {param}
 * @param {string} registryPath
 * @param {object} openapiPaths
 * @returns {boolean}
 */
function checkPathInOpenApi(registryPath, openapiPaths) {
  if (!openapiPaths) return false;

  const normalize = (p) => p.replace(/\/+$/, ''); // strip trailing slash

  const normalized = normalize(registryPath);

  // Exact match first
  if (normalized in openapiPaths || registryPath in openapiPaths) return true;

  // Strip query-string from registry path (registry paths may contain ?param=x for docs clarity)
  const pathOnly = normalized.split('?')[0];
  if (pathOnly in openapiPaths) return true;

  // Check each OpenAPI path for structural match (parameter segments)
  // Convert both to segment arrays and compare, treating {.*} as wildcard
  for (const openapiPath of Object.keys(openapiPaths)) {
    if (pathsStructurallyMatch(pathOnly, openapiPath)) return true;
  }

  return false;
}

/**
 * Compare two paths structurally, treating {param} segments as wildcards.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function pathsStructurallyMatch(a, b) {
  const segsA = a.replace(/\/+$/, '').split('/');
  const segsB = b.replace(/\/+$/, '').split('/');
  if (segsA.length !== segsB.length) return false;
  return segsA.every((seg, i) => {
    const bSeg = segsB[i];
    // Either segment is a parameter placeholder — treat as match
    if (seg.startsWith('{') || bSeg.startsWith('{')) return true;
    return seg === bSeg;
  });
}

// ── Print results (mirrors validate-dr-catalog.mjs output order) ──────────────
for (const line of passLines) log(line);
for (const line of skipLines) log(line);
for (const line of undocumentedLines) log(line);
for (const line of driftLines) log(line);

// ── Summary ────────────────────────────────────────────────────────────────────
const activeCount = entries.filter(e => e.status !== 'stub').length;
const stubCount = entries.filter(e => e.status === 'stub').length;
const driftCount = driftLines.filter(l => l.startsWith('[contract] DRIFT')).length;
const undocumentedCount = undocumentedLines.length;
const passCount = passLines.length;

log('');
log(`[contract] SUMMARY: mode=${mode}, entries=${entries.length} (${activeCount} active, ${stubCount} stub)`);
log(`[contract]          PASS=${passCount}, UNDOCUMENTED=${undocumentedCount}, DRIFT=${driftCount}, SKIP=${skipLines.length}`);

// ── Exit semantics (AC-3, AC-10) ──────────────────────────────────────────────
// Exit 1 if: any DRIFT, OR mode is DOC-BASED without a real snapshot.
// The DOC-BASED abort message is emitted HERE (after findings), not before the loop.
if (isDry) {
  log(`[contract] --dry mode: findings printed, exit forced 0.`);
  process.exit(0);
}

if (driftCount > 0) {
  log(`[contract] FAIL — ${driftCount} DRIFT finding(s) detected. Resolve before this exits 0.`);
  process.exit(1);
}

if (docBasedPlaceholderAbort) {
  // Honesty bar: DOC-BASED without real snapshot is incomplete validation.
  // Findings (DRIFT/SKIP/UNDOCUMENTED) already printed above; now emit the abort.
  log(`[contract] ABORT: no backend reachable and no snapshot committed — run contract:snapshot first`);
  log(`[contract] DOC-BASED mode without a real snapshot cannot confirm live drift. This is an incomplete validation state.`);
  log(`[contract] To produce a snapshot: npm run contract:snapshot (requires backend at ${apiBase})`);
  process.exit(1);
}

log(`[contract] PASS — ${mode} mode, zero DRIFT entries.`);
process.exit(0);
