#!/usr/bin/env node
// change-ceremony — classify a change S / M / L and name the ceremony it owes.
//
// WHY THIS EXISTS (2026-06-05 spec-tree audit, industry half): the dominant 2026
// criticism of spec-driven tooling is uniform ceremony — "16 acceptance criteria
// for a one-line bug fix" (Kiro review), spec bloat, context rot. jidoka had the
// UPPER bound (spec-size-check: a spec too big to build → decompose) but nothing
// said "this change is too SMALL to deserve a full wave spec". Result: either
// heavy ceremony on trivial fixes (friction → people bypass the system) or silent
// skipping (no record at all). Right-sizing keeps the system honest AND usable.
//
// RELATION TO spec-size-check.mjs (NOT a duplicate): size-check judges a WRITTEN
// spec's buildability (upper bound). change-ceremony judges, BEFORE writing,
// which artifact a change owes at all (lower bound + routing).
//
// TIERS (defaults, tunable via .sdd-config.json → changeCeremony):
//   S — small fix: ≤2 files, ≤40 LOC delta, no new files in app routes / stores /
//       migrations, no protected zone. Owes: NO wave spec. The spec-amendment
//       gate covers the trail (living spec amended in the same commit, or waiver).
//   M — bounded feature: up to 10 files / 400 LOC, no protected zone. Owes: a
//       MINI-SPEC — one file, goal + ≤5 acceptance criteria + affected surfaces.
//   L — everything else (new surface/route, data model, protected zone, >10 files
//       or >400 LOC). Owes: full pipeline — master spec, architects, tests-first.
//
// HONEST boundary: MECHANICAL classification from countable signals (file count,
// LOC delta, path shapes). It cannot see that a 3-line change to billing rounding
// is business-critical — that judgement stays with the committer/steward, which
// is why the verdict is ADVISORY (soft) by design and protected-zone paths are
// configurable per project.
//
// FULL & self-tested. Usage:
//   node scripts/change-ceremony.mjs --self-test
//   node scripts/change-ceremony.mjs --staged [--root <dir>]
//   node scripts/change-ceremony.mjs --metrics '{"filesTouched":3,"locDelta":120}'

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

export const DEFAULTS = {
  small: { maxFiles: 2, maxLoc: 40 },
  medium: { maxFiles: 10, maxLoc: 400 },
  // Path regexes that force L regardless of size (a project tunes these):
  protectedPaths: [
    'NORTH_STAR|PROJECT_CHARTER|MISSION|CONSTITUTION|PRODUCT_PHILOSOPHY',
    '(^|/)(billing|payments?|auth)/',
    'migrations?/',
  ],
  // New files matching these = a new surface/store → at least M, new route → L:
  newRouteRe: '(^|/)app/.*/page\\.(tsx|jsx)$',
  newStoreRe: '(^|/)(lib/store|stores)/.*\\.(ts|js)$',
};

// pure: classify from metrics. Returns { tier, reasons, owes }.
export function classify(m, cfg = DEFAULTS) {
  const reasons = [];
  let tier = 'S';

  const protectedHit = (m.paths || []).find((p) => cfg.protectedPaths.some((re) => new RegExp(re).test(p)));
  const newRoute = (m.newPaths || []).find((p) => new RegExp(cfg.newRouteRe).test(p));
  const newStore = (m.newPaths || []).find((p) => new RegExp(cfg.newStoreRe).test(p));

  if (protectedHit) { tier = 'L'; reasons.push(`protected zone touched: ${protectedHit}`); }
  if (newRoute) { tier = 'L'; reasons.push(`new route surface: ${newRoute}`); }
  if (m.filesTouched > cfg.medium.maxFiles) { tier = 'L'; reasons.push(`files ${m.filesTouched} > ${cfg.medium.maxFiles}`); }
  if (m.locDelta > cfg.medium.maxLoc) { tier = 'L'; reasons.push(`LOC delta ${m.locDelta} > ${cfg.medium.maxLoc}`); }

  if (tier !== 'L') {
    const overSmall = m.filesTouched > cfg.small.maxFiles || m.locDelta > cfg.small.maxLoc || newStore;
    if (overSmall) {
      tier = 'M';
      if (m.filesTouched > cfg.small.maxFiles) reasons.push(`files ${m.filesTouched} > ${cfg.small.maxFiles}`);
      if (m.locDelta > cfg.small.maxLoc) reasons.push(`LOC delta ${m.locDelta} > ${cfg.small.maxLoc}`);
      if (newStore) reasons.push(`new store/state module: ${newStore}`);
    }
  }

  const owes = {
    S: 'no wave spec — spec-amendment gate covers the trail (amend the living spec it touches, or waiver for internal refactor)',
    M: 'mini-spec: ONE file — goal, ≤5 acceptance criteria, affected surfaces. No architect fan-out.',
    L: 'full pipeline: master spec + architects + tests-first (and spec-size-check the result — upper bound applies)',
  }[tier];

  return { tier, reasons: reasons.length ? reasons : ['within S thresholds'], owes };
}

