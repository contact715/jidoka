#!/usr/bin/env node
// agent-trace — the framework's record of its OWN agent runs. Until now every gate (eval, judges,
// budget, red-team) ran on synthetic/snapshot data; nothing recorded what REALLY happened when an
// agent was dispatched. This is the trace log: one append-only row per dispatch (agent, label,
// outcome, tokens, ms, ts), and a summary per agent (runs, avg tokens, avg ms, outcome mix).
//
// Why it's the foundation: budget-gate can read REAL averages instead of guesses; a misfire has a
// history to debug; prompt-evolution can target REAL failures, not just golden cases; replay can
// re-check a past input against today's gates.
//
// HONEST SPLIT: recording + summary = FULL. The orchestrator (or a Task post-hook) calls --ingest
// after each dispatch; the seed below is REAL runs from this session (tokens/ms from the actual Task
// outputs), not fabricated. Full replay of an LLM agent = re-dispatch (costly) — labelled next-step.
//
// FULL & self-tested. Usage:
//   node scripts/agent-trace.mjs --self-test
//   node scripts/agent-trace.mjs --ingest '{"agent":"reflexion-critic","label":"RC-PASS","outcome":"PASS","tokens":10613,"ms":2281}'
//   node scripts/agent-trace.mjs            # summary per agent from agent-traces.jsonl

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const TRACES = process.env.AGENT_TRACES || 'docs/audits/agent-traces.jsonl';
const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

// pure: aggregate traces per agent
export function summarize(traces) {
  const by = {};
  for (const t of traces) {
    const a = (by[t.agent] ||= { agent: t.agent, runs: 0, tokens: 0, ms: 0, outcomes: {} });
    a.runs++; a.tokens += t.tokens || 0; a.ms += t.ms || 0;
    if (t.outcome) a.outcomes[t.outcome] = (a.outcomes[t.outcome] || 0) + 1;
  }
  return Object.values(by)
    .map(a => ({ ...a, avgTokens: Math.round(a.tokens / a.runs), avgMs: Math.round(a.ms / a.runs) }))
    .sort((x, y) => y.runs - x.runs);
}

export function totals(traces) {
  return { dispatches: traces.length, tokens: traces.reduce((s, t) => s + (t.tokens || 0), 0), agents: new Set(traces.map(t => t.agent)).size };
}

function selfTest() {
  const tr = [
    { agent: 'judge', outcome: 'PASS', tokens: 100, ms: 200 },
    { agent: 'judge', outcome: 'FAIL', tokens: 200, ms: 400 },
    { agent: 'critic', outcome: 'PASS', tokens: 50, ms: 100 },
  ];
  const s = summarize(tr); const by = Object.fromEntries(s.map(x => [x.agent, x]));
  const tot = totals(tr);
  const T = [
    ['aggregates runs per agent', by.judge.runs === 2 && by.critic.runs === 1],
    ['computes avg tokens', by.judge.avgTokens === 150],
    ['computes avg ms', by.judge.avgMs === 300],
    ['tallies outcome mix', by.judge.outcomes.PASS === 1 && by.judge.outcomes.FAIL === 1],
    ['sorts busiest agent first', s[0].agent === 'judge'],
    ['totals across all traces', tot.dispatches === 3 && tot.tokens === 350 && tot.agents === 2],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31magent-trace self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ agent-trace: aggregation correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const ing = arg('--ingest');
  if (ing) {
    const row = JSON.parse(ing);
    row.ts = row.ts || process.env.META_TODAY || new Date().toISOString().slice(0, 10);
    mkdirSync('docs/audits', { recursive: true });
    appendFileSync(TRACES, JSON.stringify(row) + '\n');
    console.log(`agent-trace: recorded ${row.agent} (${row.outcome || 'n/a'}, ${row.tokens || 0} tok)`);
    process.exit(0);
  }
  const traces = readJsonl(TRACES);
  if (!traces.length) { console.log(`agent-trace: no traces yet at ${TRACES}. Orchestrator --ingest after each dispatch.`); process.exit(0); }
  const tot = totals(traces);
  console.log(`agent-trace: ${tot.dispatches} dispatches, ${tot.agents} agents, ${tot.tokens} total tokens\n`);
  for (const a of summarize(traces)) {
    const mix = Object.entries(a.outcomes).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`  ${a.agent.padEnd(24)} ${String(a.runs).padStart(3)} runs  ~${String(a.avgTokens).padStart(6)} tok  ~${String(a.avgMs).padStart(5)}ms  ${mix}`);
  }
  console.log('\n  \x1b[2mreal averages here are what budget-gate should use instead of guesses.\x1b[0m');
  process.exit(0);
}
