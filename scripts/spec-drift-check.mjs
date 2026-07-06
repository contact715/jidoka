#!/usr/bin/env node
// spec-drift-check — portable, zero-dep gate: does a spec still match reality on disk?
//
// WHY THIS EXISTS (the live case it was born from): a master blueprint said "P3 BUILT"
// while a new wave was mid-flight, and specs referenced modules by name — nothing
// mechanically checked that the references still pointed at real files. A spec that
// lies about the tree is the cheapest, most common drift, and it is fully checkable.
//
// RELATION TO detect-drift.mjs (NOT a duplicate): detect-drift.mjs is the framework's
// INTERNAL drift daemon — telemetry streams, recurrence escalation, GitHub issues, and
// it is tied to this repo's docs/specs/wave-*_MASTER_SPEC.md layout (it imports the
// heavy emit-telemetry stack). THIS script is its PORTABLE twin: zero-dependency,
// config-driven, works on ANY project's spec layout, and is shipped into every project
// by install-into.mjs. Same core idea (detect-drift DR5 "spec → missing file" + DR6
// "declared parent exists"), distilled to what a project can run with no telemetry stack.
//
// HONEST SPLIT (same discipline as northstar-check.mjs):
//   MECHANICAL (this script, zero tokens): a spec must not reference a file that does
//   not exist; a declared parent spec must exist on disk. Checkable, deterministic.
//   SEMANTIC (DORMANT → an agent): "does the prose still describe what the code DOES"
//   (e.g. status says P3-done but the code is mid-wave) is a judgement the
//   meta-process-auditor / chief-architect makes. It is NOT automatable here and is
//   deliberately left to the agent — the script guarantees the cheap, certain half.
//
// SOFT / HARD (graduation, K8s admission-webhook warn→enforce — HIERARCHICAL_SPEC_SYSTEM §8):
//   .sdd-config.json → driftDetection.hardBlockEnabled
//     false (default) → WARN: print findings, exit 0 (does not block commit/push)
//     true            → HARD: exit 1 on any high-severity finding (a referenced file is missing)
//   Spec locations: .sdd-config.json → driftDetection.specPaths (array of globs/paths,
//   relative to root). Absent → a sensible default set is scanned.
//
// FULL & self-tested. Usage:
//   node scripts/spec-drift-check.mjs --self-test
//   node scripts/spec-drift-check.mjs [--root <dir>] [--config <path>] [--hard] [--quiet]
//   node scripts/spec-drift-check.mjs --specs "a.md,b.md"        # explicit spec list (skips config globs)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative, basename, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';

// Extensions we treat as "a reference to a real project file". A backtick token that
// ends in one of these (or contains a path separator) is a candidate; anything else
// (a command like `git log`, a flag, a method like `brain.draft`) is ignored.
const FILE_EXT = /\.(md|py|mjs|cjs|js|jsx|ts|tsx|json|jsonl|sh|ya?ml|toml|cfg|ini|txt|sql|css|scss|html|png|svg|env)$/i;

// Directories never worth walking for the existence index (heavy / vendored / generated).
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'venv', '.venv', 'env', '__pycache__', 'dist', 'build',
  '.next', 'out', 'coverage', '.turbo', '.cache', 'logs', 'site-packages', '.mypy_cache',
]);

// Spec scanning skips archived material: docs/archive/** is read-only history whose
// references are EXPECTED to be stale (e.g. imported product docs). The existence
// index (walkIndex) still sees archive files, so references TO the archive resolve.
// docs/research/** is weekly GitHub-enrichment / Kaizen prose: it is FULL of repo names
// and proposed-script paths (e.g. "ruvnet/ruflo", "scripts/ace-curator.mjs") that are NOT
// local spec references — scanning it as a spec source counted every mention as a false
// broken ref, inflating the ratchet each week. The existence index still sees the files.
const SPEC_SKIP_DIRS = new Set([...SKIP_DIRS, 'archive', 'runs', 'research']);