// gather metrics from the staged diff
export function metricsFromStaged(root) {
  const num = execSync('git diff --cached --numstat', { cwd: root, encoding: 'utf8' }).trim();
  if (!num) return null;
  let files = 0; let loc = 0; const paths = [];
  for (const line of num.split('\n')) {
    const [add, del, p] = line.split('\t');
    if (!p) continue;
    files++; paths.push(p);
    loc += (parseInt(add, 10) || 0) + (parseInt(del, 10) || 0);
  }
  const status = execSync('git diff --cached --name-status', { cwd: root, encoding: 'utf8' }).trim();
  const newPaths = status.split('\n').filter((l) => l.startsWith('A')).map((l) => l.split('\t').pop());
  return { filesTouched: files, locDelta: loc, paths, newPaths };
}

function loadConfig(root) {
  try {
    const user = JSON.parse(readFileSync(join(root, '.sdd-config.json'), 'utf8')).changeCeremony ?? {};
    return { ...DEFAULTS, ...user };
  } catch { return DEFAULTS; }
}

function run() {
  const args = process.argv.slice(2);
  const rootArg = args.find((_, i) => args[i - 1] === '--root');
  const metricsArg = args.find((_, i) => args[i - 1] === '--metrics');
  const root = resolve(rootArg ?? process.cwd());
  const cfg = loadConfig(root);

  let m = null;
  if (metricsArg) m = JSON.parse(metricsArg);
  else if (args.includes('--staged')) {
    try { m = metricsFromStaged(root); } catch { m = null; }
  }
  if (!m) { console.log('[change-ceremony] nothing to classify (pass --staged with a staged diff, or --metrics)'); return 0; }

  const v = classify(m, cfg);
  console.log(`[change-ceremony] tier ${v.tier} — ${v.reasons.join('; ')}`);
  console.log(`[change-ceremony] owes: ${v.owes}`);
  return 0; // ADVISORY by design — routing, not blocking
}

function selfTest() {
  let pass = 0; const checks = [];
  const c = (m) => classify(m, DEFAULTS);
  checks.push(['1-file 5-LOC fix is S', c({ filesTouched: 1, locDelta: 5, paths: ['lib/utils/date.ts'], newPaths: [] }).tier === 'S']);
  checks.push(['5 files 120 LOC is M', c({ filesTouched: 5, locDelta: 120, paths: ['components/a.tsx'], newPaths: [] }).tier === 'M']);
  checks.push(['new store forces ≥M', c({ filesTouched: 1, locDelta: 20, paths: ['lib/store/fooStore.ts'], newPaths: ['lib/store/fooStore.ts'] }).tier === 'M']);
  checks.push(['new route forces L', c({ filesTouched: 2, locDelta: 30, paths: ['app/(x)/foo/page.tsx'], newPaths: ['app/(x)/foo/page.tsx'] }).tier === 'L']);
  checks.push(['protected zone forces L', c({ filesTouched: 1, locDelta: 3, paths: ['docs/NORTH_STAR.md'], newPaths: [] }).tier === 'L']);
  checks.push(['billing path forces L', c({ filesTouched: 1, locDelta: 10, paths: ['lib/billing/pricing.ts'], newPaths: [] }).tier === 'L']);
  checks.push(['>400 LOC forces L', c({ filesTouched: 4, locDelta: 900, paths: ['components/a.tsx'], newPaths: [] }).tier === 'L']);
  checks.push(['S owes no wave spec', c({ filesTouched: 1, locDelta: 5, paths: ['lib/u.ts'], newPaths: [] }).owes.includes('no wave spec')]);
  checks.push(['M owes mini-spec', c({ filesTouched: 5, locDelta: 120, paths: ['components/a.tsx'], newPaths: [] }).owes.includes('mini-spec')]);
  checks.push(['L owes full pipeline', c({ filesTouched: 20, locDelta: 2000, paths: ['components/a.tsx'], newPaths: [] }).owes.includes('full pipeline')]);
  for (const [name, ok] of checks) { if (ok) { pass++; console.log(`  ok  ${name}`); } else console.log(`  FAIL ${name}`); }
  console.log(`[change-ceremony] self-test: ${pass}/${checks.length}`);
  return pass === checks.length ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('change-ceremony.mjs')) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
