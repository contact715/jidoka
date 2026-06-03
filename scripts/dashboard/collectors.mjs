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

// The canonical pipeline graph lives in orchestration-planner.plan() — the single source of truth for
// the phase graph. The dashboard renders that REAL graph (phases · agents · gates) overlaid with the
// live run-state cursor, not a hand-rolled funnel. Degrade gracefully if the planner is unreachable
// (e.g. a partial install): phases then come from the run-state journal alone, without gate enrichment.
let plan = null;
try { ({ plan } = await import('../orchestration-planner.mjs')); } catch { /* planner absent — pipeline still renders from run-state */ }
const safePlan = (task) => { try { return plan ? plan(task || { type: 'feature', risk: 'normal', surfaces: ['frontend', 'backend'] }) : null; } catch { return null; } };

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
const PHASE_LABEL = {
  discovery: 'Discovery', spec: 'Spec', tests: 'Tests', build: 'Build',
  gate: 'Quality gates', debug: 'Debug', launch: 'Launch', memory: 'Memory · Kaizen',
};

// The REAL pipeline: the canonical phase graph (plan()) overlaid with the live run-state position
// (docs/runs/<wave>/state.json) and real agent outcomes (agent-traces). No hand-rolled funnel.
//   runState  — the live wave journal (phases with status, current cursor) or null
//   planGraph — plan(task): each phase enriched with gates[]/skills[]/parallel/verifyN
//   traces    — agent-traces rows; latest outcome per agent overlays onto the agent chip
export function summarizePipeline({ runState = null, planGraph = null, halt = false, branch = null, traces = [] } = {}) {
  const agentOutcome = {};
  for (const t of traces) { const a = t.agent || t.actor; const o = t.outcome || t.verdict; if (a && o) agentOutcome[a] = o; }

  const enrich = {};
  for (const p of planGraph?.phases || []) enrich[p.phase] = { gates: p.gates || [], parallel: !!p.parallel, verifyN: p.verifyN || null };

  // Live phases from the run-state journal; otherwise the canonical graph with every phase 'idle'.
  const base = runState?.phases?.length
    ? runState.phases
    : (planGraph?.phases || []).map((p) => ({ phase: p.phase, status: 'idle', agents: p.agents || [], note: '' }));

  const stages = base.map((p) => ({
    phase: p.phase,
    label: PHASE_LABEL[p.phase] || p.phase,
    status: p.status || 'idle',
    current: Boolean(runState && runState.current === p.phase),
    agents: (p.agents || []).map((a) => ({ name: a, outcome: agentOutcome[a] || null })),
    gates: enrich[p.phase]?.gates || [],
    parallel: enrich[p.phase]?.parallel || false,
    verifyN: enrich[p.phase]?.verifyN || null,
    note: p.note || '',
  }));

  const done = stages.filter((s) => s.status === 'done').length;
  return {
    stages, stageCount: stages.length,
    wave: runState?.wave || null,
    task: runState?.task || planGraph?.task || null,
    current: runState?.current || null,
    live: Boolean(runState),
    progress: stages.length ? Math.round((done / stages.length) * 100) : 0,
    halted: Boolean(halt), branch: branch || null,
    updatedAt: runState?.updatedAt || null,
  };
}

// The pipeline BOARD: every wave placed left-to-right into a stage column by its CURRENT phase —
// "what's on spec, what's on tests, what's on build" at a glance (Kanban-style flow). Columns are the
// canonical stages, always shown so the whole pipeline reads left→right; a completed wave (no current)
// lands in 'Shipped'. Each card carries the wave id, progress %, risk, and live flag.
export function summarizeBoard(waves = []) {
  const place = (w) => w.current || 'done';
  const labels = { ...PHASE_LABEL, done: 'Shipped' };
  const core = ['discovery', 'spec', 'tests', 'build', 'gate', 'debug', 'memory'];
  const order = ['discovery', 'spec', 'tests', 'build', 'gate', 'debug', 'launch', 'memory', 'done'];
  const used = new Set(waves.map(place));
  const cols = order.filter((p) => core.includes(p) || used.has(p));
  const columns = cols.map((p) => ({
    phase: p,
    label: labels[p] || p,
    waves: waves
      .filter((w) => place(w) === p)
      .map((w) => ({ wave: w.wave, progress: w.progress, risk: w.task?.risk || 'normal', live: w.live })),
  }));
  return { columns, waveCount: waves.length };
}

