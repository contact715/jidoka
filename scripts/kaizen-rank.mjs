#!/usr/bin/env node
// kaizen-rank — the ROI ranker of the weekly Kaizen engine (Phase 2b).
//
// Orders recommendations by LEVERAGE (impact / effort), not just the coarse P0/P1/P2 label, so the
// week's energy goes where the return is highest. And it enforces the meta-trend verdict: when the
// engine is REGRESSING ("strengthen leaking gates before adding new mechanisms"), gate-strengthening
// items are floated to the top regardless of their raw leverage — the discipline the engine asks for
// becomes mechanical, not a matter of remembering. Pure, zero-dep.
//
// Recommendation shape: { title, impact?:1..5, effort?:low|medium|high, tags?, priority? }
//
// Usage:
//   node scripts/kaizen-rank.mjs --plan <plan.json> [--verdict REGRESSING]
//   node scripts/kaizen-rank.mjs --self-test

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isGateStrengthening } from './kaizen-critique.mjs';

export const EFFORT_WEIGHT = { low: 1, medium: 2, high: 3 };
const round2 = (n) => Math.round(n * 100) / 100;

/** Leverage = impact (default 3) / effort weight (default medium=2). Higher = better ROI. */
export function leverage(rec = {}) {
  const impact = Number.isFinite(rec.impact) ? rec.impact : 3;
  const weight = EFFORT_WEIGHT[rec.effort] || 2;
  return round2(impact / weight);
}

/**
 * Rank recommendations. Pure — returns a NEW array of {...rec, leverage, rank, prioritised}.
 * When the verdict is REGRESSING, gate-strengthening items sort before everything else
 * (prioritised=true), then by leverage; otherwise pure leverage. Stable within a tier.
 * @param {Array} recs
 * @param {{metaTrendVerdict?:string}} opts
 */
export function rank(recs = [], opts = {}) {
  const regressing = /REGRESS/i.test(opts.metaTrendVerdict || '');
  const scored = recs.map((r, i) => ({
    rec: r,
    lev: leverage(r),
    gate: regressing && isGateStrengthening(r),
    i, // original index → stable tiebreak
  }));
  scored.sort((a, b) => {
    if (a.gate !== b.gate) return a.gate ? -1 : 1;   // gate-strengthening first (only when regressing)
    if (b.lev !== a.lev) return b.lev - a.lev;         // then higher leverage
    return a.i - b.i;                                  // stable
  });
  return scored.map((s, idx) => ({ ...s.rec, leverage: s.lev, rank: idx + 1, prioritised: s.gate }));
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };

  ok('leverage = impact/effort (5/low=5)', leverage({ impact: 5, effort: 'low' }) === 5);
  ok('leverage defaults (no impact/effort → 3/2 = 1.5)', leverage({}) === 1.5);
  ok('high effort lowers leverage (4/high ≈ 1.33)', leverage({ impact: 4, effort: 'high' }) === 1.33);

  const recs = [
    { title: 'low-ROI big', impact: 2, effort: 'high' },              // 0.67
    { title: 'high-ROI quick', impact: 5, effort: 'low' },            // 5
    { title: 'strengthen a leaking gate', impact: 2, effort: 'high', tags: ['gate'] }, // 0.67 but gate
    { title: 'mid', impact: 4, effort: 'medium' },                    // 2
  ];

  // Non-regressing → pure leverage order.
  const normal = rank(recs, { metaTrendVerdict: 'improving' });
  ok('non-regressing ranks by pure leverage (quick win first)', normal[0].title === 'high-ROI quick');
  ok('non-regressing: gate item is NOT floated (low leverage stays low)', normal[normal.length - 1].leverage <= 0.67);
  ok('rank numbers are 1..n', normal.map((r) => r.rank).join(',') === '1,2,3,4');

  // Regressing → gate-strengthening floats to the top despite low leverage.
  const regressing = rank(recs, { metaTrendVerdict: 'REGRESSING — gates leaking' });
  ok('REGRESSING floats the gate-strengthening item to #1', regressing[0].title === 'strengthen a leaking gate');
  ok('REGRESSING marks it prioritised', regressing[0].prioritised === true);
  ok('REGRESSING then orders the rest by leverage', regressing[1].title === 'high-ROI quick');

  // purity + stability
  const before = JSON.stringify(recs);
  rank(recs, {});
  ok('rank does not mutate input', JSON.stringify(recs) === before);
  ok('empty input → empty output', rank([]).length === 0);
  const tie = rank([{ title: 'a', impact: 3, effort: 'medium' }, { title: 'b', impact: 3, effort: 'medium' }]);
  ok('equal leverage keeps original order (stable)', tie[0].title === 'a' && tie[1].title === 'b');

  if (fails) { console.log('\n\x1b[31mkaizen-rank self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-rank: ROI ranking + REGRESSING auto-prioritise correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const planPath = arg('--plan');
  if (!planPath || !fs.existsSync(planPath)) { console.error('usage: --plan <plan.json> [--verdict REGRESSING]  (or --self-test)'); process.exit(2); }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const ranked = rank(plan.recommendations || [], { metaTrendVerdict: arg('--verdict') || '' });
  console.log(`[kaizen-rank] ${ranked.length} recommendation(s) by leverage${/REGRESS/i.test(arg('--verdict') || '') ? ' (REGRESSING → gates first)' : ''}:`);
  for (const r of ranked) console.log(`  ${String(r.rank).padStart(2)}. [lev ${r.leverage}]${r.prioritised ? ' ⬆gate' : ''} ${r.title}`);
  process.exit(0);
}
