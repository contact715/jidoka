#!/usr/bin/env node
// spec-size-check — block a spec that is too big to build reliably. This is the #1 cause of agent
// failure per a high-volume practitioner ("my only failed runs were when the spec was too large").
// jidoka had plan-check (graph structure) + file-decomposition rules, but no PRE-BUILD spec-size gate.
// This estimates a spec's size/complexity and, if over threshold, recommends decomposition BEFORE the
// build spends a wave on a spec that will under-deliver.
//
// metrics: { objectives, acceptanceCriteria, surfaces, specLoc }
// thresholds (DEFAULTS, tunable): objectives>8, acceptanceCriteria>20, surfaces>3, specLoc>600.
// Any one exceeded → too big → decompose. (8 ≈ the 7±2 cognitive limit; 600 LOC of spec implies a
// build past the project's own ≤400-LOC-per-concern rule; >3 surfaces = multi-concern.)
//
// HONEST boundary: structural size estimate from countable signals. It does not judge whether the
// spec's CONTENT is wise (that's the architect's job) — it catches the "too much in one wave" failure.
//
// FULL & self-tested. Usage:
//   node scripts/spec-size-check.mjs --self-test
//   node scripts/spec-size-check.mjs --spec docs/specs/wave-x.md
//   node scripts/spec-size-check.mjs --metrics '{"objectives":12,"surfaces":4}'

import { readFileSync, existsSync } from 'node:fs';

export const DEFAULTS = { objectives: 8, acceptanceCriteria: 20, surfaces: 3, specLoc: 600 };

// pure: is the spec too big to build in one wave?
export function assess(metrics = {}, thresholds = DEFAULTS) {
  const ratios = Object.entries(thresholds).map(([k, max]) => ({ k, v: metrics[k] || 0, max, ratio: (metrics[k] || 0) / max }));
  const over = ratios.filter((r) => r.v > r.max);
  const score = +Math.max(0, ...ratios.map((r) => r.ratio)).toFixed(2);
  return { tooBig: over.length > 0, reasons: over.map((r) => `${r.k}=${r.v} > ${r.max}`), score, recommend: over.length ? 'decompose' : 'ok' };
}

// count list items under a header matching `sectionRe`, until the next header
function sectionBullets(lines, sectionRe) {
  let inSec = false; const items = [];
  for (const l of lines) {
    if (/^#{1,4}\s/.test(l)) inSec = sectionRe.test(l);
    else if (inSec) { const m = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/); if (m) items.push(m[1].trim()); }
  }
  return items;
}

// pull size metrics from a spec markdown structurally
export function extractMetrics(md = '') {
  const lines = md.split('\n');
  const objBullets = sectionBullets(lines, /objective|goal/i).length;
  const acBullets = sectionBullets(lines, /acceptance|criteria/i).length;
  return {
    objectives: objBullets || (md.match(/\bOBJ-?\d+/gi) || []).length,
    acceptanceCriteria: acBullets || (md.match(/\bAC-?\d+/gi) || []).length,
    surfaces: ['backend', 'frontend', 'data', 'mobile', 'api', 'infra'].filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(md)).length,
    specLoc: lines.length,
  };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('a small spec is OK', assess({ objectives: 3, acceptanceCriteria: 8, surfaces: 2, specLoc: 200 }).tooBig === false);
  ok('too many objectives → tooBig + decompose', (() => { const r = assess({ objectives: 12 }); return r.tooBig && r.recommend === 'decompose' && r.reasons.some((x) => /objectives/.test(x)); })());
  ok('too many AC → tooBig', assess({ acceptanceCriteria: 25 }).tooBig === true);
  ok('too many surfaces → tooBig', assess({ surfaces: 4 }).reasons.some((x) => /surfaces/.test(x)));
  ok('huge spec doc → tooBig', assess({ specLoc: 700 }).tooBig === true);
  ok('exactly at threshold is NOT over (8 objectives ok, 9 not)', assess({ objectives: 8 }).tooBig === false && assess({ objectives: 9 }).tooBig === true);
  ok('score is the max over-ratio (>1 when over)', assess({ objectives: 16 }).score === 2 && assess({ objectives: 4 }).score <= 1);
  // extraction from a real-shaped spec
  const md = `# Spec\n## Objectives\n- a\n- b\n- c\n## Acceptance Criteria\n- AC-1 x\n- AC-2 y\nbackend and frontend work.`;
  const m = extractMetrics(md);
  ok('extractMetrics counts objectives (3) + AC (2) + surfaces (backend+frontend=2)', m.objectives === 3 && m.acceptanceCriteria === 2 && m.surfaces === 2);
  ok('a big extracted spec is flagged', assess(extractMetrics(`## Objectives\n${'- x\n'.repeat(12)}`)).tooBig === true);

  if (fails.length) { console.log(`\n\x1b[31mspec-size-check self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ spec-size-check: size estimation + decomposition gate correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const specPath = arg('--spec'); const metricsJson = arg('--metrics');
  if (!specPath && !metricsJson) { console.error("usage: --spec <file.md> | --metrics '<json>'  (or --self-test)"); process.exit(2); }
  const metrics = metricsJson ? JSON.parse(metricsJson) : extractMetrics(readFileSync(specPath, 'utf8'));
  const r = assess(metrics);
  console.log(`spec-size-check — ${JSON.stringify(metrics)}\n`);
  if (r.tooBig) { console.error(`\x1b[31m✗ spec too big to build in one wave (score ${r.score}): ${r.reasons.join('; ')}\x1b[0m\n  → DECOMPOSE into smaller specs before building (the #1 cause of agent failure).`); process.exit(1); }
  console.log(`\x1b[32m✓ spec is build-sized (score ${r.score}).\x1b[0m`);
  process.exit(0);
}
