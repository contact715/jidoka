#!/usr/bin/env node
// gate-audit — the single map of every gate: which LAYER enforces it (CI / PreToolUse / runtime
// dispatch / product pre-push / LLM-judge) and its MODE (hard-block / soft-warn / proxy / kernel /
// measured / degrade-skip). Then it VERIFIES the claims: a gate marked CI must actually appear in a
// workflow file. This is anti-ghost for the GATES THEMSELVES — "we have a security gate" must mean
// it runs somewhere real (the security-gate.yml ghost is exactly what this catches).
//
// Answers "which gates are weak / not enforced / where" mechanically, not by opinion.
//
// FULL & self-tested. Usage: node scripts/gate-audit.mjs [--self-test]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const GATES = [
  // CI — run on every push/PR, hard-block
  { id: 'meta-audit', layer: 'CI', mode: 'hard', token: 'meta-audit.mjs' },
  { id: 'meta-honesty', layer: 'CI', mode: 'hard', token: 'meta-honesty.mjs' },
  { id: 'test:engine', layer: 'CI', mode: 'hard', token: 'test:engine' },
  { id: 'eval-suite', layer: 'CI', mode: 'hard', token: 'npm run eval' },
  { id: 'check:structural', layer: 'CI', mode: 'hard', token: 'check:structural' },
  { id: 'check:security', layer: 'CI', mode: 'hard', token: 'check:security' },
  { id: 'pre-publish-guard', layer: 'CI', mode: 'hard', token: 'pre-publish-guard.mjs' },
  { id: 'instantiation-audit', layer: 'CI', mode: 'hard', token: 'instantiation-audit.mjs' },
  { id: 'execution-gate', layer: 'CI', mode: 'hard', token: 'execution-gate.mjs' },
  { id: 'gate-audit', layer: 'CI', mode: 'hard', token: 'gate-audit.mjs' },
  // CI — spec-tree structural gates (wave: spec-tree-overhaul)
  { id: 'spec-structural-gate', layer: 'CI', mode: 'hard', token: 'spec-structural-gate.mjs' },
  { id: 'validate-raci', layer: 'CI', mode: 'hard', token: 'validate-raci.mjs' },
  { id: 'lineage-graph', layer: 'CI', mode: 'hard', token: 'build-lineage-graph.mjs' },
  { id: 'cascade-validate', layer: 'CI', mode: 'hard', token: 'cascade-validate.mjs' },
  { id: 'ac-verify-map', layer: 'CI', mode: 'hard', token: 'ac-verify-map.mjs' },
  { id: 'semgrep-sast', layer: 'CI', mode: 'hard', token: 'semgrep' },
  { id: 'trufflehog-secrets', layer: 'CI', mode: 'hard', token: 'trufflehog' },
  { id: 'dependency-audit', layer: 'CI', mode: 'hard', token: 'dependency-audit' },
  { id: 'mutation-test', layer: 'CI', mode: 'hard', token: 'mutation-test' },
  { id: 'red-team', layer: 'CI', mode: 'hard', token: 'red-team.mjs' },
  { id: 'selftest-reality', layer: 'CI', mode: 'hard', token: 'gate:selftest' },
  // PreToolUse — real-time, hard-block
  { id: 'policy-enforce-hook', layer: 'PreToolUse', mode: 'hard', token: null },
  { id: 'jidoka-guard', layer: 'PreToolUse', mode: 'hard', token: null },
  // runtime / dispatch — enforced by the orchestrator during a wave (not on commit)
  { id: 'budget-gate', layer: 'runtime', mode: 'hard', token: null },
  { id: 'policy-sandbox', layer: 'runtime', mode: 'proxy', token: null },
  { id: 'sandbox-run', layer: 'runtime', mode: 'kernel', token: null },
  { id: 'parallel-guard', layer: 'runtime', mode: 'hard', token: null },
  // product pre-push — enforced in the target product (via install-into), hard
  { id: 'northstar-check', layer: 'product', mode: 'hard', token: null },
  { id: 'charter-check', layer: 'product', mode: 'hard', token: null },
  { id: 'coverage-gate', layer: 'product', mode: 'hard', token: null },
  // runtime-coverage gates (built from real prod incidents) — enforced in the target product's CI
  { id: 'resource-guard', layer: 'product', mode: 'hard', token: null },
  { id: 'precision-guard', layer: 'product', mode: 'soft', token: null },
  { id: 'cross-layer-dup', layer: 'product', mode: 'hard', token: null },
  { id: 'req-trace', layer: 'product', mode: 'hard', token: null },
  { id: 'load-test-gate', layer: 'product', mode: 'hard', token: null },
  { id: 'canary-gate', layer: 'product', mode: 'hard', token: null },
  { id: 'e2e-run-gate', layer: 'product', mode: 'hard', token: null },
  { id: 'cost-ledger', layer: 'product', mode: 'hard', token: null },
  // soft-trial — warn until graduated (gate-graduation proposes the flip)
  { id: 'spec-drift', layer: 'product', mode: 'soft', token: null },
  { id: 'spec-frontmatter', layer: 'product', mode: 'soft', token: 'validate-spec-frontmatter.mjs' },
  { id: 'ac-coverage', layer: 'product', mode: 'soft', token: 'ac-coverage-check.mjs' },
  { id: 'spec-amendment', layer: 'product', mode: 'soft', token: 'spec-amendment-gate.mjs' },
  { id: 'change-ceremony', layer: 'product', mode: 'soft', token: 'change-ceremony.mjs' },
  { id: 'detect-injection', layer: 'runtime', mode: 'soft', token: null },
  { id: 'detect-constitutional-drift', layer: 'runtime', mode: 'soft', token: null },
  // LLM judges — measured via golden cases
  { id: 'constitutional-reviewer', layer: 'LLM', mode: 'measured', token: null },
  { id: 'reflexion-critic', layer: 'LLM', mode: 'measured', token: null },
  { id: 'debate-judge', layer: 'LLM', mode: 'measured', token: null },
  { id: 'best-of-N-judge', layer: 'LLM', mode: 'measured', token: null },
  { id: 'security-scanner', layer: 'LLM', mode: 'measured', token: null },
  { id: 'a11y-auditor', layer: 'LLM', mode: 'measured', token: null },
  { id: 'perf-profiler', layer: 'LLM', mode: 'measured', token: null },
  { id: 'coverage-auditor', layer: 'LLM', mode: 'measured', token: null },
  { id: 'debate-prosecutor', layer: 'LLM', mode: 'measured', token: null },
  { id: 'debate-defender', layer: 'LLM', mode: 'measured', token: null },
];

