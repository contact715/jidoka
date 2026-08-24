#!/usr/bin/env node
// @closes-class: reward-hacking
// @scope: all
// @scope-ok: читает тот же один реестр ошибок, 0,08 с
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
// ── who caught it: author, or somebody else? (2026-W35-B2) ───────────────────
// This used to be ONE closed list of twelve English words, and `owner` was not among
// them. Measured 2026-08-24 on the live ledger: 18 distinct `caught_by` values exist,
// only two of them matched, and `owner` — the most external judge there is, third most
// common catcher with 12 rows — was silently scored as "we caught ourselves". The
// externalRatio the engine judges its own honesty by read 14% instead of 46%.
//
// The axis that matters is NOT "is this name on my list" but "was the judge someone
// other than the author of the claim". So the vocabulary is now explicit in BOTH
// directions, and anything it does not know is reported as unknown rather than quietly
// counted as internal — the same closed-vocabulary blindness this file already learned
// once on the Cyrillic axis (see the tokenizer note below) and repeated here.
const EXTERNAL = new Set([
  // humans outside the acting agent
  'owner', 'user', 'human', 'reviewer', 'review', 'qa', 'auditor',
  // independent mechanisms: they judge work they did not produce
  'test', 'tests', 'hook', 'ci', 'gate', 'lint',
  'red-team', 'reflexion-critic', 'meta-honesty', 'adversarial-review',
  'measurement', 'browser', 'verification',
]);
// the acting agent noticing its own work — honest, but not independent evidence
const INTERNAL = new Set([
  'self', 'self-noticed', 'claude', 'agent', 'in-session-kaizen', 'dev-pipeline', 'orchestrator',
]);

/**
 * Three-way, because "I do not know this judge" is a real answer and must not be
 * disguised as either of the other two.
 * @param {string} name
 * @returns {'external'|'internal'|'unknown'}
 */
export function judgeKind(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return 'unknown';
  if (EXTERNAL.has(n)) return 'external';
  if (INTERNAL.has(n)) return 'internal';
  return 'unknown';
}
const NEGATIVE_MARKERS = ['went wrong', 'missed', 'mistake', 'failed', 'failure', 'gap', 'should have', 'regression', 'bug', 'broke', 'wrong', 'didn\'t', 'did not', 'overlooked', 'forgot'];

// UNICODE-AWARE, and that is load-bearing. The tokenizer used to strip everything outside
// [a-z0-9 ], which silently DELETED every Cyrillic word — so a Russian-language row produced an
// empty word set, `novel` came out 0, and contradicts() returned false. Every honestly-written
// Russian incident was therefore classified "self-confirming (garbage-in)". It stayed invisible
// only because those rows lived in the un-versioned global ledger; the moment they were merged
// into the canon on 2026-08-03, meta-honesty went COMPROMISED on 9 rows that are in fact some of
// the best-written entries in the file ("тест типов упал, значит ошибки типов" vs "tsc гонялся с
// живым dev-сервером, прямой прогон давал ноль"). The gate was not detecting dishonesty, it was
// detecting a language it could not read.
//
// REMAINING LIMIT, stated rather than hidden: DONE_SYNONYMS below is still English-only, so a
// synonym-pile written in Russian is not caught yet. Strictly better than erasing the text.
export const words = s => new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length > 3));

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
    // unknown is deliberately NOT external: a judge we cannot identify must never raise
    // the honesty score. It shows up by name in auditRows so the gap is fixable.
    selfReported: judgeKind(by) !== 'external',
  };
}

