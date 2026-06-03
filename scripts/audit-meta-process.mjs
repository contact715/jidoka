#!/usr/bin/env node
// @ts-check
/**
 * Wave-145 — Meta-process auditor script
 *
 * Checks for recurrence of documented anti-patterns across the last 5 retros.
 * Emits exactly one verdict to stdout: PASS, REGRESSION_DETECTED, or CATALOG_UPDATE_NEEDED.
 *
 * Logic:
 *  1. Read ANTI_PATTERNS_CATALOG.md — extract 7 canonical anti-pattern slugs
 *  2. Scan last 5 retros for each slug (and variants)
 *  3. If any slug appears in 2+ retros in the window → REGRESSION_DETECTED
 *  4. Scan retros for unknown failure pattern indicators → CATALOG_UPDATE_NEEDED
 *  5. Otherwise → PASS
 *
 * Exit codes:
 *   0 — PASS
 *   1 — REGRESSION_DETECTED or CATALOG_UPDATE_NEEDED
 *
 * Usage:
 *   node scripts/audit-meta-process.mjs
 *   npm run audit:meta-process
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeHaltState, readAndonConfig } from './andon-halt-helpers.mjs';
import { emitTelemetry } from './emit-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RETROS_DIR = path.join(ROOT, 'docs/retros');
const CATALOG_PATH = path.join(ROOT, 'docs/ANTI_PATTERNS_CATALOG.md');

/** @typedef {'PASS' | 'REGRESSION_DETECTED' | 'CATALOG_UPDATE_NEEDED'} Verdict */

/**
 * Extract anti-pattern slugs from the catalog.
 * Looks for lines like "### N. slug-name"
 * @returns {string[]}
 */
