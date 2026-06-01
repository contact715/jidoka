#!/usr/bin/env node
// model-tier — pick the model for each agent by task tier (GSD borrow #3: model profiles).
//
// GSD's config has model profiles (quality / balanced / budget) that scale which model each agent
// runs on. jidoka dispatched every agent on the session model. This advises a per-agent model so a
// throwaway task can run cheap and a critical one runs strong — WITH one hard rule: high-reasoning
// roles (architects, judges, debate, reviewers) are never cheaped out to haiku, even on budget. You
// can save on implementation, not on judgement.
//
// HONEST boundary: this is ADVICE. The orchestrator passes the chosen model to the Agent tool; this
// file only maps role+tier → model. Role classes are a curated set; unknown roles default to mid.
//
// FULL & self-tested. Usage:
//   node scripts/model-tier.mjs --self-test
//   node scripts/model-tier.mjs --role chief-architect --tier budget
//   (library) import { modelForAgent, planModels } from './model-tier.mjs'

// high-reasoning roles: architecture, product strategy, judgement, adversarial review — never haiku
const HIGH = new Set([
  'chief-architect', 'micro-architect', 'macro-architect', 'surface-cartographer', 'design-system-architect',
  'chief-product-officer', 'business-process-architect', 'product-strategist', 'user-researcher',
  'reflexion-critic', 'constitutional-reviewer', 'debate-prosecutor', 'debate-defender', 'debate-judge',
  'judge-panel', 'best-of-N-judge', 'security-scanner', 'engineering-lead', 'data-lead', 'kaizen-officer',
]);
// mechanical / low-reasoning roles: formatting, extraction, status
const LOW = new Set(['statusline', 'skill-extractor', 'ux-writer', 'metrics-aggregator']);

const TABLE = {
  quality: { high: 'opus', mid: 'opus', low: 'sonnet' },
  balanced: { high: 'opus', mid: 'sonnet', low: 'haiku' },
  budget: { high: 'sonnet', mid: 'haiku', low: 'haiku' }, // high floor = sonnet, never haiku
};

export function classOf(role) { return HIGH.has(role) ? 'high' : LOW.has(role) ? 'low' : 'mid'; }

export function modelForAgent(role, tier = 'balanced') {
  const t = TABLE[tier] || TABLE.balanced;
  return t[classOf(role)];
}

// annotate a planner graph with a model per agent
export function planModels(plan, tier = 'balanced') {
  return (plan?.phases || []).map((p) => ({
    phase: p.phase,
    agents: (p.agents || []).map((a) => ({ agent: a, model: modelForAgent(a, tier) })),
  }));
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('quality: architect → opus', modelForAgent('chief-architect', 'quality') === 'opus');
  ok('quality: implementer → opus', modelForAgent('backend-agent', 'quality') === 'opus');
  ok('balanced: architect → opus', modelForAgent('chief-architect', 'balanced') === 'opus');
  ok('balanced: implementer → sonnet', modelForAgent('backend-agent', 'balanced') === 'sonnet');
  ok('balanced: mechanical → haiku', modelForAgent('statusline', 'balanced') === 'haiku');
  ok('budget: implementer → haiku', modelForAgent('backend-agent', 'budget') === 'haiku');
  ok('budget: judge → sonnet (NOT haiku — judgement floor)', modelForAgent('debate-judge', 'budget') === 'sonnet');

  // THE invariant: no high-reasoning role is ever haiku, in ANY tier
  const highNeverHaiku = ['quality', 'balanced', 'budget'].every((tier) =>
    [...HIGH].every((role) => modelForAgent(role, tier) !== 'haiku'));
  ok('INVARIANT: high-reasoning roles are never haiku (any tier)', highNeverHaiku);

  ok('unknown tier falls back to balanced', modelForAgent('backend-agent', 'nope') === modelForAgent('backend-agent', 'balanced'));
  ok('unknown role defaults to mid', classOf('some-new-agent') === 'mid');
  ok('planModels annotates each agent', (() => {
    const pm = planModels({ phases: [{ phase: 'gate', agents: ['debate-judge', 'backend-agent'] }] }, 'budget');
    return pm[0].agents[0].model === 'sonnet' && pm[0].agents[1].model === 'haiku';
  })());

  if (fails.length) { console.log(`\n\x1b[31mmodel-tier self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ model-tier: role→model mapping correct (judgement never cheaped out)\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const role = arg('--role');
  const tier = arg('--tier') || 'balanced';
  if (!role) { console.error("usage: model-tier.mjs --role <agent> --tier <quality|balanced|budget>  (or --self-test)"); process.exit(2); }
  console.log(`${role} @ ${tier} → ${modelForAgent(role, tier)} (class: ${classOf(role)})`);
  process.exit(0);
}
