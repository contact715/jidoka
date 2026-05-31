#!/usr/bin/env node
// meta-honesty — adversarial audit of the SIGNAL the engine learns from.
//
// Every other engine in the family trusts the ledger. But a learning loop is only
// as honest as its inputs: if a logged "mistake" is really self-praise in disguise
// (a "real" that doesn't contradict the "claim"), or every miss was "caught by
// self" with no external check, the engine learns from flattery and converges on
// nothing. This is the garbage-in guard. It does NOT trust self-assessment; it
// looks for the contra-evidence that makes a retro real.
//
// Checks (per ledger entry, and per retro file if docs/retros exists):
//   self-confirming   BLOCK — `real` introduces no information `claimed` lacked →
//                             not a mistake, a tautology. Poisons the engine.
//   inflated claim    WARN  — `claimed` uses unverifiable booster words
//                             (comprehensive/seamless/flawless/…) = confidence w/o proof
//   self-reported     WARN  — caught_by is self/agent → no external falsification
//   sycophantic retro WARN  — a retro file with zero honest-negative markers
//
// Three signal indicators, each with a direction that means "honest":
//   external-catch ratio ↑   contra-evidence ratio ↑   inflated-claim rate ↓
//
// Usage: node scripts/meta-honesty.mjs      (META_LEDGER overrides the ledger path)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { loadLedger } from './meta-lib.mjs';

const INFLATED = ['comprehensive', 'seamless', 'flawless', 'bulletproof', 'robust', 'exhaustive', 'perfectly', 'thoroughly', 'fully tested', 'production-ready', 'rock-solid'];
const VAGUE_REAL = new Set(['fixed', 'done', 'ok', 'okay', 'resolved', 'works', 'good', 'n/a', 'na', 'same', 'nothing', 'none']);
// red-team find 2026-05-31 (synonym-pile): a `real` that restates the claim ONLY via done/pass
// synonyms adds zero information — still a tautology even with 2+ novel WORDS. Lexical novelty is
// not semantic novelty. If every novel word is a "done/pass/complete" synonym, it does not contradict.
const DONE_SYNONYMS = new Set(['done', 'finished', 'completed', 'complete', 'accomplished', 'confirmed', 'verified', 'passing', 'passed', 'pass', 'successfully', 'success', 'working', 'works', 'fixed', 'resolved', 'ready', 'shipped', 'deployed', 'delivered', 'implemented', 'tested', 'validated', 'correct', 'correctly']);
const EXTERNAL = new Set(['user', 'reviewer', 'review', 'test', 'tests', 'hook', 'ci', 'human', 'qa', 'gate', 'auditor', 'lint']);
const NEGATIVE_MARKERS = ['went wrong', 'missed', 'mistake', 'failed', 'failure', 'gap', 'should have', 'regression', 'bug', 'broke', 'wrong', 'didn\'t', 'did not', 'overlooked', 'forgot'];

const words = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3));

// A real mistake's `real` must say something the `claim` did not. If it introduces
// fewer than 2 novel content words, it's restating the claim — a tautology, not a finding.
function contradicts(claimed, real) {
  const r = String(real).trim().toLowerCase();
  if (r.length < 8 || VAGUE_REAL.has(r)) return false;
  const c = words(claimed), rw = words(real);
  let novel = 0, novelSynonyms = 0;
  for (const w of rw) if (!c.has(w)) { novel++; if (DONE_SYNONYMS.has(w)) novelSynonyms++; }
  // synonym-pile: every novel word is a done/pass synonym → restatement, not contra-evidence
  if (novel > 0 && novel === novelSynonyms) return false;
  return novel >= 2;
}

const rows = loadLedger();
if (rows.length === 0) { console.log('meta-honesty: ledger empty — no signal to audit.'); process.exit(0); }

let selfConfirming = 0, inflated = 0, selfReported = 0;
console.log(`meta-honesty: auditing signal quality of ${rows.length} ledger entry(ies)\n`);

for (const r of rows) {
  if (!contradicts(r.claimed, r.real)) {
    selfConfirming++;
    console.log(`\x1b[31m🔴 self-confirming (garbage-in): ${r.date} [${r.class}]\x1b[0m`);
    console.log(`     claimed: "${r.claimed}"`);
    console.log(`     real:    "${r.real}"  → real does not contradict the claim; this is not a logged mistake.\n`);
  }
  const hit = INFLATED.find(w => String(r.claimed).toLowerCase().includes(w));
  if (hit) {
    inflated++;
    console.log(`\x1b[33m🟡 inflated claim: ${r.date} [${r.class}] — "${hit}" asserts confidence without a proof artifact.\x1b[0m`);
  }
  const by = String(r.caught_by || '').toLowerCase();
  if (!by || !EXTERNAL.has(by)) {
    selfReported++;
    console.log(`\x1b[33m🟡 self-reported: ${r.date} [${r.class}] — caught_by="${r.caught_by || '∅'}" (no external falsification).\x1b[0m`);
  }
}

// ---- optional retro honesty ----
let retroFlags = 0, retroTotal = 0;
if (existsSync('docs/retros')) {
  const files = readdirSync('docs/retros').filter(f => f.endsWith('.md') && !f.startsWith('_'));
  for (const f of files) {
    retroTotal++;
    const text = readFileSync(`docs/retros/${f}`, 'utf8').toLowerCase();
    if (!NEGATIVE_MARKERS.some(m => text.includes(m))) {
      retroFlags++;
      console.log(`\x1b[33m🟡 sycophantic retro: docs/retros/${f} — zero honest-negative markers (no miss/gap/mistake/regression).\x1b[0m`);
    }
  }
}

// ---- indicators ----
const externalRatio = Math.round((100 * (rows.length - selfReported)) / rows.length);
const contraRatio = Math.round((100 * (rows.length - selfConfirming)) / rows.length);
const inflatedRate = Math.round((100 * inflated) / rows.length);

console.log('\n\x1b[1m  signal indicators\x1b[0m');
console.log(`    external-catch ratio ... ${externalRatio}% (${rows.length - selfReported}/${rows.length} caught externally, not self)   want ↑`);
console.log(`    contra-evidence ratio .. ${contraRatio}% (${rows.length - selfConfirming}/${rows.length} entries whose real contradicts the claim)   want ↑`);
console.log(`    inflated-claim rate .... ${inflatedRate}% (${inflated}/${rows.length} claims use unverifiable booster words)   want ↓`);
if (retroTotal) console.log(`    retro honesty .......... ${retroTotal - retroFlags}/${retroTotal} retros carry an honest negative`);

// ---- verdict ----
let verdict, why, color;
if (selfConfirming > 0) {
  [verdict, why, color] = ['COMPROMISED', `${selfConfirming} self-confirming entry(ies) poison the ledger — remove or rewrite them before the engine learns from flattery`, 31];
} else if (externalRatio < 50 || inflatedRate > 30) {
  [verdict, why, color] = ['WEAK-SIGNAL', 'too much self-assessment or booster language — get an external check to falsify the claim', 33];
} else {
  [verdict, why, color] = ['TRUSTWORTHY', 'misses contradict their claims and are mostly externally caught', 32];
}
console.log(`\n\x1b[${color}m  verdict: ${verdict}\x1b[0m — ${why}`);

process.exit(selfConfirming > 0 ? 1 : 0); // block only on garbage-in; weak-signal warns
