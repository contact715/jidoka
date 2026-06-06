#!/usr/bin/env node
// spec-amendment-gate — portable, zero-dep gate: code governed by a LIVING spec
// cannot change without the spec changing with it (or an explicit waiver).
//
// WHY THIS EXISTS (2026-06-05 projectx spec-tree audit + industry benchmark):
// the audit scored "spec-to-code feedback" 2/10 — drift was DETECTED
// (spec-drift-check / detect-drift) but never ACTED on: a spec ships, code is
// patched six waves later, the spec silently rots into archaeology. Industry
// terms (Fowler 2026): that is "spec-first" (write, ship, forget); the gold
// standard is "spec-ANCHORED" — the spec lives with the code. This gate is the
// mechanical half of the anchor: detection existed, FORCING the amendment didn't.
//
// SCOPE — living contracts only:
//   Specs with status Shipped/Implemented/Approved that declare code_references[]
//   in frontmatter (typically L2 domain / L3 module specs). Frozen wave deltas
//   (historical record, `inventory_check: false` or wave-spec type) are exempt —
//   amending history would be falsification, not anchoring.
//
// HONEST SPLIT:
//   MECHANICAL (this script): staged file F is listed in living spec S's
//   code_references AND S itself is not staged → WARN/BLOCK with the spec named.
//   SEMANTIC (DORMANT → an agent): "is this code change actually a CONTRACT
//   change, or an internal refactor the spec doesn't care about?" — judgement
//   for the committer / project-steward. That is exactly why the waiver exists
//   and why soft mode is the default during trial.
//
// WAIVER (explicit, logged — never silent): set SPEC_AMEND_WAIVE=1 on the commit
// command. The gate prints the waiver use to stderr so it lands in the terminal
// record; abusing waivers is a meta-audit signal, not a free pass.
//
// SOFT / HARD (graduation, warn→enforce — HIERARCHICAL_SPEC_SYSTEM §8):
//   .sdd-config.json → specAmendment.hardBlockEnabled  (false → WARN, true → exit 1)
//   .sdd-config.json → specAmendment.specDirs          (default ["docs/specs/modules","docs/specs/domains"])
//   .sdd-config.json → specAmendment.statuses          (default ["Shipped","Implemented","Approved"])
//
// FULL & self-tested. Usage:
//   node scripts/spec-amendment-gate.mjs --self-test
//   node scripts/spec-amendment-gate.mjs --staged [--root <dir>] [--hard]

import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const DEFAULTS = {
  enabled: true,
  hardBlockEnabled: false,
  specDirs: ['docs/specs/modules', 'docs/specs/domains'],
  statuses: ['Shipped', 'Implemented', 'Approved'],
};

const SKIP_DIRS = new Set(['.git', 'node_modules', 'venv', '.venv', 'dist', 'build', '.next', 'out', 'coverage']);

// ── pure helpers (exported for self-test) ────────────────────────────────────
export function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]+?)\n---(\n|$)/);
  return m ? m[1] : null;
}

export function fieldValue(fm, name) {
  const m = fm.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

// code_references as YAML list ("  - \"path\"" lines) or inline JSON-ish array.
export function extractCodeReferences(fm) {
  const refs = [];
  const block = fm.match(/^code_references:\s*$\n((?:[ \t]+-[^\n]*\n?)+)/m);
  if (block) {
    for (const line of block[1].split('\n')) {
      const m = line.match(/^[ \t]+-\s*["']?([^"'\n]+?)["']?\s*$/);
      if (m) refs.push(m[1].trim());
    }
  }
  const inline = fm.match(/^code_references:\s*\[([^\]]*)\]/m);
  if (inline) {
    for (const part of inline[1].split(',')) {
      const v = part.trim().replace(/^["']|["']$/g, '');
      if (v) refs.push(v);
    }
  }
  return refs;
}

// Is this spec a LIVING contract this gate guards?
export function isLivingSpec(fm, statuses) {
  if (!fm) return false;
  const status = fieldValue(fm, 'status');
  if (!status || !statuses.includes(status)) return false;
  if (fieldValue(fm, 'inventory_check') === 'false') return false; // frozen historical delta
  if (fieldValue(fm, 'type') === 'wave-spec' || fieldValue(fm, 'type') === 'wave-tasks') return false;
  return true;
}

// Core decision: given staged paths and the spec index, which staged files demand
// an amendment? Returns [{ file, spec }].
export function findViolations(stagedPaths, specIndex) {
  const stagedSet = new Set(stagedPaths);
  const out = [];
  for (const { specPath, refs } of specIndex) {
    if (stagedSet.has(specPath)) continue; // spec amended in same commit — anchored, OK
    for (const f of stagedPaths) {
      if (refs.includes(f)) out.push({ file: f, spec: specPath });
    }
  }
  return out;
}

// ── runner ───────────────────────────────────────────────────────────────────
function loadConfig(root) {
  let user = {};
  try { user = JSON.parse(readFileSync(join(root, '.sdd-config.json'), 'utf8')).specAmendment ?? {}; } catch { /* defaults */ }
  return { ...DEFAULTS, ...user };
}

function* walkMd(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('_')) continue;
      yield* walkMd(join(dir, e.name));
    } else if (e.name.endsWith('.md') && !e.name.startsWith('_')) {
      yield join(dir, e.name);
    }
  }
}

