#!/usr/bin/env node
/**
 * memory-retrieve — task-relevant recall over the memory corpus by MEANING.
 *
 * Closes research gaps #1/#3 (docs/research/2026-06-24_github-enrichment-research.md):
 * jidoka's recall was 100% symbolic — memory-consolidate ranks lessons only by
 * recency-weighted frequency over class labels, get-spec-context finds specs by
 * EXACT --feature name. Neither can answer "what in the corpus is similar in
 * MEANING to my current task", so relevant past lessons surfaced AFTER a mistake
 * (caught by a gate) instead of BEFORE it.
 *
 * This adds the missing capability with ZERO dependency and no vector DB: a
 * deterministic TF-IDF lexical retriever over (a) the mistake-ledger clusters and
 * (b) the markdown corpus under docs/specs + docs/retros. Relevance dominates;
 * the existing recency-weight (scoreCluster) is a mild prior and the pure-recency
 * fallback when a task overlaps nothing (so behaviour never regresses below the
 * current digest). Results are top-down: one representative per theme, no
 * redundant near-duplicates.
 *
 * This is rec #9 (lexical first, the method to internalise BEFORE any embedding
 * layer — plain top-k RAG on a correlated lesson stream returns redundant context
 * and drops prerequisites). A future memory-vector.mjs can swap scoreItem() for
 * embeddings behind an availability check; the retrieve()/dedupe contract stays.
 *
 * Usage:
 *   node scripts/memory-retrieve.mjs --task "<text>" [--k 5] [--json] [--no-docs]
 *   node scripts/memory-retrieve.mjs --self-test
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLedger, groupByClass, todayISO } from './meta-lib.mjs';
import { scoreCluster } from './memory-consolidate.mjs';

// Small RU+EN stopword set — drop the noise words that would dominate overlap.
const STOP = new Set((
  'the and for that with this from have has are was were will would can could should ' +
  'not but you your our its his her their they them then than into over under about ' +
  'это что как для или при без под над уже еще нет так там тут где когда чтобы если ' +
  'был была было были есть быть оно они его ему the’s a an of to in on is it be by we'
).split(/\s+/));

export function tokenize(text) {
  return (String(text).toLowerCase().match(/[a-zа-яё0-9][a-zа-яё0-9_-]{2,}/gi) || [])
    .filter((t) => !STOP.has(t));
}

/** term-frequency map for one document. */
function tf(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/** inverse-document-frequency over the corpus of token-maps. */
export function buildIdf(docTfs) {
  const df = new Map();
  for (const m of docTfs) for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = docTfs.length || 1;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 1)) + 1);
  return idf;
}

/** TF-IDF relevance of a query against one document's tf map. */
export function scoreItem(queryTokens, docTf, idf) {
  let s = 0;
  for (const qt of new Set(queryTokens)) {
    const f = docTf.get(qt);
    if (f) s += f * (idf.get(qt) || 1);
  }
  // length-normalise so long docs do not win purely by size.
  let norm = 0;
  for (const f of docTf.values()) norm += f;
  return norm > 0 ? s / Math.sqrt(norm) : 0;
}

/**
 * Rank items by task relevance. Each item: {id, kind, title, text, recency}.
 * Returns top-k, deduped to one per theme (kind+title family), with a flag
 * telling whether relevance actually drove the ranking.
 */
