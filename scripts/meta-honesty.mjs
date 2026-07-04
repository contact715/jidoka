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
// FULL & self-tested. The logic (contradicts / classifyRow / auditRows / verdictOf) is pure and unit-
// tested via --self-test; the CLI reads the ledger and prints. (Body wrapped in isMain — it used to run
// on import, the cli-side-effect-on-import smell.) Usage: node scripts/meta-honesty.mjs [--self-test]
//   (META_LEDGER overrides the ledger path)

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

export const words = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3));

// A ledger row is a logged MISTAKE only if it carries the mistake schema — a `claimed` or a `real`
// field. A row with neither (e.g. misfiled telemetry {ts,wave,class,run1,run2}) carries no honesty
// signal: auditing it would flag it "self-confirming" and BLOCK on something that is not a mistake.
// Defence-in-depth against ledger-pollution (debias telemetry leaked in twice; root-caused 2026-07-04).
// This is NOT a bypass hole: flattery needs a claimed≈real pair, which by definition HAS both fields,
// so any self-praising row is still audited — only content-less rows are skipped.
export const isMistakeRow = r => r != null && (('claimed' in r) || ('real' in r));

// A real mistake's `real` must say something the `claim` did not. If it introduces
// fewer than 2 novel content words, it's restating the claim — a tautology, not a finding.
export function contradicts(claimed, real) {
  const r = String(real).trim().toLowerCase();
  if (r.length < 8 || VAGUE_REAL.has(r)) return false;
  const c = words(claimed), rw = words(real);
  let novel = 0, novelSynonyms = 0;
  for (const w of rw) if (!c.has(w)) { novel++; if (DONE_SYNONYMS.has(w)) novelSynonyms++; }
  // synonym-pile: every novel word is a done/pass synonym → restatement, not contra-evidence
  if (novel > 0 && novel === novelSynonyms) return false;
  return novel >= 2;
}

// per-entry honesty flags (pure): the three signals for one ledger row
export function classifyRow(r) {
  const by = String(r.caught_by || '').toLowerCase();
  return {
    selfConfirming: !contradicts(r.claimed, r.real),
    inflated: INFLATED.find(w => String(r.claimed).toLowerCase().includes(w)) || null,
    selfReported: !by || !EXTERNAL.has(by),
  };
}

// aggregate signal indicators over the whole ledger (pure). Non-mistake rows (no claimed/real) carry
// no honesty signal and are excluded — both from the counts and from the ratio denominator — so
// misfiled telemetry can neither trip garbage-in nor dilute the real signal.
export function auditRows(rows) {
  const mistakeRows = rows.filter(isMistakeRow);
  let selfConfirming = 0, inflated = 0, selfReported = 0;
  for (const r of mistakeRows) {
    const c = classifyRow(r);
    if (c.selfConfirming) selfConfirming++;
    if (c.inflated) inflated++;
    if (c.selfReported) selfReported++;
  }
  const m = mistakeRows.length, n = m || 1;
  return {
    selfConfirming, inflated, selfReported,
    nonMistake: rows.length - m,
    mistakeCount: m,
    externalRatio: Math.round((100 * (m - selfReported)) / n),
    contraRatio: Math.round((100 * (m - selfConfirming)) / n),
    inflatedRate: Math.round((100 * inflated) / n),
  };
}

