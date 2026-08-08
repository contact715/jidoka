#!/usr/bin/env node
// permission-ledger — a one-off permission stays a one-off.
//
// scoped-expiring-permission (2026-W32-K1)
//
// THE PATTERN THIS KILLS. The owner allows something once, for one concrete reason, in one
// repo. Weeks later a different session reaches the same wall, remembers that it was allowed
// "in exactly this situation", and does it again without asking. Nobody widened the permission
// on purpose; it widened by memory.
//
// Measured in the session transcripts, 4 weeks, one action (`git ... --no-verify`):
//   2026-07-09  bypassed  "ровно тот санкционированный владельцем путь"
//   2026-08-01  ASKED     (owner decided)
//   2026-08-02  ASKED     "правило прямо запрещает обходить хуки без явного разрешения"
//   2026-08-02  bypassed  "владелец однажды уже разрешал --no-verify именно в такой ситуации"
//   2026-08-03  bypassed
// Three bypasses, two of them justified by precedent rather than by a live permission. The
// same shape the owner already named for the anti-AI rule on 2026-07-28: "a rule you overrode
// once becomes the new default silently".
//
// THE MECHANISM. A permission is a record, not a memory:
//   action   what is allowed            e.g. git-no-verify
//   scope    where                      a repo path; "*" only if the owner really said everywhere
//   reason   why it was allowed         so a later reader can judge whether it still applies
//   expires  when it stops being true   default 24h, never unlimited unless asked for
// A later session does not get to reason about precedent. It asks the ledger, and the ledger
// answers yes or no.
//
// HONEST BOUNDARY, and it matters. Like the existing l0-write-grant, this is owner DELEGATION
// with an audit trail, not a security boundary: a process that can run git can also write this
// file. It exists so nothing is silent and nothing is permanent by accident. Every grant and
// every use is appended; `--log` shows the history.
//
// Zero dependencies. Usage:
//   node scripts/permission-ledger.mjs --self-test
//   node scripts/permission-ledger.mjs grant git-no-verify --scope /path/to/repo --reason "чужие упавшие тесты" --hours 6 --by mitya
//   node scripts/permission-ledger.mjs check git-no-verify --scope /path/to/repo
//   node scripts/permission-ledger.mjs list [--all]
//   node scripts/permission-ledger.mjs revoke <id>

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const STORE = process.env.JIDOKA_PERMISSIONS
  || join(homedir(), '.jidoka', 'permissions.jsonl');

export const DEFAULT_TTL_HOURS = 24;

// ── pure core ────────────────────────────────────────────────────────────────

/** Does a grant's scope cover this target? Pure. "*" = anywhere; otherwise a path prefix. */
export function scopeCovers(grantScope, target) {
  if (!grantScope) return false;
  if (grantScope === '*') return true;
  if (!target) return false;
  const g = String(grantScope).replace(/\/+$/, '');
  const t = String(target).replace(/\/+$/, '');
  return t === g || t.startsWith(`${g}/`);
}

/**
 * Fold an append-only event log into the grants that are live right now. Pure.
 * Events: {type:'grant'|'revoke', id, action, scope, reason, by, at, expiresAt}
 */
export function liveGrants(events = [], now = Date.now()) {
  const byId = new Map();
  for (const e of events) {
    if (!e || !e.id) continue;
    if (e.type === 'grant') byId.set(e.id, e);
    else if (e.type === 'revoke') byId.delete(e.id);
  }
  return [...byId.values()].filter(g => typeof g.expiresAt === 'number' && g.expiresAt > now);
}

/**
 * The whole question, answered from records instead of from memory. Pure.
 * @returns {{allowed:boolean, grant:object|null, reason:string}}
 */
export function checkPermission(events, action, scope, now = Date.now()) {
  const live = liveGrants(events, now);
  const hit = live.find(g => g.action === action && scopeCovers(g.scope, scope));
  if (hit) {
    const leftMin = Math.round((hit.expiresAt - now) / 60000);
    return { allowed: true, grant: hit, reason: `granted by ${hit.by || 'unknown'} for "${hit.reason || 'no reason recorded'}", ${leftMin} min left` };
  }
  // Was it EVER granted for this scope? An expired grant is the precedent case, and it is
  // exactly the moment to say "that permission ran out" instead of silently reusing it.
  const expired = events.filter(e => e.type === 'grant' && e.action === action && scopeCovers(e.scope, scope) && e.expiresAt <= now);
  if (expired.length) {
    const last = expired.sort((a, b) => b.expiresAt - a.expiresAt)[0];
    return {
      allowed: false,
      grant: null,
      reason: `EXPIRED: this was allowed once (${new Date(last.at).toISOString().slice(0, 10)}, "${last.reason || 'no reason recorded'}") and that permission ran out. A past yes is not a standing yes — ask again.`,
    };
  }
  return { allowed: false, grant: null, reason: 'never granted for this action and scope' };
}

export function makeGrant({ action, scope = '*', reason = '', by = '', hours = DEFAULT_TTL_HOURS, now = Date.now(), id = null }) {
  const at = now;
  return {
    type: 'grant',
    id: id || `${action}-${at.toString(36)}`,
    action, scope, reason, by, at,
    expiresAt: at + Math.round(hours * 3600 * 1000),
  };
}

