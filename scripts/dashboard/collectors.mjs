#!/usr/bin/env node
// collectors.mjs — jidoka dashboard data layer (docs/DASHBOARD_SPEC.md).
// Pure summarizers (unit-testable) + fs gather. Reads framework `docs/…` or installed `.jidoka/…`.
//
// Usage: node scripts/dashboard/collectors.mjs --self-test
//        import { discoverProjects, collectProject } from './collectors.mjs'

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

// ── safe readers ───────────────────────────────────────────────────────────
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readJsonl = (p) => {
  if (!p) return [];
  try {
    return readFileSync(p, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const tail = (a, n) => a.slice(Math.max(0, a.length - n));

// Resolve an artifact that lives in docs/… (framework/native) OR .jidoka/… (installed).
function resolve(projectPath, rel) {
  for (const base of ['', '.jidoka/']) {
    const p = join(projectPath, base + rel);
    if (existsSync(p)) return p;
  }
  return null;
}

// ── project discovery ───────────────────────────────────────────────────────
export function discoverProjects(home = homedir(), frameworkRoot = null) {
  const projects = [];
  if (frameworkRoot && existsSync(join(frameworkRoot, 'scripts'))) {
    projects.push({ name: frameworkRoot.split('/').pop(), path: frameworkRoot, kind: 'framework' });
  }
  let entries = [];
  try { entries = readdirSync(home, { withFileTypes: true }); } catch { /* none */ }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = join(home, e.name);
    if (p === frameworkRoot) continue;
    if (existsSync(join(p, '.jidoka')) || existsSync(join(p, 'docs/governance/raci.json'))) {
      projects.push({ name: e.name, path: p, kind: 'project' });
    }
  }
  return projects;
}

// ── pure summarizers (testable without fs) ──────────────────────────────────
export function summarizePipeline(raci, halt, branch) {
  const stages = (raci?.activities || []).map((a) => ({ id: a.id, label: a.label }));
  return { stages, halted: Boolean(halt), branch: branch || null, stageCount: stages.length };
}

export function summarizeTasks({ metaMistakes = [], gateTrips = [], approvals = [], crossLine = [], reflexionQueue = 0, halt = false }) {
  const tasks = [];
  if (halt) tasks.push({ source: 'andon', priority: 'critical', text: 'pipeline HALTED — resume required' });
  for (const m of tail(metaMistakes, 5)) {
    tasks.push({ source: 'meta-ledger', priority: 'high', text: `${m.class || 'lesson'}: ${m.real || m.claimed || ''}`.slice(0, 120) });
  }
  for (const g of tail(gateTrips.filter((x) => x.verdict === 'FAIL' || x.level === 'FAIL'), 5)) {
    tasks.push({ source: 'gate-trips', priority: 'high', text: `${g.gate || g.check || 'gate'} failed` });
  }
  for (const a of tail(approvals, 5)) {
    tasks.push({ source: 'approval-queue', priority: 'medium', text: a.summary || a.action || 'pending approval' });
  }
  for (const _ of tail(crossLine.filter((x) => x.verdict === 'BLOCK' || x.block), 3)) {
    tasks.push({ source: 'cross-line', priority: 'high', text: 'cross-line dispatch block' });
  }
  if (reflexionQueue > 0) {
    tasks.push({ source: 'reflexion-queue', priority: 'medium', text: `${reflexionQueue} commit(s) awaiting adversarial review` });
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return tasks.sort((a, b) => order[a.priority] - order[b.priority]);
}

export function summarizeHealth(baseline, halt, gateTrips) {
  const evalPct = baseline?.pass_rate != null ? Math.round(baseline.pass_rate * 100) : null;
  const recentFails = (gateTrips || []).filter((g) => g.verdict === 'FAIL' || g.level === 'FAIL').length;
  let level = 'unknown';
  if (halt) level = 'red';
  else if (evalPct === 100 && recentFails === 0) level = 'green';
  else if (evalPct != null) level = 'amber';
  return { level, evalPct, recentFails, halt: Boolean(halt) };
}

export function summarizeProduction(dora) {
  const events = dora || [];
  const deploys = events.filter((e) => e.type === 'deploy' || e.event === 'deploy');
  return { deployCount: deploys.length, lastDeploy: deploys.length ? tail(deploys, 1)[0] : null, events: tail(events, 5) };
}

// Killer feature: live agent-activity tape — what the agents most recently did.
export function summarizeActivity(traces) {
  return tail(traces || [], 8).reverse().map((t) => ({
    agent: t.agent || t.actor || t.agentId || t.actor_agent || '—',
    action: t.action || t.event || t.verdict || t.gate || t.kind || 'activity',
    ts: t.ts || t.timestamp || null,
  }));
}

// Killer feature: meta-ledger active lessons grouped by class (recurrence risk surfaced).
export function summarizeLessons(metaMistakes) {
  const byClass = {};
  for (const m of metaMistakes || []) {
    const c = m.class || 'lesson';
    byClass[c] = (byClass[c] || 0) + 1;
  }
  return Object.entries(byClass)
    .map(([cls, count]) => ({ class: cls, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

// ── fs gather (impure) ──────────────────────────────────────────────────────
export function collectProject(projectPath) {
  const raci = readJson(resolve(projectPath, 'docs/governance/raci.json'));
  const halt = ['docs/audits/andon-halt.json', 'docs/audits/halt-state.json', '.sdd-halt-state.json']
    .some((p) => resolve(projectPath, p));
  let branch = null;
  try { branch = execSync('git branch --show-current', { cwd: projectPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not git */ }

  const metaMistakes = readJsonl(resolve(projectPath, 'docs/audits/meta-mistakes.jsonl'));
  const gateTrips = readJsonl(resolve(projectPath, 'docs/audits/gate-trips.jsonl'));
  const approvals = readJsonl(resolve(projectPath, 'docs/audits/approval-queue.jsonl'));
  const crossLine = readJsonl(resolve(projectPath, 'docs/audits/cross-line-verdicts.jsonl'));
  const dora = readJsonl(resolve(projectPath, 'docs/audits/dora-events.jsonl'));
  const baseline = readJson(resolve(projectPath, 'docs/evals/_baseline.json'));
  let reflexionQueue = 0;
  const rq = resolve(projectPath, '.claude/reflexion-queue');
  if (rq) { try { reflexionQueue = readdirSync(rq).filter((f) => f.endsWith('.md')).length; } catch { /* */ } }

  // killer features: agent-activity tape (traces + decisions) + wave timeline (git log)
  const traces = [
    ...readJsonl(resolve(projectPath, 'docs/audits/agent-traces.jsonl')),
    ...readJsonl(resolve(projectPath, 'docs/audits/decision-log.jsonl')),
  ];
  let timeline = [];
  try {
    timeline = execSync("git log -8 --format='%h|%s|%cr'", { cwd: projectPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean)
      .map((l) => { const [hash, subject, when] = l.split('|'); return { hash, subject, when }; });
  } catch { /* not git */ }

  return {
    pipeline: summarizePipeline(raci, halt, branch),
    tasks: summarizeTasks({ metaMistakes, gateTrips, approvals, crossLine, reflexionQueue, halt }),
    health: summarizeHealth(baseline, halt, gateTrips),
    production: summarizeProduction(dora),
    activity: summarizeActivity(traces),
    lessons: summarizeLessons(metaMistakes),
    timeline,
    collectedAt: null, // stamped by the server (Date.now() banned in pure-render context)
  };
}

// ── self-test (pure summarizers only) ───────────────────────────────────────
function selfTest() {
  let f = 0;
  const ok = (n, c) => { if (!c) f++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('pipeline stages derived from raci', summarizePipeline({ activities: [{ id: 'dor', label: 'DoR' }, { id: 'impl', label: 'Impl' }] }, false, 'main').stageCount === 2);
  ok('halt → red health', summarizeHealth({ pass_rate: 1 }, true, []).level === 'red');
  ok('100% eval + no fails → green', summarizeHealth({ pass_rate: 1 }, false, []).level === 'green');
  ok('eval present but failing → amber', summarizeHealth({ pass_rate: 0.9 }, false, [{ verdict: 'FAIL' }]).level === 'amber');
  ok('halt task is critical and first', summarizeTasks({ halt: true, metaMistakes: [{ class: 'x', real: 'y' }] })[0].priority === 'critical');
  ok('tasks priority-sorted', summarizeTasks({ approvals: [{ summary: 'a' }], gateTrips: [{ verdict: 'FAIL', gate: 'g' }] })[0].priority === 'high');
  ok('production counts only deploys', summarizeProduction([{ type: 'deploy' }, { type: 'other' }]).deployCount === 1);
  ok('missing data degrades gracefully', summarizePipeline(null, false, null).stageCount === 0 && summarizeTasks({}).length === 0);
  ok('activity tape maps recent traces (newest first)', summarizeActivity([{ agent: 'a', action: 'x' }, { agent: 'b', action: 'y' }])[0].agent === 'b');
  ok('lessons group by class, recurrence-sorted', summarizeLessons([{ class: 'c' }, { class: 'c' }, { class: 'd' }])[0].count === 2);
  if (f) { console.log(`\n\x1b[31mcollectors self-test FAILED (${f})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ collectors: pure summarizers correct\x1b[0m'); process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();
