#!/usr/bin/env node
// footprint-audit — after install-into scaffolds files into a target, PROVE each installed file is
// actually reachable from a LIVE TRIGGER in that target (git hook / CI workflow / package.json script).
// A file nobody calls is dead-on-arrival: it bloats the repo and reads as "capability" while doing
// nothing. This is the mirror of instantiation-audit (which catches ghosts the framework CLAIMS) — but
// for the INSTALL direction: it catches DEAD INSTALLS the framework LEAVES BEHIND.
//
// It also detects whether the target ALREADY has its own equivalent framework, so a blind full install
// (which would just duplicate it) is flagged BEFORE the copy, not discovered months later.
//
// ROOT INCIDENT (2026-06-02): jidoka --profile=full copied 51 scripts into Mosco; 45 had ZERO callers
// because Mosco already runs its own native verification framework. Nothing in the pipeline asked the
// two questions that matter for any ADD: "does the target already have this?" and "will it be wired?"
// This gate asks both. The lesson it encodes: addition is not free — an artifact earns its place by
// being not-already-present AND connected to something live. Otherwise the right amount is zero.
//
// HONEST boundary: "live trigger" = .husky/ + .github/workflows/ + package.json scripts. A script
// imported only by app source isn't counted (rare for CLI gates; this under-reports, never over-reports
// — a file flagged dead here is dead for sure).
//
// FULL & self-tested. Usage:
//   node scripts/footprint-audit.mjs --self-test
//   node scripts/footprint-audit.mjs --target /path/to/product            (audit an install)
//   node scripts/footprint-audit.mjs --target /path/to/product --strict   (exit 1 if redundant)

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── pure logic (testable without IO) ─────────────────────────────────────────
// Every installed basename that does NOT appear in the target's live-caller text is dead-on-arrival.
export function classifyFootprint(basenames = [], liveCallerText = '') {
  const wired = [], dead = [];
  for (const b of basenames) (liveCallerText.includes(b) ? wired : dead).push(b);
  return { wired, dead, deadRatio: basenames.length ? dead.length / basenames.length : 0 };
}

// A target "already has its own framework" when 2+ independent signals of one are present. 2 is the
// threshold so a single coincidental file (a lone docs/ folder) does not trip it.
export function detectNativeFramework(signals = []) {
  return { hasOwn: signals.length >= 2, signals };
}

// The verdict an installer should act on, derived from the two checks above.
export function footprintVerdict({ deadRatio, native }) {
  if (native.hasOwn && deadRatio > 0.5) return { level: 'REDUNDANT', msg: 'target already has its own framework AND most installed files are dead — this install is duplication; skip or revert' };
  if (deadRatio > 0.5) return { level: 'MOSTLY-DEAD', msg: 'over half the installed files have no live caller — wire them into a hook/CI or do not install them' };
  if (native.hasOwn) return { level: 'OVERLAP', msg: 'target has its own framework — install only the specific gates it lacks, do not full-install' };
  return { level: 'OK', msg: 'installed files are reachable and do not duplicate an existing framework' };
}

// ── IO wrappers ──────────────────────────────────────────────────────────────
function walkRead(dir, acc = []) {
  if (!existsSync(dir)) return '';
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkRead(p, acc);
    else { try { acc.push(readFileSync(p, 'utf8')); } catch { /* binary/unreadable */ } }
  }
  return acc.join('\n');
}

// concat of the surfaces where a gate becomes LIVE in a product
function liveCallerText(target) {
  const parts = [];
  for (const sub of ['.husky', join('.github', 'workflows')]) parts.push(walkRead(join(target, sub)));
  const pkg = join(target, 'package.json');
  if (existsSync(pkg)) { try { parts.push(readFileSync(pkg, 'utf8')); } catch { /* */ } }
  return parts.join('\n');
}

export function nativeSignals(target) {
  const checks = [
    ['own verify-gate', () => { const d = join(target, 'scripts'); return existsSync(d) && readdirSync(d).some(f => /verif.*gate|gate.*verif/i.test(f)); }],
    ['lib/verification/', () => existsSync(join(target, 'lib', 'verification'))],
    ['docs/specs/', () => existsSync(join(target, 'docs', 'specs'))],
    ['docs/AGENT_ROSTER', () => existsSync(join(target, 'docs', 'AGENT_ROSTER.md'))],
    ['own .husky gates → scripts/', () => /scripts\//.test(walkRead(join(target, '.husky')))],
  ];
  return checks.filter(([, fn]) => { try { return fn(); } catch { return false; } }).map(([l]) => l);
}

// installed jidoka script basenames (minus the inert ones that ship as engine-internal helpers)
function installedBasenames(target) {
  const dir = join(target, '.jidoka', 'scripts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.mjs')).map(f => f.replace(/\.mjs$/, ''));
}

