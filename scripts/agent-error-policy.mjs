#!/usr/bin/env node
// agent-error-policy — decides what a failed agent invocation MEANS and what to do next.
//
// agent-error-taxonomy (2026-W32-R15, closes 2026-W31-R6)
//
// Before this, jidoka-relay had exactly one branch for a non-zero agent exit:
//
//     if (res.status !== 0) { ...state: 'failed'...; throw new Error(`claude failed with status ${res.status}`); }
//
// One line, one outcome: the whole run dies. A momentary 529 from the API and a wrong API key
// were treated identically, and a live client run could be killed permanently by a blip. That
// gap was logged as 2026-W31-R6 and stayed open for a week.
//
// The three-tier split is ported from umputun/ralphex (Go, 1.4k stars) — the IDEA only. The
// binary itself is a competing harness that wants to own the session; the useful part is this
// table, which is pure logic and belongs in our own language with our own self-tests.
//
//   transient  a blip: 429/5xx, socket resets, gateway timeouts  → retry with backoff
//   ratelimit  the account is out of budget or in cooldown       → retry only if a wait was authorised
//   fatal      auth, bad request, not-logged-in, wrong context    → never retry, stop now
//   unknown    anything else                                      → stop, but say it is unclassified
//
// Deliberate difference from ralphex: `unknown` is NOT retried. A bare non-zero exit is far more
// often a real defect in our own prompt or wiring than a network blip, and retrying it burns
// tokens while hiding the bug. Unknown exits are reported as unclassified so the pattern can be
// added here on evidence, not on a guess.
//
// Also here: stalemate detection. A review loop that keeps running while nothing changes is
// spending money to stand still. Ralphex calls this `--review-patience`; the mechanism is a
// comparison of consecutive round fingerprints.
//
// Zero dependencies, pure functions, no I/O. Usage:
//   node scripts/agent-error-policy.mjs --self-test
//   node scripts/agent-error-policy.mjs --classify "API Error: 529 overloaded"

// ── the table ────────────────────────────────────────────────────────────────
// Order matters: fatal is checked before transient so that a 500 (which we treat as a real
// server-side defect worth surfacing) is not swallowed by a generic 5xx rule.
export const ERROR_PATTERNS = [
  // fatal — a retry cannot possibly help
  { kind: 'fatal', re: /\bAPI Error:\s*4(00|01|03|04|13)\b/i, why: 'client-side API error (auth, request shape, payload)' },
  { kind: 'fatal', re: /\bAPI Error:\s*500\b/i, why: 'server error 500 — surfaced, not retried, so a real defect is visible' },
  { kind: 'fatal', re: /\bnot logged in\b/i, why: 'the agent CLI has no session' },
  { kind: 'fatal', re: /cannot be launched inside another/i, why: 'nested agent session' },
  { kind: 'fatal', re: /\b(invalid|missing)\s+api[_ -]?key\b/i, why: 'credentials are wrong or absent' },
  { kind: 'fatal', re: /\bcommand not found\b|\bENOENT\b/i, why: 'the agent binary is not installed' },

  // ratelimit — retry only under an explicit wait authorisation
  { kind: 'ratelimit', re: /you'?ve hit your (usage |session |monthly )?limit/i, why: 'account limit reached' },
  { kind: 'ratelimit', re: /usage limit reached|quota exceeded/i, why: 'quota exhausted' },
  { kind: 'ratelimit', re: /\b(monthly|individual|organization)\s+spend limit/i, why: 'spend cap reached' },
  { kind: 'ratelimit', re: /\bAPI Error:\s*429\b|\brate[ _-]?limit(ed)?\b/i, why: 'rate limited' },
  { kind: 'ratelimit', re: /usage allocation (is )?disabled/i, why: 'allocation disabled for this account' },

  // transient — a blip worth one more try
  { kind: 'transient', re: /\bAPI Error:\s*5(29|02|03|04)\b/i, why: 'upstream overloaded or gateway error' },
  { kind: 'transient', re: /FYA_TRANSIENT_TIMEOUT/i, why: 'agent-reported transient timeout' },
  { kind: 'transient', re: /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE)\b/i, why: 'network error' },
  { kind: 'transient', re: /socket hang up|network error|connection (reset|closed)/i, why: 'connection dropped' },
  { kind: 'transient', re: /\boverloaded_error\b|\bservice unavailable\b/i, why: 'upstream temporarily unavailable' },
];

export const RETRYABLE = new Set(['transient', 'ratelimit']);

/**
 * Classify a failed invocation from whatever text it produced. Pure.
 * @param {string} text     stdout + stderr of the agent
 * @param {number} [status] process exit code, used only for reporting
 * @returns {{kind:'transient'|'ratelimit'|'fatal'|'unknown', why:string, matched:string|null, status:number|null}}
 */
