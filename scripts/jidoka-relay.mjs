#!/usr/bin/env node
// jidoka-relay - local no-API relay between Claude Code and Codex.
//
// The relay is a file queue in ~/.jidoka/relay. A Claude watcher can process
// Fable planning/review tasks with the local `claude` CLI. A Codex watcher can
// process implementation tasks with the local `codex exec` CLI.
//
// Usage:
//   node scripts/jidoka-relay.mjs start --task "plan billing migration" --cwd "$PWD"
//   node scripts/jidoka-relay.mjs auto --task "plan and implement billing migration" --cwd "$PWD" --allow-codex-write
//   node scripts/jidoka-relay.mjs watch --agent claude --run
//   node scripts/jidoka-relay.mjs watch --agent codex --run --allow-codex-write

import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { routeDevelopmentTask } from './model-router.mjs';

const DEFAULT_STORE = join(homedir(), '.jidoka', 'relay');
const DEFAULT_CLAUDE_TIMEOUT_MS = 4 * 60 * 1000;
const DEFAULT_CODEX_TIMEOUT_MS = 10 * 60 * 1000;
let STORE = process.env.JIDOKA_RELAY_DIR || DEFAULT_STORE;
let RUNS = join(STORE, 'runs');
const nowIso = () => new Date().toISOString();
const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const idNow = (task) => `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${safe(task) || 'task'}-${randomUUID().slice(0, 8)}`;
const arg = (k, fallback = null) => {
  const i = process.argv.indexOf(k);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (k) => process.argv.includes(k);

function numberSetting(cliName, envName, fallback) {
  const raw = arg(cliName, process.env[envName] || String(fallback));
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function timeoutFor(agent, override = null) {
  if (override) return override;
  if (agent === 'claude') return numberSetting('--claude-timeout-ms', 'JIDOKA_CLAUDE_TIMEOUT_MS', DEFAULT_CLAUDE_TIMEOUT_MS);
  if (agent === 'codex') return numberSetting('--codex-timeout-ms', 'JIDOKA_CODEX_TIMEOUT_MS', DEFAULT_CODEX_TIMEOUT_MS);
  throw new Error(`unknown agent timeout: ${agent}`);
}

function isTimedOut(result) {
  return result?.error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM';
}

function spawnAgent(agent, command, args, options) {
  if (process.env.JIDOKA_RELAY_TEST_TIMEOUT_AGENT === agent) {
    const error = new Error(`${agent} timed out`);
    error.code = 'ETIMEDOUT';
    return { status: null, signal: 'SIGTERM', error, stdout: '', stderr: '' };
  }
  return spawnSync(command, args, options);
}

function setStore(path) {
  STORE = path;
  RUNS = join(STORE, 'runs');
}

function ensureStore() {
  mkdirSync(RUNS, { recursive: true });
  mkdirSync(join(STORE, 'logs'), { recursive: true });
}

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runDir(id) {
  return join(RUNS, id);
}

function listRuns() {
  ensureStore();
  return readdirSync(RUNS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = runDir(d.name);
      return { id: d.name, dir, status: readJson(join(dir, 'status.json'), {}) };
    })
    .sort((a, b) => String(a.status.createdAt || '').localeCompare(String(b.status.createdAt || '')));
}

function nextFor(agent) {
  return listRuns().find((r) => r.status.nextAgent === agent && ['queued', 'ready'].includes(r.status.state));
}

function writePromptFiles(dir, request, route, fableOutput = '') {
  const fableKind = route.route === 'fable-plan' ? 'planning/investigation' : 'adversarial review';
  const claudePrompt = [
    '# Jidoka Local Relay: Claude Fable 5',
    '',
    `Role: ${fableKind}.`,
    'Do not edit files. Produce a handoff packet for Codex.',
    'Do not call the relay recursively.',
    '',
    `Working directory: ${request.cwd}`,
    `Original requester: ${request.from}`,
    '',
    '## Original Task',
    request.task,
    '',
    '## Route',
    JSON.stringify(route, null, 2),
    '',
    '## Output Contract',
    '- Spec: goal, scope, non-goals, assumptions, acceptance criteria',
    '- Decision or review result',
    '- Root cause or architectural rationale',
    '- Execution chunks for Codex',
    '- Files likely touched',
    '- Acceptance criteria',
    '- Test matrix',
    '- Blockers and risks',
    '- Any Andon stop needed',
  ].join('\n');

  const codexPrompt = [
    '# Jidoka Local Relay: Codex GPT-5.5',
    '',
    'You own local execution, file edits, terminal/browser checks, and final proof.',
    'Do not call the relay recursively. You are already the Codex worker for this relay run.',
    '',
    `Working directory: ${request.cwd}`,
    `Original requester: ${request.from}`,
    '',
    '## Original Task',
    request.task,
    '',
    '## Route',
    JSON.stringify(route, null, 2),
    '',
    fableOutput ? '## Fable Handoff' : '## Fable Handoff',
    fableOutput || '(No Fable handoff for this route.)',
    '',
    '## Codex Contract',
    '- Inspect local instructions first.',
    '- Treat the Fable handoff as the working spec.',
    '- If the repo has a spec system, create or update the relevant spec before code when the change is non-trivial.',
    '- Implement only the accepted scope.',
    '- Run the smallest executable proof that demonstrates the change.',
    '- If a gate fails, fix root cause or report exact blocker.',
    '- Do not claim done without proof.',
  ].join('\n');

  writeFileSync(join(dir, 'claude-prompt.md'), `${claudePrompt}\n`);
  writeFileSync(join(dir, 'codex-prompt.md'), `${codexPrompt}\n`);
}

function initialNext(route) {
  if (route.route === 'fable-plan' || route.route === 'fable-review') return { nextAgent: 'claude', phase: route.route };
  return { nextAgent: 'codex', phase: route.route };
}

function createRun({ task, cwd, from = 'user', phase = 'intake', changedLines = 0, risk = '' }) {
  ensureStore();
  if (!task) throw new Error('missing --task');
  const realCwd = resolve(cwd || process.cwd());
  const route = routeDevelopmentTask(task, { phase, changedLines, risk });
  const id = idNow(task);
  const dir = runDir(id);
  mkdirSync(dir, { recursive: true });
  const request = { id, task, cwd: realCwd, from, createdAt: nowIso() };
  const next = initialNext(route);
  writeJson(join(dir, 'request.json'), request);
  writeJson(join(dir, 'route.json'), route);
  writePromptFiles(dir, request, route);
  writeJson(join(dir, 'status.json'), {
    id,
    state: 'queued',
    nextAgent: next.nextAgent,
    phase: next.phase,
    createdAt: request.createdAt,
    updatedAt: nowIso(),
    history: [{ at: nowIso(), event: 'created', route: route.route, nextAgent: next.nextAgent }],
  });
  return { id, dir, request, route, status: readJson(join(dir, 'status.json')) };
}

function appendHistory(status, event) {
  return { ...status, updatedAt: nowIso(), history: [...(status.history || []), { at: nowIso(), ...event }] };
}

function updateStatus(dir, updater) {
  const p = join(dir, 'status.json');
  const current = readJson(p, {});
  const next = updater(current);
  writeJson(p, next);
  return next;
}

function printRun(run) {
  const { id, dir, status } = run;
  const route = readJson(join(dir, 'route.json'), {});
  console.log(`${id}  ${status.state || '?'}  next=${status.nextAgent || '-'}  phase=${status.phase || '-'}  route=${route.route || '-'}`);
}

function commandStart() {
  const run = createRun({
    task: arg('--task'),
    cwd: arg('--cwd', process.cwd()),
    from: arg('--from', 'user'),
    phase: arg('--phase', 'intake'),
    changedLines: Number(arg('--changed-lines', '0')),
    risk: arg('--risk', ''),
  });
  console.log(`jidoka-relay: created ${run.id}`);
  console.log(`  route: ${run.route.route}`);
  console.log(`  next: ${run.status.nextAgent} (${run.status.phase})`);
  console.log(`  dir: ${run.dir}`);
  if (has('--run')) runAgent(run.status.nextAgent, run.id, {
    allowCodexWrite: has('--allow-codex-write'),
    claudeTimeoutMs: timeoutFor('claude'),
    codexTimeoutMs: timeoutFor('codex'),
  });
}

function commandList() {
  const agent = arg('--agent');
  const rows = listRuns().filter((r) => !agent || r.status.nextAgent === agent);
  for (const r of rows) printRun(r);
  if (!rows.length) console.log('jidoka-relay: queue empty');
}

function commandNext() {
  const agent = arg('--agent');
  if (!agent) throw new Error('missing --agent claude|codex');
  const run = nextFor(agent);
  if (!run) { console.log(`jidoka-relay: no queued task for ${agent}`); return; }
  printRun(run);
  console.log(`prompt: ${join(run.dir, `${agent === 'claude' ? 'claude' : 'codex'}-prompt.md`)}`);
}

function commandPrompt() {
  const id = arg('--id');
  const agent = arg('--agent');
  if (!id || !agent) throw new Error('usage: prompt --id <run-id> --agent claude|codex');
  const file = join(runDir(id), `${agent === 'claude' ? 'claude' : 'codex'}-prompt.md`);
  console.log(readFileSync(file, 'utf8'));
}

function runClaude(run, { claudeTimeoutMs = null } = {}) {
  const request = readJson(join(run.dir, 'request.json'));
  const prompt = readFileSync(join(run.dir, 'claude-prompt.md'), 'utf8');
  const outputFile = join(run.dir, 'fable-output.md');
  const timeoutMs = timeoutFor('claude', claudeTimeoutMs);
  updateStatus(run.dir, (s) => appendHistory({ ...s, state: 'running', nextAgent: 'claude' }, { event: 'claude-started' }));
  const res = spawnAgent('claude', 'claude', ['-p', '--model', 'fable', '--permission-mode', 'plan', '--add-dir', request.cwd], {
    cwd: request.cwd,
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
    timeout: timeoutMs,
  });
  writeFileSync(outputFile, res.stdout || '');
  if (res.stderr) writeFileSync(join(run.dir, 'fable-stderr.txt'), res.stderr);
  if (isTimedOut(res)) {
    const route = readJson(join(run.dir, 'route.json'));
    const fallbackOutput = [
      `Fable timed out after ${timeoutMs}ms.`,
      'Fallback: Codex should continue locally from the original task, inspect the repository, produce the smallest safe plan, and run proof.',
      'Do not assume a Fable handoff exists.',
    ].join('\n');
    writeFileSync(outputFile, `${fallbackOutput}\n`);
    writePromptFiles(run.dir, request, route, fallbackOutput);
    updateStatus(run.dir, (s) => appendHistory(
      { ...s, state: 'queued', nextAgent: 'codex', phase: 'codex-after-fable-timeout', fableTimedOut: true },
      { event: 'claude-timed-out', timeoutMs, output: outputFile, fallback: 'codex' },
    ));
    console.log(`jidoka-relay: Claude timed out after ${timeoutMs}ms, Codex fallback queued for ${run.id}`);
    return;
  }
  if (res.status !== 0) {
    updateStatus(run.dir, (s) => appendHistory({ ...s, state: 'failed', nextAgent: null }, { event: 'claude-failed', status: res.status }));
    throw new Error(`claude failed with status ${res.status}`);
  }
  const route = readJson(join(run.dir, 'route.json'));
  writePromptFiles(run.dir, request, route, res.stdout || '');
  updateStatus(run.dir, (s) => appendHistory({ ...s, state: 'queued', nextAgent: 'codex', phase: 'codex-after-fable' }, { event: 'claude-done', output: outputFile }));
  console.log(`jidoka-relay: Claude done, Codex queued for ${run.id}`);
}

function runCodex(run, { allowCodexWrite = false, codexTimeoutMs = null } = {}) {
  const request = readJson(join(run.dir, 'request.json'));
  const route = readJson(join(run.dir, 'route.json'));
  const prompt = readFileSync(join(run.dir, 'codex-prompt.md'), 'utf8');
  const outputFile = join(run.dir, 'codex-output.md');
  const sandbox = allowCodexWrite ? 'workspace-write' : 'read-only';
  const timeoutMs = timeoutFor('codex', codexTimeoutMs);
  updateStatus(run.dir, (s) => appendHistory({ ...s, state: 'running', nextAgent: 'codex' }, { event: 'codex-started', sandbox }));
  const res = spawnAgent('codex', 'codex', ['exec', '-m', 'gpt-5.5', '-C', request.cwd, '-s', sandbox, '-o', outputFile, '-'], {
    cwd: request.cwd,
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
    timeout: timeoutMs,
  });
  if (res.stdout) writeFileSync(join(run.dir, 'codex-stdout.txt'), res.stdout);
  if (res.stderr) writeFileSync(join(run.dir, 'codex-stderr.txt'), res.stderr);
  if (isTimedOut(res)) {
    updateStatus(run.dir, (s) => appendHistory(
      { ...s, state: 'failed', nextAgent: null, phase: 'codex-timeout' },
      { event: 'codex-timed-out', timeoutMs, output: outputFile },
    ));
    throw new Error(`codex timed out after ${timeoutMs}ms`);
  }
  if (res.status !== 0) {
    updateStatus(run.dir, (s) => appendHistory({ ...s, state: 'failed', nextAgent: null }, { event: 'codex-failed', status: res.status }));
    throw new Error(`codex failed with status ${res.status}`);
  }
  if (route.route === 'codex-then-fable-review' && !readJson(join(run.dir, 'status.json')).fableReviewed) {
    const reviewText = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '';
    writeFileSync(join(run.dir, 'claude-prompt.md'), [
      '# Jidoka Local Relay: Claude Fable 5 Review After Codex',
      '',
      'Review the Codex implementation result. Do not edit files.',
      '',
      `Working directory: ${request.cwd}`,
      '',
      '## Original Task',
      request.task,
      '',
      '## Codex Result',
      reviewText,
      '',
      '## Output Required',
      '- Blockers',
      '- Non-blocking risks',
      '- Missing proof',
      '- Concrete fixes for Codex',
      '- Ship/no-ship recommendation',
    ].join('\n') + '\n');
    updateStatus(run.dir, (s) => appendHistory({ ...s, state: 'queued', nextAgent: 'claude', phase: 'fable-review-after-codex', fableReviewed: true }, { event: 'codex-done-review-needed', output: outputFile }));
  } else {
    updateStatus(run.dir, (s) => appendHistory({ ...s, state: 'done', nextAgent: null, phase: 'complete' }, { event: 'codex-done', output: outputFile }));
  }
  console.log(`jidoka-relay: Codex finished ${run.id}`);
}

function runAgent(agent, id, options = {}) {
  ensureStore();
  const run = id ? { id, dir: runDir(id), status: readJson(join(runDir(id), 'status.json'), {}) } : nextFor(agent);
  if (!run) { console.log(`jidoka-relay: no queued task for ${agent}`); return; }
  if (agent === 'claude') return runClaude(run, options);
  if (agent === 'codex') return runCodex(run, options);
  throw new Error('agent must be claude or codex');
}

function commandRun() {
  const agent = arg('--agent');
  const id = arg('--id');
  if (!agent) throw new Error('missing --agent claude|codex');
  runAgent(agent, id, {
    allowCodexWrite: has('--allow-codex-write'),
    claudeTimeoutMs: timeoutFor('claude'),
    codexTimeoutMs: timeoutFor('codex'),
  });
}

function commandAuto() {
  const run = createRun({
    task: arg('--task'),
    cwd: arg('--cwd', process.cwd()),
    from: arg('--from', 'user'),
    phase: arg('--phase', 'intake'),
    changedLines: Number(arg('--changed-lines', '0')),
    risk: arg('--risk', ''),
  });
  const allowCodexWrite = has('--allow-codex-write');
  const dryRun = has('--dry-run');
  console.log(`jidoka-relay: auto ${run.id}`);
  console.log(`  route: ${run.route.route}`);
  console.log(`  dir: ${run.dir}`);
  if (dryRun) {
    console.log(`  dry-run: next=${run.status.nextAgent} phase=${run.status.phase}`);
    return;
  }

  const maxSteps = 6;
  for (let step = 1; step <= maxSteps; step += 1) {
    const status = readJson(join(run.dir, 'status.json'), {});
    if (status.state === 'done') {
      console.log(`jidoka-relay: done ${run.id}`);
      console.log(`  result: ${join(run.dir, 'codex-output.md')}`);
      console.log(`  status: ${join(run.dir, 'status.json')}`);
      return;
    }
    if (status.state === 'failed') throw new Error(`run failed: ${run.id}`);
    if (!status.nextAgent) throw new Error(`run has no next agent: ${run.id}`);
    console.log(`jidoka-relay: step ${step}/${maxSteps} -> ${status.nextAgent} (${status.phase})`);
    runAgent(status.nextAgent, run.id, {
      allowCodexWrite,
      claudeTimeoutMs: timeoutFor('claude'),
      codexTimeoutMs: timeoutFor('codex'),
    });
  }
  throw new Error(`run did not finish within ${maxSteps} relay steps: ${run.id}`);
}

function commandWatch() {
  const agent = arg('--agent');
  if (!agent) throw new Error('missing --agent claude|codex');
  const poll = Number(arg('--poll', '5'));
  const run = has('--run');
  console.log(`jidoka-relay: watching ${STORE} for ${agent} tasks (${run ? 'run' : 'notify'} mode)`);
  setInterval(() => {
    try {
      const next = nextFor(agent);
      if (!next) return;
      if (!run) return printRun(next);
      runAgent(agent, next.id, {
        allowCodexWrite: has('--allow-codex-write'),
        claudeTimeoutMs: timeoutFor('claude'),
        codexTimeoutMs: timeoutFor('codex'),
      });
    } catch (e) {
      console.error(`jidoka-relay: ${e.message}`);
    }
  }, Math.max(1, poll) * 1000);
}

function pidPath(agent) {
  return join(STORE, `${agent}.pid`);
}

function isAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function watcherInfo(agent) {
  const p = pidPath(agent);
  if (!existsSync(p)) return { agent, running: false, pid: null };
  const pid = readFileSync(p, 'utf8').trim();
  return { agent, running: isAlive(pid), pid };
}

function startWatcher(agent, extraArgs = []) {
  ensureStore();
  const info = watcherInfo(agent);
  if (info.running) return info;
  const log = openSync(join(STORE, 'logs', `${agent}.log`), 'a');
  const err = openSync(join(STORE, 'logs', `${agent}.err.log`), 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'watch', '--agent', agent, '--run', ...extraArgs], {
    detached: true,
    stdio: ['ignore', log, err],
  });
  child.unref();
  writeFileSync(pidPath(agent), `${child.pid}\n`);
  return { agent, running: true, pid: child.pid };
}