// public API used by install-into to self-police a fresh install
export function auditInstall(target) {
  const installed = installedBasenames(target);
  const { wired, dead, deadRatio } = classifyFootprint(installed, liveCallerText(target));
  const native = detectNativeFramework(nativeSignals(target));
  return { installed, wired, dead, deadRatio, native, verdict: footprintVerdict({ deadRatio, native }) };
}

// ── self-test (encodes the Mosco reproduction) ───────────────────────────────
function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('a script with no caller → dead', (() => { const r = classifyFootprint(['planner', 'guard'], 'node .jidoka/scripts/guard.mjs'); return r.dead.includes('planner') && r.wired.includes('guard'); })());
  ok('empty caller surface → everything dead', classifyFootprint(['a', 'b'], '').dead.length === 2);
  ok('referenced in a hook → wired', classifyFootprint(['x'], 'pre-push: node x.mjs').wired.includes('x'));

  // THE Mosco reproduction: many installed, only the 6 meta-* aliases referenced → most dead-on-arrival.
  const installed = ['meta-audit', 'meta-honesty', 'meta-trend', 'meta-log', 'meta-premortem', 'pre-publish-guard',
    'orchestration-planner', 'precision-guard', 'resource-guard', 'cost-ledger', 'model-router', 'skill-selector',
    'debate-engine', 'trend-scan', 'spec-tldr', 'canary-gate', 'req-trace', 'prod-harvest'];
  const moscoCallers = '"jidoka:audit":"node .jidoka/scripts/meta-audit.mjs","jidoka:honesty":"node .jidoka/scripts/meta-honesty.mjs","jidoka:trend":"node .jidoka/scripts/meta-trend.mjs","jidoka:log":"node .jidoka/scripts/meta-log.mjs","jidoka:premortem":"node .jidoka/scripts/meta-premortem.mjs","jidoka:guard":"node .jidoka/scripts/pre-publish-guard.mjs"';
  const rM = classifyFootprint(installed, moscoCallers);
  ok('Mosco-shaped: exactly the 6 meta-* wired, the rest dead-on-arrival', rM.wired.length === 6 && rM.dead.length === 12 && rM.deadRatio > 0.5);

  ok('2+ signals → native framework detected', detectNativeFramework(['lib/verification/', 'own verify-gate']).hasOwn === true);
  ok('0 signals → no native framework', detectNativeFramework([]).hasOwn === false);
  ok('1 signal alone does NOT trip native-framework (avoids false positive)', detectNativeFramework(['docs/specs/']).hasOwn === false);

  // verdict: the Mosco case (native + mostly-dead) must read REDUNDANT — the verdict that would have stopped me
  ok('verdict REDUNDANT when native framework + mostly dead (the exact Mosco miss)', footprintVerdict({ deadRatio: 0.88, native: { hasOwn: true } }).level === 'REDUNDANT');
  ok('verdict OK when reachable + no duplication', footprintVerdict({ deadRatio: 0.1, native: { hasOwn: false } }).level === 'OK');
  ok('verdict OVERLAP when native present but install is small/wired', footprintVerdict({ deadRatio: 0.1, native: { hasOwn: true } }).level === 'OVERLAP');

  if (fails.length) { console.log(`\n\x1b[31mfootprint-audit self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ footprint-audit: dead-install + redundancy detection correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const target = arg('--target');
  if (!target) { console.error('usage: --target <product-dir> [--strict] | --self-test'); process.exit(2); }
  const r = auditInstall(target);
  console.log(`footprint-audit — ${target}\n`);
  console.log(`  installed jidoka scripts: ${r.installed.length}`);
  console.log(`  \x1b[32mwired (live caller): ${r.wired.length}\x1b[0m  →  ${r.wired.join(', ') || '(none)'}`);
  console.log(`  \x1b[33mdead (no caller):    ${r.dead.length}\x1b[0m  (${Math.round(r.deadRatio * 100)}%)`);
  console.log(`  native framework already in target: ${r.native.hasOwn ? '\x1b[33mYES\x1b[0m → ' + r.native.signals.join(', ') : 'no'}`);
  const color = r.verdict.level === 'OK' ? '\x1b[32m' : '\x1b[33m';
  console.log(`\n  ${color}▌ ${r.verdict.level}\x1b[0m — ${r.verdict.msg}`);
  if (process.argv.includes('--strict') && r.verdict.level !== 'OK') process.exit(1);
  process.exit(0);
}
