#!/usr/bin/env node
// debate-engine — round structure + completeness check + safety verdict override + transcript write.
// wave-judge-debias: adds positionSwap(), debiasedVerdict(), and --spec-anchor wiring.
// FULL & self-tested. Zero LLM calls — orchestrator runs those via Task.
// Usage:
//   node scripts/debate-engine.mjs --self-test
//   node scripts/debate-engine.mjs --plan "claim" [--spec-anchor docs/specs/wave-X_MASTER_SPEC.md]

import { mkdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

export function debatePlan() {
  return [
    { round: 1, name: 'opening', speakers: ['debate-prosecutor', 'debate-defender'] },
    { round: 2, name: 'cross-examination', speakers: ['debate-prosecutor', 'debate-defender'] },
    { round: 3, name: 'closing', speakers: ['debate-prosecutor', 'debate-defender', 'debate-judge'] },
  ];
}

export function isComplete(transcript) {
  const byRound = {};
  for (const t of transcript) (byRound[t.round] ??= new Set()).add(t.role);
  return Boolean(byRound[1]?.has('debate-prosecutor') && byRound[1]?.has('debate-defender') && byRound[3]?.has('debate-judge'));
}

// Safety override: unrefuted blocker can never exit as PASS. positionSensitive passthrough is optional.
export function finalVerdict(judgeVerdict, { unrefutedBlocker = false, positionSensitive } = {}) {
  const verdict = (unrefutedBlocker && judgeVerdict === 'PASS') ? 'BLOCK' : judgeVerdict;
  return positionSensitive !== undefined ? { verdict, positionSensitive } : verdict;
}

// AC-1: copy of plan with prosecutor/defender swapped in every round. Pure, zero side-effects.
export function positionSwap(plan) {
  return plan.map(round => {
    const s = round.speakers.slice();
    const p = s.indexOf('debate-prosecutor'), d = s.indexOf('debate-defender');
    if (p !== -1 && d !== -1) { s[p] = 'debate-defender'; s[d] = 'debate-prosecutor'; }
    return { ...round, speakers: s };
  });
}

const WEIGHT = { PASS: 0, REVISE: 1, BLOCK: 2, DEADLOCK: 3 };

// Position-sensitivity telemetry is NOT a logged mistake — it carries {ts,wave,class,run1,run2},
// with no claimed/real/caught_by, so it MUST NEVER be written to the mistake ledger
// (docs/audits/meta-mistakes.jsonl): meta-honesty would read it as a self-confirming "garbage-in"
// entry and BLOCK the pre-commit/pre-push gate. It streams to its own sidecar, which is a
// validator-regenerated telemetry file (gitignored, like gate-trips.jsonl), not source. Writing to
// the ledger here caused ledger-pollution twice (2026-06-06, recurred same day; root-caused 2026-07-04:
// the sidecar was created but the default write-path was never repointed). Env-overridable so the
// self-test suite can redirect it.
export const DEBIAS_LOG = process.env.JIDOKA_DEBIAS_LOG || 'docs/audits/judge-debias-telemetry.jsonl';

// AC-2..5,9: merge two judge verdicts (normal + swapped runs). Conservative: stricter wins.
// _testLogPath redirects the jsonl write to a tmp file during tests.
export function debiasedVerdict(run1, run2, { threshold = 1, _testLogPath = null } = {}) {
  const w1 = WEIGHT[run1] ?? 0, w2 = WEIGHT[run2] ?? 0;
  const positionSensitive = Math.abs(w1 - w2) >= threshold;
  if (positionSensitive) {
    const path = _testLogPath ?? DEBIAS_LOG;
    try { appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), wave: 'wave-judge-debias', class: 'position-sensitive', run1, run2 }) + '\n'); } catch (_) {}
  }
  return { verdict: w1 >= w2 ? run1 : run2, positionSensitive, run1, run2 };
}

