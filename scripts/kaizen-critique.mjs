#!/usr/bin/env node
// kaizen-critique — the completeness gate of the weekly Kaizen engine (Phase 2a).
//
// After the process synthesises a plan, it critiques its OWN output before shipping it, so a weak
// week is caught by the process instead of the reader. Deterministic checks: empty research
// domains, recommendations with no source or no point-of-integration, missing sections, and
// plan-vs-meta-trend misalignment (a REGRESSING verdict must be answered by a gate-strengthening
// item near the top). It returns the gaps; the weekly task closes them or lists them honestly in
// a "Пробелы этого прогона" section. Pure, zero-dep.
//
// Expected plan shape (all optional — a missing field IS a gap the critic reports):
//   { recommendations: [{title, sourceRepo?, url?, pointOfIntegration?, priority?, tags?[]}],
//     killerFeatures: [...], sessionReview: {...}|[...], domains: {name: candidateCount, ...} }
//
// Usage:
//   node scripts/kaizen-critique.mjs --plan <plan.json> [--verdict REGRESSING]
//   node scripts/kaizen-critique.mjs --self-test

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const has = (v) => v != null && v !== '';
// exported so kaizen-rank reuses the exact same "is this a gate-strengthening rec" notion.
export const isGateStrengthening = (r) =>
  (Array.isArray(r.tags) && r.tags.some((t) => /gate|strengthen|harden|coverage/i.test(t))) ||
  /gate|strengthen|harden|coverage|leak/i.test(`${r.title || ''} ${r.what || ''}`);

/**
 * Critique a synthesised plan. Pure.
 * @param {object} plan
 * @param {{metaTrendVerdict?:string}} opts
 * @returns {{ok:boolean, gaps:Array<{severity:string, gap:string}>}}
 */
export function critique(plan = {}, opts = {}) {
  const gaps = [];
  const add = (severity, gap) => gaps.push({ severity, gap });

  const recs = Array.isArray(plan.recommendations) ? plan.recommendations : [];
  if (recs.length === 0) add('high', 'no recommendations at all — the week produced nothing actionable');

  recs.forEach((r, i) => {
    const label = r.title || `#${i + 1}`;
    if (!has(r.sourceRepo) && !has(r.url)) add('medium', `recommendation "${label}" has no source (sourceRepo/url) — unverifiable`);
    if (!has(r.pointOfIntegration)) add('medium', `recommendation "${label}" has no point-of-integration — not actionable / can't be outcome-audited`);
  });

  if (!Array.isArray(plan.killerFeatures) || plan.killerFeatures.length === 0)
    add('medium', 'no killer feature this week — the process should surface at least one leverage move');

  const sr = plan.sessionReview;
  const srEmpty = sr == null || (Array.isArray(sr) && sr.length === 0) || (typeof sr === 'object' && !Array.isArray(sr) && Object.keys(sr).length === 0);
  if (srEmpty) add('medium', 'session review is empty — the last-10-sessions analysis was skipped');

  // empty research domains
  if (plan.domains && typeof plan.domains === 'object') {
    for (const [name, count] of Object.entries(plan.domains)) {
      if (!count) add('low', `research domain "${name}" returned 0 candidates — coverage gap`);
    }
  }

  // plan must answer a REGRESSING meta-trend with a gate-strengthening item near the top
  if (/REGRESS/i.test(opts.metaTrendVerdict || '')) {
    const top = recs.slice(0, 3);
    if (!top.some(isGateStrengthening))
      add('high', 'meta-trend is REGRESSING but no gate-strengthening item is in the top 3 — plan ignores the verdict');
  }

  return { ok: gaps.length === 0, gaps };
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const gapsOf = (r) => r.gaps.map((g) => g.gap).join(' | ');

  const good = {
    recommendations: [
      { title: 'DAG planner', sourceRepo: 'open-multi-agent', pointOfIntegration: 'scripts/dag-schedule.mjs' },
      { title: 'strengthen leaking gate', url: 'https://x', pointOfIntegration: 'scripts/gate-x.mjs', tags: ['gate'] },
    ],
    killerFeatures: [{ title: 'closed-loop kaizen' }],
    sessionReview: [{ cls: 'type-button' }],
    domains: { memory: 3, evals: 2 },
  };
  ok('a complete plan passes clean', critique(good).ok === true);

  ok('empty plan → flags no recommendations', critique({}).gaps.some((g) => /no recommendations/.test(g.gap)));
  ok('rec without source is flagged', /no source/.test(gapsOf(critique({ recommendations: [{ title: 'x', pointOfIntegration: 's.mjs' }] }))));
  ok('rec without point-of-integration is flagged', /no point-of-integration/.test(gapsOf(critique({ recommendations: [{ title: 'x', url: 'u' }] }))));
  ok('missing killer feature flagged', /no killer feature/.test(gapsOf(critique({ recommendations: good.recommendations, sessionReview: good.sessionReview }))));
  ok('empty session review flagged', /session review is empty/.test(gapsOf(critique({ recommendations: good.recommendations, killerFeatures: good.killerFeatures, sessionReview: [] }))));
  ok('empty research domain flagged', /returned 0 candidates/.test(gapsOf(critique({ ...good, domains: { memory: 0 } }))));

  // meta-trend alignment
  const noGate = { recommendations: [{ title: 'shiny new feature', url: 'u', pointOfIntegration: 's.mjs' }], killerFeatures: [{ title: 'k' }], sessionReview: [{}] };
  ok('REGRESSING + no gate item in top3 → high gap', critique(noGate, { metaTrendVerdict: 'REGRESSING' }).gaps.some((g) => g.severity === 'high' && /ignores the verdict/.test(g.gap)));
  ok('REGRESSING + a gate item present → no verdict gap', !critique(good, { metaTrendVerdict: 'REGRESSING' }).gaps.some((g) => /ignores the verdict/.test(g.gap)));
  ok('non-regressing verdict does not require a gate item', !critique(noGate, { metaTrendVerdict: 'improving' }).gaps.some((g) => /ignores the verdict/.test(g.gap)));

  ok('gaps carry a severity', critique({}).gaps.every((g) => ['low', 'medium', 'high'].includes(g.severity)));

  if (fails) { console.log('\n\x1b[31mkaizen-critique self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ kaizen-critique: completeness gate over the plan correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const planPath = arg('--plan');
  if (!planPath || !fs.existsSync(planPath)) { console.error('usage: --plan <plan.json> [--verdict REGRESSING]  (or --self-test)'); process.exit(2); }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const res = critique(plan, { metaTrendVerdict: arg('--verdict') || '' });
  if (res.ok) { console.log('[kaizen-critique] ✓ plan is complete — no gaps'); process.exit(0); }
  console.log(`[kaizen-critique] ${res.gaps.length} gap(s):`);
  for (const g of res.gaps) console.log(`  [${g.severity}] ${g.gap}`);
  process.exit(res.gaps.some((g) => g.severity === 'high') ? 1 : 0);
}
