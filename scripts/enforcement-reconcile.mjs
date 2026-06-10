#!/usr/bin/env node
// enforcement-reconcile — the "red lamp": catch a gate that SAID it blocked while the commit landed.
//
// THE GAP IT CLOSES: gate-claims-block-but-passes / gate-block-not-enforced — the most frequent pain
// (a hook prints "Commit refused" but the commit exists). The user was the last line of defense; this
// makes the discrepancy surface itself in the morning digest instead of days later.
//
// TWO SIGNALS, read across a configured list of repos:
//   1. .sdd-bypass.log — lines "<iso-ts> commit=<hash>". A gate was bypassed (--no-verify or a
//      detected sentinel-miss). INFORMATIONAL: surfaced so the user sees skipped gates, never a fail.
//   2. docs/audits/gate-refusals.jsonl — lines {ts, gate, ref, action:"refused"}. A gate CLAIMED to
//      refuse. VIOLATION if `git cat-file -e <ref>` proves the commit exists anyway: the refusal lied.
//
// LEDGER-POLLUTION GUARD (logged anti-pattern, recidivist): a daily job must NOT re-log the same
// finding every morning. New violations are deduped against docs/audits/enforcement-reconcile.jsonl
// by ref, appended once, and meta-logged once. Bypasses are never meta-logged.
//
// Repos to scan: argv paths, else ~/.claude/jidoka/enforcement-repos.json (["/path", …]), else cwd.
// No hardcoded machine paths (logged anti-pattern) — the repo list is user-owned config.
//
// FULL & self-tested (injected git + clock). Usage:
//   node scripts/enforcement-reconcile.mjs --self-test
//   node scripts/enforcement-reconcile.mjs [repo …]

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

// ── pure core ──────────────────────────────────────────────────────
// parse "<iso-ts> commit=<hash>" lines newer than sinceMs (now injected for tests)
export function parseBypassLog(text, sinceMs = 0) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\S+)\s+commit=([0-9a-f]+)/i);
    return m ? { ts: m[1], commit: m[2], at: Date.parse(m[1]) || 0 } : null;
  }).filter(e => e && e.at >= sinceMs);
}

// parse gate-refusals.jsonl → entries; keep only action:"refused"
export function parseRefusals(text, sinceMs = 0) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(e => e && e.action === 'refused' && (Date.parse(e.ts) || 0) >= sinceMs);
}

// reconcile ONE repo. commitExists: (ref)=>bool (injected). Returns { bypasses, violations }.
// A violation = a refusal whose ref still resolves to a real commit (the gate lied).
export function reconcileRepo({ repo, bypassEntries = [], refusalEntries = [], commitExists }) {
  const bypasses = bypassEntries.map(e => ({ repo, ...e, exists: commitExists(e.commit) }));
  const violations = refusalEntries
    .filter(e => commitExists(e.ref))
    .map(e => ({ repo, gate: e.gate || '?', ref: e.ref, ts: e.ts, kind: 'gate-claims-block-but-passes' }));
  return { bypasses, violations };
}