// ── store ────────────────────────────────────────────────────────────────────
export function readEvents(path = STORE) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export function appendEvent(ev, path = STORE) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(ev)}\n`);
  return ev;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const T0 = 1_700_000_000_000;
  const HOUR = 3600_000;

  // scope matching
  ok('exact path is covered', scopeCovers('/a/b', '/a/b') === true);
  ok('child path is covered', scopeCovers('/a/b', '/a/b/c') === true);
  ok('sibling path is NOT covered', scopeCovers('/a/b', '/a/bc') === false);
  ok('parent path is NOT covered by a child grant', scopeCovers('/a/b/c', '/a/b') === false);
  ok('trailing slashes do not change the answer', scopeCovers('/a/b/', '/a/b') === true);
  ok('"*" covers anything', scopeCovers('*', '/anywhere') === true);
  ok('empty scope covers nothing', scopeCovers('', '/a') === false);

  // the precedent case, which is the whole point
  const g = makeGrant({ action: 'git-no-verify', scope: '/repo/x', reason: 'чужие упавшие тесты', by: 'mitya', hours: 6, now: T0 });
  const events = [g];
  ok('inside the window and scope → allowed', checkPermission(events, 'git-no-verify', '/repo/x', T0 + HOUR).allowed === true);
  ok('allowed answer quotes who and why', /mitya/.test(checkPermission(events, 'git-no-verify', '/repo/x', T0 + HOUR).reason));
  ok('another repo is NOT covered', checkPermission(events, 'git-no-verify', '/repo/y', T0 + HOUR).allowed === false);
  ok('another action is NOT covered', checkPermission(events, 'push-to-prod', '/repo/x', T0 + HOUR).allowed === false);

  const after = checkPermission(events, 'git-no-verify', '/repo/x', T0 + 7 * HOUR);
  ok('after expiry → refused', after.allowed === false);
  ok('expiry is reported as EXPIRED, not as "never granted"', /EXPIRED/.test(after.reason));
  ok('the refusal states that a past yes is not a standing yes', /past yes is not a standing yes/.test(after.reason));
  ok('the refusal recalls the original reason', /чужие упавшие тесты/.test(after.reason));
  ok('never granted reads differently from expired',
    checkPermission(events, 'git-no-verify', '/other', T0 + HOUR).reason === 'never granted for this action and scope');

  // revoke
  const revoked = [...events, { type: 'revoke', id: g.id }];
  ok('revoke removes a live grant', checkPermission(revoked, 'git-no-verify', '/repo/x', T0 + HOUR).allowed === false);

  // fold
  ok('liveGrants drops the expired one', liveGrants(events, T0 + 7 * HOUR).length === 0);
  ok('liveGrants keeps the live one', liveGrants(events, T0 + HOUR).length === 1);
  ok('a re-grant with the same id replaces the old one',
    liveGrants([g, makeGrant({ action: 'git-no-verify', scope: '*', hours: 1, now: T0, id: g.id })], T0 + 30 * 60_000).length === 1);
  ok('malformed events are ignored, not fatal', liveGrants([null, {}, g], T0 + HOUR).length === 1);
  ok('a grant with no expiry is never live (no accidental forever)',
    liveGrants([{ type: 'grant', id: 'x', action: 'a', scope: '*' }], T0).length === 0);

  // default TTL is finite
  ok('default grant expires within a day', makeGrant({ action: 'a', now: T0 }).expiresAt === T0 + DEFAULT_TTL_HOURS * HOUR);

  if (fails) { console.log(`\n\x1b[31mpermission-ledger self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ permission-ledger: scope + expiry correct; an expired permission reads as expired, not as precedent\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('permission-ledger.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const arg = (f, d = null) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d; };
  if (has('--self-test')) selfTest();

  const cmd = argv[0];
  const action = argv[1];

  if (cmd === 'grant') {
    if (!action) { console.error('usage: grant <action> --scope <path|*> --reason "..." [--hours N] [--by name]'); process.exit(2); }
    const ev = makeGrant({
      action,
      scope: arg('--scope', process.cwd()),
      reason: arg('--reason', ''),
      by: arg('--by', process.env.USER || ''),
      hours: Number(arg('--hours', DEFAULT_TTL_HOURS)),
    });
    appendEvent(ev);
    console.log(`granted ${ev.action} on ${ev.scope} until ${new Date(ev.expiresAt).toISOString()} (id ${ev.id})`);
    process.exit(0);
  }

  if (cmd === 'check') {
    const r = checkPermission(readEvents(), action, arg('--scope', process.cwd()));
    console.log(`${r.allowed ? 'ALLOWED' : 'REFUSED'}: ${r.reason}`);
    process.exit(r.allowed ? 0 : 1);
  }

  if (cmd === 'revoke') {
    if (!action) { console.error('usage: revoke <id>'); process.exit(2); }
    appendEvent({ type: 'revoke', id: action, at: Date.now() });
    console.log(`revoked ${action}`);
    process.exit(0);
  }

  if (cmd === 'list') {
    const events = readEvents();
    const rows = has('--all') ? events.filter(e => e.type === 'grant') : liveGrants(events);
    if (!rows.length) { console.log('(no live permissions)'); process.exit(0); }
    for (const g of rows) {
      const left = Math.round((g.expiresAt - Date.now()) / 60000);
      console.log(`${g.id}  ${g.action}  scope=${g.scope}  by=${g.by || '?'}  ${left > 0 ? `${left}min left` : 'EXPIRED'}  "${g.reason || ''}"`);
    }
    process.exit(0);
  }

  console.log('usage: permission-ledger.mjs grant|check|revoke|list [...]  |  --self-test');
}
