#!/usr/bin/env node
/**
 * memory-curator — curate memory by MEASURED usefulness, not age alone.
 *
 * Closes research gap #4 (docs/research/2026-06-24_github-enrichment-research.md):
 * memory was pruned/ranked purely by recency-weighted frequency, so a valuable old
 * lesson decayed to DORMANT just by time, and nothing learned which lessons actually
 * help. This adds a per-class utility signal and a SURFACE PRIOR that boosts the
 * lessons most worth seeing before a task.
 *
 * The signal is LIVE on data already on disk (not a dormant container): it is derived
 * from the real ledger + the remedies registry — a gate that holds with zero
 * recurrences after its activation date is a helpful, working lesson; a class that
 * recurs AFTER its gate went live is a failing gate / live risk that should surface
 * MORE. Manual helpful/harmful overrides are layered on top (Laplace-smoothed).
 *
 * Non-destructive: writes a sidecar docs/audits/lesson-utility.json. It never mutates
 * the ledger, and memory-retrieve.mjs reads the sidecar as a mild prior (relevance
 * still dominates). Ported the idea (helpful/harmful + utility-over-age) from
 * ace-agent/ace — the algorithm only, no Python runtime.
 *
 * Usage:
 *   node scripts/memory-curator.mjs --build            # recompute sidecar from ledger+remedies
 *   node scripts/memory-curator.mjs --status
 *   node scripts/memory-curator.mjs --helpful <class>  # manual +1 helpful
 *   node scripts/memory-curator.mjs --harmful <class>  # manual +1 harmful
 *   node scripts/memory-curator.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLedger, groupByClass, recurrencesAfter, todayISO, LEDGER } from './meta-lib.mjs';
import { scoreCluster, ACTIVE, WATCH } from './memory-consolidate.mjs';
import { REMEDIES } from './meta-remedies.mjs';

// Sidecar lives next to the ledger (global ~/.claude/jidoka in install, docs/audits in repo)
// so curator (writer) and memory-retrieve (reader) always resolve the same file.
const SIDECAR = process.env.LESSON_UTILITY || LEDGER.replace(/meta-mistakes\.jsonl$/, 'lesson-utility.json');
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const TIER_W = { ACTIVE: 1.0, WATCH: 0.6, DORMANT: 0.2 };

const tierOf = (score) => (score >= ACTIVE ? 'ACTIVE' : score >= WATCH ? 'WATCH' : 'DORMANT');

/** Laplace-smoothed helpful share in [0,1]; 0.5 is neutral / no evidence. */
export function utilityFactor(helpful, harmful) {
  return (helpful + 1) / (helpful + harmful + 2);
}

/**
 * How strongly to BOOST a lesson at retrieval time. Live risks (ungated, recent,
 * recurring through a gate) surface more; solved/old lessons surface less.
 */
export function surfacePriorOf({ tier, gated, recurAfter }) {
  return clamp01(TIER_W[tier] * 0.6 + (gated ? 0 : 0.25) + (recurAfter > 0 ? 0.25 : 0));
}

/** Build per-class utility from raw ledger rows + the remedies registry. Pure. */
export function computeUtility(rows, remedies = REMEDIES, manual = {}, today = todayISO()) {
  const familyGate = {};
  for (const [cls, r] of Object.entries(remedies)) {
    familyGate[cls] = cls;
    for (const f of (r.family || [])) if (!familyGate[f]) familyGate[f] = cls;
  }
  const byClass = groupByClass(rows);
  const classes = {};
  for (const [cls, items] of Object.entries(byClass)) {
    const score = scoreCluster(items, today);
    const tier = tierOf(score);
    const gateCls = familyGate[cls] || null;
    const gated = !!gateCls;
    const since = gateCls ? remedies[gateCls].since : null;
    const recurAfter = gated ? recurrencesAfter(items, since).length : 0;
    const autoHelpful = gated && recurAfter === 0 ? 1 : 0;
    const autoHarmful = recurAfter;
    const man = manual[cls] || { helpful: 0, harmful: 0 };
    const helpful = autoHelpful + (man.helpful || 0);
    const harmful = autoHarmful + (man.harmful || 0);
    classes[cls] = {
      tier, gated, recurAfter, helpful, harmful,
      utilityFactor: Math.round(utilityFactor(helpful, harmful) * 1000) / 1000,
      surfacePrior: Math.round(surfacePriorOf({ tier, gated, recurAfter }) * 1000) / 1000,
    };
  }
  return { today, classes };
}

