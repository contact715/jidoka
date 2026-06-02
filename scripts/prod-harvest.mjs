#!/usr/bin/env node
// prod-harvest — convert a production incident into a permanent regression test case in the
// agent-benchmark. Closes the Kaizen loop: a prod failure MUST become an eternal regression
// guard so the same class of problem can never ship again undetected.
//
// An incident: { id, title, description, affectedFlow, verifyCmd?, date }
// Output: a benchmark task { id, prompt, verify } that the orchestrator can use to check the fix.
// The task NEVER contains the expected patch (contamination hygiene from agent-benchmark design).
//
// Usage:
//   node scripts/prod-harvest.mjs --self-test
//   node scripts/prod-harvest.mjs --incident '{"id":"INC-42","title":"...","affectedFlow":"..."}'
//   node scripts/prod-harvest.mjs --incident '...' --append  (append to docs/benchmarks/_tasks.jsonl)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TASKS_FILE = 'docs/benchmarks/_tasks.jsonl';

export function toBenchmarkTask(incident = {}) {
  if (!incident.id || !incident.title) throw new Error('incident must have id and title');
  return {
    id: `harvest-${incident.id}`,
    prompt: `Regression guard from production incident ${incident.id}: ${incident.title}. ${incident.description || ''} Ensure the affected flow "${incident.affectedFlow || 'system'}" behaves correctly and the failure mode does NOT recur.`,
    verify: incident.verifyCmd
      ? { cmd: incident.verifyCmd, expectExit: 0 }
      : { cmd: `echo "VERIFY: incident ${incident.id} — add a real verify command for this regression"`, expectExit: 0 },
    origin: { source: 'prod-incident', incidentId: incident.id, date: incident.date || 'unknown' },
  };
}

export function append(incident) {
  const task = toBenchmarkTask(incident);
  const existing = existsSync(TASKS_FILE) ? readFileSync(TASKS_FILE, 'utf8') : '';
  if (existing.includes(`"id":"${task.id}"`)) return { task, appended: false, reason: 'already in benchmark' };
  writeFileSync(TASKS_FILE, existing + JSON.stringify(task) + '\n');
  return { task, appended: true };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const inc = { id: 'INC-1', title: 'DB write every second', description: 'setInterval without throttle', affectedFlow: 'data-sync', date: '2026-06-01' };
  const task = toBenchmarkTask(inc);
  ok('task id is harvest-INC-1', task.id === 'harvest-INC-1');
  ok('task prompt references incident id and title', task.prompt.includes('INC-1') && task.prompt.includes('DB write every second'));
  ok('task has a verify block', typeof task.verify === 'object' && 'cmd' in task.verify);
  ok('task has no diff/patch (contamination hygiene)', !('diff' in task) && !('patch' in task));
  ok('origin carries incidentId', task.origin?.incidentId === 'INC-1');
  ok('custom verifyCmd is used when provided', toBenchmarkTask({ ...inc, verifyCmd: 'npm test' }).verify.cmd === 'npm test');
  ok('missing id throws', (() => { try { toBenchmarkTask({ title: 'x' }); return false; } catch { return true; } })());
  ok('missing title throws', (() => { try { toBenchmarkTask({ id: 'x' }); return false; } catch { return true; } })());

  if (fails.length) { console.log(`\n\x1b[31mprod-harvest self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ prod-harvest: incident → benchmark task conversion correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const incJson = arg('--incident');
  if (!incJson) { console.error('usage: --incident <json> [--append]  (or --self-test)'); process.exit(2); }
  const inc = JSON.parse(incJson);
  if (process.argv.includes('--append')) {
    const r = append(inc);
    console.log(r.appended ? `\x1b[32m✓ harvest-${inc.id} added to benchmark (${TASKS_FILE})\x1b[0m` : `  already present: ${r.reason}`);
  } else {
    console.log(JSON.stringify(toBenchmarkTask(inc), null, 2));
  }
  process.exit(0);
}
