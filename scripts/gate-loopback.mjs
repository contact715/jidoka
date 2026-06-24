#!/usr/bin/env node
/**
 * gate-loopback — the verdict-keyed conditional edge of the run state machine.
 *
 * Closes research gap #7 (docs/research/2026-06-24_github-enrichment-research.md):
 * run-state advances strictly linearly, so the documented "gate fails → debug →
 * re-enter gate, capped at 5 rounds" loop existed only as prose. This turns it into
 * an executable decision keyed on the gate verdict that acceptance-verdict already
 * produces.
 *
 * Deterministic and self-contained (no LLM, no calibration): given the current phase,
 * the gate verdict, and the round count, it returns the next phase and the running
 * round counter. The orchestrator consults it at the gate boundary instead of always
 * picking first-not-done; run-state's --advance still records the journal.
 *
 * The one real LangGraph idea (conditional routing) built natively — LangGraph's
 * checkpoint/resume/interrupt already exist in jidoka (run-state, acceptance-verdict,
 * Andon Cord), so only this primitive was missing.
 *
 * Usage:
 *   node scripts/gate-loopback.mjs --phase gate --verdict fail --rounds 0
 *   node scripts/gate-loopback.mjs --phase debug
 *   node scripts/gate-loopback.mjs --self-test
 */

import { pathToFileURL } from 'node:url';

export const MAX_ROUNDS = 5;

/**
 * Pure routing decision. Returns { next, rounds, action }.
 *   action: 'advance' (gate passed) | 'loopback' (gate→debug) | 'reenter' (debug→gate)
 *         | 'escalate' (round cap hit → andon) | 'noop' (nothing to route)
 */
export function decideNext({ phase, verdict, rounds = 0, maxRounds = MAX_ROUNDS } = {}) {
  if (phase === 'gate') {
    if (verdict === 'pass') return { next: 'memory', rounds, action: 'advance' };
    if (verdict === 'fail') {
      if (rounds + 1 >= maxRounds) return { next: 'halt', rounds: rounds + 1, action: 'escalate' };
      return { next: 'debug', rounds: rounds + 1, action: 'loopback' };
    }
    return { next: null, rounds, action: 'noop' };
  }
  if (phase === 'debug') return { next: 'gate', rounds, action: 'reenter' };
  return { next: null, rounds, action: 'noop' };
}

function arg(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const phase = arg(args, '--phase');
  if (!phase) { console.error('gate-loopback: --phase <gate|debug> required'); process.exit(2); }
  const d = decideNext({ phase, verdict: arg(args, '--verdict'), rounds: Number(arg(args, '--rounds')) || 0 });

  if (args.includes('--json')) { process.stdout.write(JSON.stringify(d) + '\n'); return; }
  const arrow = { advance: '→ memory (gate passed)', loopback: `→ debug (round ${d.rounds}/${MAX_ROUNDS})`, reenter: '→ gate (re-run after debug)', escalate: `→ HALT — ${MAX_ROUNDS}-round cap hit, escalate to human (andon)`, noop: '→ (no routing change)' };
  console.log(`gate-loopback: ${phase}${arg(args, '--verdict') ? `/${arg(args, '--verdict')}` : ''}  ${arrow[d.action]}`);
  // escalate is the only non-zero exit so a caller/hook can branch on the round-cap.
  process.exit(d.action === 'escalate' ? 42 : 0);
}

function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); fail++; } };
  console.log('gate-loopback --self-test');

  ok(decideNext({ phase: 'gate', verdict: 'pass' }).action === 'advance', 'gate pass → advance to memory');
  ok(decideNext({ phase: 'gate', verdict: 'pass' }).next === 'memory', 'gate pass routes to memory');
  const f = decideNext({ phase: 'gate', verdict: 'fail', rounds: 0 });
  ok(f.action === 'loopback' && f.next === 'debug' && f.rounds === 1, 'gate fail → debug, round incremented');
  ok(decideNext({ phase: 'debug' }).action === 'reenter' && decideNext({ phase: 'debug' }).next === 'gate', 'debug → re-enter gate');

  // round cap: the 5th failure escalates instead of looping forever.
  ok(decideNext({ phase: 'gate', verdict: 'fail', rounds: 4 }).action === 'escalate', 'hitting the round cap escalates');
  ok(decideNext({ phase: 'gate', verdict: 'fail', rounds: 3 }).action === 'loopback', 'below the cap still loops back');

  // a custom cap is honoured.
  ok(decideNext({ phase: 'gate', verdict: 'fail', rounds: 1, maxRounds: 2 }).action === 'escalate', 'custom maxRounds respected');

  ok(decideNext({ phase: 'spec', verdict: 'pass' }).action === 'noop', 'non-gate/debug phase is a no-op');
  ok(decideNext({ phase: 'gate' }).action === 'noop', 'gate with no verdict is a no-op (waits for verdict.json)');

  console.log(fail === 0 ? '\ngate-loopback: all self-tests passed' : `\ngate-loopback: ${fail} self-test(s) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
