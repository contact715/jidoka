#!/usr/bin/env node
// replan-ledger — the two-registry replan controller that turns CORE_PROPERTY_GATE.md from a
// document into a live mid-run halt (W29-R3, idea from AutoGen Magentic-One's orchestrator ledger;
// the PACKAGE is rejected — zero-dependency pure Node, this is a native ~port of the idea only).
//
// THE GAP IT CLOSES: `core-property-substituted-by-scaffold` (the owner's "signature lie" caught on
// projectx — CORE_PROPERTY_GATE.md is today only prose, with no mechanical enforcement) AND the
// empty architectural loop: stuck-detector.detect() TRIPS on a stall, but nothing then RE-PLANS —
// the run just burns to the cost ceiling. This controller sits between the trip and the halt.
//
// TWO REGISTRIES (Magentic-One): a wave-scoped ledger of
//   { wave, coreProperty, facts:[…known], guesses:[…assumed], plan:[…remaining steps], stalls:[…], replans }
// On a stall diagnosis (from stuck-detector.detect → {stuck,pattern,detail}), replan() decides:
//   • HALT  — when the SAME stall pattern recurs after a replan already tried to fix it (no-progress
//             loop), or when the core property shows a deterministic scaffold-substitution signal.
//   • REPLAN — otherwise: re-derive the remaining plan (drop the stalled step to the back, inject a
//             diagnosis-addressing step) and hand the new node list to scheduleDAG for re-dispatch.
//
// HONEST SCOPE (Engineering Discipline §8 + the very rule this closes): the full "is the core
// property substituted by scaffold?" judgement is what CORE_PROPERTY_GATE.md says only a human sense
// reliably catches. This mechanizes the DETERMINISTIC subset the doc enumerates — template/regex
// trigger, mock/stub instead of live data, fixed list instead of generation, one hardcoded case —
// and FORCES the check to run and be recorded on every stall. It does not claim to replace the human
// core-property sense; it catches the mechanical tells and halts the run before drift compounds.
//
// Usage:
//   node scripts/replan-ledger.mjs --self-test
//   node scripts/replan-ledger.mjs --decide <ledger.json> --pattern <p> --detail "<d>"   # prints action

import { readFileSync } from 'node:fs';

// ── two-registry ledger ────────────────────────────────────────────
export function newLedger({ wave = '?', coreProperty = '', facts = [], guesses = [], plan = [] } = {}) {
  return { wave, coreProperty, facts: [...facts], guesses: [...guesses], plan: [...plan], stalls: [], replans: 0 };
}

// ── deterministic scaffold-substitution signals (mechanizes CORE_PROPERTY_GATE.md §3) ──
// A core property that DEMANDS a dynamic quality (non-determinism / generation / live data / real
// time / "any words" / self-learning) is SUBSTITUTED when the evidence for it shows only scaffold
// markers (template/regex trigger, mock/stub, fixed list, demo, one hardcoded case). Returns the
// findings [{demand, scaffold}] — empty means no mechanical tell (which is NOT proof of no drift).
const DYNAMIC_DEMAND = /(недетерминированн|сама реша|любыми словами|в реальн\w* времени|генери\w*|самообуча\w*|non-?determinist|generat(e|ive|ion)|real-?time|any words|self-?learn)/i;
const SCAFFOLD_MARK = /(шаблон\w*|регэксп\w*|мок\b|моку|заглушк\w*|фиксирован\w* список|захардкож\w*|template|regex|regexp|\bmock(s|ed|ing)?\b|\bstub(s|bed)?\b|hard-?cod\w*|fixed list|fixed-?list|demo(-| )scenario|single case)/i;
export function coreSubstitutionSignals(coreProperty = '', evidenceText = '') {
  if (!DYNAMIC_DEMAND.test(String(coreProperty))) return []; // property makes no dynamic demand → no mechanical rule
  const ev = String(evidenceText);
  const scaffold = ev.match(SCAFFOLD_MARK);
  const provesDynamic = DYNAMIC_DEMAND.test(ev); // evidence itself demonstrates the dynamic quality
  if (scaffold && !provesDynamic) {
    return [{ demand: String(coreProperty).match(DYNAMIC_DEMAND)[0], scaffold: scaffold[0] }];
  }
  return [];
}

