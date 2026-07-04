#!/usr/bin/env node
/**
 * memory-vector — the semantic layer promised at memory-retrieve.mjs:20-23 (2026-W27 rank 2).
 *
 * memory-retrieve is a lexical TF-IDF retriever: it returns 0 for a paraphrase / synonym /
 * other-language match, so a relevant past lesson under a DIFFERENT name never surfaces before
 * the mistake. This adds the missing 20%: an embedding (cosine) ranking FUSED with the lexical
 * ranking via Reciprocal Rank Fusion — the two ranks are MERGED, not one replaced by the other,
 * so exact hits are preserved AND paraphrases are caught.
 *
 * HONEST availability check (the engine's "DORMANT, not fake-green" invariant): there is NO
 * keyless/daemonless embedding source inside the engine boundary (model-router is a POLICY, not
 * an endpoint; there are 0 embedding lines in the repo). So the vector layer is DORMANT by
 * default and retrieveFused() falls back to the pure lexical retrieve() — behaviour never
 * regresses. The moment a real embedder is wired (pass opts.embed, or set one in getEmbedder),
 * RRF activates automatically. No dependency, no vector DB — ~15 lines of RRF math.
 *
 * Usage (library):
 *   import { retrieveFused, rrfFuse, cosine } from './memory-vector.mjs';
 *   const { results, vectorActive } = retrieveFused(items, task, 5, { embed });
 *   node scripts/memory-vector.mjs --self-test
 */

import { pathToFileURL } from 'node:url';
import { tokenize, buildIdf, scoreItem, retrieve } from './memory-retrieve.mjs';