// ── IO helpers ─────────────────────────────────────────────────────
function gitHas(repo, ref) {
  try { execFileSync('git', ['-C', repo, 'cat-file', '-e', `${ref}^{commit}`], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
function resolveRepos(argv) {
  const fromArgs = argv.filter(a => !a.startsWith('--'));
  if (fromArgs.length) return fromArgs;
  const cfg = join(homedir(), '.claude', 'jidoka', 'enforcement-repos.json');
  if (existsSync(cfg)) { try { const a = JSON.parse(readFileSync(cfg, 'utf8')); if (Array.isArray(a) && a.length) return a; } catch { /* fall through */ } }
  return [process.cwd()];
}

// ── self-test (deterministic, injected git) ────────────────────────
function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const now = Date.parse('2026-06-10T12:00:00Z');
  const since = now - 26 * 3600 * 1000;

  const log = `2026-06-10T04:00:00Z commit=aaaa1111\n2026-06-08T01:00:00Z commit=oldoldold\n  \ngarbage line\n2026-06-10T05:00:00Z commit=bbbb2222`;
  const parsed = parseBypassLog(log, since);
  ok('parseBypassLog: keeps recent, drops old + garbage', parsed.length === 2 && parsed[0].commit === 'aaaa1111');
  ok('parseBypassLog: tolerates empty input', parseBypassLog('', since).length === 0);

  const ref = `{"ts":"2026-06-10T04:11:00Z","gate":"sdd-ac","ref":"bb3b8c6a","action":"refused"}\n{"ts":"2026-06-10T04:12:00Z","gate":"x","ref":"deadbeef","action":"warned"}`;
  const refs = parseRefusals(ref, since);
  ok('parseRefusals: keeps only action=refused', refs.length === 1 && refs[0].ref === 'bb3b8c6a');

  // refused commit EXISTS → violation (the gate lied)
  const exists = (r) => r === 'bb3b8c6a' || r === 'aaaa1111' || r === 'bbbb2222';
  const r1 = reconcileRepo({ repo: '/x', bypassEntries: parsed, refusalEntries: refs, commitExists: exists });
  ok('reconcile: refused-but-commit-exists → violation', r1.violations.length === 1 && r1.violations[0].kind === 'gate-claims-block-but-passes');
  ok('reconcile: bypasses flagged with existence', r1.bypasses.length === 2 && r1.bypasses[0].exists === true);

  // refused commit does NOT exist → honest refusal, no violation
  const r2 = reconcileRepo({ repo: '/x', refusalEntries: refs, commitExists: () => false });
  ok('reconcile: refused-and-commit-absent → NO violation (honest gate)', r2.violations.length === 0);

  if (fails.length) { console.log(`\n\x1b[31menforcement-reconcile self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ enforcement-reconcile: bypass + refusal reconciliation correct\x1b[0m');
  process.exit(0);
}

// ── CLI ────────────────────────────────────────────────────────────
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const noLog = process.argv.includes('--no-log'); // tests: detect + audit, but never touch the meta-ledger
  const repos = resolveRepos(process.argv.slice(2));
  const sinceMs = Date.now() - 26 * 3600 * 1000;
  const allBypasses = [], allViolations = [];

  for (const repo of repos) {
    if (!existsSync(repo)) continue;
    const bypassFile = join(repo, '.sdd-bypass.log');
    const refusalFile = join(repo, 'docs', 'audits', 'gate-refusals.jsonl');
    const bypassEntries = existsSync(bypassFile) ? parseBypassLog(readFileSync(bypassFile, 'utf8'), sinceMs) : [];
    const refusalEntries = existsSync(refusalFile) ? parseRefusals(readFileSync(refusalFile, 'utf8'), sinceMs) : [];
    const { bypasses, violations } = reconcileRepo({ repo, bypassEntries, refusalEntries, commitExists: r => gitHas(repo, r) });
    allBypasses.push(...bypasses); allViolations.push(...violations);
  }

  // report — concise, digest-friendly
  if (!allBypasses.length && !allViolations.length) { console.log('🟢 enforcement: no gate bypasses or false refusals in the last 26h'); process.exit(0); }
  // group bypasses per repo into ONE summary line each — honest count, no flooding the digest
  const byRepo = {};
  for (const b of allBypasses) (byRepo[b.repo] ||= []).push(b);
  for (const [repo, list] of Object.entries(byRepo)) {
    const latest = list[list.length - 1];
    console.log(`⚠️  ${basename(repo)}: ${list.length} gate bypass(es) in 26h (latest ${latest.commit} · ${latest.ts})`);
  }

  // VIOLATIONS: dedupe against our own audit log by ref, then meta-log each new one EXACTLY once
  const auditDir = join(repos[0] || process.cwd(), 'docs', 'audits');
  const auditFile = join(auditDir, 'enforcement-reconcile.jsonl');
  const seen = new Set(existsSync(auditFile) ? readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l).ref; } catch { return null; } }) : []);
  let newViolations = 0;
  for (const v of allViolations) {
    console.log(`🔴 GATE LIED · ${basename(v.repo)} · gate "${v.gate}" said refused but commit ${v.ref} exists`);
    if (seen.has(v.ref)) continue;
    mkdirSync(auditDir, { recursive: true });
    appendFileSync(auditFile, JSON.stringify({ ...v, detectedAt: new Date().toISOString() }) + '\n');
    if (!noLog) try {
      execFileSync('node', [join(homedir(), '.claude', 'jidoka', 'scripts', 'meta-log.mjs'),
        v.kind, `gate "${v.gate}" refused commit ${v.ref}`, `commit ${v.ref} exists in ${basename(v.repo)} — refusal was not enforced`, 'enforcement-reconcile'],
        { cwd: v.repo, stdio: 'ignore' });
    } catch { /* meta-log best-effort; the audit line is the durable record */ }
    seen.add(v.ref); newViolations++;
  }
  if (newViolations) console.log(`\n${newViolations} new false-refusal(s) logged to docs/audits/enforcement-reconcile.jsonl + meta-ledger.`);
  process.exit(allViolations.length ? 1 : 0);
}
