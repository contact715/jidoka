#!/usr/bin/env node
// wave-cost.mjs — per-wave duration + token cost ESTIMATE for the jidoka top panel. ≤400 LOC.
// Honest boundary (wave-tui-control spec): cost is an ≈estimate — usage blocks from the
// project's transcripts bucketed into each wave's [createdAt, updatedAt|now] time window.
// Parallel sessions in the same project window inflate a wave's number; the UI labels ≈.
// Pure math (prices, tier, bucketing) is exported + self-tested; fs gathering is separate.
//
// Prices: USD per MTok (Claude API list prices, 2026-06). cacheWrite = 5-minute cache tier.
// RELATION to compute-cost.mjs (NOT a duplicate): compute-cost prices a WAVE DASHBOARD
// markdown with a 50/50 split assumption; this prices REAL usage blocks per token type.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const PRICES = {
  opus:   { in: 15, out: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  sonnet: { in: 3,  out: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  haiku:  { in: 1,  out: 5,  cacheRead: 0.10, cacheWrite: 1.25 },
};

export function tierOf(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('haiku')) return 'haiku';
  return 'sonnet';
}

export function costUsd(usage, tier) {
  const p = PRICES[tier] || PRICES.sonnet;
  const u = usage || {};
  return ((u.input_tokens || 0) * p.in
        + (u.output_tokens || 0) * p.out
        + (u.cache_read_input_tokens || 0) * p.cacheRead
        + (u.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6;
}

export const tokensOf = (u = {}) =>
  (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);

// waves: run-state journals [{wave, createdAt, updatedAt, current, progress}]
// events: [{t: epochMs, usd, tokens}] — already priced
// Wave windows OVERLAP in real projects (parallel waves). Counting an event into every
// containing window double-bills it (observed: a 33h wave "absorbing" $3k of other waves'
// sessions). Rule: each event belongs to exactly ONE wave — the latest-started wave whose
// window contains it (the wave you were most plausibly working on at that moment).
export function bucketCosts(waves, events, nowMs) {
  const win = (waves || []).map((w) => {
    const start = Date.parse(w.createdAt || '');
    if (isNaN(start)) return { wave: w.wave, start: null };
    const finished = !w.current || w.progress === 100;
    const end = finished ? (Date.parse(w.updatedAt || '') || nowMs) : nowMs;
    return { wave: w.wave, start, end, usd: 0, tokens: 0, hit: false };
  });
  for (const e of events || []) {
    let best = null;
    for (const w of win) {
      if (w.start == null || e.t < w.start || e.t > w.end) continue;
      if (!best || w.start > best.start) best = w;
    }
    if (best) { best.usd += e.usd; best.tokens += e.tokens; best.hit = true; }
  }
  return win.map((w) => w.start == null
    ? { wave: w.wave, durMin: null, tokens: null, usd: null }
    : { wave: w.wave, durMin: Math.max(0, (w.end - w.start) / 60000), tokens: w.hit ? w.tokens : null, usd: w.hit ? w.usd : null });
}

// ── fs gather (impure) ────────────────────────────────────────────────────
const munge = (p) => String(p).replace(/[/.]/g, '-');

// Pull priced usage events from every transcript of the project newer than sinceMs.
// Whole-file reads are acceptable here because the caller throttles (10s cache in tui-top).
export function gatherUsageEvents(projectPath, sinceMs, home = homedir()) {
  const dir = join(home, '.claude', 'projects', munge(projectPath));
  if (!existsSync(dir)) return [];
  const events = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  for (const f of files) {
    const fp = join(dir, f);
    try {
      if (statSync(fp).mtimeMs < sinceMs) continue;
      for (const line of readFileSync(fp, 'utf8').split('\n')) {
        if (!line.includes('"usage"')) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        const u = j.message?.usage; if (!u) continue;
        const t = Date.parse(j.timestamp || ''); if (isNaN(t)) continue;
        events.push({ t, usd: costUsd(u, tierOf(j.message?.model)), tokens: tokensOf(u) });
      }
    } catch { /* unreadable transcript — skip */ }
  }
  return events;
}

// One call for the panel: journals + transcripts → [{wave, durMin, tokens, usd}].
export function collectWaveCosts(projectPath, home = homedir(), nowMs = Date.now()) {
  let journals = [];
  for (const base of ['docs/runs', '.jidoka/docs/runs']) {
    const dir = join(projectPath, base);
    if (!existsSync(dir)) continue;
    try {
      journals = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
        .map((d) => { try { return JSON.parse(readFileSync(join(dir, d.name, 'state.json'), 'utf8')); } catch { return null; } })
        .filter(Boolean)
        .map((s) => ({ wave: s.wave, createdAt: s.createdAt, updatedAt: s.updatedAt, current: s.current, progress: (s.phases || []).length ? Math.round((s.phases.filter((p) => p.status === 'done').length / s.phases.length) * 100) : 0 }));
      break;
    } catch { /* */ }
  }
  if (!journals.length) return [];
  const oldest = Math.min(...journals.map((j) => Date.parse(j.createdAt || '') || nowMs));
  const events = gatherUsageEvents(projectPath, oldest, home);
  return bucketCosts(journals, events, nowMs)
    .sort((a, b) => (b.usd || 0) - (a.usd || 0));
}

// ── self-test (pure math only) ────────────────────────────────────────────
function selfTest() {
  const fails = []; const ok = (n, c, d = '') => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}${d ? `  (${d})` : ''}`); };

  // AC-8: tier detection
  ok('AC-8: opus model → opus', tierOf('claude-opus-4-8') === 'opus');
  ok('AC-8: haiku model → haiku', tierOf('claude-haiku-4-5-20251001') === 'haiku');
  ok('AC-8: unknown → sonnet (conservative middle)', tierOf('mystery') === 'sonnet');

  // AC-8: pricing math — 1M output on opus = $75; cache read 1M on sonnet = $0.30
  ok('AC-8: 1M opus output = $75', costUsd({ output_tokens: 1e6 }, 'opus') === 75);
  ok('AC-8: 1M sonnet cache-read = $0.30', Math.abs(costUsd({ cache_read_input_tokens: 1e6 }, 'sonnet') - 0.3) < 1e-9);
  ok('AC-8: mixed block sums all four types', Math.abs(costUsd({ input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }, 'haiku') - (1 + 5 + 0.1 + 1.25)) < 1e-9);
  ok('AC-8: empty usage = $0', costUsd({}, 'opus') === 0 && costUsd(null, 'opus') === 0);
  ok('AC-8: tokensOf sums all types', tokensOf({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }) === 10);

  // AC-8: bucketing by wave window
  const NOW = Date.parse('2026-06-05T12:00:00Z');
  const waves = [
    { wave: 'w-live', createdAt: '2026-06-05T10:00:00Z', updatedAt: '2026-06-05T11:00:00Z', current: 'build', progress: 50 },
    { wave: 'w-done', createdAt: '2026-06-05T08:00:00Z', updatedAt: '2026-06-05T09:00:00Z', current: null, progress: 100 },
    { wave: 'w-broken', createdAt: null },
  ];
  const events = [
    { t: Date.parse('2026-06-05T08:30:00Z'), usd: 1, tokens: 100 },   // inside w-done only
    { t: Date.parse('2026-06-05T10:30:00Z'), usd: 2, tokens: 200 },   // inside w-live only
    { t: Date.parse('2026-06-05T11:30:00Z'), usd: 4, tokens: 400 },   // after w-live.updatedAt but live → counts (window extends to now)
    { t: Date.parse('2026-06-05T07:00:00Z'), usd: 8, tokens: 800 },   // before everything
  ];
  const b = bucketCosts(waves, events, NOW);
  const live = b.find((x) => x.wave === 'w-live'), done = b.find((x) => x.wave === 'w-done'), broken = b.find((x) => x.wave === 'w-broken');
  ok('AC-8: live wave window extends to now', live.usd === 6 && live.tokens === 600);
  ok('AC-8: done wave window closes at updatedAt', done.usd === 1 && done.tokens === 100);
  ok('AC-8: live duration = createdAt→now', Math.abs(live.durMin - 120) < 0.01);
  ok('AC-8: done duration = createdAt→updatedAt', Math.abs(done.durMin - 60) < 0.01);
  ok('AC-8: journal without createdAt degrades to nulls', broken.durMin === null && broken.usd === null);
  ok('AC-8: wave with no events in window → null cost (not $0 lie)', bucketCosts([waves[0]], [], NOW)[0].usd === null);

  // AC-8: overlapping windows — event billed to exactly ONE wave (the latest-started containing it)
  const overlapped = [
    { wave: 'w-old', createdAt: '2026-06-05T09:00:00Z', current: 'build', progress: 10 }, // live: window → now
    { wave: 'w-new', createdAt: '2026-06-05T10:15:00Z', current: 'build', progress: 10 }, // live, starts inside w-old
  ];
  const ob = bucketCosts(overlapped, [{ t: Date.parse('2026-06-05T10:30:00Z'), usd: 5, tokens: 50 }], NOW);
  ok('AC-8: overlap → later-started wave gets the event', ob.find((x) => x.wave === 'w-new').usd === 5);
  ok('AC-8: overlap → earlier wave does NOT double-bill', ob.find((x) => x.wave === 'w-old').usd === null);
  const total = (ws, es) => bucketCosts(ws, es, NOW).reduce((s, x) => s + (x.usd || 0), 0);
  ok('AC-8: no event counted twice (sum preserved)', total(overlapped, [{ t: Date.parse('2026-06-05T10:30:00Z'), usd: 5, tokens: 50 }]) === 5);

  if (fails.length) { console.log(`\n\x1b[31mFAIL (${fails.length}): ${fails.join(', ')}\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ wave-cost: prices + tiers + window bucketing (AC-8) correct\x1b[0m'); process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--self-test')) selfTest();
