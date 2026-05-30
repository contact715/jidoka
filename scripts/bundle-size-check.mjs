#!/usr/bin/env node
/**
 * Bundle size baseline tracker.
 *
 * Reads .next build manifests after `npm run build`, computes per-route
 * bundle sizes, and compares against scripts/.bundle-baseline.json.
 *
 * Behavior:
 *   - First run (empty baseline) or `--update`: writes the current sizes as the new baseline.
 *   - Subsequent runs: warns if any route grew > 10% over the baseline; fails (exit 1)
 *     if a route grew > 25% — that's almost certainly an unintended import.
 *
 * Usage:
 *   node scripts/bundle-size-check.mjs            # check
 *   node scripts/bundle-size-check.mjs --update   # accept current as new baseline
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASELINE_FILE = path.join(ROOT, "scripts", ".bundle-baseline.json");
const NEXT_DIR = path.join(ROOT, ".next");
const APP_MANIFEST = path.join(NEXT_DIR, "app-build-manifest.json");
const BUILD_MANIFEST = path.join(NEXT_DIR, "build-manifest.json");
const PERF_BUDGET_PATH = path.join(ROOT, "docs", "quality", "perf-budget.json");

// Read warn_pct and fail_pct from perf-budget.json global section (wave-162 A3).
// Falls back to hardcoded defaults if the file or keys are absent.
function loadPerfBudgetThresholds() {
  try {
    if (!fs.existsSync(PERF_BUDGET_PATH)) {
      console.log(`WARN: perf-budget.json not found at ${PERF_BUDGET_PATH} — using defaults (warn=10, fail=25)`);
      return { warnPct: 10, failPct: 25 };
    }
    const budget = JSON.parse(fs.readFileSync(PERF_BUDGET_PATH, "utf-8"));
    const global = budget?.global;
    if (!global || typeof global.warn_pct !== "number" || typeof global.fail_pct !== "number") {
      console.log("WARN: perf-budget.json missing global.warn_pct or global.fail_pct — using defaults (warn=10, fail=25)");
      return { warnPct: 10, failPct: 25 };
    }
    return { warnPct: global.warn_pct, failPct: global.fail_pct };
  } catch {
    console.log("WARN: failed to parse perf-budget.json — using defaults (warn=10, fail=25)");
    return { warnPct: 10, failPct: 25 };
  }
}

const { warnPct: WARN_PCT, failPct: FAIL_PCT } = loadPerfBudgetThresholds();

function fileSize(rel) {
  const abs = path.join(NEXT_DIR, rel);
  try {
    return fs.statSync(abs).size;
  } catch {
    return 0;
  }
}

function collectChunkSizes(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const pages = raw.pages || raw.rootMainFiles || {};
  const out = {};

  // build-manifest.json: { pages: { "/route": ["static/chunk1.js", ...] } }
  if (raw.pages && typeof raw.pages === "object") {
    for (const [route, files] of Object.entries(raw.pages)) {
      if (!Array.isArray(files)) continue;
      const total = files.reduce((sum, f) => sum + fileSize(f), 0);
      if (total > 0) out[route] = total;
    }
  }

  // app-build-manifest.json: { pages: { "/route/page": ["static/chunks/...", ...] } }
  if (raw.pages && typeof raw.pages === "object" && Object.keys(out).length === 0) {
    for (const [route, files] of Object.entries(raw.pages)) {
      if (!Array.isArray(files)) continue;
      const total = files.reduce((sum, f) => sum + fileSize(f), 0);
      if (total > 0) out[route] = total;
    }
  }

  return out;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { _comment: "Bundle baseline auto-generated.", lastUpdated: "", chunks: {} };
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8"));
}

function writeBaseline(chunks) {
  const today = new Date().toISOString().slice(0, 10);
  const next = {
    _comment:
      "Bundle baseline. Update via 'node scripts/bundle-size-check.mjs --update' after intentional changes.",
    lastUpdated: today,
    chunks,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + "\n", "utf-8");
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
  const updateMode = process.argv.includes("--update");

  if (!fs.existsSync(NEXT_DIR)) {
    console.log("SKIP: No .next build found. Run `npm run build` first.");
    process.exit(0);
  }

  let chunks = collectChunkSizes(APP_MANIFEST);
  if (!chunks || Object.keys(chunks).length === 0) {
    chunks = collectChunkSizes(BUILD_MANIFEST);
  }
  if (!chunks || Object.keys(chunks).length === 0) {
    console.log("SKIP: No build manifest entries found in .next/. Did `next build` complete?");
    process.exit(0);
  }

  const baseline = readBaseline();
  const baselineChunks = baseline.chunks || {};
  const baselineEmpty = Object.keys(baselineChunks).length === 0;

  if (updateMode || baselineEmpty) {
    writeBaseline(chunks);
    const action = baselineEmpty ? "INIT" : "UPDATE";
    console.log(`${action}: Wrote baseline for ${Object.keys(chunks).length} route(s) to ${path.relative(ROOT, BASELINE_FILE)}`);
    process.exit(0);
  }

  let warnings = 0;
  let failures = 0;
  const newRoutes = [];

  for (const [route, size] of Object.entries(chunks)) {
    const base = baselineChunks[route];
    if (base === undefined) {
      newRoutes.push({ route, size });
      continue;
    }
    const delta = size - base;
    const pct = base === 0 ? 0 : (delta / base) * 100;
    if (pct >= FAIL_PCT) {
      console.log(`FAIL: ${route} grew ${pct.toFixed(1)}% (${fmt(base)} -> ${fmt(size)})`);
      failures++;
    } else if (pct >= WARN_PCT) {
      console.log(`WARN: ${route} grew ${pct.toFixed(1)}% (${fmt(base)} -> ${fmt(size)})`);
      warnings++;
    }
  }

  if (newRoutes.length > 0) {
    console.log(`INFO: ${newRoutes.length} new route(s) detected (not in baseline yet):`);
    for (const { route, size } of newRoutes.slice(0, 5)) {
      console.log(`  + ${route} (${fmt(size)})`);
    }
    console.log("  Run with --update once these are intentional.");
  }

  if (failures > 0) {
    console.log(`FAIL: ${failures} route(s) exceeded the +${FAIL_PCT}% size budget.`);
    process.exit(1);
  }
  if (warnings > 0) {
    console.log(`WARN: ${warnings} route(s) exceeded the +${WARN_PCT}% threshold.`);
  } else {
    console.log("OK: Bundle sizes within baseline.");
  }
  process.exit(0);
}

main();
