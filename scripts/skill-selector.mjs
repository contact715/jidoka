#!/usr/bin/env node
// skill-selector — force the RIGHT superpowers skill for the task signal (a practitioner's "game-changer":
// a start-hook that obliges a specific skill in a specific situation, e.g. debugging → systematic-debugging).
// jidoka has the skills + the auto-triggering dev-pipeline skill + debate-trigger; this is the general
// router that MANDATES the matching skill so the agent never "forgets" the discipline that fits the task.
//
// It covers the full superpowers library and VALIDATES against what is actually installed (skill-coverage):
// a matched-but-not-installed skill is reported as a gap, never mandated as a phantom.
//
// HONEST boundary: a deterministic keyword router over a curated rule set, mapping to canonical
// superpowers skills. It recommends/mandates; loading is the orchestrator's (or a UserPromptSubmit hook's) job.
//
// FULL & self-tested. Usage:
//   node scripts/skill-selector.mjs --self-test
//   node scripts/skill-selector.mjs --prompt "debug why the git push fails"
//   echo '{"prompt":"..."}' | node scripts/skill-selector.mjs --hook   (UserPromptSubmit hook mode)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { installedSkills } from './skill-coverage.mjs';

// NOTE: \b word-boundaries do NOT work around Cyrillic in JS regex, and \btest\b misses "tests" —
// so Cyrillic stems are matched bare, and English stems use a LEADING \b only (matches test/tests/testing
// but not "latest"). A keyword router, heuristic by design (see HONEST boundary above).
export const RULES = [
  { re: /\bdebug|\bbug|не работает|сломал|ошибк|\bbroken|\bfailing|traceback/i, skills: ['systematic-debugging', 'root-cause-tracing'] },
  { re: /\btest|тест|\bcoverage|покрыт|\btdd\b/i, skills: ['test-driven-development'] },
  { re: /\bnew feature|new project|from scratch|с нуля|brainstorm|explore (the )?options|придума|новая фича/i, skills: ['brainstorming'] },
  { re: /\bspec\b|\bspecs\b|specification|требовани|\bplan\b|\bплан|design the/i, skills: ['writing-plans'] },
  { re: /execute the plan|implement the plan|по плану|выполни план/i, skills: ['executing-plans'] },
  { re: /\bparallel|параллельн|worktree|multiple branches|in parallel/i, skills: ['using-git-worktrees', 'dispatching-parallel-agents'] },
  { re: /decompose|break (this|it) down|разбей|раздроби|too big|big feature|many subtasks/i, skills: ['subagent-driven-development'] },
  { re: /\bpoll\b|retry until|until .*ready|подожди пока|polling|sleep loop|wait for/i, skills: ['condition-based-waiting'] },
  { re: /\bsecurity\b|\bauth\b|validate (the )?input|sanitize|injection|инъекц|untrusted|безопасн/i, skills: ['defense-in-depth'] },
  { re: /\bcommit|pull request|\bPR\b|\bship\b|\bmerge|деплой|\brelease/i, skills: ['verification-before-completion', 'requesting-code-review'] },
  { re: /\bfinish|wrap up|done with|заверши|закончи|finalize the branch/i, skills: ['finishing-a-development-branch'] },
  { re: /\brefactor|рефактор|\bsimplif|\bcleanup|tech ?debt/i, skills: ['receiving-code-review'] },
  { re: /\bverify|проверь|does it work|works\?|confirm/i, skills: ['verification-before-completion'] },
];

export function selectSkills(task = {}) {
  const text = `${task.prompt || ''} ${task.type || ''} ${task.title || ''}`.toLowerCase();
  const skills = [];
  for (const r of RULES) if (r.re.test(text)) skills.push(...r.skills);
  return [...new Set(skills)];
}

// split mandated skills into those actually installed vs missing (so we never mandate a phantom)
export function partition(skills, installedSet) {
  return {
    available: skills.filter((s) => installedSet.has(s)),
    missing: skills.filter((s) => !installedSet.has(s)),
  };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('debugging → systematic-debugging + root-cause-tracing', (() => { const s = selectSkills({ prompt: 'debug why the git push fails' }); return s.includes('systematic-debugging') && s.includes('root-cause-tracing'); })());
  ok('RU "не работает" → systematic-debugging', selectSkills({ prompt: 'почему-то не работает кнопка' }).includes('systematic-debugging'));
  ok('testing → test-driven-development', selectSkills({ prompt: 'write tests for the parser' }).includes('test-driven-development'));
  ok('new feature → brainstorming', selectSkills({ prompt: 'lets build a new feature from scratch' }).includes('brainstorming'));
  ok('spec/plan → writing-plans', selectSkills({ prompt: 'design the spec for auth' }).includes('writing-plans'));
  ok('parallel work → using-git-worktrees + dispatching-parallel-agents', (() => { const s = selectSkills({ prompt: 'do these in parallel' }); return s.includes('using-git-worktrees') && s.includes('dispatching-parallel-agents'); })());
  ok('decompose → subagent-driven-development', selectSkills({ prompt: 'this is too big, break it down' }).includes('subagent-driven-development'));
  ok('security → defense-in-depth', selectSkills({ prompt: 'sanitize the untrusted input' }).includes('defense-in-depth'));
  ok('commit/PR → verification-before-completion + requesting-code-review', (() => { const s = selectSkills({ prompt: 'open a PR and merge' }); return s.includes('verification-before-completion') && s.includes('requesting-code-review'); })());
  ok('finish → finishing-a-development-branch', selectSkills({ prompt: 'wrap up and finalize the branch' }).includes('finishing-a-development-branch'));
  ok('async wait → condition-based-waiting', selectSkills({ prompt: 'poll the job and retry until ready' }).includes('condition-based-waiting'));
  ok('plain mechanical prompt → no mandate', selectSkills({ prompt: 'rename the variable foo to bar' }).length === 0);
  ok('dedups when rules overlap', selectSkills({ prompt: 'verify and ship the PR' }).filter((s) => s === 'verification-before-completion').length === 1);

  // installed-validation: never mandate a phantom
  const installed = new Set(['systematic-debugging']);
  const part = partition(['systematic-debugging', 'root-cause-tracing'], installed);
  ok('partition splits available vs missing', part.available.includes('systematic-debugging') && part.missing.includes('root-cause-tracing'));
  ok('partition of all-installed → no missing', partition(['systematic-debugging'], installed).missing.length === 0);

  if (fails.length) { console.log(`\n\x1b[31mskill-selector self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ skill-selector: task-signal → mandatory-skill routing correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  let task = {};
  if (process.argv.includes('--hook')) { try { task = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no stdin */ } }
  else task = { prompt: arg('--prompt') || '' };

  const skills = selectSkills(task);
  const inst = installedSkills(join(homedir(), '.claude', 'skills'));
  const { available, missing } = partition(skills, inst);

  if (process.argv.includes('--hook')) {
    if (available.length) console.log(`Load and follow these skills for this task (mandatory): ${available.join(', ')}.`);
    if (missing.length) console.log(`(Heads-up: this task also fits ${missing.join(', ')}, which is not installed — run a superpowers update to enable it.)`);
    process.exit(0);
  }
  if (!skills.length) { console.log('no skill mandated for this signal'); process.exit(0); }
  console.log(`mandatory skills: ${available.join(', ') || '(none installed)'}`);
  if (missing.length) console.log(`not installed (would also fit): ${missing.join(', ')}`);
  process.exit(0);
}
