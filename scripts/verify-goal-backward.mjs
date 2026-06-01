#!/usr/bin/env node
// verify-goal-backward — trace a wave's GOAL backward to shipped evidence (GSD borrow E).
//
// jidoka verifies FORWARD (map-ac-coverage: AC → test) and runs rule-gates, but had no BACKWARD trace
// from the phase goal → its objectives → the artifact that actually delivers each. GSD's verifier does
// exactly this ("goal-backward analysis"). This is that, in our idiom: each objective names a
// VERIFIABLE evidence predicate (a file exists / contains a marker / a command passes), and the trace
// reports which objectives are not actually delivered. Complements, does not replace, the forward map.
//
// HONEST boundary: evidence predicates are mechanical (no LLM). "objective met" means its predicate
// holds on the real repo — it does NOT judge whether the objective is the RIGHT one (that is the
// spec's / CPO's job). It answers "did we ship what the goal said?", not "is the goal correct?".
//
// FULL & self-tested. Usage:
//   node scripts/verify-goal-backward.mjs --self-test
//   node scripts/verify-goal-backward.mjs --goal docs/runs/<wave>/goal.json [--root .]

import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// evaluate ONE evidence predicate against the real repo
export function checkEvidence(ev, { root = process.cwd(), runCmd } = {}) {
  if (!ev || typeof ev !== 'object') return { ok: false, why: 'no evidence predicate' };
  if (ev.fileExists) {
    const ok = existsSync(join(root, ev.fileExists));
    return { ok, why: ok ? `file ${ev.fileExists} exists` : `file ${ev.fileExists} MISSING` };
  }
  if (ev.fileContains) {
    const [f, sub] = ev.fileContains;
    const ok = existsSync(join(root, f)) && readFileSync(join(root, f), 'utf8').includes(sub);
    return { ok, why: ok ? `${f} contains "${sub}"` : `${f} lacks "${sub}"` };
  }
  if (ev.cmdPasses) {
    const run = runCmd || ((c) => { try { execSync(c, { cwd: root, stdio: 'ignore', timeout: 60000 }); return true; } catch { return false; } });
    const ok = run(ev.cmdPasses);
    return { ok, why: ok ? `\`${ev.cmdPasses}\` passes` : `\`${ev.cmdPasses}\` FAILS` };
  }
  return { ok: false, why: `unknown evidence type: ${Object.keys(ev).join(',')}` };
}

// trace BACKWARD: goal → each objective → its evidence; unmet objectives = goal not fully delivered
export function traceGoalBackward(goalSpec, ctx = {}) {
  const objectives = (goalSpec.objectives || []).map((o) => {
    const r = checkEvidence(o.evidence, ctx);
    return { id: o.id, desc: o.desc || '', met: r.ok, why: r.why };
  });
  const unmet = objectives.filter((o) => !o.met);
  return { goal: goalSpec.goal, objectives, met: unmet.length === 0, unmet };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const tmp = mkdtempSync(join(tmpdir(), 'jidoka-gb-'));
  try {
    writeFileSync(join(tmp, 'made.txt'), 'hello world');
    const goal = {
      goal: 'demo',
      objectives: [
        { id: 'O1', desc: 'file shipped', evidence: { fileExists: 'made.txt' } },
        { id: 'O2', desc: 'contains marker', evidence: { fileContains: ['made.txt', 'world'] } },
        { id: 'O3', desc: 'command passes', evidence: { cmdPasses: 'node -e "process.exit(0)"' } },
        { id: 'O4', desc: 'NOT delivered', evidence: { fileExists: 'missing.txt' } },
        { id: 'O5', desc: 'marker absent', evidence: { fileContains: ['made.txt', 'NOPE'] } },
      ],
    };
    const t = traceGoalBackward(goal, { root: tmp });
    ok('3 met objectives detected (fileExists/contains/cmd)', t.objectives.filter(o => o.met).length === 3);
    ok('2 unmet objectives detected (O4 missing file, O5 absent marker)', t.unmet.map(o => o.id).sort().join() === 'O4,O5');
    ok('goal NOT fully met when any objective unmet', t.met === false);
    ok('all-met goal reports met', traceGoalBackward({ goal: 'x', objectives: [{ id: 'A', evidence: { fileExists: 'made.txt' } }] }, { root: tmp }).met === true);
    ok('failing command → objective unmet', checkEvidence({ cmdPasses: 'node -e "process.exit(1)"' }, { root: tmp }).ok === false);
    ok('unknown evidence type → unmet, no crash', checkEvidence({ weird: 1 }).ok === false);
    ok('empty objectives → vacuously met', traceGoalBackward({ goal: 'x', objectives: [] }).met === true);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (fails.length) { console.log(`\n\x1b[31mverify-goal-backward self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ verify-goal-backward: goal-backward trace correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const goalFile = arg('--goal');
  if (!goalFile) { console.error('usage: verify-goal-backward.mjs --goal <goal.json> [--root .]   (or --self-test)'); process.exit(2); }
  if (!existsSync(goalFile)) { console.error(`goal file not found: ${goalFile}`); process.exit(2); }
  const root = arg('--root') || process.cwd();
  const goalSpec = JSON.parse(readFileSync(goalFile, 'utf8'));
  const t = traceGoalBackward(goalSpec, { root });
  console.log(`goal-backward: "${t.goal}"  (${t.objectives.length} objectives)\n`);
  for (const o of t.objectives) console.log(`  ${o.met ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${o.id} ${o.desc} — ${o.why}`);
  if (!t.met) { console.error(`\n\x1b[31m✗ ${t.unmet.length} objective(s) not delivered: ${t.unmet.map(o => o.id).join(', ')}\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ every objective of the goal is delivered (traced backward to real evidence).\x1b[0m`);
  process.exit(0);
}
