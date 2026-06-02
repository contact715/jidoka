#!/usr/bin/env node
// model-router — route each agent call to a provider+model by tier × cost × usage × privacy, with a
// LOCAL-model fallback (the LiteLLM-gate pattern a high-volume practitioner uses). Extends model-tier
// (which picks opus/sonnet/haiku by role) into a provider router: Claude API vs a local model.
//
// Why: cost (local is far cheaper for bulk), privacy (some clients require data never leaves), and a
// hedge for the June-2026 subscription→API tightening — run legitimately on API or local instead of
// dodging subscription limits. This routes HONESTLY; it does NOT swap subscription tokens to evade ToS.
//
// route(task, ctx) → { provider: 'claude-api' | 'local', model, reason }
//   task: { role, tier, hard }   ctx: { usageRatio (0..1+), privacy, allowLocal }
//
// HONEST boundary: a policy (not a live dispatcher). It DECIDES the provider/model; the orchestrator
// executes it. Local model capability is a coarse registry, not a live benchmark.
//
// FULL & self-tested. Usage:
//   node scripts/model-router.mjs --self-test
//   node scripts/model-router.mjs --task '{"role":"backend-agent","tier":"budget"}' --usage 1.1

import { modelForAgent, classOf } from './model-tier.mjs';

// local models for cost/privacy (capable = strong general/dev model; light = cheap mechanical)
export const LOCAL = { capable: 'deepseek-3.2', light: 'llama-3.3-8b' };

export function route(task = {}, { usageRatio = 0, privacy = false, allowLocal = false } = {}) {
  const tier = task.tier || 'balanced';
  const cls = classOf(task.role || 'backend-agent');
  const apiModel = modelForAgent(task.role || 'backend-agent', tier);

  // privacy-sensitive work must stay in-house → local, but never a TOY model for high-reasoning roles
  if (privacy) return { provider: 'local', model: cls === 'high' ? LOCAL.capable : LOCAL.capable, reason: 'privacy-sensitive → local model (data stays in-house)' };
  // usage budget exhausted → local fallback (legit cost control, not a subscription-limit dodge)
  if (usageRatio >= 1) return { provider: 'local', model: cls === 'low' ? LOCAL.light : LOCAL.capable, reason: 'usage budget exhausted → local fallback' };
  // local explicitly allowed + a mechanical task → cheap local
  if (allowLocal && cls === 'low') return { provider: 'local', model: LOCAL.light, reason: 'mechanical task + local allowed → cheap local model' };
  // default: Claude API at the tier model
  return { provider: 'claude-api', model: apiModel, reason: `claude-api ${apiModel} (tier=${tier}, class=${cls})` };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('normal task → claude-api with the model-tier model', (() => { const r = route({ role: 'backend-agent', tier: 'balanced' }); return r.provider === 'claude-api' && r.model === 'sonnet'; })());
  ok('privacy-sensitive → local (data stays in-house)', route({ role: 'backend-agent' }, { privacy: true }).provider === 'local');
  ok('usage exhausted → local fallback', route({ role: 'backend-agent' }, { usageRatio: 1.2 }).provider === 'local');
  ok('under budget → still claude-api', route({ role: 'backend-agent' }, { usageRatio: 0.5 }).provider === 'claude-api');
  ok('allowLocal + mechanical role → cheap local light', route({ role: 'statusline' }, { allowLocal: true }).model === LOCAL.light);
  ok('allowLocal + HIGH role → NOT the light local (judgement not cheaped out)', route({ role: 'debate-judge' }, { allowLocal: true }).model !== LOCAL.light);
  ok('privacy + HIGH role → capable local, not light', route({ role: 'chief-architect' }, { privacy: true }).model === LOCAL.capable);
  ok('reason is always explained', typeof route({ role: 'backend-agent' }).reason === 'string' && route({ role: 'backend-agent' }).reason.length > 0);
  // inherits the model-tier invariant on the API path: a judge is never haiku
  ok('judge on API path is never haiku (inherits model-tier floor)', route({ role: 'debate-judge', tier: 'budget' }).model !== 'haiku');

  if (fails.length) { console.log(`\n\x1b[31mmodel-router self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ model-router: provider+model routing correct (local fallback, judgement floor held)\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const task = JSON.parse(arg('--task') || '{"role":"backend-agent","tier":"balanced"}');
  const ctx = { usageRatio: parseFloat(arg('--usage') || '0'), privacy: process.argv.includes('--privacy'), allowLocal: process.argv.includes('--allow-local') };
  const r = route(task, ctx);
  console.log(`model-router: ${task.role} → \x1b[1m${r.provider} / ${r.model}\x1b[0m — ${r.reason}`);
  process.exit(0);
}
