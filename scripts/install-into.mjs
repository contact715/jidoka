#!/usr/bin/env node
// install-into.mjs <target-repo> [--frontend] — install the portable jidoka core
// (self-learning engine + secret guard) into another project.
//
// SAFE BY DESIGN — the whole point of this framework is "mechanisms, not declarations",
// so the installer refuses to do anything that could leak a secret:
//   1. Copies the zero-dep engine into <target>/.jidoka/ (self-contained, no symlinks).
//   2. Scans <target> for secret-shaped files; ensures .gitignore covers them BEFORE
//      any git wiring. If a secret is not ignored, it adds the rule and reports it.
//   3. Installs .githooks (pre-commit + pre-push) and sets core.hooksPath — ONLY if the
//      target is already a git repo. Never runs `git init`, `git add`, or `git commit`.
//   4. Wires npm scripts if package.json exists; otherwise prints manual run commands.
//   5. Seeds docs/audits/meta-mistakes.jsonl (empty ledger) so the engine has a home.
//
// Usage: node scripts/install-into.mjs /path/to/target [--frontend] [--profile=core|standard|full]
//   --frontend            also note the React/TS structural gate (manual baseline step printed)
//   --profile=core        kernel only (meta-engine + honesty + sandbox + run-state) — smallest, still honest
//   --profile=standard    (default) kernel + everyday gates (northstar/charter/coverage/dep/exec/…)
//   --profile=full        everything in CORE (adds debate/graduation/trace/code-map/approval)
//   --self-test           verify profile resolution (kernel-in-every-profile invariant)

import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { detectNativeFramework, nativeSignals, auditInstall } from './footprint-audit.mjs';

const HERE = dirname(dirname(fileURLToPath(import.meta.url))); // framework root

// ── Profiles — proportional-by-default (GSD borrow C) ─────────────────────────
// KERNEL = the non-negotiable learning / honesty / safety core. It ships in EVERY
// profile; no "lightness" tier may drop it (a lighter jidoka that forgets is just
// GSD with more files). standard = kernel + everyday gates; full = everything.
export const KERNEL = [
  'meta-lib.mjs', 'meta-remedies.mjs', 'meta-audit.mjs', 'meta-honesty.mjs', 'meta-trend.mjs',
  'meta-premortem.mjs', 'meta-log.mjs', 'proof-gate.mjs', 'pre-publish-guard.mjs',
  'sandbox-run.mjs', 'run-state.mjs',
  // run-state derives phases from the planner, which routes debate via debate-trigger — both must be
  // in the kernel so even --profile=core is import-closed (no run-state without its planner).
  'orchestration-planner.mjs', 'debate-trigger.mjs', 'adaptive-verify.mjs',
];
const COMMON = [ // standard adds the everyday gates
  'northstar-check.mjs', 'charter-check.mjs', 'kaizen-loop.mjs', 'spec-drift-check.mjs',
  // spec-first read gate (ported from the Mosco build, genericized): read the controlling spec
  // before product code. get-spec-context (canonical, now logs its runs) + the gate that reads
  // that log. Leaf scripts (node builtins only) → import-closure stays green.
  'get-spec-context.mjs', 'spec-first-gate.mjs',
  'execution-gate.mjs', 'coverage-gate.mjs', 'dependency-audit.mjs', 'gate-audit.mjs',
  'parallel-guard.mjs',
  // product-grade gates built this session (precision-guard + resource-guard battle-tested on Mosco).
  // deps are closed: plan-check→orchestration-planner (KERNEL), model-router→model-tier, skill-selector→skill-coverage.
  'spec-size-check.mjs', 'plan-check.mjs', 'resource-guard.mjs', 'precision-guard.mjs',
  'cross-layer-dup.mjs', 'dead-code.mjs', 'type-coverage.mjs', 'contract-check.mjs',
  'cost-ledger.mjs', 'model-tier.mjs', 'model-router.mjs', 'skill-coverage.mjs',
  'skill-selector.mjs', 'trend-scan.mjs', 'spec-tldr.mjs',
  // the rest of orchestration-planner's PHASE_GATES battery (gate/launch/debug/memory phases). The planner
  // lives in KERNEL and NAMES these; standard+ must ship them or a real wave references a script that
  // isn't there. Caught on the real Mosco full install: planner --self-test failed anti-ghost because
  // these 8 weren't copied. All are leaf scripts (no relative imports) → closure stays green.
  'mutation-test.mjs', 'property-test.mjs', 'load-test-gate.mjs', 'e2e-run-gate.mjs',
  'verify-goal-backward.mjs', 'canary-gate.mjs', 'req-trace.mjs', 'prod-harvest.mjs',
];
const HEAVY = [ // full adds the deeper adversarial / analysis tools
  'gate-graduation.mjs', 'debate-engine.mjs', 'agent-trace.mjs', 'code-map.mjs', 'approval-queue.mjs',
];
export const CORE = [...KERNEL, ...COMMON, ...HEAVY];
export const PROFILES = { core: KERNEL, standard: [...KERNEL, ...COMMON], full: CORE };
export function resolveProfile(name = 'standard') {
  if (!PROFILES[name]) throw new Error(`unknown profile: ${name} (use core|standard|full)`);
  return [...new Set(PROFILES[name])];
}

function profileSelfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('core profile = kernel only', resolveProfile('core').length === KERNEL.length);
  ok('standard contains all of core + more', KERNEL.every(k => resolveProfile('standard').includes(k)) && resolveProfile('standard').length > KERNEL.length);
  ok('full contains all of standard + more', resolveProfile('standard').every(s => resolveProfile('full').includes(s)) && resolveProfile('full').length > resolveProfile('standard').length);
  ok('KERNEL present in EVERY profile (moat protected)', ['core', 'standard', 'full'].every(p => KERNEL.every(k => resolveProfile(p).includes(k))));
  ok('full == CORE (full install drops nothing)', resolveProfile('full').length === CORE.length);
  ok('every profile script exists on disk', ['core', 'standard', 'full'].every(p => resolveProfile(p).every(s => existsSync(join(HERE, 'scripts', s)))));
  // import-closure: a profile must contain the relative deps of every script it ships, or the install
  // breaks on a missing import. (This is the check that the run-state→planner gap in wave-1 lacked.)
  const closure = (prof) => {
    const set = new Set(resolveProfile(prof));
    for (const f of set) {
      for (const m of readFileSync(join(HERE, 'scripts', f), 'utf8').matchAll(/from '\.\/([\w-]+\.mjs)'/g)) {
        if (!set.has(m[1])) return { ok: false, f, missing: m[1] };
      }
    }
    return { ok: true };
  };
  ok('core profile is import-closed', closure('core').ok);
  ok('standard profile is import-closed', closure('standard').ok);
  ok('full profile is import-closed', closure('full').ok);
  ok('unknown profile throws', (() => { try { resolveProfile('nope'); return false; } catch { return true; } })());
  if (fails.length) { console.log(`\n\x1b[31minstall-into profile self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ install-into: profile resolution correct (kernel always shipped, full == CORE)\x1b[0m');
  process.exit(0);
}

if (process.argv.includes('--self-test')) profileSelfTest();

const target = process.argv.slice(2).find(a => !a.startsWith('--'));
const isFrontend = process.argv.includes('--frontend');
const profile = (process.argv.find(a => a.startsWith('--profile=')) || '--profile=standard').split('=')[1];

if (!target || !existsSync(target)) {
  console.error('usage: node scripts/install-into.mjs <existing-target-dir> [--frontend] [--profile=core|standard|full]  (or --self-test)');
  process.exit(2);
}
const T = s => join(target, s);
const log = m => console.log(m);
const isGit = (() => { try { execSync('git rev-parse --is-inside-work-tree', { cwd: target, stdio: 'ignore' }); return true; } catch { return false; } })();

log(`\n\x1b[1minstall-into:\x1b[0m ${target}  (git: ${isGit ? 'yes' : 'NO'}, frontend: ${isFrontend})\n`);

// ── 0. Pre-install survey (necessity check) ──────────────────────────────────
// Before copying ANYTHING, ask the question that was missing when this whole thing was built: does the
// target ALREADY have its own equivalent framework? If yes, a blind full install just duplicates it
// (the Mosco incident: 51 scripts copied next to Mosco's own native framework, 45 went dead). Warn and
// recommend the minimal profile — do not silently full-install over an existing framework.
const preNative = detectNativeFramework(nativeSignals(target));
if (preNative.hasOwn && profile !== 'core') {
  log(`  \x1b[33m⚠ target already has its own framework\x1b[0m (${preNative.signals.join(', ')}).`);
  log(`    A '${profile}' install will copy gates this target likely already runs → dead duplication.`);
  log(`    Recommended: --profile=core (kernel only), or install ONLY the specific gates it lacks and wire them.`);
  log(`    Proceeding with '${profile}' as requested — the post-install footprint audit below will show what went dead.\n`);
}

// ── 1. Copy the portable core (proportional: --profile=core|standard|full) ────
// Self-learning engine + secret guard. NOT instantiation-audit (framework-self-specific).
const scripts = resolveProfile(profile);
mkdirSync(T('.jidoka/scripts'), { recursive: true });
mkdirSync(T('.jidoka/lib/redaction'), { recursive: true });
for (const f of scripts) copyFileSync(join(HERE, 'scripts', f), T(`.jidoka/scripts/${f}`));
copyFileSync(join(HERE, 'lib/redaction/redact-pii.mjs'), T('.jidoka/lib/redaction/redact-pii.mjs'));
log(`  ✓ profile '${profile}': copied ${scripts.length} engine scripts + redact-pii → .jidoka/  (kernel always included)`);

// meta-remedies references mechanism paths as "scripts/..." — rewrite to ".jidoka/scripts/..."
// so meta-audit's broken-gate check resolves them in the target layout.
const remPath = T('.jidoka/scripts/meta-remedies.mjs');
writeFileSync(remPath, readFileSync(remPath, 'utf8').replaceAll("'scripts/", "'.jidoka/scripts/"));
log('  ✓ adapted meta-remedies mechanism paths to .jidoka/scripts/');

// ── 2. SECURITY FIRST — ensure .gitignore covers secrets BEFORE any git wiring ─
const SECRET_RULES = ['.secrets.json', '.credentials/', '.env', '.env.local', '.env*.local', '*.key', '**/google_tokens.json', '.jidoka/**/*-events.jsonl', '.jidoka/**/*-trips.jsonl'];
const giPath = T('.gitignore');
const gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
const missing = SECRET_RULES.filter(r => !gi.split('\n').some(l => l.trim() === r));
if (missing.length) {
  appendFileSync(giPath, `\n# jidoka: secret/state guards (added by install-into)\n${missing.join('\n')}\n`);
  log(`  \x1b[33m✓ added ${missing.length} secret rule(s) to .gitignore (were missing)\x1b[0m`);
} else {
  log('  ✓ .gitignore already covers secrets');
}
// Hard safety check: are any secret files currently tracked / not ignored?
if (isGit) {
  let exposed = [];
  for (const f of ['.secrets.json', '.env', '.env.local', '.credentials/google_tokens.json']) {
    if (!existsSync(T(f))) continue;
    try { execSync(`git check-ignore ${JSON.stringify(f)}`, { cwd: target, stdio: 'ignore' }); }
    catch { exposed.push(f); } // check-ignore exits 1 = NOT ignored
  }
  if (exposed.length) log(`  \x1b[31m‼ WARNING: these secret files are NOT git-ignored: ${exposed.join(', ')} — fix before committing\x1b[0m`);
}

// ── 3. Seed the ledger home ──────────────────────────────────────────────────
mkdirSync(T('docs/audits'), { recursive: true });
if (!existsSync(T('docs/audits/meta-mistakes.jsonl'))) writeFileSync(T('docs/audits/meta-mistakes.jsonl'), '');
log('  ✓ seeded docs/audits/meta-mistakes.jsonl (empty ledger)');

// ── 3a. Seed .sdd-config.json so the spec-drift gate has its soft/hard switch ──
// Soft by default (warn, never blocks) — graduation to hardBlockEnabled is a human
// decision after the trial (K8s admission-webhook warn→enforce pattern).
if (!existsSync(T('.sdd-config.json'))) {
  writeFileSync(T('.sdd-config.json'), JSON.stringify({
    _comment: 'jidoka gate config. Flip driftDetection.hardBlockEnabled to true after a soft trial to block on spec→missing-file drift.',
    driftDetection: { enabled: true, hardBlockEnabled: false, specPaths: ['docs'] },
  }, null, 2) + '\n');
  log('  ✓ seeded .sdd-config.json (spec-drift gate: soft/warn — set specPaths to your spec dirs, flip hardBlockEnabled after trial)');
} else {
  log('  • .sdd-config.json exists — left as is (add a driftDetection block if missing)');
}

// ── 3b. Federation: project-steward (guardian) + North Star/Charter templates ──
mkdirSync(T('.claude/agents'), { recursive: true });
if (!existsSync(T('.claude/agents/project-steward.md'))) copyFileSync(join(HERE, '.claude/agents/project-steward.md'), T('.claude/agents/project-steward.md'));
if (!existsSync(T('.claude/agents/spec-custodian.md'))) copyFileSync(join(HERE, '.claude/agents/spec-custodian.md'), T('.claude/agents/spec-custodian.md'));
for (const tpl of ['NORTH_STAR_TEMPLATE.md', 'PROJECT_CHARTER_TEMPLATE.md']) {
  if (existsSync(join(HERE, 'docs', tpl)) && !existsSync(T('docs/' + tpl))) copyFileSync(join(HERE, 'docs', tpl), T('docs/' + tpl));
}
log('  ✓ federation: project-steward + North Star/Charter templates → project (steward fills them)');

// ── 4. Install hooks (only if git, and only if not clobbering existing hooks) ──
const existingHooksPath = (() => { try { return execSync('git config core.hooksPath', { cwd: target, encoding: 'utf8' }).trim(); } catch { return ''; } })();
const hasHusky = existsSync(T('.husky'));
if (!isGit) {
  log('  \x1b[33m• not a git repo → hooks skipped. Run `git init` (after checking .gitignore) then re-run to wire hooks.\x1b[0m');
} else if (hasHusky || existingHooksPath) {
  // The target already manages hooks (husky or a custom hooksPath). Overriding would
  // SILENTLY DISABLE the project's own dev-flow — refuse and print the integration steps.
  log(`  \x1b[33m• target already has hooks (${hasHusky ? '.husky' : 'core.hooksPath=' + existingHooksPath}) — NOT overriding (would disable them).`);
  log('    Integrate by adding to the existing pre-commit hook:');
  log('      node "$(git rev-parse --show-toplevel)/.jidoka/scripts/meta-honesty.mjs" || exit 1');
  log('      node "$(git rev-parse --show-toplevel)/.jidoka/scripts/meta-audit.mjs"   || exit 1');
  log('    and to pre-push: node "$(git rev-parse --show-toplevel)/.jidoka/scripts/pre-publish-guard.mjs" || exit 1');
  log('    and (if docs/NORTH_STAR.md exists): node "$(git rev-parse --show-toplevel)/.jidoka/scripts/northstar-check.mjs" --doc docs/NORTH_STAR.md || exit 1');
  log('    and (if docs/PROJECT_CHARTER.md exists): node "$(git rev-parse --show-toplevel)/.jidoka/scripts/charter-check.mjs" --doc docs/PROJECT_CHARTER.md || exit 1');
  log('    and (spec-drift gate, soft until .sdd-config driftDetection.hardBlockEnabled=true): node "$(git rev-parse --show-toplevel)/.jidoka/scripts/spec-drift-check.mjs" --root "$(git rev-parse --show-toplevel)" || exit 1\x1b[0m');
} else {
  mkdirSync(T('.githooks'), { recursive: true });
  const preCommit = `#!/bin/sh
# jidoka pre-commit — signal honesty + recurrence/regression gate (both pass on empty ledger).
ROOT="$(git rev-parse --show-toplevel)"
node "$ROOT/.jidoka/scripts/meta-honesty.mjs" || exit 1
node "$ROOT/.jidoka/scripts/meta-audit.mjs"   || exit 1
node "$ROOT/.jidoka/scripts/spec-drift-check.mjs" --root "$ROOT" || exit 1
# spec-first read gate (soft/warn by default; add --block to enforce after a trial)
node "$ROOT/.jidoka/scripts/spec-first-gate.mjs" --staged || true
exit 0
`;
  const prePush = `#!/bin/sh
# jidoka pre-push — secret/PII guard + North Star completeness (only if the product has one).
ROOT="$(git rev-parse --show-toplevel)"
node "$ROOT/.jidoka/scripts/pre-publish-guard.mjs" || exit 1
if [ -f "$ROOT/docs/NORTH_STAR.md" ]; then
  node "$ROOT/.jidoka/scripts/northstar-check.mjs" --doc "$ROOT/docs/NORTH_STAR.md" || exit 1
else
  echo "  ○ no docs/NORTH_STAR.md yet — the CPO owns it; create one so features can be checked against the goal"
fi
if [ -f "$ROOT/docs/PROJECT_CHARTER.md" ]; then
  node "$ROOT/.jidoka/scripts/charter-check.mjs" --doc "$ROOT/docs/PROJECT_CHARTER.md" || exit 1
else
  echo "  ○ no docs/PROJECT_CHARTER.md yet — the project-steward owns it; create one to defend integrity"
fi
exit 0
`;
  writeFileSync(T('.githooks/pre-commit'), preCommit); chmodSync(T('.githooks/pre-commit'), 0o755);
  writeFileSync(T('.githooks/pre-push'), prePush); chmodSync(T('.githooks/pre-push'), 0o755);
  execSync('git config core.hooksPath .githooks', { cwd: target });
  log('  ✓ installed .githooks (pre-commit, pre-push) + set core.hooksPath');
}

// ── 5. Wire npm scripts if package.json exists ───────────────────────────────
if (existsSync(T('package.json'))) {
  const pkgRaw = readFileSync(T('package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  pkg.scripts ||= {};
  const add = {
    'jidoka:audit': 'node .jidoka/scripts/meta-audit.mjs',
    'jidoka:honesty': 'node .jidoka/scripts/meta-honesty.mjs',
    'jidoka:trend': 'node .jidoka/scripts/meta-trend.mjs',
    'jidoka:log': 'node .jidoka/scripts/meta-log.mjs',
    'jidoka:premortem': 'node .jidoka/scripts/meta-premortem.mjs',
    'jidoka:guard': 'node .jidoka/scripts/pre-publish-guard.mjs',
  };
  let added = 0;
  for (const [k, v] of Object.entries(add)) if (!pkg.scripts[k]) { pkg.scripts[k] = v; added++; }
  if (added) {
    // PRESERVE the target's existing indentation (tab vs N spaces) instead of forcing 2-space. Forcing
    // it reformats the whole file → a 300-line whitespace diff on a shared file (the real noise hit on
    // the Mosco install, fixed by hand). Detect the first indented line; reuse its indent. Only rewrite
    // when something was actually added, so a re-run is a true no-op (idempotent, zero churn).
    const m = pkgRaw.match(/\n([\t ]+)\S/);
    const indent = m ? (m[1].includes('\t') ? '\t' : m[1].length) : 2;
    writeFileSync(T('package.json'), JSON.stringify(pkg, null, indent) + (pkgRaw.endsWith('\n') ? '\n' : ''));
    log(`  ✓ wired ${added} npm script(s) (indent preserved): npm run jidoka:audit / honesty / trend / log / premortem / guard`);
  } else {
    log('  ✓ npm scripts already wired (jidoka:*) — package.json untouched (idempotent)');
  }
} else {
  log('  • no package.json → run engines directly: node .jidoka/scripts/meta-audit.mjs');
}

// ── 6. Report ────────────────────────────────────────────────────────────────
log(`\n\x1b[32m✓ jidoka core installed into ${target}\x1b[0m`);
log('  Next: log a mistake → `node .jidoka/scripts/meta-log.mjs <class> "<claimed>" "<real>" <caught_by>`');
log('        then `node .jidoka/scripts/meta-audit.mjs` to see the closed loop.');
if (isFrontend) log('  Frontend: structural gate not auto-installed (needs a baseline) — port scripts/check-structural.sh manually if wanted.');

// ── 7. Footprint audit (self-policing) — did this install land on something LIVE? ─────────────
// The mirror of instantiation-audit, for the install direction. An installed file with no caller is
// dead-on-arrival; if the target already has its own framework, this whole install is duplication.
// This is the gate that would have caught Mosco (45 dead of 51) AT INSTALL TIME instead of months later.
const fp = auditInstall(target);
log(`\n\x1b[1m▌ footprint audit\x1b[0m — ${fp.wired.length}/${fp.installed.length} installed scripts reach a live trigger (hook/CI/npm)`);
if (fp.verdict.level === 'OK') {
  log('  \x1b[32m✓ no dead duplication — installed gates are reachable\x1b[0m');
} else {
  log(`  \x1b[33m▌ ${fp.verdict.level}\x1b[0m — ${fp.verdict.msg}`);
  log(`  \x1b[33m${fp.dead.length} script(s) have no caller in this target (${Math.round(fp.deadRatio * 100)}% dead-on-arrival).\x1b[0m`);
  log(`  Re-audit anytime: node ${join(HERE, 'scripts', 'footprint-audit.mjs')} --target ${target}`);
}
process.exit(0);
