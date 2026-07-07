#!/usr/bin/env node
// Cost/tool budget enforcement — the hard ceiling that makes autonomy safe.
//
// Without a budget you cannot "leave the agents running for an hour and walk away": a loop or a
// runaway agent burns unbounded tokens/tool-calls. This gate reads per-tier limits, checks
// consumption, and exits 1 when exceeded. A single runaway agent is halted by solo_agent_cap
// BEFORE it consumes the whole wave budget. (Frontier gap #3 — OpenAI Agents SDK has per-agent
// budgets; we lacked any hard ceiling.)
//
// FULL & self-tested. In a real run, consumption is fed via --used JSON from telemetry
// (emit-telemetry already records tool/agent events).
//
// Usage:
//   node scripts/budget-gate.mjs --self-test
//   node scripts/budget-gate.mjs --tier normal --used '{"tool_calls":120,"est_tokens":800000,"max_solo":40}'

import { readFileSync, existsSync } from 'node:fs';

const POLICY = 'docs/quality/budget-policy.json';

// Pure, testable. Returns {ok, breaches[], limit}.
export function check(tier, used, policy) {
  const lim = policy.tiers?.[tier];
  if (!lim) return { ok: false, breaches: [`unknown tier "${tier}"`] };
  const u = { tool_calls: 0, est_tokens: 0, max_solo: 0, ...used };
  const breaches = [];
  if (u.tool_calls > lim.tool_calls) breaches.push(`tool_calls ${u.tool_calls} > ${lim.tool_calls}`);
  if (u.est_tokens > lim.est_tokens) breaches.push(`est_tokens ${u.est_tokens} > ${lim.est_tokens}`);
  if (u.max_solo > lim.solo_agent_cap) breaches.push(`runaway agent: one agent used ${u.max_solo} > ${lim.solo_agent_cap} solo cap`);
  return { ok: breaches.length === 0, breaches, limit: lim };
}

// Exported so the est_tokens caps are a single source of truth: the token-meter in
// shard-story-bundle reads the SAME tier caps to report a bundle as a % of budget
// (the "thermometer" under this "thermostat" — before, nothing computed est_tokens
// from real text, so the cap had no live feeder).
export const DEFAULT_POLICY = { tiers: {
  trivial:  { tool_calls: 50,   est_tokens: 200000,  solo_agent_cap: 30 },
  normal:   { tool_calls: 300,  est_tokens: 1500000, solo_agent_cap: 120 },
  critical: { tool_calls: 1000, est_tokens: 6000000, solo_agent_cap: 300 },
} };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
if (process.argv.includes('--self-test')) {
  const P = DEFAULT_POLICY;
  const T = [
    { tier: 'normal', used: { tool_calls: 100, est_tokens: 500000, max_solo: 40 }, ok: true,  name: 'under budget' },
    { tier: 'normal', used: { tool_calls: 300, est_tokens: 1500000, max_solo: 120 }, ok: true, name: 'exactly at cap' },
    { tier: 'normal', used: { tool_calls: 400, est_tokens: 500000, max_solo: 40 }, ok: false, name: 'over tool_calls' },
    { tier: 'normal', used: { tool_calls: 100, est_tokens: 500000, max_solo: 200 }, ok: false, name: 'runaway solo agent' },
    { tier: 'trivial', used: { tool_calls: 60, est_tokens: 100000, max_solo: 10 }, ok: false, name: 'trivial over' },
    { tier: 'bogus', used: {}, ok: false, name: 'unknown tier' },
  ];
  let fails = 0;
  for (const t of T) {
    const r = check(t.tier, t.used, P);
    const pass = r.ok === t.ok;
    if (!pass) fails++;
    console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${t.name}: ok=${r.ok}${r.breaches.length ? ' ('+r.breaches[0]+')' : ''}`);
  }
  if (fails) { console.log('\n\x1b[31mbudget-gate self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ budget-gate enforcement correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const tier = arg('--tier') || 'normal';
const used = JSON.parse(arg('--used') || '{}');
const policy = existsSync(POLICY) ? JSON.parse(readFileSync(POLICY, 'utf8')) : DEFAULT_POLICY;
const r = check(tier, used, policy);
if (r.ok) { console.log(`\x1b[32m✓ within ${tier} budget\x1b[0m (${JSON.stringify(used)})`); process.exit(0); }
console.error(`\x1b[31m✗ BUDGET EXCEEDED [${tier}]:\x1b[0m`);
for (const b of r.breaches) console.error(`  · ${b}`);
console.error('  Halt the wave — a hard ceiling fired. Raise the tier deliberately or stop the runaway.');
process.exit(1);
}