function commandStartWatchers() {
  const timeoutArgs = [
    '--claude-timeout-ms', String(timeoutFor('claude')),
    '--codex-timeout-ms', String(timeoutFor('codex')),
  ];
  const claude = startWatcher('claude', timeoutArgs);
  const codexArgs = has('--allow-codex-write') ? ['--allow-codex-write', ...timeoutArgs] : timeoutArgs;
  const codex = startWatcher('codex', codexArgs);
  console.log(`jidoka-relay: claude watcher pid=${claude.pid}`);
  console.log(`jidoka-relay: codex watcher pid=${codex.pid}${has('--allow-codex-write') ? ' (write mode)' : ' (read-only mode)'}`);
  console.log(`logs: ${join(STORE, 'logs')}`);
}

function commandWatcherStatus() {
  ensureStore();
  for (const agent of ['claude', 'codex']) {
    const info = watcherInfo(agent);
    console.log(`${agent}: ${info.running ? 'running' : 'stopped'}${info.pid ? ` pid=${info.pid}` : ''}`);
  }
}

function commandStopWatchers() {
  ensureStore();
  for (const agent of ['claude', 'codex']) {
    const info = watcherInfo(agent);
    if (!info.running) {
      console.log(`${agent}: already stopped`);
      continue;
    }
    process.kill(Number(info.pid), 'SIGTERM');
    console.log(`${agent}: stopped pid=${info.pid}`);
  }
}

