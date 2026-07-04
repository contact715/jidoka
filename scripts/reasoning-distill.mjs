#!/usr/bin/env node
/**
 * reasoning-distill — Part B of the reasoning-bank recommendation (2026-W27 rank 3).
 *
 * Part A (shipped) CAPTURES the adversarial stack's contrast signal before it is force-deleted
 * (scripts/reasoning-bank.mjs → docs/memory/reasoning-bank.jsonl). This is Part B: DISTILL those
 * captured contrastive artifacts into forward-looking, task-class-keyed STRATEGY records
 * ("in class X: prefer Y / avoid Z"), emitted into the SAME sink extract-retro-memory writes
 * (.claude/memory-staging/), so they flow through memory-guard and the existing merge pipeline.
 *
 * Composition (deliberate):
 *   - reuses readBank() from reasoning-bank.mjs (no re-read logic),
 *   - author = 'reasoning-distill'; the ADMITTER is memory-guard (author ≠ judge holds),
 *   - INJECTION is gated behind judge calibration: until >=2 judges are MEASURED, strategies are
 *     written with verdict 'private' (captured, NOT injected into shared recall). Once calibrated
 *     (docs/metrics/judge-calibration-state.json → measuredJudges >= 2) they are 'shared' and go
 *     through memory-guard's dedup before injection. Capture freely now, inject only when trusted.
 *   - LLM distillation into natural language is OPTIONAL and DORMANT: without a model the record
 *     carries a deterministic structured template of the contrast (honest, marked NEEDS-NL-DISTILL),
 *     never a fabricated narrative.
 *
 * Usage:
 *   node scripts/reasoning-distill.mjs --dry      # print strategy candidates, write nothing
 *   node scripts/reasoning-distill.mjs            # write staging records
 *   node scripts/reasoning-distill.mjs --self-test
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBank } from './reasoning-bank.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAGING = path.join(ROOT, '.claude', 'memory-staging');
const CALIB_STATE = path.join(ROOT, 'docs', 'metrics', 'judge-calibration-state.json');
const MIN_MEASURED_JUDGES = 2;

/** How many judges are MEASURED (calibration marker). Absent ⇒ 0 (honest: not yet calibrated). */
export function measuredJudges(readState = () => fs.readFileSync(CALIB_STATE, 'utf8')) {
  try {
    const s = JSON.parse(readState());
    return Number(s.measuredJudges) || 0;
  } catch { return 0; }
}

/**
 * Distill captured artifacts into strategy records. Pure — no filesystem.
 * @param {Array} artifacts  reasoning-bank rows: {source, kind, key, verdict, content, meta}
 * @param {{calibrated?:boolean, llm?:(prompt:string)=>string}} opts
 * @returns {Array} strategy records: {author, verdict, category, class, title, text, material}
 */
export function distillArtifacts(artifacts = [], opts = {}) {
  const calibrated = !!opts.calibrated;
  const byKey = new Map();
  for (const a of artifacts) {
    if (!a || !a.key) continue;
    if (!byKey.has(a.key)) byKey.set(a.key, []);
    byKey.get(a.key).push(a);
  }
  const records = [];
  for (const [key, group] of byKey) {
    const attempts = group.filter((g) => g.source === 'best-of-N');
    const reviews = group.filter((g) => g.source === 'reflexion');
    // A strategy needs contrast: >1 attempt (winner vs losers) OR at least one reviewed verdict.
    if (attempts.length < 2 && reviews.length === 0) continue;

    const verdicts = reviews.map((r) => r.verdict).filter(Boolean);
    const structured =
      `[strategy candidate for class "${key}"]\n` +
      `- best-of-N attempts captured: ${attempts.length}${attempts.length ? ` (winner named in ${attempts[0].meta?.bestofN || 'the bestofN comparison'})` : ''}\n` +
      `- reflexion reviews captured: ${reviews.length}${verdicts.length ? ` (verdicts: ${verdicts.join(', ')})` : ''}\n` +
      `- guidance: prefer the approach that won the comparison / passed reflexion; avoid the diffs that lost or drew REVISE/BLOCK.\n` +
      `[NEEDS-NL-DISTILL] — an LLM pass turns this contrast into a one-line forward strategy.`;

    let text = structured;
    if (typeof opts.llm === 'function') {
      try {
        const nl = opts.llm(`Distill a single forward-looking engineering strategy for task class "${key}" from this contrast:\n${structured}`);
        if (nl && nl.trim()) text = nl.trim();
      } catch { /* keep the structured template — never fabricate */ }
    }

    records.push({
      author: 'reasoning-distill',
      verdict: calibrated ? 'shared' : 'private', // gated injection
      category: 'strategy',
      class: key,
      title: `strategy:${key}`,
      text,
      material: { attempts: attempts.length, reviews: reviews.length, verdicts },
    });
  }
  return records;
}