function extractCatalogSlugs() {
  if (!fs.existsSync(CATALOG_PATH)) {
    log('WARN: catalog not found — using hardcoded slug list');
    return [
      'reactive-incremental-thinking',
      'partial-closure-via-documentation',
      'optimistic-completion-bias',
      'asymmetric-closure-standards',
      'over-documentation',
      'scope-creep-mid-wave',
      'wave-spec-drift',
    ];
  }
  const content = fs.readFileSync(CATALOG_PATH, 'utf8');
  /** @type {string[]} */
  const slugs = [];
  for (const match of content.matchAll(/^###\s+\d+\.\s+([\w-]+)/gm)) {
    slugs.push(match[1]);
  }
  return slugs;
}

/**
 * Get last N retro files sorted by modification time (newest last).
 * @param {number} n
 * @returns {string[]}
 */
function getLastNRetros(n) {
  if (!fs.existsSync(RETROS_DIR)) {
    log('WARN: retros directory not found');
    return [];
  }
  const files = fs
    .readdirSync(RETROS_DIR)
    .filter((f) => /^wave-[\w.-]+\.md$/.test(f) && f !== '_TEMPLATE.md')
    .map((f) => ({
      name: f,
      fullPath: path.join(RETROS_DIR, f),
      mtime: fs.statSync(path.join(RETROS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime)
    .slice(-n)
    .map((f) => f.fullPath);
  return files;
}

/**
 * Check if a retro file contains a given slug or related keywords.
 * @param {string} retroPath
 * @param {string} slug
 * @returns {boolean}
 */
function retroContainsSlug(retroPath, slug) {
  const content = fs.readFileSync(retroPath, 'utf8').toLowerCase();
  // Direct slug match (hyphenated or space-separated)
  const spacedSlug = slug.replace(/-/g, ' ');
  if (content.includes(slug) || content.includes(spacedSlug)) {
    return true;
  }
  // Anti-pattern keyword variants
  const variants = getSlugVariants(slug);
  return variants.some((v) => content.includes(v));
}

/**
 * Keyword variants for each slug (to catch prose descriptions).
 * @param {string} slug
 * @returns {string[]}
 */
function getSlugVariants(slug) {
  const variantMap = /** @type {Record<string, string[]>} */ ({
    'reactive-incremental-thinking': ['reactive incremental', 'incremental dispatch', 'incremental thinking'],
    'partial-closure-via-documentation': ['partial closure', 'docs only', 'documentation only', 'documented but not enforced'],
    'optimistic-completion-bias': ['optimistic completion', 'premature done', 'declared done without', 'completion bias'],
    'asymmetric-closure-standards': ['asymmetric closure', 'informal process', 'skipped process'],
    'over-documentation': ['over documentation', 'over-documentation', 'too many docs', 'soft rule'],
    'scope-creep-mid-wave': ['scope creep', 'out of scope', 'added scope'],
    'wave-spec-drift': ['spec drift', 'spec mismatch', 'undocumented change'],
  });
  return variantMap[slug] ?? [];
}

/**
 * Scan retros for unknown pattern indicators.
 * Phrases that suggest a recurring issue not in the catalog.
 * @param {string[]} retroPaths
 * @param {string[]} knownSlugs
 * @returns {{ found: boolean; description: string }}
 */
function detectUnknownPatterns(retroPaths, knownSlugs) {
  const indicators = [
    'we did this again',
    'same issue as',
    'recurring problem',
    'root cause was',
    'third time',
    'keeps happening',
    'not the first time',
    'we have seen this before',
  ];

  for (const retroPath of retroPaths) {
    const content = fs.readFileSync(retroPath, 'utf8').toLowerCase();
    for (const indicator of indicators) {
      if (content.includes(indicator)) {
        // Check if it matches a known slug nearby (within 200 chars)
        const idx = content.indexOf(indicator);
        const window = content.slice(Math.max(0, idx - 100), idx + 200);
        const matchesKnown = knownSlugs.some(
          (s) => window.includes(s) || window.includes(s.replace(/-/g, ' ')),
        );
        if (!matchesKnown) {
          return {
            found: true,
            description: `"${indicator}" found in ${path.basename(retroPath)} without matching a known catalog slug`,
          };
        }
      }
    }
  }
  return { found: false, description: '' };
}

/**
 * @param {string} msg
 */
function log(msg) {
  process.stderr.write(`[meta-process-auditor] ${msg}\n`);
}

function main() {
  log('Starting meta-process audit');

  const slugs = extractCatalogSlugs();
  log(`Loaded ${slugs.length} anti-pattern slugs from catalog`);

  const retroPaths = getLastNRetros(5);
  log(`Scanning ${retroPaths.length} retros: ${retroPaths.map((p) => path.basename(p)).join(', ')}`);

  if (retroPaths.length === 0) {
    log('No retros found — PASS (no history to check)');
    process.stdout.write('PASS\n');
    process.exit(0);
  }

  // Check each slug for recurrence in 2+ retros
  /** @type {Array<{slug: string; retros: string[]}>} */
  const regressions = [];

  for (const slug of slugs) {
    const matchingRetros = retroPaths.filter((rp) => retroContainsSlug(rp, slug));
    if (matchingRetros.length >= 2) {
      regressions.push({
        slug,
        retros: matchingRetros.map((p) => path.basename(p)),
      });
    }
  }

  if (regressions.length > 0) {
    for (const r of regressions) {
      log(`REGRESSION: ${r.slug} appears in ${r.retros.length} retros: ${r.retros.join(', ')}`);
    }
    log('Resolution required: human must review before next wave dispatch');
    log('Verdict: REGRESSION_DETECTED');
    process.stdout.write('REGRESSION_DETECTED\n');
    // T3 — telemetry emission (wave-150): enables wave-148 recurrence engine counting
    emitTelemetry('meta_process_regression', {
      source: 'scripts/audit-meta-process.mjs',
      wave: 'wave-current',
      agent: 'meta-process-auditor',
      verdict: 'REGRESSION_DETECTED',
      payload: {
        slugs: regressions.map((r) => r.slug),
        retros: regressions.flatMap((r) => r.retros),
        pii_possible: false,
      },
    });
    // T2 — halt-state wiring (wave-150): replaces bare process.exit(1)
    // readAndonConfig() is available but writeHaltState() gates internally on andonCord.enabled
    // soft mode (andonCord.enabled: false): halt-state written + stderr warn, then exit(42)
    // hard mode (andonCord.enabled: true): common-launcher blocks downstream scripts
    readAndonConfig(); // side-effect: confirms config is readable; result drives common-launcher, not this script
    writeHaltState(
      'wave-current',
      'meta-process-auditor',
      `REGRESSION_DETECTED: ${regressions.map((r) => r.slug).join(', ')} in ${regressions.flatMap((r) => r.retros).join(', ')}`
    );
    // writeHaltState always calls process.exit(42) — line below is unreachable but kept as marker
    process.exit(1); // fallback marker — never reached
  }

  // Check for unknown patterns
  const unknown = detectUnknownPatterns(retroPaths, slugs);
  if (unknown.found) {
    log(`CATALOG_UPDATE_NEEDED: ${unknown.description}`);
    log('Action: add new entry to docs/ANTI_PATTERNS_CATALOG.md before next wave');
    log('Verdict: CATALOG_UPDATE_NEEDED');
    process.stdout.write('CATALOG_UPDATE_NEEDED\n');
    // T3 — telemetry emission (wave-150)
    emitTelemetry('meta_process_regression', {
      source: 'scripts/audit-meta-process.mjs',
      wave: 'wave-current',
      agent: 'meta-process-auditor',
      verdict: 'CATALOG_UPDATE_NEEDED',
      payload: {
        slugs: [],
        retros: [],
        description: unknown.description,
        pii_possible: false,
      },
    });
    // T2 — halt-state wiring (wave-150)
    writeHaltState(
      'wave-current',
      'meta-process-auditor',
      `CATALOG_UPDATE_NEEDED: ${unknown.description}`
    );
    // writeHaltState always calls process.exit(42) — line below is unreachable but kept as marker
    process.exit(1); // fallback marker — never reached
  }

  log(`Checked ${slugs.length} anti-patterns across ${retroPaths.length} retros`);
  log('No recurrence detected');
  log('Verdict: PASS');
  process.stdout.write('PASS\n');
  process.exit(0);
}

try {
  main();
} catch (e) {
  // fail-closed: a crash in the auditor must not read as PASS (andon — stop the line).
  log(`FAIL: unhandled exception — ${/** @type {Error} */ (e).message ?? String(e)}`);
  process.exit(1);
}
