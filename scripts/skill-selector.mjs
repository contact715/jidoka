#!/usr/bin/env node
// skill-selector — force the RIGHT skill for the task signal (a high-volume practitioner's "game-changer":
// a start-hook that obliges a specific skill in a specific situation, e.g. debugging → systematic-debugging).
// jidoka has skills + the auto-triggering dev-pipeline skill + debate-trigger, but no general router that
// MANDATES the matching skill on a task signal. This is that router; it maps a prompt/type to the real
// skills that must be loaded, so the agent doesn't "forget" the discipline that fits the task.
//
// HONEST boundary: a deterministic keyword router over a curated rule set, mapping to skills that EXIST.
// It recommends/mandates; loading is the orchestrator's (or a UserPromptSubmit hook's) job.
//
// FULL & self-tested. Usage:
//   node scripts/skill-selector.mjs --self-test
//   node scripts/skill-selector.mjs --prompt "debug why the git push fails"
//   echo '{"prompt":"..."}' | node scripts/skill-selector.mjs --hook   (UserPromptSubmit hook mode)

import { readFileSync } from 'node:fs';

// signal → mandatory skill(s). Skills referenced here exist in the skill library.
// NOTE: \b word-boundaries do NOT work around Cyrillic in JS regex, and \btest\b misses "tests" —
// so Cyrillic stems are matched bare, and English stems use a LEADING \b only (matches test/tests/testing
// but not "latest"). A keyword router, heuristic by design (see HONEST boundary above).
export const RULES = [
  { re: /\bdebug|\bbug|не работает|сломал|ошибк|\bbroken|\bfailing|traceback/i, skills: ['systematic-debugging'] },
  { re: /\btest|тест|\bcoverage|покрыт|\btdd\b/i, skills: ['test-driven-development'] },
  { re: /\bspec\b|\bspecs\b|specification|требовани|\bplan\b|\bплан|design the/i, skills: ['writing-plans'] },
  { re: /\bcommit|pull request|\bPR\b|\bship\b|\bmerge|деплой|\brelease/i, skills: ['verification-before-completion'] },
  { re: /\brefactor|рефактор|\bsimplif|\bcleanup|tech ?debt/i, skills: ['receiving-code-review'] },
  { re: /\bverify|проверь|does it work|works\?|confirm/i, skills: ['verification-before-completion'] },
];

export function selectSkills(task = {}) {
  const text = `${task.prompt || ''} ${task.type || ''} ${task.title || ''}`.toLowerCase();
  const skills = [];
  for (const r of RULES) if (r.re.test(text)) skills.push(...r.skills);
  return [...new Set(skills)];
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('debugging task → systematic-debugging (mandated)', selectSkills({ prompt: 'debug why the git push fails' }).includes('systematic-debugging'));
  ok('RU "не работает" → systematic-debugging', selectSkills({ prompt: 'почему-то не работает кнопка' }).includes('systematic-debugging'));
  ok('testing task → test-driven-development', selectSkills({ prompt: 'write tests for the parser' }).includes('test-driven-development'));
  ok('spec/plan task → writing-plans', selectSkills({ prompt: 'design the spec for auth' }).includes('writing-plans'));
  ok('commit/PR task → verification-before-completion', selectSkills({ prompt: 'open a PR and merge' }).includes('verification-before-completion'));
  ok('a plain mechanical prompt → no mandate (no over-forcing)', selectSkills({ prompt: 'rename the variable foo to bar' }).length === 0);
  ok('dedups when multiple rules hit the same skill', selectSkills({ prompt: 'verify and ship the PR' }).filter((s) => s === 'verification-before-completion').length === 1);
  ok('every mandated skill is a non-empty string', selectSkills({ prompt: 'debug and test' }).every((s) => typeof s === 'string' && s.length));

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
  if (process.argv.includes('--hook')) { if (skills.length) console.log(`Load and follow these skills for this task (mandatory): ${skills.join(', ')}.`); process.exit(0); }
  console.log(skills.length ? `mandatory skills: ${skills.join(', ')}` : 'no skill mandated for this signal');
  process.exit(0);
}