function loadManual() {
  if (!existsSync(SIDECAR)) return {};
  try { return JSON.parse(readFileSync(SIDECAR, 'utf8')).manual || {}; } catch { return {}; }
}
function save(model, manual) {
  mkdirSync(dirname(SIDECAR), { recursive: true });
  writeFileSync(SIDECAR, JSON.stringify({ ...model, manual }, null, 2) + '\n');
}
function arg(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const manual = loadManual();
  const bump = (cls, key) => { (manual[cls] ??= { helpful: 0, harmful: 0 })[key]++; };
  const h = arg(args, '--helpful'); if (h) bump(h, 'helpful');
  const harm = arg(args, '--harmful'); if (harm) bump(harm, 'harmful');

  const model = computeUtility(loadLedger(), REMEDIES, manual, todayISO());

  if (args.includes('--status') && !args.includes('--build') && !h && !harm) {
    const rows = Object.entries(model.classes).sort((a, b) => b[1].surfacePrior - a[1].surfacePrior);
    console.log(`memory-curator: ${rows.length} classes (by surfacePrior)`);
    for (const [cls, u] of rows.slice(0, 12)) {
      console.log(`  ${u.surfacePrior.toFixed(2)}  ${cls}  [${u.tier}${u.gated ? ' gated' : ' UNGATED'}${u.recurAfter ? ` recur×${u.recurAfter}` : ''}]  util ${u.utilityFactor}`);
    }
    return;
  }

  // --build / --helpful / --harmful all persist the sidecar.
  save(model, manual);
  console.log(`memory-curator: wrote ${SIDECAR} (${Object.keys(model.classes).length} classes${h ? `, +helpful ${h}` : ''}${harm ? `, +harmful ${harm}` : ''})`);
}

function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); fail++; } };
  console.log('memory-curator --self-test');

  ok(utilityFactor(0, 0) === 0.5, 'no evidence → neutral 0.5');
  ok(utilityFactor(3, 0) > 0.5 && utilityFactor(0, 3) < 0.5, 'helpful raises, harmful lowers utility');

  ok(surfacePriorOf({ tier: 'ACTIVE', gated: false, recurAfter: 0 }) > surfacePriorOf({ tier: 'DORMANT', gated: true, recurAfter: 0 }), 'active+ungated surfaces above dormant+gated');
  ok(surfacePriorOf({ tier: 'WATCH', gated: true, recurAfter: 2 }) > surfacePriorOf({ tier: 'WATCH', gated: true, recurAfter: 0 }), 'recurrence-through-gate boosts surfacing');
  ok(surfacePriorOf({ tier: 'ACTIVE', gated: false, recurAfter: 5 }) <= 1, 'surface prior is clamped to ≤1');

  const remedies = { 'leak': { since: '2026-01-10', mechanism: 'm', family: ['leak-2'] } };
  const rows = [
    { date: '2026-01-05', class: 'leak', claimed: 'a', real: 'b' },   // before gate → provoked it
    { date: '2026-02-01', class: 'leak', claimed: 'c', real: 'd' },   // AFTER gate → recurrence (gate failing)
    { date: '2026-02-02', class: 'ungated-thing', claimed: 'e', real: 'f' },
  ];
  const u = computeUtility(rows, remedies, {}, '2026-02-10');
  ok(u.classes.leak.recurAfter === 1, 'recurrence after gate-since is counted');
  ok(u.classes.leak.harmful >= 1, 'a recurring-through-gate class is marked harmful');
  ok(u.classes['ungated-thing'].gated === false, 'a class with no remedy is ungated');

  // incident BEFORE the gate-since (it provoked the gate), with none after → gate is holding.
  const rows2 = [{ date: '2026-01-05', class: 'leak', claimed: 'x', real: 'y' }];
  const u2 = computeUtility(rows2, remedies, {}, '2026-02-10');
  ok(u2.classes.leak.recurAfter === 0 && u2.classes.leak.helpful === 1, 'gate holding (no recurrence) → helpful');

  const u3 = computeUtility(rows2, remedies, { leak: { helpful: 0, harmful: 5 } }, '2026-02-10');
  ok(u3.classes.leak.harmful === 5, 'manual harmful override is layered on top');

  console.log(fail === 0 ? '\nmemory-curator: all self-tests passed' : `\nmemory-curator: ${fail} self-test(s) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