export function retrieve(items, taskText, k = 5) {
  const docTfs = items.map((it) => tf(tokenize(`${it.title} ${it.text}`)));
  const idf = buildIdf(docTfs);
  const q = tokenize(taskText);
  const maxRecency = Math.max(1e-9, ...items.map((it) => it.recency || 0));
  const scored = items.map((it, i) => {
    const relevance = scoreItem(q, docTfs[i], idf);
    const recencyNorm = (it.recency || 0) / maxRecency;
    // relevance dominates; recency is a mild prior and the tiebreak.
    const combined = relevance + 0.15 * recencyNorm;
    return { ...it, relevance, recencyNorm, combined };
  });
  const anyRelevant = scored.some((s) => s.relevance > 0);
  // When nothing overlaps the task, fall back to pure recency (never worse than today's digest).
  scored.sort((a, b) => (anyRelevant ? b.combined - a.combined : b.recencyNorm - a.recencyNorm));
  // Dedupe: one representative per theme key.
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    const key = `${s.kind}:${s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= k) break;
  }
  return { results: out, relevanceDriven: anyRelevant };
}

// ---- corpus builders ----
function ledgerItems(today) {
  let rows = [];
  try { rows = loadLedger(); } catch { rows = []; }
  const byClass = groupByClass(rows);
  return Object.entries(byClass).map(([cls, items]) => ({
    id: `lesson:${cls}`, kind: 'lesson', title: cls,
    text: items.map((r) => `${r.claimed || ''} ${r.real || ''}`).join(' '),
    recency: scoreCluster(items, today),
  }));
}

function walkMd(dir, cap, acc) {
  if (acc.length >= cap || !existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (acc.length >= cap) break;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMd(p, cap, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

function docItems(dirs = ['docs/specs', 'docs/retros'], cap = 400) {
  const files = [];
  for (const d of dirs) walkMd(d, cap, files);
  return files.slice(0, cap).map((p) => {
    let snippet = '';
    try { snippet = readFileSync(p, 'utf8').slice(0, 2000); } catch { /* skip */ }
    let recency = 0;
    try { recency = 0.2; statSync(p); } catch { /* keep 0 */ }
    return { id: `doc:${p}`, kind: 'doc', title: p, text: snippet, recency };
  });
}

function arg(args, name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const task = arg(args, '--task');
  if (!task) { console.error('memory-retrieve: --task "<text>" required'); process.exit(2); }
  const k = Number(arg(args, '--k', '5')) || 5;
  const today = todayISO();
  const items = [...ledgerItems(today), ...(args.includes('--no-docs') ? [] : docItems())];
  const { results, relevanceDriven } = retrieve(items, task, k);

  if (args.includes('--json')) { process.stdout.write(JSON.stringify({ task, relevanceDriven, results }, null, 2) + '\n'); return; }

  console.log(`memory-retrieve: top ${results.length} for "${task}" (${relevanceDriven ? 'relevance-driven' : 'recency fallback — task overlaps nothing'})`);
  for (const r of results) {
    const tag = r.kind === 'lesson' ? '📕 lesson' : '📄 doc';
    const why = r.relevance > 0 ? `rel ${r.relevance.toFixed(2)}` : `recency ${r.recencyNorm.toFixed(2)}`;
    console.log(`  ${tag}  ${r.title}  [${why}]`);
    if (r.kind === 'lesson') console.log(`      ${r.text.slice(0, 160)}…`);
  }
}

function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); fail++; } };
  console.log('memory-retrieve --self-test');

  ok(tokenize('Fix the Git history secret leak!').join(',') === 'fix,git,history,secret,leak', 'tokenize lowercases, strips punctuation + stopwords');
  ok(tokenize('the and for').length === 0, 'pure stopwords tokenize to nothing');

  const items = [
    { id: 'a', kind: 'lesson', title: 'secret-leak', text: 'git history still leaked private tokens and secrets before publish', recency: 0.2 },
    { id: 'b', kind: 'lesson', title: 'react-hooks', text: 'too many useEffect cascading renders in a component', recency: 2.0 },
    { id: 'c', kind: 'doc', title: 'docs/specs/x.md', text: 'unrelated content about layout grids', recency: 0 },
  ];
  const r1 = retrieve(items, 'secret leaked in git history', 2);
  ok(r1.relevanceDriven, 'a task with overlap is relevance-driven');
  ok(r1.results[0].title === 'secret-leak', 'most semantically relevant lesson ranks first, not the most recent');

  const r2 = retrieve(items, 'completely orthogonal quantum zebra', 3);
  ok(!r2.relevanceDriven, 'a task overlapping nothing falls back to recency');
  ok(r2.results[0].title === 'react-hooks', 'recency fallback returns the highest-recency item first');

  const r3 = retrieve([...items, { id: 'a2', kind: 'lesson', title: 'secret-leak', text: 'dup', recency: 0.1 }], 'secret', 5);
  ok(r3.results.filter((x) => x.title === 'secret-leak').length === 1, 'dedupe keeps one representative per theme');

  const idf = buildIdf([tf(['git', 'secret']), tf(['git', 'react'])]);
  ok((idf.get('secret') || 0) > (idf.get('git') || 0), 'rarer term gets higher idf');

  console.log(fail === 0 ? '\nmemory-retrieve: all self-tests passed' : `\nmemory-retrieve: ${fail} self-test(s) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
