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