// the verdict thresholds (pure): garbage-in blocks; weak signal warns; else trustworthy
export function verdictOf({ selfConfirming, externalRatio, inflatedRate }) {
  if (selfConfirming > 0) return 'COMPROMISED';
  if (externalRatio < 50 || inflatedRate > 30) return 'WEAK-SIGNAL';
  return 'TRUSTWORTHY';
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  // contradicts — the core garbage-in guard
  ok('contradicts: 2+ novel content words → true', contradicts('private data cleaned', 'git history still leaked home paths and a personal name') === true);
  ok('contradicts: vague real ("done") → false', contradicts('the feature is done', 'done') === false);
  ok('contradicts: short real (<8 chars) → false', contradicts('all tests pass', 'yep ok') === false);
  ok('contradicts: synonym-pile (all novel words are done-synonyms) → false', contradicts('all tests pass', 'all tests passing verified confirmed successfully') === false);
  ok('contradicts: only 1 novel content word → false', contradicts('the gate is wired and working', 'the gate is wired') === false);
  // words — content-word tokenizer (keeps >3-char words)
  ok('words: keeps >3-char words, drops ≤3-char', words('the cat ran faster').has('faster') && !words('the cat').has('cat'));
  // classifyRow — per-entry flags
  ok('classifyRow: externally-caught, contradicting entry is clean', (() => { const c = classifyRow({ claimed: 'data cleaned ready', real: 'git history still leaked home paths and name', caught_by: 'user' }); return c.selfConfirming === false && c.selfReported === false; })());
  ok('classifyRow: self-caught tautology flags both', (() => { const c = classifyRow({ claimed: 'done', real: 'done', caught_by: 'self' }); return c.selfConfirming === true && c.selfReported === true; })());
  ok('classifyRow: booster word flags inflated', classifyRow({ claimed: 'comprehensive coverage added', real: 'only one path was covered actually', caught_by: 'user' }).inflated === 'comprehensive');
  // auditRows — aggregation
  ok('auditRows: ratios computed', (() => { const a = auditRows([{ claimed: 'x done', real: 'real reason it broke in prod clearly', caught_by: 'user' }]); return a.externalRatio === 100 && a.contraRatio === 100; })());
  // verdictOf — the three thresholds + strict boundaries
  ok('verdictOf: any self-confirming → COMPROMISED', verdictOf({ selfConfirming: 1, externalRatio: 100, inflatedRate: 0 }) === 'COMPROMISED');
  ok('verdictOf: external <50 → WEAK-SIGNAL', verdictOf({ selfConfirming: 0, externalRatio: 40, inflatedRate: 0 }) === 'WEAK-SIGNAL');
  ok('verdictOf: inflated >30 → WEAK-SIGNAL', verdictOf({ selfConfirming: 0, externalRatio: 100, inflatedRate: 40 }) === 'WEAK-SIGNAL');
  ok('verdictOf: clean → TRUSTWORTHY', verdictOf({ selfConfirming: 0, externalRatio: 80, inflatedRate: 10 }) === 'TRUSTWORTHY');
  ok('verdictOf: exactly 50% external is NOT weak (strict <)', verdictOf({ selfConfirming: 0, externalRatio: 50, inflatedRate: 0 }) === 'TRUSTWORTHY');
  ok('verdictOf: exactly 30% inflated is NOT weak (strict >)', verdictOf({ selfConfirming: 0, externalRatio: 100, inflatedRate: 30 }) === 'TRUSTWORTHY');

  ok('auditRows: ratio denominator is the row count (2 rows, 1 external → 50%)', auditRows([{ claimed: 'a done', real: 'real reason it broke in prod clearly', caught_by: 'user' }, { claimed: 'b done', real: 'another distinct failure cause found here', caught_by: 'self' }]).externalRatio === 50);

  // ledger-pollution regression (2026-07-04): a debias telemetry row (no claimed/real) is NOT a mistake.
  // It must not register as garbage-in, must not compromise the verdict, and must not dilute real ratios.
  const telemetry = { ts: '2026-07-04T00:00:00Z', wave: 'wave-judge-debias', class: 'position-sensitive', run1: 'PASS', run2: 'BLOCK' };
  ok('isMistakeRow: telemetry row (no claimed/real) → false', isMistakeRow(telemetry) === false);
  ok('isMistakeRow: a real mistake row → true', isMistakeRow({ claimed: 'x', real: 'y' }) === true);
  ok('auditRows: lone telemetry row → 0 self-confirming (not garbage-in)', auditRows([telemetry]).selfConfirming === 0);
  ok('verdictOf: a ledger of only telemetry rows is NOT COMPROMISED', verdictOf(auditRows([telemetry])) !== 'COMPROMISED');
  ok('auditRows: telemetry does not dilute a real mistake (1 real, external → 100%, 1 skipped)', (() => { const a = auditRows([telemetry, { claimed: 'a done', real: 'real reason it broke in prod clearly', caught_by: 'user' }]); return a.externalRatio === 100 && a.contraRatio === 100 && a.nonMistake === 1 && a.mistakeCount === 1; })());

  if (fails.length) { console.log(`\n\x1b[31mmeta-honesty self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ meta-honesty: contradicts + classify + verdict logic correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  const rows = loadLedger();
  if (rows.length === 0) { console.log('meta-honesty: ledger empty — no signal to audit.'); process.exit(0); }

  console.log(`meta-honesty: auditing signal quality of ${rows.length} ledger entry(ies)\n`);
  for (const r of rows) {
    if (!isMistakeRow(r)) {
      console.log(`\x1b[33m🟡 non-mistake row (misfiled telemetry?): ${r.date || r.ts || '∅'} [${r.class || '∅'}] — no claimed/real fields; skipped from the honesty audit (belongs in a telemetry sidecar, not the ledger).\x1b[0m`);
      continue;
    }
    const c = classifyRow(r);
    if (c.selfConfirming) {
      console.log(`\x1b[31m🔴 self-confirming (garbage-in): ${r.date} [${r.class}]\x1b[0m`);
      console.log(`     claimed: "${r.claimed}"`);
      console.log(`     real:    "${r.real}"  → real does not contradict the claim; this is not a logged mistake.\n`);
    }
    if (c.inflated) console.log(`\x1b[33m🟡 inflated claim: ${r.date} [${r.class}] — "${c.inflated}" asserts confidence without a proof artifact.\x1b[0m`);
    if (c.selfReported) console.log(`\x1b[33m🟡 self-reported: ${r.date} [${r.class}] — caught_by="${r.caught_by || '∅'}" (no external falsification).\x1b[0m`);
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
  const ind = auditRows(rows);
  const m = ind.mistakeCount;
  console.log('\n\x1b[1m  signal indicators\x1b[0m');
  if (ind.nonMistake) console.log(`    non-mistake rows ....... ${ind.nonMistake} skipped (no claimed/real — telemetry misfiled into the ledger)`);
  console.log(`    external-catch ratio ... ${ind.externalRatio}% (${m - ind.selfReported}/${m} caught externally, not self)   want ↑`);
  console.log(`    contra-evidence ratio .. ${ind.contraRatio}% (${m - ind.selfConfirming}/${m} entries whose real contradicts the claim)   want ↑`);
  console.log(`    inflated-claim rate .... ${ind.inflatedRate}% (${ind.inflated}/${m} claims use unverifiable booster words)   want ↓`);
  if (retroTotal) console.log(`    retro honesty .......... ${retroTotal - retroFlags}/${retroTotal} retros carry an honest negative`);

  // ---- verdict ----
  const verdict = verdictOf(ind);
  const [why, color] = verdict === 'COMPROMISED'
    ? [`${ind.selfConfirming} self-confirming entry(ies) poison the ledger — remove or rewrite them before the engine learns from flattery`, 31]
    : verdict === 'WEAK-SIGNAL'
      ? ['too much self-assessment or booster language — get an external check to falsify the claim', 33]
      : ['misses contradict their claims and are mostly externally caught', 32];
  console.log(`\n\x1b[${color}m  verdict: ${verdict}\x1b[0m — ${why}`);

  process.exit(ind.selfConfirming > 0 ? 1 : 0); // block only on garbage-in; weak-signal warns
}
