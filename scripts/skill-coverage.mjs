#!/usr/bin/env node
// skill-coverage — verify the superpowers process-skill library is installed, so the skill-selector
// never mandates a skill that is not on disk (a phantom mandate). Reports present / missing / %.
//
// superpowers (obra/Jesse Vincent) is a library of PROCESS skills — they steer HOW Claude works
// (brainstorm before building, find root cause before fixing, verify before "done") rather than WHAT
// it knows. jidoka's skill-selector routes task signals → these skills; this gate keeps that routing
// honest by confirming the target skills exist.
//
// HONEST boundary: presence check by directory name in a skills dir. It does not validate skill
// CONTENT, only that the skill is installed.
//
// FULL & self-tested. Usage:
//   node scripts/skill-coverage.mjs --self-test
//   node scripts/skill-coverage.mjs            (audit ~/.claude/skills)
//   node scripts/skill-coverage.mjs --dir <skills-dir>

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// the canonical superpowers process skills
export const CANONICAL = [
  'brainstorming', 'writing-plans', 'executing-plans', 'systematic-debugging',
  'test-driven-development', 'verification-before-completion', 'using-git-worktrees',
  'subagent-driven-development', 'dispatching-parallel-agents', 'receiving-code-review',
  'requesting-code-review', 'finishing-a-development-branch', 'condition-based-waiting',
  'root-cause-tracing', 'defense-in-depth', 'using-superpowers',
];

// pure: which canonical skills are present in the installed set?
export function coverage(installedSet, canonical = CANONICAL) {
  const present = canonical.filter((s) => installedSet.has(s));
  const missing = canonical.filter((s) => !installedSet.has(s));
  return { total: canonical.length, present: present.length, missing, pct: Math.round((100 * present.length) / canonical.length), ok: missing.length === 0 };
}

export function installedSkills(dir) {
  // skills are often SYMLINKS (e.g. ~/.claude/skills/X -> ~/.agents/skills/X), so count dirs AND
  // symlinks that resolve to a directory — an isDirectory()-only filter silently reports 0% (the bug
  // this comment exists to prevent: the pure coverage() was tested, the I/O adapter was not).
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() || (e.isSymbolicLink() && existsSync(join(dir, e.name))))
    .map((e) => e.name));
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const full = new Set(CANONICAL);
  ok('full install → ok, 100%', coverage(full).ok === true && coverage(full).pct === 100);

  const partial = new Set(['brainstorming', 'systematic-debugging', 'writing-plans']);
  const r = coverage(partial);
  ok('partial install → not ok', r.ok === false);
  ok('missing list excludes the present ones', !r.missing.includes('brainstorming') && r.missing.includes('using-superpowers'));
  ok('pct reflects 3 of 16', r.present === 3 && r.pct === Math.round((100 * 3) / 16));

  ok('empty install → all missing, 0%', coverage(new Set()).pct === 0 && coverage(new Set()).missing.length === CANONICAL.length);
  ok('extra unrelated skills do not inflate coverage', coverage(new Set([...CANONICAL, 'some-other-skill'])).pct === 100);
  ok('canonical set is the 16 superpowers skills', CANONICAL.length === 16 && CANONICAL.includes('systematic-debugging'));

  if (fails.length) { console.log(`\n\x1b[31mskill-coverage self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ skill-coverage: superpowers coverage audit correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const dir = arg('--dir') || join(homedir(), '.claude', 'skills');
  const r = coverage(installedSkills(dir));
  console.log(`skill-coverage — superpowers in ${dir}\n  ${r.present}/${r.total} canonical skills present (${r.pct}%)`);
  if (r.missing.length) console.log(`  missing: ${r.missing.join(', ')}`);
  console.log(r.ok ? '\x1b[32m  ✓ full superpowers coverage\x1b[0m' : '\x1b[33m  ⚠ some canonical superpowers skills are not installed (skill-selector will not mandate them)\x1b[0m');
  process.exit(0);
}
