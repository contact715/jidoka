#!/usr/bin/env node
// debate-trigger — decide when a task/question deserves an adversarial debate (the "AI war"),
// so the debate subsystem fires at the SYSTEM level, not only on critical code diffs.
//
// jidoka already has the debate machinery (debate-engine + prosecutor/defender/judge + judge-panel +
// best-of-N), but it only auto-fired in the gate phase of critical CODE waves. Many of the highest-
// value moments are ANALYTICAL: "compare X vs Y", "should we do Z", "evaluate these options",
// "analyse the gaps" (this very GSD-vs-jidoka analysis is the canonical case). This classifier routes
// those to a debate BEFORE the answer is committed to.
//
// Modes:
//   full  — prosecutor → defender → judge (two-sided: comparisons, decisions, critical changes)
//   panel — judge-panel / best-of-N (N competing options, "pick the best of these")
//   none  — mechanical / implementation task; a debate would be wasted ceremony
//
// HONEST boundary: this is a deterministic ROUTER (keywords + task shape). It decides WHETHER to
// debate; the debate itself is the LLM agents (debate-engine). It can over- or under-trigger on
// unusual phrasing — when unsure on a genuine decision it leans toward debate (analysis is cheap
// insurance), and an explicit task.debate flag always wins.
//
// FULL & self-tested. Usage:
//   node scripts/debate-trigger.mjs --self-test
//   node scripts/debate-trigger.mjs --task '{"prompt":"compare A vs B, which is better?"}'

const COMPARE = [/\bcompare\b/, /\bvs\.?\b/, /which (is |one is )?(better|best|stronger)/, /pros and cons/, /trade-?offs?/, /сравн/, /что лучше/, /за и против/, /компромисс/, /лучше или/];
const DECISION = [/should (we|i)\b/, /worth (it|doing|building)/, /\bdecide\b/, /\bchoose\b/, /стоит ли/, /выбра(ть|ть\b)|выбери/, /какой (подход|вариант)/, /go or no/];
const ANALYSIS = [/\banaly[sz]e\b/, /\banaly[sz]is\b/, /\bevaluate\b/, /\bassess\b/, /\bcritique\b/, /проанализ/, /\bоцен(и|ить|ка)\b/, /аналитик/, /\bразбор\b/, /дебат/, /ai war|аи вар/];
const DEBATE_TYPES = ['analysis', 'comparison', 'decision', 'evaluation', 'research-synthesis'];

export function shouldDebate(task = {}) {
  if (task.debate === true) return { debate: true, mode: 'full', reason: 'explicitly requested (task.debate)' };
  if (task.debate === false) return { debate: false, mode: 'none', reason: 'explicitly disabled (task.debate=false)' };

  const text = `${task.prompt || ''} ${task.title || ''} ${task.type || ''}`.toLowerCase();

  if (Array.isArray(task.options) && task.options.length >= 2) {
    return { debate: true, mode: 'panel', reason: `${task.options.length} competing options → judge-panel / best-of-N` };
  }
  if (task.risk === 'critical') return { debate: true, mode: 'full', reason: 'critical risk → adversarial gate' };
  if (DEBATE_TYPES.includes(task.type)) return { debate: true, mode: 'full', reason: `task type=${task.type}` };
  if (COMPARE.some((r) => r.test(text))) return { debate: true, mode: 'full', reason: 'comparison question → two-sided debate' };
  if (DECISION.some((r) => r.test(text))) return { debate: true, mode: 'full', reason: 'decision question → two-sided debate' };
  if (ANALYSIS.some((r) => r.test(text))) return { debate: true, mode: 'full', reason: 'analytical question → adversarial review' };

  return { debate: false, mode: 'none', reason: 'mechanical / implementation task — no debate needed' };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('comparison "compare A vs B, which is better" → full', shouldDebate({ prompt: 'compare GSD vs jidoka, which is better' }).mode === 'full');
  ok('RU comparison "что лучше X или Y" → full', shouldDebate({ prompt: 'что лучше, наш подход или их' }).debate === true);
  ok('decision "should we build Z" → full', shouldDebate({ prompt: 'should we build a plugin system?' }).mode === 'full');
  ok('RU decision "стоит ли" → debate', shouldDebate({ prompt: 'стоит ли это делать' }).debate === true);
  ok('analysis "проанализируй дыры" → debate', shouldDebate({ prompt: 'проанализируй дыры системы' }).debate === true);
  ok('N options → panel', shouldDebate({ prompt: 'pick one', options: ['a', 'b', 'c'] }).mode === 'panel');
  ok('critical risk → full', shouldDebate({ risk: 'critical', prompt: 'refactor auth' }).mode === 'full');
  ok('task type=comparison → full', shouldDebate({ type: 'comparison' }).mode === 'full');
  ok('explicit debate:true wins', shouldDebate({ debate: true, prompt: 'fix typo' }).debate === true);
  ok('explicit debate:false wins over markers', shouldDebate({ debate: false, prompt: 'compare A vs B' }).debate === false);
  ok('mechanical "fix typo in README" → none', shouldDebate({ prompt: 'fix a typo in the README' }).debate === false);
  ok('mechanical "add a field to the form" → none', shouldDebate({ prompt: 'add an email field to the signup form' }).debate === false);
  ok('single option is not a panel', shouldDebate({ prompt: 'do x', options: ['only-one'] }).debate === false);

  if (fails.length) { console.log(`\n\x1b[31mdebate-trigger self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ debate-trigger: analytical/decision routing correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const task = JSON.parse(arg('--task') || '{}');
  const r = shouldDebate(task);
  if (r.debate) {
    console.log(`\x1b[1m⚔️  debate: YES (${r.mode})\x1b[0m — ${r.reason}`);
    console.log(r.mode === 'panel'
      ? '  → run a judge-panel / best-of-N over the options (scripts/judge-panel.mjs, best-of-N-judge).'
      : '  → run the adversarial debate: prosecutor → defender → judge (scripts/debate-engine.mjs).');
    process.exit(0);
  }
  console.log(`debate: no — ${r.reason}`);
  process.exit(0);
}
