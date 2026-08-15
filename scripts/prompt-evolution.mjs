#!/usr/bin/env node
// prompt-evolution — closes the self-improvement loop on the AGENTS themselves. A judge that fails
// its golden cases is a candidate for a prompt patch. This is the DETERMINISTIC half: find the
// failing agents, and (after a patch is tried and re-run) decide whether the new run is a STRICT
// improvement with NO regression — so a fix for one case can't silently break another.
//
// HONEST SPLIT: candidate detection + the improvement/regression guard = FULL (here). Generating the
// prompt patch and applying it = an LLM + human step (the prompt-evolver agent proposes; a human
// accepts). The guard below is what makes that safe: a patch only counts if it strictly improves
// accuracy AND regresses nothing. Never auto-applied.
//
// FULL & self-tested. Usage:
//   node scripts/prompt-evolution.mjs --self-test
//   node scripts/prompt-evolution.mjs            # list agents whose golden accuracy < 100% (candidates)

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { score } from './llm-eval-score.mjs';

const EVALS = 'docs/evals';
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// candidates = measured agents below 100% on their golden set
export function findCandidates(rows) {
  return rows.filter(r => r.status === 'MEASURED' && r.accuracy < 1).map(r => ({ slug: r.slug, accuracy: r.accuracy }));
}

// strict improvement: higher accuracy AND no previously-passing case now fails
export function isImprovement(before, after) {
  const wasPassing = Object.fromEntries(before.map(r => [r.case_id, r.match]));
  const regressed = after.some(r => wasPassing[r.case_id] === true && r.match === false);
  const acc = (rs) => rs.length ? rs.filter(r => r.match).length / rs.length : 0;
  const beforeAcc = acc(before), afterAcc = acc(after);
  return { improved: afterAcc > beforeAcc && !regressed, beforeAcc, afterAcc, regressed };
}

// ── paretoArchive: a front instead of one monotonic winner (2026-W30-R5, GEPA) ───────────────
// `isImprovement` above is a STRICT scalar gate: higher accuracy AND no previously-passing case
// now failing. That is the right gate for SHIPPING, and it is a trap for SEARCHING. A variant that
// fixes three hard cases and breaks one easy one is rejected outright, so the search can only ever
// crawl uphill from where it stands and dies in the first local optimum it meets. Every variant
// that traded one case for three is thrown away and never seen again.
//
// A Pareto front keeps them. A variant belongs on the front when NO other variant is at least as
// good on every single case and strictly better somewhere — so "best overall" and "the only one
// that solves case 7" both survive, and the next round can start from either.
//
// This SEARCHES and ARCHIVES. It never ships anything: `isImprovement` plus a human stay the only
// way in. That separation is deliberate — an archive that could promote its own members would be a
// self-improving loop grading its own homework, which is the reward-hacking surface this engine
// already guards with meta-honesty.
//
// It runs on the DETERMINISTIC per-case match vectors from llm-eval-score.score(): no judge, no
// LLM, no network. That is why it works today while judge calibration is still a standing P0 —
// it does not depend on it at all.

/** Per-case pass vector of a variant, as a Map. Pure. */
export const matchVector = (results = []) => new Map(results.map((r) => [r.case_id, r.match === true]));

/**
 * Does `a` dominate `b`? At least as good on EVERY case, strictly better on at least one. Pure.
 * Cases only one side ran are ignored: comparing on different case sets would let a variant
 * "dominate" by having been measured on less.
 */
export function dominates(a, b) {
  const A = matchVector(a), B = matchVector(b);
  const shared = [...A.keys()].filter((k) => B.has(k));
  if (!shared.length) return false;
  let strictlyBetter = false;
  for (const k of shared) {
    const av = A.get(k), bv = B.get(k);
    if (!av && bv) return false;        // worse somewhere → cannot dominate
    if (av && !bv) strictlyBetter = true;
  }
  return strictlyBetter;
}

/**
 * The Pareto front of variants. Pure.
 * @param {Array<{id:string, results:Array}>} variants
 * @returns {{front:Array, dominated:Array, reason:string}}
 */
export function paretoArchive(variants = []) {
  const front = variants.filter((v) => !variants.some((o) => o.id !== v.id && dominates(o.results, v.results)));
  const dominated = variants.filter((v) => !front.includes(v));
  return {
    front,
    dominated,
    reason: front.length
      ? `на фронте ${front.length} вариант(ов): каждый лучший хоть на чём-то, ни один не побеждён целиком`
      : 'вариантов нет — фронт пуст, и это не «всё хорошо», а «нечего сравнивать»',
  };
}

function scan() {
  if (!existsSync(EVALS)) return [];
  const dirs = readdirSync(EVALS).filter(d => { try { return statSync(join(EVALS, d)).isDirectory(); } catch { return false; } });
  return dirs.map(slug => {
    const dir = join(EVALS, slug);
    const gp = join(dir, 'golden-cases.jsonl');
    const runs = readdirSync(dir).filter(f => f.startsWith('run-') && f.endsWith('.jsonl')).sort();
    if (!existsSync(gp) || !runs.length) return null;
    const s = score(readJsonl(gp), readJsonl(join(dir, runs.at(-1))));
    return { slug, status: 'MEASURED', accuracy: s.accuracy, results: s.results };
  }).filter(Boolean);
}