function writeStaging(records) {
  if (records.length === 0) return null;
  fs.mkdirSync(STAGING, { recursive: true });
  // deterministic filename from content (no Date.now in the name → reproducible)
  const hash = String(records.reduce((h, r) => (h * 31 + r.title.length + r.text.length) >>> 0, 7)).slice(0, 8);
  const out = path.join(STAGING, `strategies-${hash}.json`);
  fs.writeFileSync(out, JSON.stringify({ source: 'reasoning-distill', records }, null, 2), 'utf8');
  return out;
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  const artifacts = [
    { source: 'best-of-N', kind: 'attempt', key: 'wave-900', content: 'diff a', meta: { branch: 'a', bestofN: 'docs/debates/wave-900-bestofN.md' } },
    { source: 'best-of-N', kind: 'attempt', key: 'wave-900', content: 'diff b', meta: { branch: 'b' } },
    { source: 'reflexion', kind: 'reviewed', key: 'wave-901', verdict: 'REVISE', content: 'review text' },
    { source: 'best-of-N', kind: 'attempt', key: 'wave-902', content: 'lonely', meta: { branch: 'x' } }, // only 1 attempt, no review → no strategy
  ];

  const recs = distillArtifacts(artifacts, { calibrated: false });
  const byClass = Object.fromEntries(recs.map((r) => [r.class, r]));
  ok('distills a strategy for a multi-attempt class', !!byClass['wave-900']);
  ok('distills a strategy for a reviewed reflexion class', !!byClass['wave-901']);
  ok('does NOT distill a single-attempt class with no review (needs contrast)', !byClass['wave-902']);
  ok('author is reasoning-distill (distinct from the memory-guard admitter)', recs.every((r) => r.author === 'reasoning-distill'));
  ok('category is strategy', recs.every((r) => r.category === 'strategy'));
  ok('UNCALIBRATED → verdict private (injection gated, captured only)', recs.every((r) => r.verdict === 'private'));
  ok('carries the reflexion verdicts in material', byClass['wave-901'].material.verdicts.includes('REVISE'));
  ok('structured template is honest (marks NEEDS-NL-DISTILL, no fabricated narrative)', byClass['wave-900'].text.includes('NEEDS-NL-DISTILL'));

  const calibrated = distillArtifacts(artifacts, { calibrated: true });
  ok('CALIBRATED → verdict shared (eligible for injection through memory-guard dedup)', calibrated.every((r) => r.verdict === 'shared'));

  // LLM pass replaces the template when available.
  const withLlm = distillArtifacts(artifacts, { calibrated: false, llm: () => 'In wave-900: prefer the streaming approach; avoid the sync retry loop.' });
  ok('an available LLM distiller replaces the structured template', withLlm.find((r) => r.class === 'wave-900').text.includes('streaming approach'));

  ok('measuredJudges returns 0 when the marker is absent (honest not-calibrated)', measuredJudges(() => { throw new Error('ENOENT'); }) === 0);
  ok('measuredJudges reads the marker', measuredJudges(() => JSON.stringify({ measuredJudges: 5 })) === 5);

  ok('empty bank → no strategies (no fabrication)', distillArtifacts([]).length === 0);

  if (fails) { console.log('\n\x1b[31mreasoning-distill self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ reasoning-distill: contrast → gated strategy records correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  const calibrated = measuredJudges() >= MIN_MEASURED_JUDGES;
  const artifacts = readBank();
  const records = distillArtifacts(artifacts, { calibrated });

  console.log(`[reasoning-distill] ${artifacts.length} captured artifact(s) → ${records.length} strategy candidate(s) · judges measured: ${measuredJudges()} (${calibrated ? 'CALIBRATED → shared' : 'not calibrated → private, injection gated'})`);
  for (const r of records) console.log(`  ${r.title}  [${r.verdict}]  attempts=${r.material.attempts} reviews=${r.material.reviews}`);

  if (process.argv.includes('--dry')) { console.log('[reasoning-distill] --dry: no staging written'); process.exit(0); }
  const out = writeStaging(records);
  console.log(out ? `[reasoning-distill] wrote ${path.relative(ROOT, out)}` : '[reasoning-distill] nothing to write');
  process.exit(0);
}
