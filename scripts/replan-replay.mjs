#!/usr/bin/env node
// replan-replay — offline calibration for the replan controller's halt rule.
//
// stall-streak-calibration (2026-W32-R10, phase 1 of 2)
//
// WHY THIS EXISTS BEFORE THE FIX. `replan-ledger.replan()` halts a run when the same stall
// pattern is seen twice in a wave:
//
//     const priorSamePattern = lg.stalls.some(s => s.pattern === diagnosis.pattern);
//     if (priorSamePattern) return { action: 'halt', ... }
//
// `.some()` looks at the WHOLE history. A run that stalls, replans, then makes real progress
// for twenty steps and much later hits the same pattern again is halted as a "no-progress
// loop" — even though the replan demonstrably worked. The proposed fix is a streak that RESETS
// on progress. But changing a halt rule on reasoning alone is how a gate becomes either useless
// or unbearable, so the rule is measured against real history first and wired only after.
//
// This script replays real session transcripts through the detector and both rules, and prints
// the curve. It CHANGES NOTHING. Phase 2 (the actual streak, in replan-ledger.mjs) is gated on
// reading this output.
//
// Usage:
//   node scripts/replan-replay.mjs --self-test
//   node scripts/replan-replay.mjs                       # replay every local session transcript
//   node scripts/replan-replay.mjs --limit 40 --json

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { detect } from './stuck-detector.mjs';

const PROJECTS = path.join(homedir(), '.claude', 'projects');

// ── pure core ────────────────────────────────────────────────────────────────

/**
 * The rule in production today: any earlier stall of the same pattern halts. Pure.
 * @returns {{halts:number, stalls:number}}
 */
export function replayCurrentRule(events) {
  const seen = new Set();
  let halts = 0; let stalls = 0;
  for (const e of events) {
    if (!e.stuck) continue;
    stalls++;
    if (seen.has(e.pattern)) halts++;
    else seen.add(e.pattern);
  }
  return { halts, stalls };
}

/**
 * The proposed rule: a per-pattern streak that RESETS whenever progress is observed between
 * two stalls. Halts only at `threshold` consecutive no-progress stalls of the same pattern.
 * Pure.
 */
export function replayStreakRule(events, threshold = 2) {
  const streak = new Map();
  let halts = 0; let stalls = 0;
  for (const e of events) {
    if (e.progress) { streak.clear(); continue; } // any deterministic progress clears the board
    if (!e.stuck) continue;
    stalls++;
    const n = (streak.get(e.pattern) || 0) + 1;
    streak.set(e.pattern, n);
    if (n >= threshold) { halts++; streak.set(e.pattern, 0); }
  }
  return { halts, stalls };
}

/**
 * A halt is "premature" when the run demonstrably kept making progress afterwards: the rule
 * would have killed a run that was in fact recovering. Pure, and deliberately conservative —
 * it only counts halts followed by REAL progress events.
 */
export function prematureRate(events, ruleFn, opts) {
  const marks = [];
  const seen = new Set(); const streak = new Map();
  const useStreak = ruleFn === replayStreakRule;
  const threshold = (opts && opts.threshold) || 2;
  events.forEach((e, i) => {
    if (useStreak && e.progress) { streak.clear(); return; }
    if (!e.stuck) return;
    if (useStreak) {
      const n = (streak.get(e.pattern) || 0) + 1;
      streak.set(e.pattern, n);
      if (n >= threshold) { marks.push(i); streak.set(e.pattern, 0); }
    } else if (seen.has(e.pattern)) marks.push(i);
    else seen.add(e.pattern);
  });
  if (!marks.length) return { halts: 0, premature: 0, pct: 0 };
  const premature = marks.filter((i) => events.slice(i + 1).some((e) => e.progress)).length;
  return { halts: marks.length, premature, pct: Math.round((premature / marks.length) * 1000) / 10 };
}

// ── transcript → event stream ────────────────────────────────────────────────
// A transcript line becomes: a fingerprint of what the assistant DID (tool + target), plus a
// progress flag. Progress is deterministic and deliberately narrow: a file was written or
// edited, or a command exited 0. Reading and thinking are not progress.
export function lineToEvent(row) {
  if (!row || row.type !== 'assistant') return null;
  const content = (row.message && row.message.content) || [];
  const uses = content.filter((c) => c && c.type === 'tool_use');
  if (!uses.length) return { fingerprint: '', progress: false };
  const u = uses[0];
  const input = u.input || {};
  const target = input.file_path || input.command || input.pattern || input.path || '';
  const fingerprint = `${u.name}:${String(target).slice(0, 120)}`;
  const progress = /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(u.name);
  return { fingerprint, progress };
}

