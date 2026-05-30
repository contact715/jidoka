#!/usr/bin/env node
// Wave 58 / A3 — Build tool quality report JSON
//
// Runs the aggregator (lib/tools-quality/aggregator.ts) over the live
// docs/agents/runs/ directory and writes the result to
// lib/tools-quality/report.generated.json. The dashboard page imports
// that JSON statically so the client never executes fs reads.
//
// Usage:
//   node scripts/build-tool-quality-report.mjs
//
// Re-run this manually after each audit wave (or wire it into a hook).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const aggregatorTs = path.join(repoRoot, "lib/tools-quality/aggregator.ts");
const outPath = path.join(repoRoot, "lib/tools-quality/report.generated.json");

// Compile the TS aggregator to a temp .mjs via TypeScript's transpileModule.
// We avoid heavyweight ts-node setup — the aggregator is plain Node + fs.
const ts = await import("typescript").catch(() => null);
if (!ts) {
    console.error("typescript package required to run this script");
    process.exit(1);
}

const tsSrc = fs.readFileSync(aggregatorTs, "utf8");
const transpiled = ts.default.transpileModule(tsSrc, {
    compilerOptions: { module: ts.default.ModuleKind.ESNext, target: ts.default.ScriptTarget.ES2022 },
});
const tmp = path.join(os.tmpdir(), `tool-quality-aggregator-${Date.now()}.mjs`);
fs.writeFileSync(tmp, transpiled.outputText, "utf8");
const url = pathToFileURL(tmp).href;
const mod = await import(url);
const report = mod.buildToolQualityReport(repoRoot);
fs.unlinkSync(tmp);

fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath}`);
console.log(
    `  ${report.tools.length} tools tracked, ${report.fixesShipped} fixes scanned across ${report.wavesScanned} waves (${report.unassignedFixes} unassigned)`,
);
