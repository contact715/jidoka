#!/usr/bin/env node
// @ts-check
/**
 * session-pattern-log — the REAL-TIME tier of the self-improvement engine.
 *
 * The existing engine catches recurrence at WAVE/RETRO granularity:
 *   - self-improvement-reviewer: every 5 waves, threshold 3-of-5 retros
 *   - meta-log / meta-trend / meta-process-auditor: post-wave, manual or modulo
 * What was missing (owner, 2026-06-24): a pattern that recurs ≥2× WITHIN one
 * live session never got surfaced until a retro — hours later, if ever.
 *
 * This is that missing tier. The DETECTION stays the agent's semantic judgement
 * (a script can't tell that "preview empty" == "couldn't verify visually"); this
 * tool is the durable backbone + the nudge: log each observation, it shouts when
 * a class crosses the threshold, `report` lists what to raise at the next pause,
 * and `resolve` feeds the cross-wave meta-ledger so the lesson outlives the chat.
 *
 * Where it writes follows the install location (same idea as meta-lib): from the
 * framework repo → repo ledger; from ~/.claude/jidoka/scripts/ → the GLOBAL
 * cross-project ledger. Override with SESSION_PATTERNS for tests.
 *
 * Usage:
 *   node session-pattern-log.mjs log <class> "<note>" [--session <id>]
 *   node session-pattern-log.mjs report            [--session <id>]
 *   node session-pattern-log.mjs resolve <class> "<fix>" [--session <id>]
 *   node session-pattern-log.mjs --self-test
 *
 * Class = short kebab-case (e.g. preview-empty-blocks-visual-verify). Session
 * defaults to $CLAUDE_SESSION_ID or "current". Threshold = $ISK_THRESHOLD || 2.
 */

import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const THRESHOLD = Number(process.env.ISK_THRESHOLD || 2);
const SELF = 'session-pattern-log.mjs';

function ledgerPath() {
  return process.env.SESSION_PATTERNS || join(HERE, '..', 'docs', 'audits', 'session-patterns.jsonl');
}
function sessionFrom(args) {
  const i = args.indexOf('--session');
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return process.env.CLAUDE_SESSION_ID || 'current';
}
function readAll() {
  const p = ledgerPath();
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
function append(rec) {
  const p = ledgerPath();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(rec) + '\n');
}
function openCount(records, session, cls) {
  return records.filter((r) => r.session === session && r.class === cls && r.status === 'open').length;
}

function cmdLog(rest) {
  const cls = rest[0];
  const note = rest[1] || '';
  if (!cls || cls.startsWith('--')) { console.error(`usage: ${SELF} log <class> "<note>" [--session id]`); return 2; }
  const session = sessionFrom(rest);
  append({ ts: new Date().toISOString(), session, class: cls, note, status: 'open' });
  const count = openCount(readAll(), session, cls);
  console.log(`logged: ${cls} (${count}× open this session)`);
  if (count >= THRESHOLD) {
    console.log(`\n🔴 SURFACE NOW — "${cls}" recurred ${count}× this session.`);
    console.log(`   At the next natural pause: name it to the owner in PLAIN language, propose a`);
    console.log(`   system-level fix in jidoka. Do the technical part yourself; discuss only the`);
    console.log(`   business choice plainly. Then close it:`);
    console.log(`   node ${SELF} resolve ${cls} "<the systemic fix you shipped>" --session ${session}`);
  }
  return 0;
}

function cmdReport(rest) {
  const session = sessionFrom(rest);
  const recs = readAll();
  const classes = [...new Set(recs.filter((r) => r.session === session && r.status === 'open').map((r) => r.class))];
  const due = classes.map((c) => ({ class: c, count: openCount(recs, session, c) })).filter((x) => x.count >= THRESHOLD);
  if (!due.length) { console.log(`✓ no recurring patterns to surface this session (${session}).`); return 0; }
  console.log(`🔴 ${due.length} pattern(s) to surface this session (${session}):`);
  for (const d of due) console.log(`  • ${d.class} — ${d.count}×`);
  return 0;
}

