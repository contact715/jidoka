#!/usr/bin/env node
// approval-queue — turns "the human triggers the merge" from a principle into a mechanism. A change
// ready for merge is SUBMITTED with its gate verdicts; the human sees the queue (what's waiting,
// is it green, what each gate said) and DECIDES (approve / reject / edit); the decision is written
// to an append-only decision-log (who, when, what, why). No more informal "looks good, merge it".
//
// HONEST SPLIT: the queue + readiness check + decision-log = FULL (here, self-tested). The actual
// git merge is performed by the human after they decide — this records and gates that decision, it
// does not perform the merge (agents propose, humans trigger — the mechanism enforces the record).
//
// FULL & self-tested. Usage:
//   node scripts/approval-queue.mjs --self-test
//   node scripts/approval-queue.mjs --submit '{"id":"wave-x","title":"...","gates":{"eval":"100%","ghosts":0}}'
//   node scripts/approval-queue.mjs                                  # show pending queue + readiness
//   node scripts/approval-queue.mjs --decide wave-x approve --by mitya --reason "verified"
//   node scripts/approval-queue.mjs --log                           # the decision history

import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

const QUEUE = process.env.APPROVAL_QUEUE || 'docs/audits/approval-queue.jsonl';
const LOG = process.env.DECISION_LOG || 'docs/audits/decision-log.jsonl';
const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

// pure: is a change ready to approve? (no failing gate, no ghosts/regressions)
export function isReady(gates) {
  for (const [k, v] of Object.entries(gates || {})) {
    if (typeof v === 'string' && /(fail|block|✗|red|compromised|regress)/i.test(v)) return false;
    if (typeof v === 'number' && /(ghost|regression|fail|breach|vuln)/i.test(k) && v > 0) return false;
  }
  return true;
}

export function applyDecision(items, id, decision) {
  return items.map(i => i.id === id ? { ...i, status: decision } : i);
}

export function summarizeQueue(items) {
  const s = { pending: 0, approved: 0, rejected: 0, edited: 0 };
  for (const i of items) s[i.status] = (s[i.status] || 0) + 1;
  return s;
}

function selfTest() {
  const items = [
    { id: 'a', status: 'pending', gates: { eval: '100%', ghosts: 0 } },
    { id: 'b', status: 'approved', gates: {} },
  ];
  const T = [
    ['all-green gates → ready', isReady({ eval: '100%', ghosts: 0, reflexion: 'PASS' }) === true],
    ['a failing gate → not ready', isReady({ eval: '90%', reflexion: 'BLOCK' }) === false],
    ['a ghost → not ready', isReady({ ghosts: 1 }) === false],
    ['a regression count → not ready', isReady({ regressions: 2 }) === false],
    ['decision updates the right item', applyDecision(items, 'a', 'approved').find(i => i.id === 'a').status === 'approved'],
    ['decision leaves others alone', applyDecision(items, 'a', 'approved').find(i => i.id === 'b').status === 'approved'],
    ['summary tallies statuses', summarizeQueue(items).pending === 1 && summarizeQueue(items).approved === 1],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mapproval-queue self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ approval-queue: readiness + decision logic correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const today = process.env.META_TODAY || new Date().toISOString().slice(0, 10);
  mkdirSync('docs/audits', { recursive: true });

  if (arg('--submit')) {
    const item = JSON.parse(arg('--submit')); item.status = 'pending'; item.ts = item.ts || today;
    appendFileSync(QUEUE, JSON.stringify(item) + '\n');
    console.log(`approval-queue: submitted "${item.title || item.id}" (${isReady(item.gates) ? 'ready' : 'NOT ready — gates red'})`);
    process.exit(0);
  }
  if (process.argv.includes('--decide')) {
    const di = process.argv.indexOf('--decide'); const id = process.argv[di + 1], decision = process.argv[di + 2];
    if (!['approve', 'reject', 'edit'].includes(decision)) { console.error('decision must be approve|reject|edit'); process.exit(2); }
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'edited';
    const items = readJsonl(QUEUE);
    if (!items.some(i => i.id === id)) { console.error(`no queued item "${id}"`); process.exit(1); }
    writeFileSync(QUEUE, applyDecision(items, id, status).map(i => JSON.stringify(i)).join('\n') + '\n');
    const entry = { id, decision: status, by: arg('--by') || 'unknown', reason: arg('--reason') || '', ts: today };
    appendFileSync(LOG, JSON.stringify(entry) + '\n');
    console.log(`approval-queue: ${id} → ${status} by ${entry.by}. Logged to decision-log.`);
    process.exit(0);
  }
  if (process.argv.includes('--log')) {
    const log = readJsonl(LOG);
    if (!log.length) { console.log('decision-log: empty.'); process.exit(0); }
    for (const e of log) console.log(`  ${e.ts}  ${e.id} → ${e.decision} by ${e.by}${e.reason ? ' — ' + e.reason : ''}`);
    process.exit(0);
  }
  const items = readJsonl(QUEUE);
  const pending = items.filter(i => i.status === 'pending');
  const s = summarizeQueue(items);
  console.log(`approval-queue: ${pending.length} pending · ${s.approved || 0} approved · ${s.rejected || 0} rejected\n`);
  if (!pending.length) { console.log('  nothing waiting for a human decision.'); process.exit(0); }
  for (const i of pending) {
    const ready = isReady(i.gates);
    const gates = Object.entries(i.gates || {}).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`  ${ready ? '🟢 ready' : '🔴 blocked'}  ${i.id} — ${i.title || ''}`);
    console.log(`     gates: ${gates}`);
    console.log(`     decide: node scripts/approval-queue.mjs --decide ${i.id} approve|reject|edit --by <you> --reason <why>`);
  }
  console.log('\n  \x1b[2magents propose; the human triggers the merge. This records what is proposed, with which verdicts, and who decided.\x1b[0m');
  process.exit(0);
}