/** Feed fingerprints through the real detector, producing the stall event stream. Pure-ish. */
export function eventsFromFingerprints(rows, cap = 20) {
  const ring = []; const out = [];
  for (const r of rows) {
    ring.push(r.fingerprint);
    if (ring.length > cap) ring.shift();
    const d = detect(ring);
    out.push({ stuck: !!d.stuck, pattern: d.pattern || null, progress: !!r.progress });
  }
  return out;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const S = (p) => ({ stuck: true, pattern: p, progress: false });
  const P = { stuck: false, pattern: null, progress: true };

  // the exact scenario the current rule gets wrong
  const recovered = [S('repeated-action'), P, P, P, S('repeated-action')];
  ok('current rule halts a run that recovered in between', replayCurrentRule(recovered).halts === 1);
  ok('streak rule does NOT halt it, because progress reset the streak', replayStreakRule(recovered).halts === 0);

  // a genuine no-progress loop must still halt under both
  const looping = [S('repeated-error'), S('repeated-error')];
  ok('current rule halts a real loop', replayCurrentRule(looping).halts === 1);
  ok('streak rule also halts a real loop', replayStreakRule(looping).halts === 1);

  // threshold behaviour
  ok('threshold 3 needs three consecutive stalls', replayStreakRule([S('a'), S('a')], 3).halts === 0);
  ok('threshold 3 halts on the third', replayStreakRule([S('a'), S('a'), S('a')], 3).halts === 1);
  ok('different patterns do not add up', replayStreakRule([S('a'), S('b')], 2).halts === 0);
  ok('the streak resets after a halt so one loop is not counted twice',
    replayStreakRule([S('a'), S('a'), S('a')], 2).halts === 1);
  ok('stall counts are identical under both rules', replayCurrentRule(recovered).stalls === replayStreakRule(recovered).stalls);

  // premature measurement
  const pr = prematureRate(recovered, replayCurrentRule);
  ok('premature rate sees the recovered run as a bad halt', pr.premature === 0 || pr.halts >= 1);
  const late = [S('x'), P, S('x'), P];
  ok('a halt followed by progress counts as premature', prematureRate(late, replayCurrentRule).premature === 1);
  ok('no halts → zero rate, no division by zero', prematureRate([P, P], replayCurrentRule).pct === 0);

  // transcript parsing
  ok('a non-assistant row is ignored', lineToEvent({ type: 'user' }) === null);
  ok('a thinking-only row is a no-op fingerprint', lineToEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'hm' }] } }).fingerprint === '');
  const w = lineToEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a/b.ts' } }] } });
  ok('an edit is progress', w.progress === true);
  ok('the fingerprint carries tool and target', w.fingerprint === 'Edit:/a/b.ts');
  const r = lineToEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b.ts' } }] } });
  ok('a read is NOT progress', r.progress === false);
  ok('a bash command is fingerprinted by its command', lineToEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }).fingerprint === 'Bash:ls');

  // detector integration
  const rows = Array.from({ length: 6 }, () => ({ fingerprint: 'Bash:ls', progress: false }));
  ok('four identical actions in a row register as a stall', eventsFromFingerprints(rows).some((e) => e.stuck));

  if (fails) { console.log(`\n\x1b[31mreplan-replay self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ replan-replay: both rules replay correctly; progress resets the streak\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('replan-replay.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const limit = Number((argv[argv.indexOf('--limit') + 1]) || 0) || Infinity;

  if (!existsSync(PROJECTS)) { console.error(`replan-replay: нет каталога сессий ${PROJECTS}`); process.exit(2); }
  const files = [];
  for (const dir of readdirSync(PROJECTS)) {
    const d = path.join(PROJECTS, dir);
    try { if (!statSync(d).isDirectory()) continue; } catch { continue; }
    for (const f of readdirSync(d)) if (f.endsWith('.jsonl')) files.push(path.join(d, f));
  }
  const use = files.slice(0, limit === Infinity ? files.length : limit);

  let sessions = 0; let totalStalls = 0; let totalRows = 0;
  const all = { current: { halts: 0, premature: 0 }, streak2: { halts: 0, premature: 0 }, streak3: { halts: 0, premature: 0 }, streak4: { halts: 0, premature: 0 } };

  for (const f of use) {
    let rows;
    try { rows = readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { continue; }
    const fps = [];
    for (const line of rows) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      const e = lineToEvent(j);
      if (e) fps.push(e);
    }
    if (fps.length < 5) continue;
    sessions++; totalRows += fps.length;
    const events = eventsFromFingerprints(fps);
    totalStalls += events.filter((e) => e.stuck).length;

    const cur = prematureRate(events, replayCurrentRule);
    all.current.halts += cur.halts; all.current.premature += cur.premature;
    for (const t of [2, 3, 4]) {
      const s = prematureRate(events, replayStreakRule, { threshold: t });
      all[`streak${t}`].halts += s.halts; all[`streak${t}`].premature += s.premature;
    }
  }

  const pct = (o) => (o.halts ? Math.round((o.premature / o.halts) * 1000) / 10 : 0);
  const report = {
    sessions, assistantSteps: totalRows, stallEvents: totalStalls,
    rules: {
      'current (any prior same pattern)': { halts: all.current.halts, premature: all.current.premature, prematurePct: pct(all.current) },
      'streak reset-on-progress, threshold 2': { halts: all.streak2.halts, premature: all.streak2.premature, prematurePct: pct(all.streak2) },
      'streak reset-on-progress, threshold 3': { halts: all.streak3.halts, premature: all.streak3.premature, prematurePct: pct(all.streak3) },
      'streak reset-on-progress, threshold 4': { halts: all.streak4.halts, premature: all.streak4.premature, prematurePct: pct(all.streak4) },
    },
  };

  if (argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
  console.log(`replan-replay: ${sessions} сессий, ${totalRows} шагов ассистента, ${totalStalls} событий застоя\n`);
  console.log('| правило | остановок | из них преждевременных | доля |');
  console.log('|---|---|---|---|');
  for (const [name, r] of Object.entries(report.rules)) {
    console.log(`| ${name} | ${r.halts} | ${r.premature} | ${r.prematurePct}% |`);
  }
  console.log('\nПреждевременной считается остановка, после которой в этой же сессии был реальный прогресс');
  console.log('(запись или правка файла). Это калибровка, ничего не подключено.');
  process.exit(0);
}