// ── the decision ───────────────────────────────────────────────────
// diagnosis = stuck-detector.detect() output { stuck, pattern, detail }.
// evidenceText (optional) = the current proof/output for the core-property AC, checked for scaffold.
export function replan(ledger, diagnosis = {}, evidenceText = '') {
  const lg = { ...ledger, stalls: [...(ledger.stalls || [])], plan: [...(ledger.plan || [])], replans: ledger.replans || 0 };
  const subs = coreSubstitutionSignals(lg.coreProperty, evidenceText);
  if (subs.length) {
    return { action: 'halt', reason: `core-property substituted by scaffold: core property demands "${subs[0].demand}" but evidence shows "${subs[0].scaffold}" and never demonstrates the dynamic quality`, ledger: lg, substitutions: subs };
  }
  if (!diagnosis.stuck) return { action: 'continue', reason: 'no stall', ledger: lg };

  const priorSamePattern = lg.stalls.some(s => s.pattern === diagnosis.pattern);
  lg.stalls.push({ pattern: diagnosis.pattern, detail: diagnosis.detail });
  if (priorSamePattern) {
    return { action: 'halt', reason: `no-progress loop: stall pattern "${diagnosis.pattern}" recurred after a replan already addressed it (${diagnosis.detail})`, ledger: lg };
  }
  // recoverable: re-derive the plan — move the stalled step to the back, inject a step that
  // addresses the diagnosis so the next attempt is different, not a repeat.
  const stalledStep = lg.plan[0];
  const rest = lg.plan.slice(1);
  const fix = `address-stall(${diagnosis.pattern}): ${diagnosis.detail}`;
  lg.plan = [fix, ...rest, ...(stalledStep !== undefined ? [stalledStep] : [])];
  lg.replans += 1;
  return { action: 'replan', reason: `stall "${diagnosis.pattern}" is new — re-planning once`, plan: lg.plan, ledger: lg };
}

// ── self-test (deterministic) ──────────────────────────────────────
function selfTest() {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  // scaffold-substitution detector — the CORE_PROPERTY_GATE mechanization
  ok('dynamic demand + scaffold-only evidence → substitution flagged',
    coreSubstitutionSignals('среда должна быть недетерминированной, любыми словами', 'intent matched via regex template, plain-text fallback').length === 1);
  ok('dynamic demand BUT evidence demonstrates the dynamic quality → no false halt',
    coreSubstitutionSignals('система сама решает недетерминированно', 'model generates the decision at runtime, non-deterministic across phrasings').length === 0);
  ok('no dynamic demand in core property → detector is a no-op (no over-reach)',
    coreSubstitutionSignals('render the count badge', 'hardcoded mock list of 3 items').length === 0);
  ok('English core property + mock evidence → substitution flagged',
    coreSubstitutionSignals('the assistant must generate answers to any words', 'returns a fixed list from a hardcoded stub').length === 1);

  // replan decision
  const base = newLedger({ wave: 'w1', coreProperty: 'x', plan: ['stepA', 'stepB', 'stepC'] });
  const cont = replan(base, { stuck: false });
  ok('no stall → action continue, plan untouched', cont.action === 'continue');

  const first = replan(base, { stuck: true, pattern: 'repeated-error', detail: '"E" ×3' });
  ok('new stall → action replan', first.action === 'replan');
  ok('replan injects a diagnosis-addressing step at the front', first.plan[0].startsWith('address-stall(repeated-error)'));
  ok('replan moves the stalled step to the back', first.plan[first.plan.length - 1] === 'stepA');
  ok('replan increments replans counter', first.ledger.replans === 1);

  const second = replan(first.ledger, { stuck: true, pattern: 'repeated-error', detail: '"E" ×4' });
  ok('SAME stall pattern recurs after a replan → action halt (no-progress loop)', second.action === 'halt');

  const drift = replan(newLedger({ coreProperty: 'must be non-deterministic', plan: ['s'] }), { stuck: false }, 'matched with a regex template, no model call');
  ok('core-property scaffold drift → halt even without a stall', drift.action === 'halt' && drift.substitutions.length === 1);

  if (fails.length) { console.log(`\n\x1b[31mreplan-ledger self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ replan-ledger: two-registry replan + core-property scaffold halt correct\x1b[0m');
  process.exit(0);
}

// ── CLI ────────────────────────────────────────────────────────────
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) selfTest();
  const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const ledgerPath = arg('--decide');
  if (!ledgerPath) { console.error('usage: replan-ledger.mjs --decide <ledger.json> --pattern <p> --detail "<d>" [--evidence "<text>"] | --self-test'); process.exit(1); }
  let ledger;
  try { ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); }
  catch (e) { console.error(`✗ cannot read ledger ${ledgerPath}: ${e.message}`); process.exit(1); }
  const pattern = arg('--pattern');
  const decision = replan(ledger, pattern ? { stuck: true, pattern, detail: arg('--detail') || '' } : { stuck: false }, arg('--evidence') || '');
  console.log(JSON.stringify(decision, null, 2));
  // exit 2 = andon tripwire (same convention as policy-enforce-hook): a halt stops the run.
  process.exit(decision.action === 'halt' ? 2 : 0);
}