export function summarizeTasks({ metaMistakes = [], gateTrips = [], approvals = [], crossLine = [], reflexionQueue = 0, halt = false, backlog = [] }) {
  const tasks = [];
  if (halt) tasks.push({ source: 'andon', priority: 'critical', text: 'pipeline HALTED — resume required' });
  // explicit session follow-ups — what we said we'd do but haven't (status open|blocked, never done).
  for (const b of backlog.filter((x) => (x.status || 'open') !== 'done')) {
    tasks.push({ source: 'backlog', priority: b.priority || 'high', text: `${(b.status || 'open') === 'blocked' ? '⛔ ' : ''}${b.title || ''}`.slice(0, 140) });
  }
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
    action: t.outcome || t.action || t.event || t.verdict || t.gate || t.kind || 'activity',
    label: t.label || null,
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
  const halt = ['docs/audits/andon-halt.json', 'docs/audits/halt-state.json', '.sdd-halt-state.json']
    .some((p) => resolve(projectPath, p));
  let branch = null;
  try { branch = execSync('git branch --show-current', { cwd: projectPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not git */ }

  const metaMistakes = readJsonl(resolve(projectPath, 'docs/audits/meta-mistakes.jsonl'));
  const gateTrips = readJsonl(resolve(projectPath, 'docs/audits/gate-trips.jsonl'));
  const approvals = readJsonl(resolve(projectPath, 'docs/audits/approval-queue.jsonl'));
  const crossLine = readJsonl(resolve(projectPath, 'docs/audits/cross-line-verdicts.jsonl'));
  const backlog = readJsonl(resolve(projectPath, 'docs/audits/backlog.jsonl'));
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

  // every wave journal — the board places them left→right by current phase; the detail view drills
  // into one wave's phases. The most-recently-MOVED wave is the default selection.
  let allStates = [];
  const runsDir = resolve(projectPath, 'docs/runs');
  if (runsDir) {
    try {
      allStates = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => readJson(join(runsDir, d.name, 'state.json')))
        .filter(Boolean);
    } catch { /* no runs */ }
  }
  const moved = allStates.filter((s) => (s.events?.length) || (s.phases || []).some((p) => p.status && p.status !== 'pending'));
  const primary = (moved.length ? moved : allStates).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
  const waves = allStates
    .map((rs) => summarizePipeline({ runState: rs, planGraph: safePlan(rs.task), halt, branch, traces }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const board = summarizeBoard(waves);

  return {
    pipeline: summarizePipeline({ runState: primary, planGraph: safePlan(primary?.task), halt, branch, traces }),
    board,
    waves,
    tasks: summarizeTasks({ metaMistakes, gateTrips, approvals, crossLine, reflexionQueue, halt, backlog }),
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
  const pg = { phases: [{ phase: 'gate', agents: ['reflexion-critic'], gates: ['coverage-gate'], parallel: true, verifyN: 3 }] };
  const rs = { wave: 'w-1', task: {}, current: 'gate', updatedAt: '2026-06-02', phases: [{ phase: 'gate', status: 'running', agents: ['reflexion-critic'], note: 'n' }] };
  ok('pipeline overlays run-state status + gates on canonical phases', (() => { const s = summarizePipeline({ runState: rs, planGraph: pg }); return s.stages[0].status === 'running' && s.stages[0].current && s.stages[0].gates.includes('coverage-gate') && s.live === true; })());
  ok('pipeline falls back to canonical graph (idle) with no run-state', (() => { const s = summarizePipeline({ planGraph: pg }); return s.stages[0].status === 'idle' && s.live === false; })());
  ok('pipeline overlays real agent outcomes from traces', summarizePipeline({ runState: rs, planGraph: pg, traces: [{ agent: 'reflexion-critic', outcome: 'PASS' }] }).stages[0].agents[0].outcome === 'PASS');
  ok('pipeline progress = % phases done', summarizePipeline({ runState: { phases: [{ phase: 'a', status: 'done' }, { phase: 'b', status: 'pending' }] } }).progress === 50);
  const bd = summarizeBoard([
    { wave: 'a', current: 'spec', progress: 20, task: { risk: 'critical' }, live: true },
    { wave: 'b', current: 'tests', progress: 40, task: {}, live: true },
    { wave: 'c', current: null, progress: 100, task: {}, live: true },
  ]);
  ok('board places waves into stage columns by current phase', bd.columns.find((c) => c.phase === 'spec').waves[0].wave === 'a' && bd.columns.find((c) => c.phase === 'tests').waves[0].wave === 'b');
  ok('board sends a completed wave (no current) to Shipped', bd.columns.find((c) => c.phase === 'done').waves[0].wave === 'c');
  ok('board always shows the core stages even when empty', ['discovery', 'build', 'gate', 'memory'].every((p) => bd.columns.some((c) => c.phase === p)));
  ok('board counts all waves', bd.waveCount === 3);
  ok('halt → red health', summarizeHealth({ pass_rate: 1 }, true, []).level === 'red');
  ok('100% eval + no fails → green', summarizeHealth({ pass_rate: 1 }, false, []).level === 'green');
  ok('eval present but failing → amber', summarizeHealth({ pass_rate: 0.9 }, false, [{ verdict: 'FAIL' }]).level === 'amber');
  ok('halt task is critical and first', summarizeTasks({ halt: true, metaMistakes: [{ class: 'x', real: 'y' }] })[0].priority === 'critical');
  ok('tasks priority-sorted', summarizeTasks({ approvals: [{ summary: 'a' }], gateTrips: [{ verdict: 'FAIL', gate: 'g' }] })[0].priority === 'high');
  ok('backlog: open follow-ups surface, done ones are hidden', (() => { const t = summarizeTasks({ backlog: [{ title: 'do X', status: 'open' }, { title: 'did Y', status: 'done' }] }); const b = t.filter((x) => x.source === 'backlog'); return b.length === 1 && b[0].text === 'do X'; })());
  ok('production counts only deploys', summarizeProduction([{ type: 'deploy' }, { type: 'other' }]).deployCount === 1);
  ok('missing data degrades gracefully', summarizePipeline({}).stageCount === 0 && summarizeTasks({}).length === 0);
  ok('activity tape maps recent traces (newest first)', summarizeActivity([{ agent: 'a', action: 'x' }, { agent: 'b', action: 'y' }])[0].agent === 'b');
  ok('activity surfaces the real outcome (VIOLATION/PASS), not a generic "activity"', summarizeActivity([{ agent: 'a', outcome: 'VIOLATION', label: 'CR-01' }])[0].action === 'VIOLATION');
  ok('lessons group by class, recurrence-sorted', summarizeLessons([{ class: 'c' }, { class: 'c' }, { class: 'd' }])[0].count === 2);
  if (f) { console.log(`\n\x1b[31mcollectors self-test FAILED (${f})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ collectors: pure summarizers correct\x1b[0m'); process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();
