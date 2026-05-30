#!/usr/bin/env node
// @ts-check
/**
 * Wave-135 — Contract-to-Types Generator
 *
 * Contract domain: reads docs/security/api-contract-registry.json (wave-182)
 * and emits one TypeScript interface per active entry with non-empty
 * response_fields. All generated fields are typed `unknown` — the registry
 * declares field NAMES only; no field types are available at v1.
 *
 * BOUNDARY COMMENTS (REFLEXION-8):
 *   NOT validate-contract.mjs  — that script validates registry entries against
 *                                a live backend or OpenAPI snapshot (HTTP fetch).
 *   NOT wave-134 (AC-to-test)  — that wave maps ACs to test stubs; no types.
 *   NOT wave-182 (registry)    — wave-182 BUILT the registry this script reads.
 *   THIS script ONLY generates TypeScript interface declarations from the
 *   registry's response_fields arrays. No logic, no function bodies, no Zod.
 *
 * Flags:
 *   (none)    — Write lib/types/generated/api-contract.gen.ts. Exit 0 on success.
 *   --check   — Regenerate to a string buffer, compare vs committed file.
 *               Exit 0 if identical. Exit 1 + [FAIL] if different (CI drift gate).
 *
 * Output (stdout on every run):
 *   [types] Scanned N entries (active), M qualified (non-empty response_fields),
 *           K interfaces emitted, S skipped (empty response_fields or non-active).
 *
 * Stdout style mirrors scripts/validate-contract.mjs:29-45 ([PASS]/[FAIL]/[WARN]).
 *
 * Telemetry: none. No emit-telemetry.mjs call. No new JSONL stream.
 * Dependency: Node.js built-ins only (fs, path, url). No new npm package.
 *
 * Spec:    docs/specs/wave-135_MASTER_SPEC.md
 * Source:  docs/security/api-contract-registry.json
 * Output:  lib/types/generated/api-contract.gen.ts
 * AC coverage: AC-1..AC-14.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Paths ─────────────────────────────────────────────────────────────────────
const REGISTRY_PATH = path.join(ROOT, 'docs', 'security', 'api-contract-registry.json');
const OUT_PATH = path.join(ROOT, 'lib', 'types', 'generated', 'api-contract.gen.ts');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isCheck = args.includes('--check');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a dot-separated endpoint name to PascalCase for use in interface names.
 * e.g. "leads.list" → "LeadsList", "integrations.meta.conversations" → "IntegrationsMetaConversations"
 */
function toPascalCase(endpoint) {
  return endpoint
    .split('.')
    .map((segment) =>
      segment
        .replace(/[^a-zA-Z0-9]/g, '_')
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')
    )
    .join('');
}

/**
 * Generate the full content of api-contract.gen.ts from registry entries.
 * Returns a string — caller decides whether to write or compare.
 */
function generateFileContent(entries) {
  const activeEntries = entries.filter((e) => e.status === 'active');
  const qualifying = activeEntries.filter(
    (e) => Array.isArray(e.response_fields) && e.response_fields.length > 0
  );
  const skipped = entries.length - qualifying.length; // all non-qualifying (any status)

  const interfaces = qualifying.map((entry) => {
    const name = `ApiContract${toPascalCase(entry.endpoint)}Response`;
    const fields = entry.response_fields
      .map((f) => `  ${f}: unknown; // registry declares name only — type unknown`)
      .join('\n');
    return `/** Generated from registry entry: ${entry.endpoint} (${entry.method} ${entry.path}) */\nexport interface ${name} {\n${fields}\n}`;
  });

  // DO NOT EDIT header — convention from scripts/build-lineage-graph.mjs:386
  // and scripts/regenerate-specs-index.mjs:249
  const header = [
    '// DO NOT EDIT — generated from docs/security/api-contract-registry.json by scripts/generate-api-types.mjs. Regenerate: npm run types:generate',
    '//',
    '// Wave-135: Contract-to-Types Generation (v1)',
    '// All fields typed `unknown` — the registry declares field NAMES only. No field',
    '// types are available without an OpenAPI snapshot (deferred to v2).',
    '// See docs/specs/wave-135_MASTER_SPEC.md § D3 (Honest typing).',
    '//',
    `// Generated: ${new Date().toISOString()}`,
    `// Registry entries scanned: ${entries.length}`,
    `// Active entries: ${activeEntries.length}`,
    `// Interfaces emitted: ${qualifying.length}`,
    `// Skipped (empty response_fields or non-active): ${skipped}`,
    '',
  ].join('\n');

  const body = interfaces.join('\n\n');
  return `${header}\n${body}\n`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Load registry
let registry;
try {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  registry = JSON.parse(raw);
} catch (err) {
  process.stderr.write(`[types] ERROR: Failed to read registry at ${REGISTRY_PATH}\n  ${err.message}\n`);
  process.exit(1);
}

const entries = registry.entries;
if (!Array.isArray(entries)) {
  process.stderr.write(`[types] ERROR: registry.entries is not an array.\n`);
  process.exit(1);
}

const activeEntries = entries.filter((e) => e.status === 'active');
const qualifying = activeEntries.filter(
  (e) => Array.isArray(e.response_fields) && e.response_fields.length > 0
);
const skipped = entries.length - qualifying.length;

// Generate content
const generated = generateFileContent(entries);

if (isCheck) {
  // ── Check mode: compare buffer vs committed file ───────────────────────────
  // Mirrors the validate-contract.mjs:1-46 load → compare → exit skeleton.
  let committed;
  try {
    committed = fs.readFileSync(OUT_PATH, 'utf8');
  } catch (err) {
    process.stderr.write(
      `[types] [FAIL] Cannot read committed file at ${OUT_PATH}\n  ${err.message}\n`
    );
    process.stderr.write(
      `[types] Hint: run \`npm run types:generate\` to create the initial file.\n`
    );
    process.exit(1);
  }

  // Normalize timestamps in both strings for a stable comparison.
  // The "Generated: <ISO>" line changes on every run; strip it for comparison.
  const normalize = (s) => s.replace(/^\/\/ Generated: .+$/m, '// Generated: <NORMALIZED>');

  if (normalize(generated) === normalize(committed)) {
    process.stdout.write(
      `[types] [PASS] Committed api-contract.gen.ts matches fresh regeneration.\n` +
      `[types] Scanned ${entries.length} entries, ${activeEntries.length} active, ` +
      `${qualifying.length} interfaces, ${skipped} skipped (empty response_fields or non-active).\n`
    );
    process.exit(0);
  } else {
    process.stdout.write(
      `[types] [FAIL] Committed api-contract.gen.ts is STALE — it does not match a fresh regeneration.\n` +
      `[types] Run \`npm run types:generate\` to update the committed file, then re-commit.\n` +
      `[types] Scanned ${entries.length} entries, ${activeEntries.length} active, ` +
      `${qualifying.length} interfaces (fresh), ${skipped} skipped.\n`
    );
    process.exit(1);
  }
} else {
  // ── Write mode ─────────────────────────────────────────────────────────────
  // Ensure directory exists (first run after wave ships)
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, generated, 'utf8');

  process.stdout.write(
    `[types] [PASS] Wrote ${OUT_PATH}\n` +
    `[types] Scanned ${entries.length} entries total.\n` +
    `[types] Active entries: ${activeEntries.length}\n` +
    `[types] Interfaces emitted: ${qualifying.length}\n` +
    `[types] Skipped (empty response_fields or non-active): ${skipped}\n`
  );
  process.exit(0);
}