// aggregate signal indicators over the whole ledger (pure). Non-mistake rows (no claimed/real) carry
// no honesty signal and are excluded — both from the counts and from the ratio denominator — so
// misfiled telemetry can neither trip garbage-in nor dilute the real signal.
export function auditRows(rows) {
  const mistakeRows = rows.filter(isMistakeRow);
  let selfConfirming = 0, inflated = 0, selfReported = 0;
  const unknown = new Set();
  for (const r of mistakeRows) {
    const c = classifyRow(r);
    if (c.selfConfirming) selfConfirming++;
    if (c.inflated) inflated++;
    if (c.selfReported) selfReported++;
    // 2026-W35-B2 — name the judges the vocabulary does not know. Silence here is what
    // let `owner` sit unrecognised for 85 days while the ratio it distorted was printed
    // every day as a verdict on our own honesty.
    if (judgeKind(r.caught_by) === 'unknown') unknown.add(String(r.caught_by || '(пусто)').toLowerCase());
  }
  const m = mistakeRows.length, n = m || 1;
  return {
    selfConfirming, inflated, selfReported,
    unknownJudges: [...unknown].sort(),
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

  // Cyrillic — the 2026-08-03 blindspot. These two are VERBATIM from the live ledger
  // (docs/audits/meta-mistakes.jsonl, class gate-depends-on-live-rebuild-artifacts and
  // toggle-loses-to-default-specificity). With the old [a-z0-9] tokenizer both produced an
  // empty word set and were reported "self-confirming (garbage-in)".
  ok('contradicts: real Russian ledger row is recognised as contradicting',
    contradicts(
      'тест типов упал — значит в коде ошибки типов',
      'tsc проверял каталог, который живой dev-сервер пересоздавал в тот же момент; прямой прогон давал 0 ошибок, падение было гонкой, а не дефектом',
    ) === true);
  ok('contradicts: second real Russian row also recognised',
    contradicts(
      'правило в CSS есть и селектор совпадает — значит переключатель работает',
      'вес селектора переключателя (0,2,0) ниже веса объявления по умолчанию (0,3,1), правило не применялось никогда',
    ) === true);
  ok('words(): Cyrillic survives tokenization', words('проверка типов упала').size === 3);
  // NB the >3-char filter applies to every alphabet, so "tsc" is dropped as a stop-word-length
  // token in both the old and the new tokenizer. That is existing behaviour, not a regression.
  ok('words(): mixed-script row keeps both alphabets',
    words('webpack проверял каталог').has('webpack') && words('webpack проверял каталог').has('проверял'));
  ok('words(): tokens of 3 chars or fewer are still dropped, in any alphabet',
    !words('tsc код').has('tsc') && !words('tsc код').has('код'));
  ok('contradicts: a Russian restatement is still NOT a contradiction',
    contradicts('гейт подключён и работает', 'гейт подключён') === false);
  // words — content-word tokenizer (keeps >3-char words)
  ok('words: keeps >3-char words, drops ≤3-char', words('the cat ran faster').has('faster') && !words('the cat').has('cat'));
  // classifyRow — per-entry flags
  ok('classifyRow: externally-caught, contradicting entry is clean', (() => { const c = classifyRow({ claimed: 'data cleaned ready', real: 'git history still leaked home paths and name', caught_by: 'user' }); return c.selfConfirming === false && c.selfReported === false; })());
  ok('classifyRow: self-caught tautology flags both', (() => { const c = classifyRow({ claimed: 'done', real: 'done', caught_by: 'self' }); return c.selfConfirming === true && c.selfReported === true; })());

  // ── 2026-W35-B2: the owner is the most external judge we have ──────────────
  // Measured 2026-08-24 on the live ledger: `owner` appears 12 times and is the third
  // most common catcher, and the word did not exist anywhere in this file. Every
  // incident the owner caught was therefore counted as "we caught ourselves", and the
  // external-catch figure the engine judges itself by read 14% instead of 28%.
  ok('owner-caught row is NOT self-reported',
    classifyRow({ claimed: 'x done', real: 'the queue lock was per-directory so parallel builds stacked', caught_by: 'owner' }).selfReported === false);
  ok('a judge that is not the author is external, whatever its name',
    judgeKind('reflexion-critic') === 'external' && judgeKind('red-team') === 'external');
  ok('the acting agent itself is internal',
    judgeKind('self') === 'internal' && judgeKind('claude') === 'internal' && judgeKind('in-session-kaizen') === 'internal');
  ok('an unknown judge is UNKNOWN, not silently internal',
    judgeKind('some-new-thing') === 'unknown');
  ok('unknown still counts as self-reported (never inflates the ratio)',
    classifyRow({ claimed: 'x done', real: 'a real and specific contradicting reason here', caught_by: 'some-new-thing' }).selfReported === true);
  ok('auditRows surfaces the unrecognised judge names instead of hiding them',
    auditRows([{ claimed: 'x done', real: 'a real and specific contradicting reason here', caught_by: 'some-new-thing' }]).unknownJudges.includes('some-new-thing'));
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
  // 2026-W35-B2 — a judge the vocabulary does not know counts as self-reported (it never
  // flatters the ratio), but it must be SAID. This line is the one that would have shown
  // `owner` missing on day one instead of eighty-five days later.
  if (ind.unknownJudges && ind.unknownJudges.length) {
    console.log(`    \x1b[33mсудьи вне словаря ..... ${ind.unknownJudges.length}: ${ind.unknownJudges.join(', ')}\x1b[0m`);
    console.log('                             считаются «поймал сам» — если это внешняя проверка, впиши её в EXTERNAL');
  }
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
