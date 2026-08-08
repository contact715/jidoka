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
import { homedir } from 'node:os';

export const GATES = [
  // CI — run on every push/PR, hard-block
  { id: 'meta-audit', layer: 'CI', mode: 'hard', token: 'meta-audit.mjs' },
  { id: 'meta-honesty', layer: 'CI', mode: 'hard', token: 'meta-honesty.mjs' },
  { id: 'ledger-schema-gate', layer: 'CI', mode: 'hard', token: 'gate:ledger-schema' },
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
  // local pre-push — enforced on the machine that publishes (not checkable in CI: they compare
  // the repo against the LIVE install, which does not exist on a runner)
  { id: "ledger-sync-gate", layer: "local", mode: "hard", token: null },
  { id: "settings-integrity", layer: "local", mode: "hard", token: null },
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


// stop-layer-derived (2026-W31-R8) — the gate map called itself "the single map of every gate"
// and had no Stop layer at all, while four Stop hooks were live in settings.json:
// browser-verify-gate, proof-of-work-gate, outbound-claims-gate, synthesis-coverage-gate. A map
// that omits a whole enforcement layer is worse than no map: it is consulted and believed.
//
// The Stop layer is DERIVED from the hook config rather than typed here, so it cannot drift the
// way a hand-written list does. That is the same reason the README script counter kept going
// stale: a number a human maintains, guarding a property a machine could read.
//
// REJECTED half of this recommendation, with evidence. It also asked to "drop the unbacked
// measured claim for 10 judges". Checked on disk: all ten have docs/evals/<agent>/golden-cases.jsonl
// AND a recorded run-*.jsonl. The claim is backed, so it stays. Removing it would have deleted a
// true statement on the strength of a plausible-sounding report line.
export function stopGatesFrom(settingsText) {
  let cfg;
  try { cfg = JSON.parse(String(settingsText)); } catch { return { checked: false, gates: [] }; }
  const groups = cfg?.hooks?.Stop;
  if (!Array.isArray(groups)) return { checked: false, gates: [] };
  const gates = [];
  const seen = new Set();
  for (const g of groups) {
    for (const h of g.hooks || []) {
      const cmd = String(h.command || '');
      const file = (cmd.match(/([\w-]+)\.mjs\b/) || [])[1];
      if (!file || seen.has(file)) continue;
      seen.add(file);
      // a Stop hook that only records state is not a GATE; a gate is one that can block
      if (/^(session-state)$/.test(file)) continue;
      gates.push({ id: file, layer: 'Stop', mode: 'hard', token: `${file}.mjs` });
    }
  }
  return { checked: true, gates };
}

// PreToolUse gates are "wired" only if the GLOBAL hook config actually routes the right tools
// through them. Incident 2026-07-12 (gate-bypass): policy-enforce-hook handled Bash side-channels
// in code (self-tested, red-team-proven) but ~/.claude/settings.json ran it only on Write|Edit —
// the Bash write channel to L0 paths stayed open for weeks. Same anti-ghost idea as verifyCI:
// "enforced" must mean a standing caller routes the traffic, not that the logic exists.
export function verifyPreToolUse(settingsText) {
  let cfg; try { cfg = JSON.parse(String(settingsText)); } catch { return { checked: false, missing: [] }; }
  const groups = cfg?.hooks?.PreToolUse;
  if (!Array.isArray(groups)) return { checked: false, missing: [] };
  const routed = (tool, token) => groups.some(g => {
    const m = String(g.matcher ?? '');
    return (m === '*' || m.split('|').includes(tool)) && (g.hooks || []).some(h => String(h.command || '').includes(token));
  });
  const missing = [];
  for (const tool of ['Write', 'Edit', 'Bash']) {
    if (!routed(tool, 'policy-enforce-hook')) missing.push(`policy-enforce-hook not routed for ${tool} (the ${tool === 'Bash' ? 'side-channel' : 'write'} path is open)`);
  }
  if (!routed('Bash', 'jidoka-guard')) missing.push('jidoka-guard not routed for Bash (secret-guard on push/commit is open)');
  return { checked: true, missing };
}

// gate-severity-parity (2026-W32-R1) — the same checker must be equally strict where you
// COMMIT and where you PUBLISH. When a script runs with a softening flag in .githooks/* but
// hard in .github/workflows/*, every commit passes locally and the failure surfaces only on
// the server, where nobody is watching. Not hypothetical: instantiation-audit ran --warn in
// .githooks/pre-commit and hard in ci.yml, main went red on 2026-07-29 over a one-line README
// count and stayed red five days while four more commits landed on top of it.
//
// A local gate MAY be stricter than CI. It may never be looser.
export const SOFTENING_FLAGS = ['--warn', '--soft', '--dry-run', '--advisory', '--no-fail'];

// Map script filename → is EVERY invocation of it softened? (a script invoked twice, once hard,
// counts as hard). --self-test invocations are skipped: they verify logic, they do not enforce.
function invocationSeverity(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const m = line.match(/scripts\/([\w.-]+\.mjs)(.*)$/);
    if (!m) continue;
    const script = m[1];
    const rest = m[2] || '';
    if (rest.includes('--self-test')) continue;
    const soft = SOFTENING_FLAGS.some(fl => rest.includes(fl));
    const prev = out.get(script);
    out.set(script, prev === undefined ? soft : prev && soft);
  }
  return out;
}