function selfTest() {
  const rows = [
    { slug: 'perfect', status: 'MEASURED', accuracy: 1 },
    { slug: 'failing', status: 'MEASURED', accuracy: 0.67 },
    { slug: 'dormant', status: 'DORMANT', accuracy: null },
  ];
  const before = [{ case_id: 'a', match: true }, { case_id: 'b', match: true }, { case_id: 'c', match: false }]; // 2/3
  const fixed = [{ case_id: 'a', match: true }, { case_id: 'b', match: true }, { case_id: 'c', match: true }]; // 3/3
  const brokeOther = [{ case_id: 'a', match: false }, { case_id: 'b', match: true }, { case_id: 'c', match: true }]; // 2/3, a regressed
  const T = [
    ['finds only failing measured agents', JSON.stringify(findCandidates(rows).map(c => c.slug)) === JSON.stringify(['failing'])],
    ['a real fix is an improvement', isImprovement(before, fixed).improved === true],
    ['fixing one but breaking another is NOT (regression guard)', isImprovement(before, brokeOther).improved === false],
    ['the broken case is flagged regressed', isImprovement(before, brokeOther).regressed === true],
    ['no accuracy gain is not an improvement', isImprovement(before, before).improved === false],

    // ── Pareto archive: search wide, ship narrow (2026-W30-R5) ─────────────
    ['a variant better everywhere dominates', dominates(
      [{ case_id: '1', match: true }, { case_id: '2', match: true }],
      [{ case_id: '1', match: true }, { case_id: '2', match: false }]) === true],
    ['trading one case for another dominates NOTHING', dominates(
      [{ case_id: '1', match: true }, { case_id: '2', match: false }],
      [{ case_id: '1', match: false }, { case_id: '2', match: true }]) === false],
    ['an identical variant does not dominate (no strict gain)', dominates(
      [{ case_id: '1', match: true }], [{ case_id: '1', match: true }]) === false],
    // measured on a different case set is not "better", it is incomparable
    ['variants sharing no cases never dominate each other', dominates(
      [{ case_id: 'a', match: true }], [{ case_id: 'b', match: false }]) === false],

    ['both halves of a trade survive on the front — the local optimum escape', (() => {
      const A = { id: 'A', results: [{ case_id: '1', match: true }, { case_id: '2', match: false }] };
      const B = { id: 'B', results: [{ case_id: '1', match: false }, { case_id: '2', match: true }] };
      return paretoArchive([A, B]).front.length === 2;
    })()],
    ['a variant better on everything clears the front', (() => {
      const A = { id: 'A', results: [{ case_id: '1', match: true }, { case_id: '2', match: false }] };
      const C = { id: 'C', results: [{ case_id: '1', match: true }, { case_id: '2', match: true }] };
      const r = paretoArchive([A, C]);
      return r.front.map((v) => v.id).join() === 'C' && r.dominated.map((v) => v.id).join() === 'A';
    })()],
    ['a single variant is its own front', paretoArchive([{ id: 'A', results: [{ case_id: '1', match: true }] }]).front.length === 1],
    ['no variants → empty front, and it says that is not "fine"',
      paretoArchive([]).front.length === 0 && /нечего сравнивать/.test(paretoArchive([]).reason)],

    // the separation that keeps this from grading its own homework
    ['the SHIP gate is untouched: a trade is still rejected for shipping', (() => {
      const b = [{ case_id: '1', match: true }, { case_id: '2', match: false }];
      const a = [{ case_id: '1', match: false }, { case_id: '2', match: true }];
      return isImprovement(b, a).improved === false;
    })()],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mprompt-evolution self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ prompt-evolution: candidate + improvement guard correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const rows = scan();
  const cands = findCandidates(rows);
  console.log(`prompt-evolution: ${rows.length} measured agent(s), ${cands.length} below 100% (evolution candidates)\n`);
  for (const c of cands) {
    const row = rows.find(r => r.slug === c.slug);
    const misses = row.results.filter(r => !r.match).map(r => `${r.case_id} (expected ${r.expected}, got ${r.got})`);
    console.log(`  🟡 ${c.slug}: ${(c.accuracy * 100).toFixed(0)}% — misses: ${misses.join('; ')}`);
  }
  if (!cands.length) { console.log('  🟢 every measured agent is at 100% — nothing to evolve.'); }
  else {
    console.log('\n  Next: dispatch the prompt-evolver agent on a candidate → it proposes a MINIMAL prompt patch →');
    console.log('  re-run the golden cases → prompt-evolution verifies isImprovement (strict gain, no regression) → human accepts.');
  }
  process.exit(0);
}