function selfTest() {
  const old = process.env.JIDOKA_RELAY_DIR;
  setStore(join(tmpdir(), `jidoka-relay-test-${Date.now()}`));
  const run = createRun({ task: 'plan architecture for a large billing migration', cwd: process.cwd(), from: 'self-test' });
  const fails = [];
  const ok = (name, pass) => { if (!pass) fails.push(name); console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  ok('creates a run directory', existsSync(run.dir));
  ok('routes architecture migration to Claude first', run.status.nextAgent === 'claude');
  ok('writes Claude prompt', existsSync(join(run.dir, 'claude-prompt.md')));
  ok('writes Codex prompt', existsSync(join(run.dir, 'codex-prompt.md')));
  ok('nextFor(claude) finds the run', nextFor('claude')?.id === run.id);
  ok('watcher info is stopped before start', watcherInfo('claude').running === false);
  const timeoutRun = createRun({ task: 'plan architecture for a timeout fallback', cwd: process.cwd(), from: 'self-test' });
  const previousTimeoutAgent = process.env.JIDOKA_RELAY_TEST_TIMEOUT_AGENT;
  process.env.JIDOKA_RELAY_TEST_TIMEOUT_AGENT = 'claude';
  runClaude({ id: timeoutRun.id, dir: timeoutRun.dir, status: readJson(join(timeoutRun.dir, 'status.json'), {}) }, { claudeTimeoutMs: 1 });
  if (previousTimeoutAgent === undefined) delete process.env.JIDOKA_RELAY_TEST_TIMEOUT_AGENT;
  else process.env.JIDOKA_RELAY_TEST_TIMEOUT_AGENT = previousTimeoutAgent;
  const timeoutStatus = readJson(join(timeoutRun.dir, 'status.json'), {});
  ok('Claude timeout queues Codex fallback', timeoutStatus.nextAgent === 'codex' && timeoutStatus.phase === 'codex-after-fable-timeout');
  ok('Claude timeout records history', timeoutStatus.history.some((e) => e.event === 'claude-timed-out'));
  const codexRun = createRun({ task: 'add a button and run tests', cwd: process.cwd(), from: 'self-test' });
  ok('clear execution auto run starts with Codex', codexRun.status.nextAgent === 'codex');
  const cyrillicA = createRun({ task: 'спланируй архитектуру миграции', cwd: process.cwd(), from: 'self-test' });
  const cyrillicB = createRun({ task: 'добавь кнопку и тесты', cwd: process.cwd(), from: 'self-test' });
  ok('cyrillic tasks get unique run ids', cyrillicA.id !== cyrillicB.id);
  setStore(old || DEFAULT_STORE);
  if (fails.length) { console.log(`\n\x1b[31mjidoka-relay self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ jidoka-relay: local queue and prompts work\x1b[0m');
  process.exit(0);
}

function help() {
  console.log(`jidoka-relay - local no-API Claude/Codex relay

Commands:
  start --task <text> [--cwd <dir>] [--from <who>] [--run] [--allow-codex-write] [--claude-timeout-ms N] [--codex-timeout-ms N]
  auto --task <text> [--cwd <dir>] [--from <who>] [--allow-codex-write] [--dry-run] [--claude-timeout-ms N] [--codex-timeout-ms N]
  list [--agent claude|codex]
  next --agent claude|codex
  prompt --id <run-id> --agent claude|codex
  run --agent claude|codex [--id <run-id>] [--allow-codex-write] [--claude-timeout-ms N] [--codex-timeout-ms N]
  watch --agent claude|codex [--run] [--allow-codex-write] [--poll 5] [--claude-timeout-ms N] [--codex-timeout-ms N]
  start-watchers [--allow-codex-write] [--claude-timeout-ms N] [--codex-timeout-ms N]
  watcher-status
  stop-watchers
  --self-test

Defaults:
  Claude/Fable timeout: ${DEFAULT_CLAUDE_TIMEOUT_MS}ms (override with JIDOKA_CLAUDE_TIMEOUT_MS)
  Codex timeout:        ${DEFAULT_CODEX_TIMEOUT_MS}ms (override with JIDOKA_CODEX_TIMEOUT_MS)
`);
}

const command = process.argv[2];
try {
  if (has('--self-test')) selfTest();
  if (!command || command === '-h' || command === '--help') help();
  else if (command === 'start') commandStart();
  else if (command === 'auto') commandAuto();
  else if (command === 'list') commandList();
  else if (command === 'next') commandNext();
  else if (command === 'prompt') commandPrompt();
  else if (command === 'run') commandRun();
  else if (command === 'watch') commandWatch();
  else if (command === 'start-watchers') commandStartWatchers();
  else if (command === 'watcher-status') commandWatcherStatus();
  else if (command === 'stop-watchers') commandStopWatchers();
  else { console.error(`unknown command: ${command}`); help(); process.exit(2); }
} catch (e) {
  console.error(`jidoka-relay: ${e.message}`);
  process.exit(1);
}
