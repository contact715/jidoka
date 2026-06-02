#!/usr/bin/env node
// jidoka — one CLI to drive the engine (GSD borrow #4: gsd-tools unified entry).
//
// jidoka has 140+ scripts; remembering which to run is friction (gsd-core fronts its engine with one
// `gsd-tools` CLI). This is that single door: `jidoka <subcommand> [args]` dispatches to the right
// engine script and passes args through. `jidoka` (no args) or `--help` lists every subcommand.
//
// Anti-ghost: the dispatch map only points at scripts that EXIST on disk — the self-test fails if a
// subcommand maps to a missing script, so this CLI can never advertise a command that isn't real.
//
// FULL & self-tested. Usage:
//   node scripts/jidoka.mjs --self-test
//   node scripts/jidoka.mjs <subcommand> [args...]      e.g.  jidoka eval   ·   jidoka resume wave-1

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

// subcommand → { s: engine script, prepend?: fixed args, help: one-liner }
export const CMDS = {
  audit: { s: 'meta-audit.mjs', help: 'recurrence / regression / ungated mistake classes' },
  honesty: { s: 'meta-honesty.mjs', help: 'audit the honesty of the learning signal itself' },
  trend: { s: 'meta-trend.mjs', help: 'learning trend over time (incidents, fitness, coverage)' },
  eval: { s: 'eval-suite.mjs', help: 'deterministic eval suite vs baseline' },
  ghosts: { s: 'instantiation-audit.mjs', help: 'anti-ghost: every declared mechanism is real' },
  gates: { s: 'gate-audit.mjs', help: 'map of all gates by layer + CI-ghost detection' },
  graduation: { s: 'gate-graduation.mjs', help: 'soft→hard gate promotion readiness' },
  mutation: { s: 'mutation-test.mjs', help: 'mutation testing of the engine' },
  property: { s: 'property-test.mjs', help: 'property-based testing (forAll)' },
  commands: { s: 'check-commands.mjs', help: 'validate the slash-command surface' },
  plan: { s: 'orchestration-planner.mjs', help: 'compose the agent graph for a task' },
  'plan-check': { s: 'plan-check.mjs', help: 'pre-execution plan validation' },
  goal: { s: 'verify-goal-backward.mjs', help: 'trace a goal backward to shipped evidence' },
  debate: { s: 'debate-trigger.mjs', help: 'route a question to an adversarial debate' },
  model: { s: 'model-tier.mjs', help: 'pick agent model by tier (quality/balanced/budget)' },
  sandbox: { s: 'sandbox-run.mjs', help: 'run a command in a kernel sandbox' },
  coverage: { s: 'coverage-gate.mjs', help: 'coverage ratchet gate' },
  deps: { s: 'dependency-audit.mjs', help: 'supply-chain (npm audit) gate' },
  resume: { s: 'run-state.mjs', prepend: ['--resume'], help: 'resume a wave from its on-disk journal' },
  'run-state': { s: 'run-state.mjs', help: 'wave run-journal (init/advance/resume)' },
  guard: { s: 'pre-publish-guard.mjs', help: 'secret/PII pre-publish guard' },
  deadcode: { s: 'dead-code.mjs', help: 'find orphaned (unreferenced) engine scripts' },
  types: { s: 'type-coverage.mjs', help: 'TS type-escape density gate (any/@ts-ignore)' },
  contract: { s: 'contract-check.mjs', help: 'fe↔be API contract gate' },
  bench: { s: 'agent-benchmark.mjs', help: 'agent task-resolution benchmark (outcome-based)' },
  trajectory: { s: 'trajectory-score.mjs', help: 'score an agent trajectory (path, not just outcome)' },
  calibration: { s: 'judge-calibration.mjs', help: 'judge agreement + drift calibration' },
  adaptive: { s: 'adaptive-verify.mjs', help: 'adaptive test-time verification (scale N by risk)' },
  'frontier-eval': { s: 'frontier-eval.mjs', help: 'run post-wave frontier evals (benchmark+trajectory+calibration)' },
};

export function resolve(cmd) {
  const e = CMDS[cmd];
  return e ? { script: e.s, prepend: e.prepend || [] } : null;
}
export const subcommands = () => Object.keys(CMDS);

function help() {
  console.log('jidoka — one CLI for the engine. Usage: jidoka <subcommand> [args]\n');
  const w = Math.max(...subcommands().map((c) => c.length));
  for (const c of subcommands()) console.log(`  ${c.padEnd(w)}  ${CMDS[c].help}`);
  console.log('\n  e.g.  node scripts/jidoka.mjs eval   ·   node scripts/jidoka.mjs resume wave-1');
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('resolve(audit) → meta-audit.mjs', resolve('audit')?.script === 'meta-audit.mjs');
  ok('resolve(unknown) → null', resolve('nope') === null);
  ok('resume prepends --resume', resolve('resume')?.prepend.join() === '--resume');
  ok('at least 18 subcommands', subcommands().length >= 18);
  // ANTI-GHOST: every mapped subcommand points at a script that exists on disk
  const ghosts = subcommands().filter((c) => !existsSync(join(HERE, CMDS[c].s)));
  ok(`no ghost subcommand (every mapping resolves to a real script)`, ghosts.length === 0);
  if (ghosts.length) console.log(`      ghosts: ${ghosts.map((c) => `${c}→${CMDS[c].s}`).join(', ')}`);
  ok('every subcommand has a help string', subcommands().every((c) => typeof CMDS[c].help === 'string' && CMDS[c].help.length > 0));

  if (fails.length) { console.log(`\n\x1b[31mjidoka CLI self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ jidoka CLI: dispatch map correct (no ghost subcommand)\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') { help(); process.exit(0); }
  const r = resolve(cmd);
  if (!r) { console.error(`unknown subcommand: ${cmd}\n`); help(); process.exit(2); }
  const rest = process.argv.slice(3);
  const res = spawnSync('node', [join(HERE, r.script), ...r.prepend, ...rest], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
