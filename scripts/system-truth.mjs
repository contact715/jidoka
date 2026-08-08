#!/usr/bin/env node
// system-truth — what state is the engine ACTUALLY in, as opposed to what it last claimed.
//
// ci-verdict-probe (2026-W31-R2)
//
// THE GAP, measured. CI on main went red on 2026-07-29 and stayed red for five days over a
// single hand-maintained number in the README. Nothing surfaced it: the session-start digest
// printed "jidoka: ⚪ нет baseline" every session and nothing else. The engine had a red light
// on and no lamp in the room.
//
// Three numbers answer "is what I am reading still true?", and all three were unavailable at
// the one moment they matter, which is the first second of a session:
//   CI            the verdict of the last run on the default branch, and how long ago
//   ledger age    days since the last recorded incident — a silent ledger means the learning
//                 signal stopped, not that nothing went wrong
//   doc age       days since the honest-state document was last touched; a stale honest-state
//                 doc is exactly the thing that reads as authoritative and is not
//
// The CI probe is NETWORK, so it is cached and fail-open: a stale or missing answer prints
// "неизвестно" and never delays a session. A digest that hangs is worse than a digest that
// admits it does not know.
//
// Zero dependencies. Usage:
//   node scripts/system-truth.mjs --self-test
//   node scripts/system-truth.mjs              # human line
//   node scripts/system-truth.mjs --json

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(homedir(), '.jidoka', 'ci-status.json');
export const CACHE_TTL_MS = 30 * 60 * 1000;

// ── pure core ────────────────────────────────────────────────────────────────

/** Age in whole days between two ISO-ish timestamps. Pure. */
export const daysBetween = (thenIso, nowMs) => {
  const t = Date.parse(thenIso);
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
};

/** Is the cached CI answer still worth trusting? Pure. */
export const cacheFresh = (cache, nowMs, ttl = CACHE_TTL_MS) =>
  !!cache && typeof cache.probedAt === 'number' && nowMs - cache.probedAt < ttl;

/**
 * Turn the three raw readings into one short, honest line. Pure.
 * Anything unknown says so; nothing is guessed.
 */
export function renderLine({ ci = null, ledgerAgeDays = null, docAgeDays = null, baseline = null } = {}) {
  const parts = [];
  if (!ci || !ci.conclusion) parts.push('CI неизвестен');
  else {
    const mark = ci.conclusion === 'success' ? 'зелёный' : ci.conclusion === 'failure' ? 'КРАСНЫЙ' : ci.conclusion;
    const age = typeof ci.ageDays === 'number' ? (ci.ageDays === 0 ? 'сегодня' : `${ci.ageDays}д назад`) : '';
    parts.push(`CI ${mark}${age ? ` (${age})` : ''}`);
  }
  parts.push(ledgerAgeDays === null ? 'реестр ошибок неизвестен' : `последняя ошибка ${ledgerAgeDays}д назад`);
  if (docAgeDays !== null) parts.push(`честное состояние ${docAgeDays}д`);
  if (baseline !== null) parts.push(`eval ${baseline}%`);
  return parts.join(' · ');
}

/** Should this line shout? Pure. */
export const isAlarming = ({ ci = null, ledgerAgeDays = null, docAgeDays = null } = {}) =>
  (ci && ci.conclusion === 'failure') || (docAgeDays !== null && docAgeDays > 30) || ledgerAgeDays === null;

// ── I/O ──────────────────────────────────────────────────────────────────────
function probeCi(nowMs) {
  let cache = null;
  try { cache = JSON.parse(readFileSync(CACHE, 'utf8')); } catch { /* none */ }
  if (cacheFresh(cache, nowMs)) return cache.ci;
  let ci = null;
  try {
    const out = execFileSync('gh',
      ['run', 'list', '--workflow=ci.yml', '--branch=main', '--limit', '1', '--json', 'conclusion,createdAt,status'],
      { cwd: ROOT, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    const r = JSON.parse(out)[0];
    if (r) ci = { conclusion: r.status === 'completed' ? r.conclusion : r.status, ageDays: daysBetween(r.createdAt, nowMs) };
  } catch { ci = cache ? cache.ci : null; } // network/auth/timeout → last known, else unknown
  try { mkdirSync(path.dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify({ probedAt: nowMs, ci })); } catch { /* cache is best-effort */ }
  return ci;
}

function ledgerAge(nowMs) {
  const candidates = [
    path.join(ROOT, 'docs/audits/meta-mistakes.jsonl'),
    path.join(homedir(), '.claude/jidoka/meta-mistakes.jsonl'),
  ];
  let newest = null;
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const d = JSON.parse(line).date;
        if (d && (!newest || d > newest)) newest = d;
      }
    } catch { /* skip unreadable */ }
  }
  return newest ? daysBetween(`${newest}T00:00:00Z`, nowMs) : null;
}