function run() {
  const args = process.argv.slice(2);
  const rootArg = args.find((_, i) => args[i - 1] === '--root');
  const root = resolve(rootArg ?? process.cwd());
  const cfg = loadConfig(root);
  if (cfg.enabled === false) { console.log('[spec-amendment] disabled via .sdd-config.json'); return 0; }
  const hard = args.includes('--hard') || cfg.hardBlockEnabled === true;

  if (!args.includes('--staged')) {
    console.log('[spec-amendment] commit-time gate: pass --staged');
    return 0;
  }

  if (process.env.SPEC_AMEND_WAIVE === '1') {
    process.stderr.write('[spec-amendment] WAIVED via SPEC_AMEND_WAIVE=1 — recorded; waiver abuse is a meta-audit signal\n');
    return 0;
  }

  let staged = [];
  try {
    staged = execSync('git diff --cached --name-only', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    console.log('[spec-amendment] not a git repo or git unavailable — skipped');
    return 0;
  }
  if (staged.length === 0) { console.log('[spec-amendment] nothing staged — skipped'); return 0; }

  // Build the living-spec index
  const specIndex = [];
  for (const d of cfg.specDirs) {
    for (const f of walkMd(join(root, d))) {
      let content;
      try { content = readFileSync(f, 'utf8'); } catch { continue; }
      const fm = extractFrontmatter(content);
      if (!isLivingSpec(fm, cfg.statuses)) continue;
      const refs = extractCodeReferences(fm);
      if (refs.length === 0) continue;
      specIndex.push({ specPath: relative(root, f).split(sep).join('/'), refs });
    }
  }

  const violations = findViolations(staged, specIndex);
  for (const v of violations) {
    console.log(`[spec-amendment] ${hard ? 'BLOCK' : 'WARN'} ${v.file} is governed by ${v.spec} — amend the spec in the same commit (or SPEC_AMEND_WAIVE=1 git commit ... for an internal-only refactor)`);
  }
  if (violations.length === 0) {
    console.log(`[spec-amendment] OK — no staged file changes code governed by a living spec without amending it (${specIndex.length} living specs indexed)`);
  }
  if (violations.length > 0 && hard) return 1;
  return 0;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0; const checks = [];
  const fmLiving = 'status: Shipped\ntype: module-spec\ncode_references:\n  - "lib/foo.ts"\n  - "components/Bar.tsx"';
  const fmFrozen = 'status: Shipped\ntype: wave-spec\ninventory_check: false\ncode_references:\n  - "lib/foo.ts"';
  const fmDraft = 'status: Draft\ncode_references:\n  - "lib/foo.ts"';
  const fmInline = 'status: Implemented\ncode_references: ["lib/a.ts", "lib/b.ts"]';
  checks.push(['living spec recognised', isLivingSpec(fmLiving, DEFAULTS.statuses) === true]);
  checks.push(['frozen wave delta exempt', isLivingSpec(fmFrozen, DEFAULTS.statuses) === false]);
  checks.push(['draft spec exempt', isLivingSpec(fmDraft, DEFAULTS.statuses) === false]);
  checks.push(['yaml list refs parsed', JSON.stringify(extractCodeReferences(fmLiving)) === JSON.stringify(['lib/foo.ts', 'components/Bar.tsx'])]);
  checks.push(['inline array refs parsed', JSON.stringify(extractCodeReferences(fmInline)) === JSON.stringify(['lib/a.ts', 'lib/b.ts'])]);
  const idx = [{ specPath: 'docs/specs/modules/surfaces/foo.md', refs: ['lib/foo.ts'] }];
  checks.push(['violation when code staged without spec', findViolations(['lib/foo.ts'], idx).length === 1]);
  checks.push(['no violation when spec staged too', findViolations(['lib/foo.ts', 'docs/specs/modules/surfaces/foo.md'], idx).length === 0]);
  checks.push(['no violation for unrelated file', findViolations(['lib/other.ts'], idx).length === 0]);
  for (const [name, ok] of checks) {
    if (ok) { pass++; console.log(`  ok  ${name}`); } else console.log(`  FAIL ${name}`);
  }
  console.log(`[spec-amendment] self-test: ${pass}/${checks.length}`);
  return pass === checks.length ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('spec-amendment-gate.mjs')) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