// ── pure: is this backtick/link token a plausible local file reference? ──────────
export function looksLikeFileRef(raw) {
  if (!raw) return false;
  const s = raw.trim();
  if (!s || /\s/.test(s)) return false;                 // commands / prose
  if (/[*?<>|{}]/.test(s)) return false;                // globs / placeholders / {wave-id}
  if (/\b(?:NN|YYYY|MM|DD|HH)\b/.test(s)) return false; // template placeholders (wave-NN.md, YYYY-WNN)
  if (s.startsWith('-') || s.startsWith('$') || s.startsWith('@')) return false; // flags / vars / handles
  if (s.includes(':')) return false;                    // endpoints (:8080/api), urls, user:pass — not files
  if (s.startsWith('/') || s.startsWith('~')) return false; // absolute / home — out of scope (+ privacy)
  if (s.startsWith('#')) return false;                  // anchors
  if (s.endsWith('/')) return false;                    // a directory mention, not a file artifact
  const hasSep = s.includes('/');
  const hasExt = FILE_EXT.test(s);
  return hasSep || hasExt;                              // a path, or a bare filename with a known ext
}

// ── pure: extract local file references from spec markdown ───────────────────────
// Catches backtick `path/to/file.ext` and markdown [text](path). Dedup, order-stable.
export function extractLocalRefs(content) {
  const out = [];
  const seen = new Set();
  const add = (r) => { const t = r.trim(); if (t && !seen.has(t) && looksLikeFileRef(t)) { seen.add(t); out.push(t); } };
  for (const m of content.matchAll(/`([^`\n]+)`/g)) add(m[1]);
  for (const m of content.matchAll(/\]\(([^)\s]+)\)/g)) add(m[1]);  // markdown link target
  return out;
}

// ── pure: declared parents of a spec ─────────────────────────────────────────────
// Two shapes: YAML `parents:` list (- path: ...) and a prose "Parents:/Родители:" line
// carrying backtick paths. Returns the referenced paths (existence checked by caller).
export function extractDeclaredParents(content) {
  const out = [];
  const yaml = content.match(/^---\n([\s\S]*?)\n---/);
  if (yaml) {
    const pm = yaml[1].match(/^parents:\n((?:[ \t]+.*\n?)+)/m);
    if (pm) for (const m of pm[1].matchAll(/path:\s*(.+)/g)) out.push(m[1].trim().replace(/^\//, ''));
  }
  for (const line of content.split('\n')) {
    if (/^\s*(parents?|родител)/i.test(line)) for (const m of line.matchAll(/`([^`\n]+)`/g)) if (looksLikeFileRef(m[1])) out.push(m[1].trim());
  }
  return [...new Set(out)];
}

// ── pure: does a reference resolve to a real file? ───────────────────────────────
// `has` is the existence oracle: (relPathFromRoot) => bool. `names` is a Set of bare
// basenames present anywhere under root (so a spec naming `answer_cache.py` resolves
// even though the spec lives elsewhere). Injectable for self-test (no FS needed).
export function resolveRef(ref, specRelDir, has, names) {
  const tries = [];
  const norm = (p) => p.replace(/\/+/g, '/').replace(/^\.\//, '');
  if (ref.startsWith('./') || ref.startsWith('../')) {
    tries.push(norm(join(specRelDir, ref)));            // relative to the spec's own dir
  } else if (ref.includes('/')) {
    tries.push(norm(ref));                              // relative to root
    tries.push(norm(join(specRelDir, ref)));            // or relative to the spec
  } else {
    // bare filename — match by basename anywhere in the tree (module reference)
    if (names && names.has(ref)) return { ok: true, tries: [ref + ' (by basename)'] };
    tries.push(norm(ref));
  }
  for (const t of tries) if (has(t)) return { ok: true, tries };
  // last resort for path-bearing refs: basename match (a moved-but-present module)
  if (names && names.has(basename(ref))) return { ok: true, tries: [...tries, basename(ref) + ' (by basename)'] };
  return { ok: false, tries };
}

// ── pure: analyse one spec, return findings ──────────────────────────────────────
// finding = { spec, ref, kind: 'missing-ref'|'missing-parent', severity: 'high'|'warn', tries }
export function analyzeSpec(specRel, content, has, names) {
  const specDir = dirname(specRel);
  const findings = [];
  const parents = new Set(extractDeclaredParents(content));
  for (const ref of extractDeclaredParents(content)) {
    const r = resolveRef(ref, specDir, has, names);
    if (!r.ok) findings.push({ spec: specRel, ref, kind: 'missing-parent', severity: 'high', tries: r.tries });
  }
  for (const ref of extractLocalRefs(content)) {
    if (parents.has(ref)) continue;                     // already reported as parent
    const r = resolveRef(ref, specDir, has, names);
    if (!r.ok) findings.push({ spec: specRel, ref, kind: 'missing-ref', severity: 'high', tries: r.tries });
  }
  return findings;
}

// ── pure: drop findings whose target is a gitignored runtime artifact ─────────────
// A reference to a runtime-generated, gitignored path (e.g. docs/audits/*-events.jsonl,
// docs/CURRENT_WAVE.md) is NOT spec drift: that file legitimately does not exist in a
// clean checkout and is recreated at runtime. Counting it makes the metric flap between
// a fresh checkout (target absent → "broken") and a warmed tree (target present →
// "resolved"). `ignored` is the set of root-relative paths matched by committed
// .gitignore patterns — pattern membership is independent of what exists on disk, so
// the verdict is identical in CI and locally.
export function excludeIgnored(findings, ignored) {
  if (!ignored || !ignored.size) return findings;
  return findings.filter(f => !(f.tries || []).some(t => ignored.has(t)));
}

// ── FS helpers (impure, CLI only) ────────────────────────────────────────────────
function walkIndex(root) {
  const rel = new Set();         // relative paths from root
  const names = new Set();       // bare basenames
  (function walk(dir) {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.githooks' && e.name !== '.jidoka') { if (SKIP_DIRS.has(e.name)) continue; }
      if (e.isDirectory()) { if (SKIP_DIRS.has(e.name)) continue; walk(join(dir, e.name)); }
      else if (e.isFile()) { rel.add(relative(root, join(dir, e.name)).replace(/\\/g, '/')); names.add(e.name); }
    }
  })(root);
  return { rel, names };
}

