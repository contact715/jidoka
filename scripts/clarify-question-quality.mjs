#!/usr/bin/env node
/**
 * clarify-question-quality — a drop-in quality gate for the clarify-engine's OWN questions
 * (2026-W27 quick win). clarify-engine decides WHICH topics to ask (its 9-category coverage);
 * this checks HOW WELL each question is phrased: a 14-type interviewer-error taxonomy plus a
 * 3-axis Grice rubric (quantity / relation / manner). Deterministic + zero-dep; an optional LLM
 * critic can be layered on, but the static rubric already catches the common failure modes.
 *
 * A well-run elicitation is worth little if the questions are leading, double-barrelled, vague,
 * or ask for opinions instead of behaviour (the Mom Test). This makes those mechanical.
 *
 * Usage:
 *   node scripts/clarify-question-quality.mjs --question "Don't you think we should use OAuth?"
 *   node scripts/clarify-question-quality.mjs --self-test
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 14 interviewer-error types. Each detector is a pure (text)->boolean over a lowercased question.
// Conservative: a detector fires on a clear signal, not a guess (false positives erode trust).
// Detectors run on the ORIGINAL-case text (so the jargon detector can see UPPERCASE acronyms);
// the word detectors carry /i so casing does not matter for them.
export const INTERVIEWER_ERRORS = [
  { id: 'leading', desc: 'leads to a preferred answer', test: (q) => /\b(don'?t you think|wouldn'?t you|isn'?t it|shouldn'?t we|surely|obviously|of course)\b/i.test(q) },
  { id: 'double-barrelled', desc: 'asks two things at once', test: (q) => /\?.*\?/.test(q) || /,?\s+and\s+(how|what|when|where|why|who|which|do|does|is|are|can|could|will|would|should)\b/i.test(q) },
  { id: 'vague', desc: 'vague filler instead of specifics', test: (q) => /\b(stuff|things|etc\.?|somehow|some kind of|whatever)\b/i.test(q) },
  { id: 'hypothetical', desc: 'hypothetical/future speculation (Mom Test violation)', test: (q) => /\b(would you|could you imagine|if you had|in the future|someday|hypothetically)\b/i.test(q) },
  { id: 'opinion-not-behaviour', desc: 'asks for opinion, not real past behaviour', test: (q) => /\b(do you like|would you like|do you prefer|what do you think of|how do you feel about)\b/i.test(q) },
  { id: 'closed-when-open-needed', desc: 'yes/no where an open answer is needed', test: (q) => /^(is|are|do|does|did|can|could|will|would|should|have|has)\b/i.test(q) && q.split(/\s+/).length <= 8 },
  { id: 'assumptive', desc: 'assumes a fact not established', test: (q) => /\b(since you already|as you know|given that you|now that you)\b/i.test(q) },
  { id: 'absolute', desc: 'absolutes that force a false binary', test: (q) => /\b(always|never|everyone|no one|nobody|all of|none of)\b/i.test(q) },
  { id: 'loaded', desc: 'loaded / emotionally charged framing', test: (q) => /\b(obviously bad|terrible|awful|amazing|nightmare|disaster|clearly wrong)\b/i.test(q) },
  { id: 'not-a-question', desc: 'no question mark — a statement, not a question', test: (q) => !q.includes('?') },
  { id: 'jargon-heavy', desc: 'stacked jargon/acronyms without grounding', test: (q) => ((q.match(/\b[A-Z]{3,}\b/g) || []).length >= 3) },
  { id: 'compound-overlong', desc: 'too long / too many clauses to answer cleanly', test: (q) => q.split(/\s+/).length > 40 || (q.match(/,/g) || []).length >= 4 },
  { id: 'ambiguous-reference', desc: 'ambiguous "it/they/this" with no referent', test: (q) => /^(so\s+)?(it|they|this|that|those)\b/i.test(q) },
  { id: 'stacked-choices', desc: 'crams many options into one prompt', test: (q) => (q.match(/\bor\b/gi) || []).length >= 3 },
];

// Grice's maxims collapsed to a 3-axis rubric for a single question.
export const GRICE = [
  { axis: 'quantity', desc: 'as informative as needed, no more', violated: (q, errs) => errs.has('compound-overlong') || errs.has('double-barrelled') },
  { axis: 'relation', desc: 'relevant, grounded in reality', violated: (q, errs) => errs.has('hypothetical') || errs.has('opinion-not-behaviour') || errs.has('assumptive') },
  { axis: 'manner', desc: 'clear, unambiguous, not leading', violated: (q, errs) => errs.has('leading') || errs.has('vague') || errs.has('ambiguous-reference') || errs.has('not-a-question') },
];

/**
 * Score one question. Pure.
 * @param {string} question
 * @returns {{question:string, errors:string[], grice:string[], ok:boolean, score:number}}
 */