/**
 * Scripts that are SOFT locally but HARD in CI. Pure — takes the concatenated text of the
 * git hooks and of the workflows.
 */
export function findSeverityMismatches(hooksText = '', workflowsText = '') {
  const local = invocationSeverity(hooksText);
  const ci = invocationSeverity(workflowsText);
  const out = [];
  for (const [script, localSoft] of local) {
    if (!ci.has(script)) continue;          // not a shared checker — nothing to compare
    if (localSoft && !ci.get(script)) out.push(script);
  }
  return out.sort();
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
    // verifyPreToolUse — the 2026-07-12 gate-bypass incident: hook logic fine, routing absent
    // stop-layer-derived (2026-W31-R8)
    ['Stop-гейты выводятся из живого конфига, а не из списка',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node ~/.claude/hooks/browser-verify-gate.mjs' }] }] } })).gates.length === 1],
    ['у выведенного гейта правильный слой',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node x/proof-of-work-gate.mjs' }] }] } })).gates[0].layer === 'Stop'],
    ['записыватель состояния не считается гейтом',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node x/session-state.mjs Stop' }] }] } })).gates.length === 0],
    ['не-mjs команда (звук) игнорируется',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'afplay done.wav' }] }] } })).gates.length === 0],
    ['дубль одного хука в двух группах не удваивает карту',
      stopGatesFrom(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'a/x-gate.mjs' }] }, { hooks: [{ command: 'b/x-gate.mjs' }] }] } })).gates.length === 1],
    ['отсутствие Stop-секции это не проверено, а не пусто', stopGatesFrom(JSON.stringify({ hooks: {} })).checked === false],
    ['битый конфиг не роняет аудит', stopGatesFrom('{не json').checked === false],
    ['fully-routed PreToolUse config → no missing', verifyPreToolUse(JSON.stringify({ hooks: { PreToolUse: [
      { matcher: 'Bash', hooks: [{ command: 'jidoka-guard.sh' }, { command: 'node policy-enforce-hook.mjs' }] },
      { matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [{ command: 'node policy-enforce-hook.mjs' }] },
    ] } })).missing.length === 0],
    ['policy-enforce-hook absent from Bash matcher is caught (2026-07-12 incident)', verifyPreToolUse(JSON.stringify({ hooks: { PreToolUse: [
      { matcher: 'Bash', hooks: [{ command: 'jidoka-guard.sh' }] },
      { matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [{ command: 'node policy-enforce-hook.mjs' }] },
    ] } })).missing.some(m => m.includes('policy-enforce-hook not routed for Bash'))],
    ['a "*" matcher counts as routing every tool', verifyPreToolUse(JSON.stringify({ hooks: { PreToolUse: [
      { matcher: '*', hooks: [{ command: 'node policy-enforce-hook.mjs' }, { command: 'jidoka-guard.sh' }] },
    ] } })).missing.length === 0],
    ['malformed settings → checked:false, not a crash or a false alarm', verifyPreToolUse('{oops').checked === false],
    // findSeverityMismatches — the 2026-07-29 red-main incident: soft locally, hard in CI
    ['soft locally + hard in CI is caught (the exact incident shape)',
      findSeverityMismatches(
        'out=$(node "$ROOT/scripts/instantiation-audit.mjs" --warn 2>&1)',
        '      - run: node scripts/instantiation-audit.mjs',
      ).join() === 'instantiation-audit.mjs'],
    ['same severity both sides → clean',
      findSeverityMismatches('node "$ROOT/scripts/instantiation-audit.mjs"', '- run: node scripts/instantiation-audit.mjs').length === 0],
    ['stricter locally than CI is allowed, not flagged',
      findSeverityMismatches('node "$ROOT/scripts/x.mjs"', '- run: node scripts/x.mjs --warn').length === 0],
    ['a checker CI does not run at all is not a mismatch',
      findSeverityMismatches('node "$ROOT/scripts/local-only.mjs" --warn', '- run: node scripts/other.mjs').length === 0],
    ['--self-test invocations are ignored (logic check, not enforcement)',
      findSeverityMismatches('node "$ROOT/scripts/y.mjs" --warn', '- run: node scripts/y.mjs --self-test').length === 0],
    ['a second HARD local invocation clears the softened one',
      findSeverityMismatches('node "$ROOT/scripts/z.mjs" --warn\nnode "$ROOT/scripts/z.mjs"', '- run: node scripts/z.mjs').length === 0],
    ['empty inputs → no findings, no crash', findSeverityMismatches('', '').length === 0],
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
  // stop-layer-derived: the Stop gates come from the live hook config, never from a typed list.
  let settingsRaw = '';
  try { settingsRaw = readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'); } catch { /* no global config */ }
  const stop = stopGatesFrom(settingsRaw);
  const ALL = [...GATES, ...stop.gates];
  const byLayer = {};
  for (const g of ALL) (byLayer[g.layer] ??= []).push(g);
  console.log('gate-audit — map of all gates by enforcement layer\n');
  for (const [layer, gs] of Object.entries(byLayer)) {
    console.log(`  ${layer}:`);
    for (const g of gs) {
      const c = ci.find(c => c.id === g.id);
      const mark = g.layer === 'CI' ? (!c?.present ? '🔴 GHOST' : c.selfTestOnly ? '🟡 self-test-only' : '🟢') : (g.mode === 'soft' ? '🟡 soft' : g.mode === 'measured' ? '📊' : '🟢');
      console.log(`    ${mark} ${g.id} (${g.mode})`);
    }
  }
  const soft = ALL.filter(g => g.mode === 'soft').length;
  console.log(`\n  ${ALL.length} gates · ${ALL.filter(g => g.layer === 'CI').length} in CI · ${soft} soft-trial · ${ALL.filter(g => g.mode === 'measured').length} measured-LLM`);
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
  // severity parity: a checker that is soft locally and hard in CI guarantees a red server
  const mismatches = findSeverityMismatches(hooksText, wf);
  if (mismatches.length) {
    console.error(`\n\x1b[31m✗ ${mismatches.length} checker(s) SOFT in .githooks but HARD in CI: ${mismatches.join(', ')}\x1b[0m`);
    console.error('    Every commit passes locally and fails on the server. Match the severities');
    console.error('    (drop the softening flag locally, or soften CI deliberately and say why).');
    process.exit(1);
  }
  console.log('  \x1b[32m✓ no checker is softer locally than in CI (severity parity).\x1b[0m');
  // PreToolUse routing check: only meaningful on a machine with a global hook config (skipped in CI)
  const settingsPath = join(process.env.HOME || '', '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    const ptu = verifyPreToolUse(readFileSync(settingsPath, 'utf8'));
    if (ptu.checked && ptu.missing.length) {
      console.error(`\n\x1b[31m✗ PreToolUse gate(s) built but NOT ROUTED in ~/.claude/settings.json:\x1b[0m`);
      for (const m of ptu.missing) console.error(`    ${m}`);
      process.exit(1);
    }
    console.log('  \x1b[32m✓ PreToolUse hooks are routed for Write/Edit AND Bash (no unwired side-channel).\x1b[0m');
  } else {
    console.log('  \x1b[33mℹ no ~/.claude/settings.json here (CI) — PreToolUse routing not checkable, skipped honestly.\x1b[0m');
  }
  process.exit(0);
}
