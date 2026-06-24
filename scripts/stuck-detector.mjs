#!/usr/bin/env node
/**
 * stuck-detector — real-time runaway/loop detection for autonomous agent runs.
 *
 * Closes research gap #6 (docs/research/2026-06-24_github-enrichment-research.md):
 * today a stuck or looping agent is only caught indirectly by the cost ceiling —
 * too late, and with no diagnosis of WHY. This watches a sliding window of recent
 * activity fingerprints and names the failure mode the moment it appears.
 *
 * Five patterns (ported from OpenHands stuck-detection heuristics — the IDEA only,
 * no Python SDK, no event-stream rework):
 *   1. repeated-action   — the same action N times in a row
 *   2. repeated-error    — an action followed by the same error, again and again
 *   3. monologue         — many no-op / empty-activity steps in a row
 *   4. ping-pong         — A,B,A,B,A,B oscillation between two actions
 *   5. cycle             — a window of length L (2..4) repeats at the tail
 *
 * It reuses describeActivity() from hooks/session-state.mjs as the fingerprint, so
 * the signal matches what the session hook already computes. Pure detect()/pushRing()
 * are disk-free and unit-tested; the CLI maintains a per-session ring under
 * ~/.claude/session-env and, on a hit, appends a diagnosis the andon layer can read.
 *
 * Usage:
 *   node scripts/stuck-detector.mjs --push "<fingerprint>" [--session <id>] [--cap 20]
 *   node scripts/stuck-detector.mjs --from-tool Bash --input '{"command":"ls"}' [--session <id>]
 *   node scripts/stuck-detector.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CAP = 20;

export function pushRing(ring, fp, cap = DEFAULT_CAP) {
  const next = [...ring, String(fp)];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

const isError = (s) => /error|fail|exception|not permitted|refus|denied|exit (?:[1-9]|\d\d)/i.test(s);
const tail = (a, n) => a.slice(Math.max(0, a.length - n));

/** Returns {stuck, pattern, detail} for the current ring. First match wins. */
export function detect(ring, opts = {}) {
  const repeatN = opts.repeatN ?? 4;     // identical-in-a-row threshold
  const errN = opts.errN ?? 3;           // same-error count in recent window
  const monoN = opts.monoN ?? 4;         // empty steps in a row
  const r = ring.filter((x) => x !== undefined && x !== null);
  if (r.length < 3) return { stuck: false };

  // 3. monologue — empty fingerprints in a row (no real tool activity).
  const lastMono = tail(r, monoN);
  if (lastMono.length === monoN && lastMono.every((x) => String(x).trim() === '')) {
    return { stuck: true, pattern: 'monologue', detail: `${monoN} no-op steps in a row` };
  }

  // 1. repeated-action — same non-empty fingerprint N times in a row.
  const lastRep = tail(r, repeatN);
  if (lastRep.length === repeatN && lastRep.every((x) => x !== '' && x === lastRep[0])) {
    return { stuck: true, pattern: 'repeated-action', detail: `"${lastRep[0]}" ×${repeatN}` };
  }

  // 2. repeated-error — the same error fingerprint appears errN+ times in the last 2*errN.
  const win = tail(r, errN * 2);
  const errs = win.filter(isError);
  const errCounts = new Map();
  for (const e of errs) errCounts.set(e, (errCounts.get(e) || 0) + 1);
  for (const [e, c] of errCounts) if (c >= errN) return { stuck: true, pattern: 'repeated-error', detail: `"${e}" ×${c}` };

  // 4. ping-pong — A,B,A,B,A,B with A≠B over the last 6.
  const six = tail(r, 6);
  if (six.length === 6) {
    const [a, b] = [six[0], six[1]];
    if (a !== b && six.every((x, i) => x === (i % 2 === 0 ? a : b))) {
      return { stuck: true, pattern: 'ping-pong', detail: `"${a}" ↔ "${b}"` };
    }
  }

  // 5. cycle — a window of length L (2..4) repeats ≥2× at the tail.
  for (let L = 2; L <= 4; L++) {
    const seg = tail(r, L * 2);
    if (seg.length === L * 2) {
      const first = seg.slice(0, L).join('|');
      const second = seg.slice(L).join('|');
      if (first === second && new Set(seg.slice(0, L)).size > 1) {
        return { stuck: true, pattern: 'cycle', detail: `window[${L}] repeated: ${first}` };
      }
    }
  }

  return { stuck: false };
}

