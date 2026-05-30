#!/usr/bin/env node
// instantiation-audit — does the framework's scaffolding point at things that exist?
//
// A holistic audit of this repo found a systemic pattern: validators, gates, and
// docs are written and described as working, but the OBJECTS they act on don't
// exist on disk, the automation they claim isn't mounted, and the counts they
// publish have drifted. That is declaration-over-implementation at framework
// scale — the exact class meta-audit gates for one ledger entry. This makes it a
// mechanism: it scans the whole system and fails when a claim has no instance.
//
// It does the opposite of trusting the scaffolding: a written validator proves
// nothing if its input is a ghost. Three classes, each detected a reliable way:
//
//   Class 1 — ghost automation : docs/scripts cite .github/workflows/* or .husky/*
//                                 that are not on disk → the automatic gate is imaginary
//   Class 2 — doc-count drift   : README publishes agent/skill/script counts that no
//                                 longer match reality → docs have silently rotted
//   Class 3 — registry ghosts   : a curated manifest of critical INPUT objects that
//                                 validators require but that are absent → the gate
//                                 throws ENOENT instead of guarding anything
//
// Class 3 is a curated manifest, NOT a full auto-scan — boundary stated explicitly
// so this does not read as exhaustive coverage (the scope-narrowed-silently gate).
// Output objects (telemetry .jsonl streams, baselines) are deliberately excluded:
// they are lazily created and their absence is normal, not a ghost.
//
// Usage:
//   node scripts/instantiation-audit.mjs          exit 1 if any ghost (hard gate)
//   node scripts/instantiation-audit.mjs --warn    report + exit 0 (soft trial, for CI onboarding)
//
// The --warn mode follows the framework's own soft→hard gate doctrine: observe and
// report while the known ghosts are being filled, then drop --warn to make it block.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve as resolvePath, relative } from 'node:path';

const warnOnly = process.argv.includes('--warn');

