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
import { EventEmitter } from 'node:events';

// ── two-registry ledger ────────────────────────────────────────────
export function newLedger({ wave = '?', coreProperty = '', facts = [], guesses = [], plan = [] } = {}) {
  return { wave, coreProperty, facts: [...facts], guesses: [...guesses], plan: [...plan], stalls: [], replans: 0, stallStreak: {} };
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

// stall-streak-reset (2026-W32-R10) — the halt rule used `lg.stalls.some(...)`, which looks at
// the WHOLE history: a run that stalled, replanned, made real progress for twenty steps and
// only much later hit the same pattern again was halted as a "no-progress loop", even though
// the replan had demonstrably worked. A streak that RESETS on progress separates "stuck" from
// "stumbled once, recovered, stumbled again".
//
// CALIBRATED, NOT ASSUMED. scripts/replan-replay.mjs replayed 186 real session transcripts,
// 49821 assistant steps, 3041 stall events:
//
//   rule                          halts   premature
//   current (any prior pattern)    2812      93.8%
//   streak, threshold 2            1092      92.5%
//   streak, threshold 3             623      92.0%
//   streak, threshold 4             370      91.9%
//
// The streak removes 61-87% of the bogus halts, so it is a strict improvement and ships. But
// the premature RATE barely moves: even at threshold 4, more than nine halts in ten would kill
// a run that was still making progress. So the conclusion is not "now we can wire it" — it is
// the opposite, and it is now a measured statement rather than a worry: this halt MUST NOT be
// connected to a live hook. The next lever is the detector's sensitivity, not the counter.

/** Any deterministic sign of progress clears every pattern streak. Pure. */
export function noteProgress(ledger) {
  return { ...ledger, stallStreak: {} };
}

// ── the decision ───────────────────────────────────────────────────
// diagnosis = stuck-detector.detect() output { stuck, pattern, detail }.
// evidenceText (optional) = the current proof/output for the core-property AC, checked for scaffold.

// ── checkpoint stream: observability + crash-resume (2026-W29-R6, langgraph shape) ───────────
// The controller decides — continue, replan, halt — and those decisions used to exist only as a
// return value the caller may or may not log. Two things were impossible as a result. First,
// WATCHING a long run: nothing emitted, so a wave in progress was a black box until it ended.
// Second, RESUMING one: the ledger lived in memory, so a crash lost every stall, streak and replan
// the run had learned, and the retry started from a blank controller that would repeat the same
// stalls before halting again.
//
// node:events is a builtin, so this stays zero-dep. Purity is preserved deliberately: `replan()`
// emits ONLY when a stream is handed to it. With no stream it behaves exactly as before, which is
// why every existing test keeps passing unchanged.
export const CHECKPOINT_EVENTS = ['continue', 'replan', 'halt'];

/** An observer for a run. Attach listeners before dispatching; never required. */
export function createCheckpointStream() {
  const em = new EventEmitter();
  em.setMaxListeners(50);
  return em;
}

/**
 * Serialize a ledger to a resumable checkpoint. Pure.
 * `version` is stamped so a checkpoint written by an older shape can be REFUSED rather than
 * silently half-restored — a partial resume is worse than no resume, because it looks like state.
 */
export const CHECKPOINT_VERSION = 1;
export function checkpoint(ledger = {}) {
  return JSON.stringify({
    version: CHECKPOINT_VERSION,
    wave: ledger.wave ?? '?',
    coreProperty: ledger.coreProperty ?? '',
    facts: ledger.facts ?? [],
    guesses: ledger.guesses ?? [],
    plan: ledger.plan ?? [],
    stalls: ledger.stalls ?? [],
    stallStreak: ledger.stallStreak ?? {},
    replans: ledger.replans ?? 0,
  });
}

/**
 * Restore a ledger from a checkpoint. Returns { ok, ledger, reason }.
 * A wrong or missing version is REFUSED: resuming from a shape this code does not understand
 * would produce a controller that looks initialised and has lost half its history.
 */
export function restore(text = '') {
  let o;
  try { o = JSON.parse(String(text)); } catch { return { ok: false, ledger: null, reason: 'контрольная точка не разбирается как JSON' }; }
  if (!o || typeof o !== 'object') return { ok: false, ledger: null, reason: 'контрольная точка пуста' };
  if (o.version !== CHECKPOINT_VERSION) {
    return { ok: false, ledger: null, reason: `версия контрольной точки ${o.version ?? '(нет)'} не совпадает с текущей ${CHECKPOINT_VERSION}: частичное восстановление опаснее отсутствия` };
  }
  const { version, ...ledger } = o;
  return { ok: true, ledger, reason: 'восстановлено полностью' };
}

export function replan(ledger, diagnosis = {}, evidenceText = '', opts = {}) {
  const lg = { ...ledger, stalls: [...(ledger.stalls || [])], plan: [...(ledger.plan || [])], replans: ledger.replans || 0 };
  // emit only when the caller asked to observe; with no stream this function stays pure
  const emit = (out) => { try { opts.stream?.emit(out.action, { ...out, at: opts.now ?? null }); } catch { /* an observer must never break the controller */ } return out; };
  const subs = coreSubstitutionSignals(lg.coreProperty, evidenceText);
  if (subs.length) {
    return emit({ action: 'halt', reason: `core-property substituted by scaffold: core property demands "${subs[0].demand}" but evidence shows "${subs[0].scaffold}" and never demonstrates the dynamic quality`, ledger: lg, substitutions: subs });
  }
  if (!diagnosis.stuck) return emit({ action: 'continue', reason: 'no stall', ledger: lg });

  const threshold = Number(opts.stallThreshold ?? 2);
  lg.stallStreak = { ...(lg.stallStreak || {}) };
  const streak = (lg.stallStreak[diagnosis.pattern] || 0) + 1;
  lg.stallStreak[diagnosis.pattern] = streak;
  lg.stalls.push({ pattern: diagnosis.pattern, detail: diagnosis.detail, streak });
  if (streak >= threshold) {
    lg.stallStreak[diagnosis.pattern] = 0; // one loop is reported once, not on every later stall
    return emit({ action: 'halt', reason: `no-progress loop: stall pattern "${diagnosis.pattern}" hit ${streak}× with no progress in between (${diagnosis.detail})`, ledger: lg });
  }
  // recoverable: re-derive the plan — move the stalled step to the back, inject a step that
  // addresses the diagnosis so the next attempt is different, not a repeat.
  const stalledStep = lg.plan[0];
  const rest = lg.plan.slice(1);
  const fix = `address-stall(${diagnosis.pattern}): ${diagnosis.detail}`;
  lg.plan = [fix, ...rest, ...(stalledStep !== undefined ? [stalledStep] : [])];
  lg.replans += 1;
  return emit({ action: 'replan', reason: `stall "${diagnosis.pattern}" is new — re-planning once`, plan: lg.plan, ledger: lg });
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

  // ── stall streak with reset on progress (2026-W32-R10) ──────────────
  {
    const d = { stuck: true, pattern: 'repeated-error', detail: 'same error' };
    let lg = newLedger({ wave: 'w', coreProperty: 'p', plan: ['a', 'b'] });

    // first stall replans, second in a row halts — same strictness as before for a real loop
    const r1 = replan(lg, d);
    ok('first stall still replans', r1.action === 'replan');
    const r2 = replan(r1.ledger, d);
    ok('second stall of the same pattern with no progress → halt', r2.action === 'halt');
    ok('halt names the streak count', /2×/.test(r2.reason));

    // THE FIX: progress between two stalls means this is not a loop
    const afterProgress = noteProgress(replan(lg, d).ledger);
    ok('progress clears the streak', Object.values(afterProgress.stallStreak).every(v => !v));
    const r3 = replan(afterProgress, d);
    ok('same pattern AFTER progress replans instead of halting', r3.action === 'replan');

    // and it is still recorded, so nothing is hidden
    ok('the stall history keeps every occurrence', r3.ledger.stalls.length === 2);

    // different patterns do not add up into a halt
    const other = replan(replan(lg, d).ledger, { stuck: true, pattern: 'monologue', detail: 'x' });
    ok('two different patterns do not halt', other.action === 'replan');

    // configurable threshold
    const t3a = replan(lg, d, '', { stallThreshold: 3 });
    const t3b = replan(t3a.ledger, d, '', { stallThreshold: 3 });
    ok('threshold 3: second stall still replans', t3b.action === 'replan');
    const t3c = replan(t3b.ledger, d, '', { stallThreshold: 3 });
    ok('threshold 3: third stall halts', t3c.action === 'halt');

    // after a halt the streak restarts, so one loop is reported once
    const afterHalt = replan(r2.ledger, d);
    ok('the stall right after a halt replans, not halts again', afterHalt.action === 'replan');

  // ── checkpoint stream + crash-resume (2026-W29-R6) ────────────────────────
  ok('with NO stream the controller behaves exactly as before (purity preserved)', (() => {
    const lg = newLedger({ plan: ['s'] });
    return replan(lg, { stuck: false }).action === 'continue';
  })());
  ok('a stream receives the decision it was attached for', (() => {
    const stream = createCheckpointStream();
    const seen = [];
    for (const e of CHECKPOINT_EVENTS) stream.on(e, (p) => seen.push([e, p.reason]));
    replan(newLedger({ plan: ['s'] }), { stuck: false }, '', { stream });
    return seen.length === 1 && seen[0][0] === 'continue';
  })());
  ok('a halt is observable too', (() => {
    const stream = createCheckpointStream();
    let halted = null;
    stream.on('halt', (p) => { halted = p; });
    replan(newLedger({ coreProperty: 'must be non-deterministic', plan: ['s'] }), { stuck: false }, 'matched with a regex template', { stream });
    return halted !== null && /core-property/.test(halted.reason);
  })());
  // an observer must never be able to break the thing it observes
  ok('a listener that throws does not break the controller', (() => {
    const stream = createCheckpointStream();
    stream.on('continue', () => { throw new Error('boom'); });
    return replan(newLedger({ plan: ['s'] }), { stuck: false }, '', { stream }).action === 'continue';
  })());

  ok('a checkpoint round-trips every field a run has learned', (() => {
    const lg = replan(replan(newLedger({ wave: 'w1', plan: ['a', 'b'] }),
      { stuck: true, pattern: 'p', detail: 'd' }).ledger, { stuck: true, pattern: 'q', detail: 'e' }).ledger;
    const back = restore(checkpoint(lg));
    return back.ok && JSON.stringify(back.ledger.stalls) === JSON.stringify(lg.stalls)
      && JSON.stringify(back.ledger.stallStreak) === JSON.stringify(lg.stallStreak)
      && back.ledger.replans === lg.replans && JSON.stringify(back.ledger.plan) === JSON.stringify(lg.plan);
  })());
  ok('a resumed controller keeps counting from where it crashed', (() => {
    const first = replan(newLedger({ plan: ['a'] }), { stuck: true, pattern: 'p', detail: 'd' });
    const resumed = restore(checkpoint(first.ledger)).ledger;
    // the SAME pattern again must now hit the threshold, exactly as it would have without a crash
    return replan(resumed, { stuck: true, pattern: 'p', detail: 'd' }).action === 'halt';
  })());
  // a partial resume looks like state and is worse than no resume
  ok('a checkpoint from another version is REFUSED, not half-restored',
    restore(JSON.stringify({ version: 999, plan: ['x'] })).ok === false);
  ok('the refusal says which versions disagree', /999/.test(restore(JSON.stringify({ version: 999 })).reason));
  ok('garbage is refused without throwing', restore('{not json').ok === false && restore('').ok === false);

    ok('a fresh ledger starts with an empty streak', Object.keys(newLedger({ wave: 'w', coreProperty: 'p' }).stallStreak).length === 0);
  }

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