// ---- CLI (disk-backed ring per session) ----
const SESSION_DIR = join(homedir(), '.claude', 'session-env');
const ringPath = (sid) => join(SESSION_DIR, `ring-${sid || 'default'}.json`);
const EVENTS = join(homedir(), '.claude', 'jidoka', 'stuck-events.jsonl');

function loadRing(sid) { try { return JSON.parse(readFileSync(ringPath(sid), 'utf8')); } catch { return []; } }
function saveRing(sid, ring) { mkdirSync(SESSION_DIR, { recursive: true }); writeFileSync(ringPath(sid), JSON.stringify(ring)); }
function arg(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const sid = arg(args, '--session') || 'default';
  const cap = Number(arg(args, '--cap')) || DEFAULT_CAP;
  let fp = arg(args, '--push');
  if (fp === undefined && args.includes('--from-tool')) {
    const { describeActivity } = await import('../hooks/session-state.mjs');
    let input = {}; try { input = JSON.parse(arg(args, '--input') || '{}'); } catch { /* keep {} */ }
    fp = describeActivity(arg(args, '--from-tool'), input);
  }
  if (fp === undefined) { console.error('stuck-detector: --push "<fp>" or --from-tool <name> required'); process.exit(2); }

  const ring = pushRing(loadRing(sid), fp, cap);
  saveRing(sid, ring);
  const verdict = detect(ring);
  if (verdict.stuck) {
    try { mkdirSync(join(homedir(), '.claude', 'jidoka'), { recursive: true }); appendFileSync(EVENTS, JSON.stringify({ ts: new Date().toISOString(), session: sid, ...verdict }) + '\n'); } catch { /* best-effort */ }
    console.error(`stuck-detector: 🔴 STUCK [${verdict.pattern}] ${verdict.detail}`);
    process.exit(args.includes('--andon') ? 42 : 0);
  }
  console.log(`stuck-detector: ok (ring ${ring.length}/${cap})`);
}

function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); fail++; } };
  console.log('stuck-detector --self-test');

  ok(pushRing([], 'a', 3).length === 1, 'pushRing appends');
  ok(pushRing(['a', 'b', 'c'], 'd', 3).join('') === 'bcd', 'pushRing caps to the most recent');

  ok(!detect(['a', 'b']).stuck, 'too-short ring is never stuck');
  ok(detect(['x', 'x', 'x', 'x']).pattern === 'repeated-action', 'detects repeated action');
  ok(detect(['', '', '', '']).pattern === 'monologue', 'detects monologue (empty steps)');
  ok(detect(['do', 'error: boom', 'do', 'error: boom', 'do', 'error: boom']).pattern === 'repeated-error', 'detects repeated error');
  ok(detect(['a', 'b', 'a', 'b', 'a', 'b']).pattern === 'ping-pong', 'detects ping-pong');
  ok(detect(['p', 'q', 'r', 'p', 'q', 'r']).pattern === 'cycle', 'detects a repeating cycle window');
  ok(!detect(['a', 'b', 'c', 'd', 'e', 'f']).stuck, 'healthy varied progress is not stuck');
  ok(!detect(['a', 'a', 'a']).stuck, '3 repeats below the ×4 threshold is not stuck');

  console.log(fail === 0 ? '\nstuck-detector: all self-tests passed' : `\nstuck-detector: ${fail} self-test(s) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