// Count functional files only — exclude scaffolding (_TEMPLATE, _INDEX, README) so a
// "28 agent roles" doc claim matches reality instead of counting the template as a role.
const count = (dir, ext = '.md') => { try { return readdirSync(dir).filter(f => f.endsWith(ext) && !/^_|^README/i.test(f)).length; } catch { return 0; } };
// Exclude this file from every scan: it contains the detection patterns/manifest
// literally, so git grep would otherwise flag the detector's own regex as a ghost
// (the declaration-over-implementation false positive a self-scanner must guard).
const SELF = "':(exclude)scripts/instantiation-audit.mjs'";
const grepLines = re => { try { return execSync(`git grep -hoE ${JSON.stringify(re)} -- docs scripts package.json README.md ${SELF} 2>/dev/null || true`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };
const refCount = needle => { try { return execSync(`git grep -lF ${JSON.stringify(needle)} -- scripts ${SELF} 2>/dev/null | wc -l`, { encoding: 'utf8' }).trim(); } catch { return '0'; } };
const refFile = needle => { try { return execSync(`git grep -lF ${JSON.stringify(needle)} -- docs scripts ${SELF} 2>/dev/null | head -1`, { encoding: 'utf8' }).trim(); } catch { return ''; } };
// A registry whose validator honest-skips (prints DORMANT, exit 0) when the object
// is absent is NOT a hidden ghost — it's a dormant gate awaiting seed. Distinguish
// them by checking whether ANY script referencing the object honest-skips on it.
const honestSkips = needle => { try {
  return execSync(`git grep -lF ${JSON.stringify(needle)} -- scripts ${SELF} 2>/dev/null`, { encoding: 'utf8' })
    .split('\n').filter(Boolean).some(f => { try { return readFileSync(f, 'utf8').includes('DORMANT'); } catch { return false; } });
} catch { return false; } };

let ghosts = 0, dormant = 0;

// ── Class 1 — ghost automation ────────────────────────────────────────────────
console.log('\x1b[1m▌ Class 1 — ghost automation (declared in docs/code, not on disk)\x1b[0m');
const autoRefs = [...new Set(
  grepLines('\\.(github/workflows/[A-Za-z0-9_.-]+\\.ya?ml|husky/[A-Za-z0-9_.-]+|githooks/[A-Za-z0-9_.-]+)')
    .map(r => r.replace(/[.\s]+$/, ''))                          // strip trailing prose dots/space
    .filter(r => /workflows\/.+\.ya?ml$|(?:husky|githooks)\/[A-Za-z0-9_-]+$/.test(r)) // real file name, not "..."
)];
let c1 = 0;
for (const ref of autoRefs) {
  if (existsSync(ref)) continue;
  c1++; ghosts++;
  console.log(`  \x1b[31m👻 ${ref}\x1b[0m — cited in ${refFile(ref) || '(docs)'} but not on disk`);
}
if (c1 === 0) console.log('  \x1b[32m✓ every cited workflow/hook exists\x1b[0m');

// ── Class 2 — doc-count drift ─────────────────────────────────────────────────
console.log('\n\x1b[1m▌ Class 2 — doc-count drift (README claims vs reality)\x1b[0m');
const readme = existsSync('README.md') ? readFileSync('README.md', 'utf8') : '';
const real = { agent: count('.claude/agents'), skill: count('.claude/skills'), script: count('scripts', '.mjs') + count('scripts', '.sh') };
const labels = { agent: /(\d+)(\+?)\s*(?:агент|agent)/i, skill: /(\d+)(\+?)\s*(?:навык|skill)/i, script: /(\d+)(\+?)\s*(?:скрипт|script)/i };
let c2 = 0;
for (const [key, re] of Object.entries(labels)) {
  const m = readme.match(re);
  if (!m) continue;
  const claimed = +m[1], plus = m[2] === '+', actual = real[key];
  const drifted = plus ? actual < claimed : actual !== claimed;
  if (drifted) { c2++; ghosts++; console.log(`  \x1b[31m👻 ${key}s: README says ${claimed}${plus ? '+' : ''}, real ${actual}\x1b[0m`); }
}
if (c2 === 0) console.log('  \x1b[32m✓ README counts match reality (or make no claim)\x1b[0m');

// ── Class 3 — registry ghosts (curated manifest of required INPUT objects) ─────
console.log('\n\x1b[1m▌ Class 3 — registry ghosts (validators whose required object is absent)\x1b[0m');
const MANIFEST = [
  ['docs/evals',                              'golden datasets for run-evals.mjs (agent quality regression)'],
  ['docs/security/dr-scenario-catalog.json',  'DR catalog required by validate-dr-catalog.mjs'],
  ['docs/security/api-contract-registry.json','API surface required by validate-contract.mjs', 'product'],
  ['docs/governance/agent-access-registry.json','tool grants required by validate-agent-access.mjs'],
  ['docs/governance/raci.json',               'RACI matrix required by validate-raci.mjs'],
  ['docs/quality/slo-definitions.json',       'SLO definitions required by compute-slos.mjs'],
  ['docs/quality/dora-definitions.json',      'DORA definitions required by compute-dora.mjs'],
  ['docs/specs/_LINEAGE.json',                'spec lineage required by query-graph.mjs'],
];
let c3 = 0, naCount = 0;
for (const [path, note, scope] of MANIFEST) {
  if (existsSync(path)) continue;
  const base = path.split('/').pop();
  if (refCount(base) === '0') continue; // nothing references it → not a live expectation
  if (scope === 'product') {
    naCount++;
    console.log(`  \x1b[2m○ ${path}\x1b[0m — ${note}; N/A: this repo exposes no HTTP API (product-repo gate, not a framework gap)`);
    continue;
  }
  if (honestSkips(base)) {
    dormant++;
    console.log(`  \x1b[36m⊘ ${path}\x1b[0m — ${note}; absent, but validator honest-skips (DORMANT, not a hidden crash)`);
    continue;
  }
  c3++; ghosts++;
  console.log(`  \x1b[31m👻 ${path}\x1b[0m — ${note}; absent AND validator crashes (hidden ghost)`);
}
if (c3 === 0 && dormant === 0 && naCount === 0) console.log('  \x1b[32m✓ every manifest registry is present\x1b[0m');
else if (c3 === 0) console.log(`  \x1b[36m${dormant} dormant (awaiting seed)\x1b[0m\x1b[2m, ${naCount} n/a (product-repo gate) — none blocking\x1b[0m`);
console.log(`  \x1b[2m(Class 3 checks a curated manifest of ${MANIFEST.length} critical registries, not a full auto-scan.)\x1b[0m`);

// ── Class 4 — broken imports (a script imports a relative module not on disk) ──
console.log('\n\x1b[1m▌ Class 4 — broken imports (script imports a module not on disk)\x1b[0m');
let c4 = 0;
const importLines = (() => { try { return execSync(`git grep -noE "from '[^']+\\.mjs'" -- scripts ${SELF} 2>/dev/null || true`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } })();
const seenImports = new Set();
for (const line of importLines) {
  const m = line.match(/^(scripts\/[^:]+):\d+:from '([^']+\.mjs)'$/);
  if (!m) continue;
  const [, srcFile, imp] = m;
  if (!imp.startsWith('.')) continue; // only relative imports resolve to a file on disk
  const target = relative('.', resolvePath(dirname(srcFile), imp));
  if (existsSync(target) || seenImports.has(target)) continue;
  seenImports.add(target);
  c4++; ghosts++;
  console.log(`  \x1b[31m👻 ${target}\x1b[0m — imported by ${srcFile} but not on disk (ERR_MODULE_NOT_FOUND at load)`);
}
if (c4 === 0) console.log('  \x1b[32m✓ every relative .mjs import resolves\x1b[0m');

// ── verdict ───────────────────────────────────────────────────────────────────
console.log(`\n\x1b[1m— instantiation-audit summary —\x1b[0m`);
console.log(`  ghosts: ${ghosts}  (class1 automation: ${c1}, class2 doc-drift: ${c2}, class3 registries: ${c3}, class4 imports: ${c4})`);
if (dormant > 0 || naCount > 0) console.log(`  \x1b[36mdormant: ${dormant}\x1b[0m\x1b[2m, n/a (product-scope): ${naCount} — neither is a ghost\x1b[0m`);
if (ghosts > 0) {
  console.log(`\n\x1b[31m${ghosts} ghost(s). The scaffolding is real; the objects are not. This is`);
  console.log(`declaration-over-implementation at framework scale — fill the object or delete the claim.\x1b[0m`);
  if (warnOnly) { console.log('\x1b[2m(--warn: soft trial, exiting 0)\x1b[0m'); process.exit(0); }
  process.exit(1);
}
console.log('\n\x1b[32m✓ every declared mechanism points at something that exists.\x1b[0m');
process.exit(0);