function cmdResolve(rest) {
  const cls = rest[0];
  const fix = rest[1] || '';
  if (!cls || cls.startsWith('--')) { console.error(`usage: ${SELF} resolve <class> "<fix>" [--session id]`); return 2; }
  const session = sessionFrom(rest);
  const recs = readAll();
  let changed = 0;
  const out = recs.map((r) => {
    if (r.session === session && r.class === cls && r.status === 'open') { changed++; return { ...r, status: 'resolved', fix }; }
    return r;
  });
  writeFileSync(ledgerPath(), out.length ? out.map((r) => JSON.stringify(r)).join('\n') + '\n' : '');
  // Feed the cross-wave meta-engine so the lesson joins meta-trend / meta-audit.
  let fed = false;
  if (!process.env.ISK_NO_META) {
    try {
      const metaLog = join(HERE, 'meta-log.mjs');
      if (existsSync(metaLog)) {
        execFileSync('node', [metaLog, cls, `recurred ${changed}x within one session`, `systemic fix: ${fix}`, 'in-session-kaizen'], { stdio: 'ignore' });
        fed = true;
      }
    } catch { /* meta-log is an optional sibling */ }
  }
  console.log(`resolved ${changed} open "${cls}" entr${changed === 1 ? 'y' : 'ies'}${fed ? ' (fed to meta-ledger)' : ''}.`);
  return 0;
}

function selfTest() {
  const tmp = join(tmpdir(), `isk-selftest-${process.pid}.jsonl`);
  const env = { ...process.env, SESSION_PATTERNS: tmp, ISK_NO_META: '1', ISK_THRESHOLD: '2' };
  const run = (args) => execFileSync('node', [join(HERE, SELF), ...args], { env, encoding: 'utf8' });
  let pass = 0; const checks = [];
  const ok = (name, cond) => { checks.push(`${cond ? '✓' : '✗'} ${name}`); if (cond) pass++; };
  try {
    if (existsSync(tmp)) rmSync(tmp);
    const o1 = run(['log', 'demo-class', 'first', '--session', 's1']);
    ok('first log does NOT surface', !/SURFACE NOW/.test(o1));
    const o2 = run(['log', 'demo-class', 'second', '--session', 's1']);
    ok('second log SURFACES (threshold 2)', /SURFACE NOW/.test(o2));
    const oReport = run(['report', '--session', 's1']);
    ok('report lists the due class', /demo-class/.test(oReport) && /1 pattern/.test(oReport));
    const oOther = run(['report', '--session', 's2']);
    ok('other session is clean', /no recurring patterns/.test(oOther));
    const oRes = run(['resolve', 'demo-class', 'shipped a gate', '--session', 's1']);
    ok('resolve closes 2 entries', /resolved 2 open/.test(oRes));
    const oReport2 = run(['report', '--session', 's1']);
    ok('after resolve, nothing to surface', /no recurring patterns/.test(oReport2));
  } catch (e) {
    checks.push(`✗ threw: ${e && e.message ? e.message : e}`);
  } finally {
    if (existsSync(tmp)) rmSync(tmp);
  }
  console.log(checks.join('\n'));
  const total = 6;
  console.log(`\n${pass}/${total} checks green`);
  return pass === total ? 0 : 1;
}

const [cmd, ...rest] = process.argv.slice(2);
let code = 0;
if (cmd === 'log') code = cmdLog(rest);
else if (cmd === 'report') code = cmdReport(rest);
else if (cmd === 'resolve') code = cmdResolve(rest);
else if (cmd === '--self-test' || cmd === 'self-test') code = selfTest();
else { console.error(`session-pattern-log — usage:\n  log <class> "<note>" [--session id]\n  report [--session id]\n  resolve <class> "<fix>" [--session id]\n  --self-test`); code = 2; }
process.exit(code);