export function scoreQuestion(question = '') {
  const q = String(question).trim(); // original case — jargon detector needs UPPERCASE acronyms
  const errors = INTERVIEWER_ERRORS.filter((e) => { try { return e.test(q); } catch { return false; } }).map((e) => e.id);
  const errSet = new Set(errors);
  const grice = GRICE.filter((g) => g.violated(q, errSet)).map((g) => g.axis);
  // score: 1.0 clean, minus 0.15 per interviewer-error and 0.1 per Grice-axis violation, floored at 0.
  const score = Math.max(0, 1 - 0.15 * errors.length - 0.1 * grice.length);
  return { question: String(question).trim(), errors, grice, ok: errors.length === 0, score: Number(score.toFixed(2)) };
}

/** Score many; return the ones that fail (for a gate). */
export function screenQuestions(questions = []) {
  return questions.map(scoreQuestion).filter((r) => !r.ok);
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  const good = scoreQuestion('Walk me through the last time your team handled a refund — what happened step by step?');
  ok('a clean Mom-Test question passes', good.ok && good.score >= 0.9);

  ok('detects a leading question', scoreQuestion("Don't you think we should use OAuth?").errors.includes('leading'));
  ok('detects a hypothetical (Mom Test)', scoreQuestion('Would you use a feature that auto-syncs?').errors.includes('hypothetical'));
  ok('detects opinion-not-behaviour', scoreQuestion('Do you like the current dashboard?').errors.includes('opinion-not-behaviour'));
  ok('detects a double-barrelled question', scoreQuestion('Who approves refunds, and how long does it take?').errors.includes('double-barrelled'));
  ok('detects vagueness', scoreQuestion('How do you handle stuff and things in billing?').errors.includes('vague'));
  ok('detects a non-question statement', scoreQuestion('Tell me about billing.').errors.includes('not-a-question'));
  ok('detects an assumptive question', scoreQuestion('Since you already use Stripe, which webhook fires first?').errors.includes('assumptive'));
  ok('detects jargon overload', scoreQuestion('Does the CRM ETL sync with the SSO IDP correctly?').errors.includes('jargon-heavy'));

  const lead = scoreQuestion("Don't you think we should use OAuth?");
  ok('a leading question violates the Grice manner axis', lead.grice.includes('manner'));
  const hyp = scoreQuestion('Would you use a feature that auto-syncs?');
  ok('a hypothetical violates the Grice relation axis', hyp.grice.includes('relation'));

  ok('bad questions score lower than good', scoreQuestion("Don't you think, obviously, we should?").score < good.score);
  ok('screenQuestions returns only the failing ones', screenQuestions(['Walk me through your last refund — what happened?', "Don't you think we should use OAuth?"]).length === 1);
  ok('empty/whitespace question is flagged (not a question)', !scoreQuestion('   ').ok);

  if (fails) { console.log('\n\x1b[31mclarify-question-quality self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ clarify-question-quality: interviewer-error + Grice rubric correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const i = process.argv.indexOf('--question');
  if (i === -1) {
    // read questions from stdin (one per line) as a gate
    let raw = '';
    try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
    const qs = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (qs.length === 0) { console.error('usage: --question "<text>"  |  pipe questions on stdin  |  --self-test'); process.exit(2); }
    const bad = screenQuestions(qs);
    for (const b of bad) console.log(`  ⚠ [${b.score}] "${b.question}" — ${b.errors.join(', ')}${b.grice.length ? ` (Grice: ${b.grice.join(', ')})` : ''}`);
    console.log(bad.length ? `\nclarify-question-quality: ${bad.length}/${qs.length} question(s) need rework.` : `\n✓ all ${qs.length} question(s) clean.`);
    process.exit(0); // WARN by default (soft gate)
  }
  const r = scoreQuestion(process.argv[i + 1] || '');
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