// The DETERMINISTIC existence oracle: tracked files only (git ls-files). A clean checkout
// (what CI scans) contains exactly the tracked files; a warmed local tree additionally holds
// runtime artifacts (telemetry journals under docs/audits/, generated docs). Resolving refs
// against the WORKING tree therefore flaps between the two — a ref to a not-yet-generated
// journal reads as "broken" in CI but "resolved" locally. Resolving against the COMMITTED
// tree removes that flap entirely: the answer is the same everywhere. Returns null when git
// is unavailable / not a repo, so the caller falls back to the filesystem walk (portable).
function trackedIndex(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const files = out.split('\0').filter(Boolean);
    if (!files.length) return null;
    const rel = new Set();
    const names = new Set();
    for (const f of files) { const p = f.replace(/\\/g, '/'); rel.add(p); names.add(basename(p)); }
    return { rel, names };
  } catch { return null; }
}

function listSpecs(root, specPaths) {
  // specPaths entries may be a concrete file, a directory, or a "dir/**.md"-ish hint.
  const out = new Set();
  const addFile = (p) => { if (p.endsWith('.md') && existsSync(join(root, p))) out.add(p); };
  const addDir = (d) => {
    const abs = join(root, d); let entries; try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SPEC_SKIP_DIRS.has(e.name)) addDir(join(d, e.name)); }
      // Skip generated graph artifacts (e.g. _LINEAGE.md): they are rewritten by
      // build-lineage-graph, not authored specs — scanning them is a self-reference.
      else if (e.name.endsWith('.md') && e.name !== '_LINEAGE.md') out.add(join(d, e.name).replace(/\\/g, '/'));
    }
  };
  for (const raw of specPaths) {
    const p = raw.replace(/\/\*\*.*$/, '').replace(/\/\*$/, '');  // strip glob tail → walk the dir
    const abs = join(root, p);
    if (!existsSync(abs)) continue;
    statSync(abs).isDirectory() ? addDir(p) : addFile(p);
  }
  return [...out];
}

function readConfig(configPath) {
  try { return JSON.parse(readFileSync(configPath, 'utf8'))?.driftDetection ?? {}; } catch { return {}; }
}

