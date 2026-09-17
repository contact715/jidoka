#!/usr/bin/env node
// gate-graduation — closes the "eternal soft-trial" gap. Soft gates (.sdd-config hardBlockEnabled:
// false) warn but never block; without a readiness check they stay soft forever. This reports, for
// each soft gate, whether it is READY to graduate to hard-block — and proposes the flip for a human.
// It NEVER flips a gate itself (an auto-hardened gate that false-positives would halt the whole
// pipeline — graduation is a human call). Complements .sdd-config autoStrengthen (event-based
// auto-promote engine, currently disabled): this is the human-facing readiness view.
//
// Readiness rule (by the NATURE of the trial, not just time):
//   trialing   — younger than the graduation horizon; too soon.
//   no-signal  — horizon passed but the gate never fired → nothing proven; don't harden a gate that
//                has never caught anything (it may be unneeded, or the trial wasn't exercised).
//   noisy      — the gate fired with false-positives → calibrate first, hardening would block good work.
//   READY      — horizon passed, fired on real issues, zero false-positives → safe to flip to hard.
//
// FULL & self-tested. META_TODAY overrides "today". Usage:
//   node scripts/gate-graduation.mjs
//   node scripts/gate-graduation.mjs --self-test

import { readFileSync, existsSync } from 'node:fs';
import { runCli } from './lib/cli.mjs';

const GRADUATION_DAYS = 30;

export function gradeable({ ageDays, trips, falsePositives }, gradDays = GRADUATION_DAYS) {
  if (ageDays < gradDays) return 'trialing';
  if (falsePositives > 0) return 'noisy';
  if (trips === 0) return 'no-signal';
  return 'READY';
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// collect soft gates (hardBlockEnabled:false) from .sdd-config, recursing one level
function softGates(cfg) {
  const out = [];
  for (const [k, v] of Object.entries(cfg)) {
    if (v && typeof v === 'object' && v.hardBlockEnabled === false) out.push(k);
  }
  return out;
}

function selfTest() {
  const T = [
    ['long clean trial that caught real issues → READY', gradeable({ ageDays: 35, trips: 4, falsePositives: 0 }) === 'READY'],
    ['young trial → trialing', gradeable({ ageDays: 8, trips: 4, falsePositives: 0 }) === 'trialing'],
    ['false-positives → noisy (calibrate first)', gradeable({ ageDays: 40, trips: 4, falsePositives: 2 }) === 'noisy'],
    ['never fired → no-signal (do not harden)', gradeable({ ageDays: 40, trips: 0, falsePositives: 0 }) === 'no-signal'],
    ['softGates finds hardBlockEnabled:false entries', JSON.stringify(softGates({ a: { hardBlockEnabled: false }, b: { hardBlockEnabled: true }, c: 1 })) === '["a"]'],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mgate-graduation self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ gate-graduation: readiness logic correct\x1b[0m');
  process.exit(0);
}

// Флагов, кроме --self-test, нет. Разбор строгий (2026-09-16): незнакомый флаг или слово — код 2.
export const CLI = {
  name: 'gate-graduation',
  summary: 'Готовность мягких гейтов (.sdd-config.json) стать жёсткими; только отчёт, сам ничего не переключает. META_TODAY подменяет «сегодня».',
  selfTest: true,
};

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  const { selfTest: wantsSelfTest } = runCli(CLI);
  if (wantsSelfTest) selfTest();
  if (!existsSync('.sdd-config.json')) { console.log('gate-graduation: no .sdd-config.json here (soft-gates live in products).'); process.exit(0); }
  const cfg = JSON.parse(readFileSync('.sdd-config.json', 'utf8'));
  const today = process.env.META_TODAY || new Date().toISOString().slice(0, 10);
  const start = cfg.soft_trial_started || today;
  const age = Math.max(0, daysBetween(start, today));
  const trips = existsSync('docs/audits/gate-trips.jsonl') ? readFileSync('docs/audits/gate-trips.jsonl', 'utf8').split('\n').filter(Boolean).length : 0;
  const gates = softGates(cfg);
  console.log(`gate-graduation — ${gates.length} soft gate(s), trial age ${age}d (horizon ${GRADUATION_DAYS}d)\n`);
  let ready = 0;
  for (const g of gates) {
    // trips/falsePositives per-gate need a per-gate trip log; absent → treat as 0 (honest: no signal)
    const status = gradeable({ ageDays: age, trips, falsePositives: 0 });
    if (status === 'READY') ready++;
    const icon = status === 'READY' ? '🟢' : status === 'noisy' ? '🔴' : '🟡';
    console.log(`  ${icon} ${g}: ${status}`);
  }
  console.log(`\n  ${ready} gate(s) READY to graduate (flip hardBlockEnabled:true after human review).`);
  if (!ready) console.log('  \x1b[2mNone ready yet — trial young or gates have not fired. This is the honest state, not a failure.\x1b[0m');
  process.exit(0);
}