export function classifyAgentError(text = '', status = null) {
  const body = String(text || '');
  for (const p of ERROR_PATTERNS) {
    const m = body.match(p.re);
    if (m) return { kind: p.kind, why: p.why, matched: m[0], status };
  }
  return { kind: 'unknown', why: 'no known failure pattern matched — unclassified, not retried', matched: null, status };
}

/**
 * What to do about a classified failure. Pure — returns a decision, performs nothing.
 * @param {{kind:string}} cls          result of classifyAgentError
 * @param {object} o
 * @param {number} o.attempt           1-based attempt that just failed
 * @param {number} [o.maxAttempts]     total attempts allowed for transient failures
 * @param {number|null} [o.waitMs]     authorised wait for a rate limit (null = not authorised)
 * @param {number} [o.backoffMs]       base backoff for transient retries
 */
export function retryPlan(cls, { attempt = 1, maxAttempts = 3, waitMs = null, backoffMs = 5000 } = {}) {
  const kind = cls && cls.kind;
  if (!RETRYABLE.has(kind)) {
    return { retry: false, delayMs: 0, reason: kind === 'fatal' ? 'fatal error, retrying cannot help' : 'unclassified failure, stopping so the cause stays visible' };
  }
  if (kind === 'ratelimit') {
    if (!waitMs || waitMs <= 0) {
      return { retry: false, delayMs: 0, reason: 'rate limited and no wait authorised — stopping cleanly (pass --wait <ms> to sit it out)' };
    }
    if (attempt >= maxAttempts) return { retry: false, delayMs: 0, reason: `rate limited and out of attempts (${attempt}/${maxAttempts})` };
    return { retry: true, delayMs: waitMs, reason: `rate limited — waiting ${Math.round(waitMs / 1000)}s as authorised, attempt ${attempt + 1}/${maxAttempts}` };
  }
  if (attempt >= maxAttempts) return { retry: false, delayMs: 0, reason: `transient error but out of attempts (${attempt}/${maxAttempts})` };
  // exponential, capped, so a long outage does not turn into a tight spin
  const delayMs = Math.min(backoffMs * 2 ** (attempt - 1), 60000);
  return { retry: true, delayMs, reason: `transient error — retrying in ${Math.round(delayMs / 1000)}s, attempt ${attempt + 1}/${maxAttempts}` };
}

/**
 * Stalemate: the last `patience` rounds produced identical fingerprints, so the loop is paying
 * for rounds that change nothing. Pure.
 * @param {string[]} fingerprints  one per completed round, oldest first
 * @param {number} patience        how many identical rounds in a row count as stuck
 */
export function isStalemate(fingerprints = [], patience = 3) {
  if (patience < 2 || fingerprints.length < patience) return false;
  const tail = fingerprints.slice(-patience);
  return tail.every(f => f === tail[0]);
}

