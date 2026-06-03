#!/usr/bin/env node
// Pre-publish guard — a MECHANICAL andon for irreversible publication.
//
// Per-rule severity + scope, so the guard protects what actually matters without
// bricking the repo on its own immutable history:
//
//   • Real secrets (tokens, keys, private-key blocks, connection strings) are a
//     LIVE risk wherever they sit — even in an old commit. They stay BLOCK and are
//     scanned in the working TREE *and* full git HISTORY (a leaked token in history
//     must still be caught and rotated).
//
//   • Absolute home paths (/Users/<name>/, /home/<name>/) are local filesystem
//     strings, NOT credentials. They already pervade this repo's history (1000+),
//     so scanning all history for them AND blocking permanently bricks every commit
//     for every session — it did exactly that on 2026-06-02. They are WARN-only and
//     scanned in the working TREE only: that surfaces the paths you can actually
//     edit out (parameterise with $HOME), never blocks, and never re-litigates
//     immutable history.
//
// Exit 1 (block) fires ONLY on a BLOCK-severity finding. Wired as a git pre-push
// hook (.githooks/pre-push) and a PreToolUse Bash guard, so a push cannot proceed
// while a real secret exists.
//
// This exists because a skill/checklist that relies on the agent remembering to
// read it is not mechanical. This script makes the check unavoidable.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { recordTrip } from './meta-lib.mjs';

// Files that legitimately contain pattern *definitions*, doc examples, or PII-shaped
// test fixtures — skip these so the guard does not flag its own detection patterns or
// the redaction utility's tests (a PII-redactor's tests must contain sample PII).
// Matched against each grep line, which in history diffs carries the code, not the
// filename — hence redactPii (the function name appears on every fixture line).
const SELF_REFERENCE = /pre-publish-guard|pre-publish-checklist|run-pentest-harness|ANTI_PATTERNS_CATALOG|\.jidoka-denylist|redact-pii|redactPii/;

// severity: 'block' (exit 1) | 'warn' (report, exit 0). scopes: which corpora to scan.
const RULES = [
  { name: 'absolute home path', re: '(/Users/|/home/)[A-Za-z0-9._-]+/', allow: /\/(Users|home)\/(you|user|runner|me|<)/, severity: 'warn',  scopes: ['tree'] },
  { name: 'GitHub token',        re: 'gh[posru]_[A-Za-z0-9]{30}',        allow: null,                    severity: 'block', scopes: ['tree', 'history'] },
  { name: 'OpenAI key',          re: 'sk-[A-Za-z0-9]{40}',               allow: null,                    severity: 'block', scopes: ['tree', 'history'] },
  { name: 'AWS access key',      re: 'AKIA[A-Z0-9]{16}',                 allow: null,                    severity: 'block', scopes: ['tree', 'history'] },
  { name: 'private key block',   re: '-----BEGIN [A-Z ]*PRIVATE KEY',    allow: null,                    severity: 'block', scopes: ['tree', 'history'] },
  // Real DSNs block (incl. history — a leaked prod password is live). Known LOCAL/
  // docker-compose defaults are not secrets and are allow-listed: trivial dev cred
  // pairs (postgres:postgres / :password) and compose-service / localhost hosts
  // (@db, @localhost, @redis …). A real host + real password still blocks.
  { name: 'connection string',   re: '[a-z]+://[^:@/ ]+:[^@/ ]{6,}@',    allow: /(example|user:pass|<|postgres:(postgres|password)@|:password@|@(localhost|127\.0\.0\.1|db|postgres|redis|mysql|mongo)([:/]|$))/, severity: 'block', scopes: ['tree', 'history'] },
];

function grepTree(re) {
  try {
    return execSync(`git grep -nIE ${JSON.stringify(re)} -- .`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; } // git grep exits 1 when no match
}
function grepHistory(re) {
  try {
    return execSync(`git log --all -p --no-color | grep -nIE ${JSON.stringify(re)} || true`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch { return ''; }
}
const SCAN = { tree: grepTree, history: grepHistory };

const blockFindings = [];
const warnFindings = [];

function classify(line, r, scope) {
  if (!line.trim()) return;
  if (SELF_REFERENCE.test(line)) return;
  if (r.allow && r.allow.test(line)) return;
  const entry = `[${scope}] ${r.name}: ${line.trim().slice(0, 100)}`;
  (r.severity === 'block' ? blockFindings : warnFindings).push(entry);
}

for (const r of RULES) {
  for (const scope of r.scopes) {
    for (const line of SCAN[scope](r.re).split('\n')) classify(line, r, scope);
  }
}

// Optional deny-list: brand names, personal names — one term per line, # for comments.
// Block-severity, tree + history (a name/brand leak is publish-sensitive like a secret).
if (existsSync('.jidoka-denylist')) {
  const terms = readFileSync('.jidoka-denylist', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  for (const term of terms) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const scope of ['tree', 'history']) {
      for (const line of SCAN[scope](esc).split('\n')) {
        if (line.trim() && !SELF_REFERENCE.test(line)) blockFindings.push(`[${scope}] deny '${term}': ${line.trim().slice(0, 100)}`);
      }
    }
  }
}

if (warnFindings.length) {
  console.error('\n\x1b[33m⚠ pre-publish-guard warnings (non-blocking) — local home paths; parameterise with $HOME when you touch these files:\x1b[0m');
  for (const f of warnFindings.slice(0, 20)) console.error('  ' + f);
  if (warnFindings.length > 20) console.error(`  … and ${warnFindings.length - 20} more`);
}

if (blockFindings.length) {
  recordTrip('tree-not-history', 'scripts/pre-publish-guard.mjs'); // gate fired: a publish was blocked
  console.error('\n\x1b[31m✗ pre-publish-guard BLOCKED this push — a real secret was found:\x1b[0m\n');
  for (const f of blockFindings.slice(0, 40)) console.error('  ' + f);
  if (blockFindings.length > 40) console.error(`  … and ${blockFindings.length - 40} more`);
  console.error('\n  Rotate the secret, remove it from the TREE, then scrub HISTORY (orphan-commit');
  console.error('  rewrite — force-push alone leaks dangling commits reachable by SHA).');
  console.error('  See .claude/skills/pre-publish-checklist.md.\n');
  process.exit(1);
}

console.error(
  '\x1b[32m✓ pre-publish-guard: no real secrets in tree or history' +
  (warnFindings.length ? ` (${warnFindings.length} home-path warning${warnFindings.length > 1 ? 's' : ''})` : '') +
  '\x1b[0m',
);
process.exit(0);