// a CI gate is "present" if its token appears in a workflow; selfTestOnly flags when its ONLY
// appearance is a --self-test invocation — the gate's LOGIC is CI-verified, but it does NOT enforce on
// the repo's real code. Present-but-self-test-only is surfaced (🟡), not failed — honest, not a ghost.
export function verifyCI(gates, workflowText) {
  const lines = String(workflowText).split('\n');
  return gates.filter(g => g.layer === 'CI').map(g => {
    if (!g.token) return { id: g.id, present: true, selfTestOnly: false };
    const hits = lines.filter(l => l.includes(g.token));
    return { id: g.id, present: hits.length > 0, selfTestOnly: hits.length > 0 && hits.every(l => l.includes('--self-test')) };
  });
}

// the INVERSE of a ghost: an ORPHAN — a gate script that exists (package.json "gate:*") but has NO
// standing caller (no workflow, no git hook). Built-but-unwired reads as protection while enforcing
// nothing. Incident that taught this: gate:selftest (wave-meta-gates) lived 3 days with zero callers
// while its commit claimed it "live + runnable" — declaration-over-implementation regression 2026-06-06.
// "Wired" = the script NAME is invoked somewhere (workflow / git hook), OR the FILE it runs is
// distributed to products by the installer (product-layer gates enforce in the target repo, not here).
export function findOrphanGateScripts(pkg, callersText) {
  const scripts = (pkg && pkg.scripts) || {};
  const names = Object.keys(scripts).filter(n => n.startsWith('gate:'));
  const text = String(callersText);
  return names.filter(n => {
    if (text.includes(n)) return false;
    const file = (String(scripts[n]).match(/[\w./-]+\.(?:mjs|js|sh)/) || [])[0];
    return !(file && text.includes(file.replace(/^.*\//, '')));
  });
}

function workflowsText(root = process.cwd()) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return '';
  return readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
}

function selfTest() {
  const wf = '...\n  run: npm run eval\n  run: node scripts/meta-audit.mjs\n  run: node scripts/execution-gate.mjs --self-test\n  uses: trufflesecurity/trufflehog\n  run: semgrep scan';
  const v = verifyCI([{ id: 'eval-suite', layer: 'CI', token: 'npm run eval' }, { id: 'semgrep-sast', layer: 'CI', token: 'semgrep' }, { id: 'ghost-gate', layer: 'CI', token: 'does-not-exist-xyz' }, { id: 'exec-st', layer: 'CI', token: 'execution-gate.mjs' }], wf);
  const by = Object.fromEntries(v.map(x => [x.id, x.present]));
  const stOnly = Object.fromEntries(v.map(x => [x.id, x.selfTestOnly]));
  const T = [
    ['GATES registry is non-trivial', GATES.length >= 20],
    ['every gate has a layer + mode', GATES.every(g => g.layer && g.mode)],
    ['a present CI gate verifies true', by['eval-suite'] === true],
    ['a token-matched CI gate (semgrep) verifies true', by['semgrep-sast'] === true],
    ['a GHOST CI gate (token absent) is caught', by['ghost-gate'] === false],
    ['a --self-test-only CI gate is flagged selfTestOnly (over-credit made visible)', stOnly['exec-st'] === true],
    ['a real-run CI gate is NOT flagged selfTestOnly', stOnly['eval-suite'] === false],
    ['layers cover CI/runtime/product/LLM/PreToolUse', new Set(GATES.map(g => g.layer)).size >= 5],
    ['soft gates are explicitly marked', GATES.some(g => g.mode === 'soft')],
    ['orphan gate:* script (no caller anywhere) is caught', findOrphanGateScripts({ scripts: { 'gate:x': 'node scripts/x.mjs' } }, 'run: npm test').includes('gate:x')],
    ['gate:* called by name (CI/hook) is NOT an orphan', findOrphanGateScripts({ scripts: { 'gate:x': 'node scripts/x.mjs' } }, 'run: npm run gate:x').length === 0],
    ['gate:* whose FILE ships via installer is NOT an orphan', findOrphanGateScripts({ scripts: { 'gate:x': 'node scripts/x.mjs' } }, "payload: 'x.mjs',").length === 0],
    ['no gate:* scripts → no orphans', findOrphanGateScripts({ scripts: { test: 'vitest' } }, '').length === 0],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mgate-audit self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ gate-audit: gate map + CI-ghost detection correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const wf = workflowsText();
  const ci = verifyCI(GATES, wf);
  const ghosts = ci.filter(c => !c.present);
  const byLayer = {};
  for (const g of GATES) (byLayer[g.layer] ??= []).push(g);
  console.log('gate-audit — map of all gates by enforcement layer\n');
  for (const [layer, gs] of Object.entries(byLayer)) {
    console.log(`  ${layer}:`);
    for (const g of gs) {
      const c = ci.find(c => c.id === g.id);
      const mark = g.layer === 'CI' ? (!c?.present ? '🔴 GHOST' : c.selfTestOnly ? '🟡 self-test-only' : '🟢') : (g.mode === 'soft' ? '🟡 soft' : g.mode === 'measured' ? '📊' : '🟢');
      console.log(`    ${mark} ${g.id} (${g.mode})`);
    }
  }
  const soft = GATES.filter(g => g.mode === 'soft').length;
  console.log(`\n  ${GATES.length} gates · ${GATES.filter(g => g.layer === 'CI').length} in CI · ${soft} soft-trial · ${GATES.filter(g => g.mode === 'measured').length} measured-LLM`);
  const selfTestOnly = ci.filter(c => c.selfTestOnly);
  if (selfTestOnly.length) console.log(`  \x1b[33mℹ ${selfTestOnly.length} CI gate(s) run ONLY as --self-test in CI (logic verified, NOT enforcing on repo code): ${selfTestOnly.map(g => g.id).join(', ')}\x1b[0m`);
  if (ghosts.length) { console.error(`\n\x1b[31m✗ ${ghosts.length} CI gate(s) declared but absent from workflows: ${ghosts.map(g => g.id).join(', ')}\x1b[0m`); process.exit(1); }
  console.log('  \x1b[32m✓ every CI-layer gate is present in a workflow (no ghost gate).\x1b[0m');
  // orphan check: every package.json gate:* script must have a standing caller (workflow or git hook)
  const pkgPath = join(process.cwd(), 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
  const hooksDir = join(process.cwd(), '.githooks');
  const hooksText = existsSync(hooksDir)
    ? readdirSync(hooksDir).map(f => { try { return readFileSync(join(hooksDir, f), 'utf8'); } catch { return ''; } }).join('\n')
    : '';
  const installerPath = join(process.cwd(), 'scripts', 'install-into.mjs');
  const installerText = existsSync(installerPath) ? readFileSync(installerPath, 'utf8') : '';
  const orphans = findOrphanGateScripts(pkg, wf + '\n' + hooksText + '\n' + installerText);
  if (orphans.length) { console.error(`\n\x1b[31m✗ ${orphans.length} gate script(s) built but UNWIRED (no workflow / git-hook caller — an orphan enforces nothing): ${orphans.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('  \x1b[32m✓ every gate:* script has a standing caller (no orphan gate).\x1b[0m');
  process.exit(0);
}