/** A stable fingerprint of a round's observable result. Pure. */
export function roundFingerprint({ openIssues = null, filesChanged = [], output = '' } = {}) {
  const files = [...filesChanged].sort().join(',');
  const shape = String(output).replace(/\s+/g, ' ').trim().slice(0, 400);
  return `${openIssues === null ? '?' : openIssues}|${files}|${shape}`;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const kindOf = (t) => classifyAgentError(t).kind;

  // the exact strings the relay would have died on
  ok('529 overloaded → transient', kindOf('API Error: 529 {"type":"overloaded_error"}') === 'transient');
  ok('502/503/504 → transient', kindOf('API Error: 503 Service Unavailable') === 'transient');
  ok('agent transient timeout token → transient', kindOf('FYA_TRANSIENT_TIMEOUT after 30s') === 'transient');
  ok('socket hang up → transient', kindOf('Error: socket hang up') === 'transient');
  ok('ECONNRESET → transient', kindOf('read ECONNRESET') === 'transient');

  ok('session limit → ratelimit', kindOf("You've hit your session limit. Resets at 3pm") === 'ratelimit');
  ok('usage limit → ratelimit', kindOf('usage limit reached for this account') === 'ratelimit');
  ok('spend limit → ratelimit', kindOf('monthly spend limit exceeded') === 'ratelimit');
  ok('429 → ratelimit', kindOf('API Error: 429 Too Many Requests') === 'ratelimit');

  ok('401 → fatal', kindOf('API Error: 401 unauthorized') === 'fatal');
  ok('400 → fatal', kindOf('API Error: 400 invalid_request_error') === 'fatal');
  ok('500 → fatal (surfaced, not retried)', kindOf('API Error: 500 internal') === 'fatal');
  ok('not logged in → fatal', kindOf('Error: Not logged in. Run `claude login`') === 'fatal');
  ok('nested session → fatal', kindOf('claude cannot be launched inside another Claude Code session') === 'fatal');
  ok('missing binary → fatal', kindOf('spawn codex ENOENT') === 'fatal');

  ok('unrecognised text → unknown', kindOf('TypeError: x is not a function') === 'unknown');
  ok('empty text → unknown', kindOf('') === 'unknown');
  ok('classification carries the matched fragment', classifyAgentError('API Error: 529').matched === 'API Error: 529');
  ok('classification carries the exit status', classifyAgentError('boom', 7).status === 7);

  // ORDER: a 500 must not be swallowed by the generic 5xx family
  ok('500 is fatal, not transient (order of the table)', kindOf('API Error: 500') === 'fatal');
  // a body containing BOTH a fatal and a transient marker resolves fatal (first match wins)
  ok('mixed body resolves to the fatal reading', kindOf('API Error: 401 ... later: socket hang up') === 'fatal');

  // ── retry plan ─────────────────────────────────────────────────────────────
  const t = { kind: 'transient' }, rl = { kind: 'ratelimit' }, ft = { kind: 'fatal' }, un = { kind: 'unknown' };
  ok('transient retries with backoff', retryPlan(t, { attempt: 1, maxAttempts: 3 }).retry === true);
  ok('transient backoff grows', retryPlan(t, { attempt: 2, maxAttempts: 3 }).delayMs > retryPlan(t, { attempt: 1, maxAttempts: 3 }).delayMs);
  ok('transient backoff is capped at 60s', retryPlan(t, { attempt: 9, maxAttempts: 20 }).delayMs === 60000);
  ok('transient stops at the attempt ceiling', retryPlan(t, { attempt: 3, maxAttempts: 3 }).retry === false);
  ok('ratelimit without authorised wait stops cleanly', retryPlan(rl, { attempt: 1, waitMs: null }).retry === false);
  ok('ratelimit stop explains how to authorise a wait', /--wait/.test(retryPlan(rl, { attempt: 1, waitMs: null }).reason));
  ok('ratelimit with authorised wait retries after exactly that wait', retryPlan(rl, { attempt: 1, waitMs: 900000 }).delayMs === 900000);
  ok('ratelimit still respects the attempt ceiling', retryPlan(rl, { attempt: 3, maxAttempts: 3, waitMs: 1000 }).retry === false);
  ok('fatal never retries', retryPlan(ft, { attempt: 1 }).retry === false);
  ok('unknown never retries', retryPlan(un, { attempt: 1 }).retry === false);
  ok('unknown says it is unclassified', /unclassified/.test(retryPlan(un, { attempt: 1 }).reason));

  // ── stalemate ──────────────────────────────────────────────────────────────
  ok('three identical rounds at patience 3 → stalemate', isStalemate(['a', 'a', 'a'], 3) === true);
  ok('a changing round breaks the stalemate', isStalemate(['a', 'b', 'a'], 3) === false);
  ok('only the LAST rounds count', isStalemate(['x', 'y', 'a', 'a', 'a'], 3) === true);
  ok('fewer rounds than patience → not yet a stalemate', isStalemate(['a', 'a'], 3) === false);
  ok('patience below 2 is meaningless and never fires', isStalemate(['a', 'a', 'a'], 1) === false);
  ok('empty history → no stalemate', isStalemate([], 3) === false);
  ok('fingerprint is order-independent for files',
    roundFingerprint({ openIssues: 2, filesChanged: ['b.ts', 'a.ts'] }) === roundFingerprint({ openIssues: 2, filesChanged: ['a.ts', 'b.ts'] }));
  ok('fingerprint separates a different issue count',
    roundFingerprint({ openIssues: 2, filesChanged: ['a.ts'] }) !== roundFingerprint({ openIssues: 1, filesChanged: ['a.ts'] }));
  ok('fingerprint ignores whitespace noise in output',
    roundFingerprint({ output: 'same   result\n\n' }) === roundFingerprint({ output: 'same result' }));

  if (fails) { console.log(`\n\x1b[31magent-error-policy self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ agent-error-policy: transient / ratelimit / fatal split + stalemate detection correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] && process.argv[1].endsWith('agent-error-policy.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const i = process.argv.indexOf('--classify');
  if (i !== -1) {
    const cls = classifyAgentError(process.argv[i + 1] || '');
    console.log(`${cls.kind}: ${cls.why}${cls.matched ? ` (matched "${cls.matched}")` : ''}`);
    console.log(`  plan: ${JSON.stringify(retryPlan(cls, { attempt: 1 }))}`);
    process.exit(0);
  }
  console.log('usage: agent-error-policy.mjs --self-test | --classify "<agent output>"');
}