// ── impure: which of these root-relative paths are gitignored (pattern-based)? ────
// Uses `git check-ignore` so the answer depends only on committed .gitignore patterns,
// not on which runtime files happen to exist on disk → deterministic across checkouts.
// Guarded: if git is absent or this is not a repo, returns an empty set (no exclusion,
// preserving the zero-dep portable behaviour on non-git trees).
function gitIgnoredPaths(root, paths) {
  const ignored = new Set();
  const list = [...new Set(paths)].filter(Boolean);
  if (!list.length) return ignored;
  const collect = (out) => { for (const line of String(out).split('\n')) { const t = line.trim(); if (t) ignored.add(t); } };
  try {
    // exit 0 → some paths matched (printed to stdout); exit 1 → none matched (throws, stdout empty)
    collect(execFileSync('git', ['-C', root, 'check-ignore', '--stdin'],
      { input: list.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
  } catch (e) {
    if (e && typeof e.stdout === 'string') collect(e.stdout);
    // any other failure (git missing / not a repo) → ignored stays empty → no exclusion
  }
  return ignored;
}

// ── self-test (pure logic, injected oracles — no real FS) ────────────────────────
function selfTest() {
  const present = new Set(['docs/NORTH_STAR.md', 'src/answer_cache.py', 'docs/specs/blueprint.md']);
  const names = new Set(['NORTH_STAR.md', 'answer_cache.py', 'blueprint.md']);
  const has = (p) => present.has(p);

  const specOK = [
    'Parents: `../NORTH_STAR.md` and `blueprint.md`.',
    'Reuses `answer_cache.py` as the substrate. Run `git log` to see history.',
    'See [the star](../NORTH_STAR.md).',
  ].join('\n');
  // spec lives at docs/specs/auto.md → ../NORTH_STAR.md = docs/NORTH_STAR.md (present)
  const fOK = analyzeSpec('docs/specs/auto.md', specOK, has, names);

  const specBad = [
    'Parents: `../GONE.md`.',                          // missing parent
    'Implemented in `src/missing_module.py`.',          // missing ref
    'A flag `--check`, a method `brain.draft`, a cmd `npm run build` — all ignored.',
  ].join('\n');
  const fBad = analyzeSpec('docs/specs/auto.md', specBad, has, names);

  const T = [
    ['a path with a known extension is a file ref', looksLikeFileRef('v2/NORTH_STAR.md') === true],
    ['a bare module filename is a file ref', looksLikeFileRef('answer_cache.py') === true],
    ['a shell command is NOT a file ref', looksLikeFileRef('git log') === false],
    ['a flag is NOT a file ref', looksLikeFileRef('--check') === false],
    ['a method call is NOT a file ref', looksLikeFileRef('brain.draft') === false],
    ['an absolute path is skipped (privacy + scope)', looksLikeFileRef('/Users/me/x.py') === false],
    ['a url is NOT a file ref', looksLikeFileRef('https://x.io/a.png') === false],
    ['an endpoint (port:path) is NOT a file ref', looksLikeFileRef(':8080/api/send') === false],
    ['a directory mention (trailing slash) is NOT a file ref', looksLikeFileRef('castells-automation/whatsapp_agent/') === false],
    ['a template placeholder (wave-NN.md) is NOT a file ref', looksLikeFileRef('docs/retros/wave-NN.md') === false],
    ['a date placeholder (YYYY-WNN) is NOT a file ref', looksLikeFileRef('docs/audit-reports/routine-weekly-YYYY-WNN.md') === false],
    ['a braces placeholder ({wave-id}) is NOT a file ref', looksLikeFileRef('docs/specs/{wave-id}_MASTER_SPEC.md') === false],
    ['a real path is still a file ref after placeholder filters', looksLikeFileRef('docs/specs/wave-188_MASTER_SPEC.md') === true],
    ['extractLocalRefs pulls backticks + md links, drops noise + dedups', extractLocalRefs(specOK).length === 3],
    ['declared parents are extracted from a prose line', extractDeclaredParents(specOK).includes('../NORTH_STAR.md')],
    ['a clean spec yields zero findings', fOK.length === 0],
    ['a relative parent resolves against the spec dir', !fOK.some(f => f.ref === '../NORTH_STAR.md')],
    ['a bare module name resolves by basename', !fOK.some(f => f.ref === 'answer_cache.py')],
    ['a missing parent is caught (high)', fBad.some(f => f.kind === 'missing-parent' && f.ref === '../GONE.md' && f.severity === 'high')],
    ['a missing module ref is caught (high)', fBad.some(f => f.kind === 'missing-ref' && f.ref === 'src/missing_module.py')],
    ['noise (flag/method/command) produces no finding', !fBad.some(f => ['--check', 'brain.draft', 'npm run build'].includes(f.ref))],
    ['exactly the two real misses are found', fBad.length === 2],
    ['excludeIgnored drops a finding whose target is gitignored', (() => {
      const fs2 = [
        { spec: 'a.md', ref: 'docs/audits/x-events.jsonl', kind: 'missing-ref', tries: ['docs/audits/x-events.jsonl'] },
        { spec: 'a.md', ref: 'src/real.py', kind: 'missing-ref', tries: ['src/real.py'] },
      ];
      const kept = excludeIgnored(fs2, new Set(['docs/audits/x-events.jsonl']));
      return kept.length === 1 && kept[0].ref === 'src/real.py';
    })()],
    ['excludeIgnored is a no-op when nothing is ignored', excludeIgnored([{ ref: 'x', tries: ['x'] }], new Set()).length === 1],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log(`\n\x1b[31mspec-drift-check self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ spec-drift-check self-test passes — reference + parent drift detection correct\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) selfTest();

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const root = resolve(arg('--root') || process.cwd());
const quiet = process.argv.includes('--quiet');
const configPath = arg('--config') || join(root, '.sdd-config.json');
const cfg = readConfig(configPath);
const hard = process.argv.includes('--hard') || cfg.hardBlockEnabled === true;

const DEFAULT_SPEC_PATHS = ['docs', 'whatsapp_agent', 'specs', 'SPEC.md', 'README.md'];
const specPaths = arg('--specs') ? arg('--specs').split(',').map(s => s.trim())
  : (Array.isArray(cfg.specPaths) && cfg.specPaths.length ? cfg.specPaths : DEFAULT_SPEC_PATHS);

// Prefer the committed tree (deterministic across CI / local); fall back to a filesystem
// walk on non-git trees so the portable script still works outside a repo.
const { rel, names } = trackedIndex(root) || walkIndex(root);
const has = (p) => rel.has(p);
// Scan only specs that exist in the same (committed, when available) tree the oracle uses,
// so a runtime-generated doc on disk (e.g. docs/CURRENT_WAVE.md) is never scanned in a warm
// tree but skipped in CI — same set of specs scanned everywhere.
const specs = listSpecs(root, specPaths).filter(s => rel.has(s));

if (specs.length === 0) {
  console.log(`\x1b[2mspec-drift-check: no spec files found under ${specPaths.join(', ')} (root: ${relative(process.cwd(), root) || '.'}) — nothing to check.\x1b[0m`);
  process.exit(0);
}

const rawFindings = [];
for (const s of specs) {
  let content; try { content = readFileSync(join(root, s), 'utf8'); } catch { continue; }
  rawFindings.push(...analyzeSpec(s, content, has, names));
}

// Deterministic exclusion: a reference to a gitignored runtime artifact is not drift —
// see excludeIgnored. Evaluated against committed .gitignore patterns so the count is
// identical in a fresh CI checkout and a warmed local tree (the bug this gate had).
const ignored = gitIgnoredPaths(root, rawFindings.flatMap(f => f.tries || []));
const findings = excludeIgnored(rawFindings, ignored);

const high = findings.filter(f => f.severity === 'high');
if (!quiet) {
  console.log(`spec-drift-check: scanned ${specs.length} spec(s) — ${findings.length} drift finding(s) [mode: ${hard ? 'HARD' : 'soft/warn'}]`);
  for (const f of findings) {
    const tag = f.kind === 'missing-parent' ? 'parent missing' : 'reference missing';
    console.log(`  ${hard ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⚠\x1b[0m'} ${f.spec}: ${tag} → \x1b[1m${f.ref}\x1b[0m`);
  }
}

if (findings.length === 0) {
  console.log('\x1b[32m✓ no spec→file drift: every referenced file and declared parent exists.\x1b[0m');
  console.log('  \x1b[2msemantic match (does the prose still describe what the code DOES) is the agent\'s call — not automated here.\x1b[0m');
  process.exit(0);
}

if (hard && high.length) {
  console.error(`\n\x1b[31m✗ spec-drift-check BLOCKED: ${high.length} spec(s) reference a file that does not exist. Fix the spec or restore the file.\x1b[0m`);
  process.exit(1);
}
console.log(`\n\x1b[33m○ soft mode: ${findings.length} finding(s) reported, not blocking. Set driftDetection.hardBlockEnabled=true to enforce after the trial.\x1b[0m`);
console.log('  \x1b[2msemantic drift (status vs real progress) — hand to meta-process-auditor / chief-architect.\x1b[0m');
process.exit(0);