/** term-frequency map (kept local — buildIdf/scoreItem consume tf maps). */
function tf(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/**
 * Reciprocal Rank Fusion — merge N ranked id-lists into one. An id ranked high in ANY input
 * accumulates score; being high in several inputs compounds. score(id) = Σ 1/(k + rank).
 * k=60 is the standard RRF constant (dampens the top ranks so no single list dominates).
 * @param {string[][]} rankings  each an array of ids, best-first
 * @param {number} k
 * @returns {string[]} fused ids, best-first
 */
export function rrfFuse(rankings, k = 60) {
  const score = new Map();
  for (const ranking of rankings) {
    if (!Array.isArray(ranking)) continue;
    ranking.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (k + i + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** cosine similarity of two equal-length numeric vectors (0 if either is empty/degenerate). */
export function cosine(a = [], b = []) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Full lexical ranking (ids best-first) — the same TF-IDF scoreItem memory-retrieve uses. */
export function lexicalRanking(items, taskText) {
  const docTfs = items.map((it) => tf(tokenize(`${it.title} ${it.text}`)));
  const idf = buildIdf(docTfs);
  const q = tokenize(taskText);
  return items
    .map((it, i) => ({ id: it.id, s: scoreItem(q, docTfs[i], idf) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.id);
}

/** Full vector ranking (ids best-first) via an injected embedder. */
export function vectorRanking(items, taskText, embed) {
  const q = embed(taskText);
  return items
    .map((it) => ({ id: it.id, s: cosine(q, embed(`${it.title} ${it.text}`)) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.id);
}

/**
 * Availability check for an embedding source inside the engine boundary.
 * Returns a function embed(text)->number[] or null. DEFAULT null (DORMANT) — there is no
 * keyless/daemonless embedder here yet. Wiring one (or passing opts.embed) activates RRF.
 */
export function getEmbedder() {
  // Intentionally null until a real, keyless in-boundary embedder exists. Honest, not faked.
  return null;
}

/**
 * Task-relevant recall with the vector layer fused in when available, else pure lexical.
 * Drop-in for retrieve() — same {results, relevanceDriven} shape, plus {vectorActive, mode}.
 * @param {Array} items    {id, kind, title, text, recency}
 * @param {string} taskText
 * @param {number} k
 * @param {{embed?: (t:string)=>number[]}} opts
 */
export function retrieveFused(items, taskText, k = 5, opts = {}) {
  const embed = opts.embed || getEmbedder();
  if (typeof embed !== 'function') {
    // DORMANT vector layer → the honest fallback IS the existing lexical retriever, unchanged.
    const base = retrieve(items, taskText, k);
    return { ...base, vectorActive: false, mode: 'lexical (vector DORMANT — no embedding source)' };
  }
  // RRF-fuse the two full rankings, then map back to items and dedupe one-per-theme (the
  // retrieve() contract). Relevance from either channel can surface an item.
  const fusedIds = rrfFuse([lexicalRanking(items, taskText), vectorRanking(items, taskText, embed)]);
  const byId = new Map(items.map((it) => [it.id, it]));
  const seen = new Set();
  const results = [];
  for (const id of fusedIds) {
    const it = byId.get(id);
    if (!it) continue;
    const key = `${it.kind}:${it.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(it);
    if (results.length >= k) break;
  }
  return { results, relevanceDriven: true, vectorActive: true, mode: 'RRF(lexical, vector)' };
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (c) console.log(`  \x1b[32m✓\x1b[0m ${m}`); else { console.error(`  \x1b[31m✗\x1b[0m ${m}`); fail++; } };
  console.log('memory-vector --self-test');

  // RRF: an id ranked high in BOTH lists beats one high in only one.
  const fused = rrfFuse([['a', 'b', 'c'], ['b', 'a', 'd']]);
  ok(fused[0] === 'b' || fused[0] === 'a', 'RRF ranks the item high in both lists first');
  ok(fused.includes('d') && fused.includes('c'), 'RRF keeps items present in only one list');
  ok(rrfFuse([['x'], ['x']])[0] === 'x', 'RRF compounds an id present in every list');

  // cosine sanity.
  ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9, 'cosine of identical vectors is 1');
  ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9, 'cosine of orthogonal vectors is 0');
  ok(cosine([], [1]) === 0, 'cosine is 0 for a degenerate vector (honest)');

  // The killer demo — a PARAPHRASE the lexical layer misses is surfaced by the vector layer.
  // Fake embedder: map known synonyms into the same 3-dim concept space.
  const CONCEPT = {
    secret: [1, 0, 0], token: [1, 0, 0], credential: [1, 0, 0], // synonyms → same axis
    leak: [0, 1, 0], exposed: [0, 1, 0],
    react: [0, 0, 1], hooks: [0, 0, 1],
  };
  const embed = (text) => {
    const v = [0, 0, 0];
    for (const t of tokenize(text)) { const c = CONCEPT[t]; if (c) for (let i = 0; i < 3; i++) v[i] += c[i]; }
    return v;
  };
  const items = [
    { id: 'a', kind: 'lesson', title: 'credential-exposed', text: 'a token was exposed in the build output', recency: 0.1 },
    { id: 'b', kind: 'lesson', title: 'react-hooks', text: 'too many hooks caused cascading renders', recency: 2.0 },
  ];
  // Lexical alone: query "secret leak" shares NO token with item a ("credential/token/exposed").
  ok(scoreItem(tokenize('secret leak'), tf(tokenize('a token was exposed')), buildIdf([tf(tokenize('a token was exposed'))])) === 0,
    'lexical scoreItem returns 0 for the paraphrase (the gap)');
  const lex = retrieveFused(items, 'secret leak', 2); // no embedder → DORMANT
  ok(lex.vectorActive === false, 'no embedder → vector layer honestly DORMANT');
  const fusedR = retrieveFused(items, 'secret leak', 2, { embed });
  ok(fusedR.vectorActive === true, 'injected embedder → vector layer active');
  ok(fusedR.results[0].id === 'a', 'RRF surfaces the paraphrase lesson (credential-exposed) first');

  // Contract: DORMANT path is exactly the lexical retrieve() result.
  const viaBase = retrieve(items, 'react hooks', 2);
  const viaFused = retrieveFused(items, 'react hooks', 2);
  ok(JSON.stringify(viaBase.results.map((r) => r.id)) === JSON.stringify(viaFused.results.map((r) => r.id)),
    'DORMANT retrieveFused matches the lexical retrieve() contract exactly');

  console.log(fail === 0 ? '\n\x1b[32m✓ memory-vector: RRF fusion + honest DORMANT fallback correct\x1b[0m' : `\n\x1b[31m${fail} self-test(s) FAILED\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.includes('--self-test')) selfTest();
  else { console.log('memory-vector: a library (retrieveFused/rrfFuse/cosine). Run --self-test, or import it.'); process.exit(0); }
}