async function selfTest() {
  const { unlinkSync, existsSync: fe, readFileSync } = await import('node:fs');
  const full = [{ round:1,role:'debate-prosecutor'},{round:1,role:'debate-defender'},{round:3,role:'debate-judge'}];
  const plan = debatePlan(), sw = positionSwap(plan);
  const ac1 = sw.length === plan.length && sw.every((r,i) => {
    const o=plan[i].speakers, p=o.indexOf('debate-prosecutor'), d=o.indexOf('debate-defender');
    return (p===-1||d===-1) || (r.speakers[p]==='debate-defender' && r.speakers[d]==='debate-prosecutor');
  });
  const tmp = '/tmp/meta-mistakes-test-debias.jsonl';
  try { unlinkSync(tmp); } catch(_) {}
  debiasedVerdict('PASS','BLOCK',{_testLogPath:tmp});
  let ac9=false;
  if (fe(tmp)) { try { const o=JSON.parse(readFileSync(tmp,'utf8').trim().split('\n').pop()); ac9=o.class==='position-sensitive'&&o.run1==='PASS'&&o.run2==='BLOCK'&&!!o.ts; } catch(_){} }
  try { unlinkSync(tmp); } catch(_){}
  const T = [
    ['plan has 3 rounds',                         debatePlan().length===3],
    ['closing includes judge',                    debatePlan()[2].speakers.includes('debate-judge')],
    ['complete debate validates',                 isComplete(full)===true],
    ['no judge ruling → incomplete',              isComplete([{round:1,role:'debate-prosecutor'},{round:1,role:'debate-defender'}])===false],
    ['judge PASS stays PASS',                     finalVerdict('PASS')==='PASS'],
    ['unrefuted blocker overrides PASS→BLOCK',    finalVerdict('PASS',{unrefutedBlocker:true})==='BLOCK'],
    ['judge BLOCK stays BLOCK',                   finalVerdict('BLOCK')==='BLOCK'],
    ['AC-1: positionSwap swaps in every round',   ac1],
    ['AC-2: identical → positionSensitive:false', debiasedVerdict('PASS','PASS').positionSensitive===false && debiasedVerdict('PASS','PASS').verdict==='PASS'],
    ['AC-3: PASS+BLOCK → sensitive:true,BLOCK',   debiasedVerdict('PASS','BLOCK',{_testLogPath:'/dev/null'}).positionSensitive===true && debiasedVerdict('PASS','BLOCK',{_testLogPath:'/dev/null'}).verdict==='BLOCK'],
    ['AC-4: REVISE+REVISE → sensitive:false',     debiasedVerdict('REVISE','REVISE').positionSensitive===false && debiasedVerdict('REVISE','REVISE').verdict==='REVISE'],
    ['AC-5: PASS+REVISE → sensitive:true,REVISE', debiasedVerdict('PASS','REVISE',{_testLogPath:'/dev/null'}).positionSensitive===true && debiasedVerdict('PASS','REVISE',{_testLogPath:'/dev/null'}).verdict==='REVISE'],
    ['AC-9: positionSensitive logs jsonl entry',  ac9],
    ['AC-10: finalVerdict compat (string return)', finalVerdict('PASS')==='PASS' && finalVerdict('PASS',{unrefutedBlocker:true})==='BLOCK'],
    // ledger-pollution regression (2026-07-04): the DEFAULT telemetry sink must never be the mistake
    // ledger — a position-sensitive row has no claimed/real and would trip meta-honesty (garbage-in).
    ['REGRESSION: DEBIAS_LOG default is NOT the mistake ledger', !/meta-mistakes/.test(DEBIAS_LOG)],
    ['REGRESSION: DEBIAS_LOG default is the debias sidecar',     /judge-debias/.test(DEBIAS_LOG)],
  ];
  let fails=0;
  for (const [n,ok] of T) { if(!ok)fails++; console.log(`  ${ok?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${n}`); }
  if (fails) { console.log('\n\x1b[31mdebate-engine self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ debate-engine: round structure + verdict aggregation correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) { await selfTest(); }
  const arg = (k) => { const i=process.argv.indexOf(k); return i!==-1?process.argv[i+1]:null; };
  const claim = arg('--plan') || arg('--claim');
  if (!claim) { console.error('usage: --plan "<claim>" [--spec-anchor <path>] | --self-test'); process.exit(2); }
  const anchor = arg('--spec-anchor');
  console.log(`debate-engine: adversarial verification of — "${claim}"\n`);
  if (anchor) { console.log(`  spec-anchor: ${anchor}\n  (Orchestrator: include anchor content in every judge dispatch)\n`); }
  else { console.log('  WARN: no spec-anchor — judge verdict will be based on rubric only\n'); }
  for (const r of debatePlan()) console.log(`  round ${r.round} (${r.name}): ${r.speakers.join(' vs ')}`);
  console.log('\n  Orchestrator dispatches each speaker (Task) per round → isComplete() + finalVerdict(). Transcript → docs/debates/.');
  mkdirSync('docs/debates', { recursive: true });
  const slug = claim.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40).replace(/-$/,'');
  const path = `docs/debates/${slug||'debate'}.md`;
  if (!existsSync(path)) {
    writeFileSync(path, `# Debate — ${claim}\n\n> Transcript skeleton. Orchestrator fills each round.\n\n## Round 1 — opening\n- prosecutor: \n- defender: \n\n## Round 2 — cross-examination\n- prosecutor: \n- defender: \n\n## Round 3 — closing\n- prosecutor: \n- defender: \n- judge VERDICT: \n`);
    console.log(`\n  opened transcript: ${path}`);
  }
  process.exit(0);
}