function docAge(nowMs) {
  const p = path.join(ROOT, 'docs/HONEST_SYSTEM_STATE.md');
  if (!existsSync(p)) return null;
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'docs/HONEST_SYSTEM_STATE.md'],
      { cwd: ROOT, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (iso) return daysBetween(iso, nowMs);
  } catch { /* fall back to mtime */ }
  try { return Math.floor((nowMs - statSync(p).mtimeMs) / 86400000); } catch { return null; }
}

function baselinePct() {
  for (const p of [path.join(ROOT, 'docs/evals/_baseline.json'), path.join(homedir(), '.claude/jidoka/docs/evals/_baseline.json')]) {
    try { return Math.round(JSON.parse(readFileSync(p, 'utf8')).pass_rate * 100); } catch { /* try next */ }
  }
  return null;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const NOW = Date.parse('2026-08-08T12:00:00Z');

  ok('возраст в днях считается вниз', daysBetween('2026-08-05T12:00:00Z', NOW) === 3);
  ok('сегодняшняя дата это 0 дней', daysBetween('2026-08-08T01:00:00Z', NOW) === 0);
  ok('мусорная дата даёт null, а не NaN', daysBetween('не дата', NOW) === null);

  ok('свежий кеш признаётся свежим', cacheFresh({ probedAt: NOW - 1000 }, NOW) === true);
  ok('протухший кеш не признаётся', cacheFresh({ probedAt: NOW - 40 * 60 * 1000 }, NOW) === false);
  ok('отсутствующий кеш не признаётся', cacheFresh(null, NOW) === false);

  // the line itself
  ok('красный CI назван КРАСНЫМ, заглавными',
    /CI КРАСНЫЙ/.test(renderLine({ ci: { conclusion: 'failure', ageDays: 5 }, ledgerAgeDays: 0 })));
  ok('возраст красного прогона виден',
    /5д назад/.test(renderLine({ ci: { conclusion: 'failure', ageDays: 5 }, ledgerAgeDays: 0 })));
  ok('зелёный CI сегодня читается как сегодня',
    /CI зелёный \(сегодня\)/.test(renderLine({ ci: { conclusion: 'success', ageDays: 0 }, ledgerAgeDays: 1 })));
  ok('неизвестный CI честно говорит, что неизвестен',
    /CI неизвестен/.test(renderLine({ ci: null, ledgerAgeDays: 1 })));
  ok('идущий прогон не выдаётся за успех',
    /CI in_progress/.test(renderLine({ ci: { conclusion: 'in_progress', ageDays: 0 }, ledgerAgeDays: 1 })));
  ok('возраст реестра попадает в строку', /последняя ошибка 4д назад/.test(renderLine({ ledgerAgeDays: 4 })));
  ok('пустой реестр читается как неизвестный, а не как ноль', /реестр ошибок неизвестен/.test(renderLine({ ledgerAgeDays: null })));
  ok('возраст честного документа добавляется, если известен', /честное состояние 38д/.test(renderLine({ ledgerAgeDays: 1, docAgeDays: 38 })));
  ok('неизвестный возраст документа просто не печатается', !/честное состояние/.test(renderLine({ ledgerAgeDays: 1, docAgeDays: null })));

  // when to shout
  ok('красный CI тревожит', isAlarming({ ci: { conclusion: 'failure' }, ledgerAgeDays: 0 }) === true);
  ok('зелёный CI со свежим реестром не тревожит', isAlarming({ ci: { conclusion: 'success' }, ledgerAgeDays: 0, docAgeDays: 3 }) === false);
  ok('документ старше месяца тревожит', isAlarming({ ci: { conclusion: 'success' }, ledgerAgeDays: 0, docAgeDays: 40 }) === true);
  ok('нечитаемый реестр тревожит', isAlarming({ ci: { conclusion: 'success' }, ledgerAgeDays: null }) === true);

  if (fails) { console.log(`\n\x1b[31msystem-truth self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ system-truth: неизвестное называется неизвестным, красное называется красным\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('system-truth.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const now = Date.now();
  // --ages skips the network probe entirely. The session-start digest already has its own CI
  // line (it prints nothing when green, deliberately), and probing twice at session start would
  // pay the network cost twice to say the same thing.
  const agesOnly = process.argv.includes('--ages');
  const state = { ci: agesOnly ? null : probeCi(now), ledgerAgeDays: ledgerAge(now), docAgeDays: docAge(now), baseline: baselinePct() };
  if (agesOnly) {
    const parts = [];
    if (state.ledgerAgeDays !== null && state.ledgerAgeDays > 0) parts.push(`последняя записанная ошибка ${state.ledgerAgeDays}д назад`);
    if (state.docAgeDays !== null && state.docAgeDays > 30) parts.push(`док «честное состояние» не трогали ${state.docAgeDays}д`);
    console.log(parts.join(' · '));
    process.exit(0);
  }
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ ...state, line: renderLine(state), alarming: isAlarming(state) }, null, 2)); process.exit(0); }
  console.log(renderLine(state));
  process.exit(0);
}
