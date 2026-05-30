#!/usr/bin/env node
// Pre-publish guard — a MECHANICAL andon for irreversible publication.
//
// Scans the working tree AND full git history for private data (secrets,
// absolute home paths, and an optional project deny-list of brand/personal
// terms). Exit 1 blocks the action. Wired as a git pre-push hook
// (.githooks/pre-push) so a push cannot proceed while private data exists.
//
// This exists because a skill/checklist that relies on the agent remembering
// to read it is not mechanical. This script makes the check unavoidable.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { recordTrip } from './meta-lib.mjs';

// Files that legitimately contain pattern *definitions* or doc examples —
// skip these so the guard does not flag its own detection patterns.
const SELF_REFERENCE = /pre-publish-guard|pre-publish-checklist|run-pentest-harness|ANTI_PATTERNS_CATALOG|\.jidoka-denylist/;

const RULES = [
  { name: 'absolute home path', re: '(/Users/|/home/)[A-Za-z0-9._-]+/', allow: /\/(Users|home)\/(you|user|runner|me|<)/ },
  { name: 'GitHub token',        re: 'gh[posru]_[A-Za-z0-9]{30}',        allow: null },
  { name: 'OpenAI key',          re: 'sk-[A-Za-z0-9]{40}',               allow: null },
  { name: 'AWS access key',      re: 'AKIA[A-Z0-9]{16}',                 allow: null },
  { name: 'private key block',   re: '-----BEGIN [A-Z ]*PRIVATE KEY',    allow: null },
  { name: 'connection string',   re: '[a-z]+://[^:@/ ]+:[^@/ ]{6,}@',    allow: /(example|user:pass|<)/ },
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

const findings = [];

for (const r of RULES) {
  for (const [scope, fn] of [['tree', grepTree], ['history', grepHistory]]) {
    for (const line of fn(r.re).split('\n')) {
      if (!line.trim()) continue;
      if (SELF_REFERENCE.test(line)) continue;
      if (r.allow && r.allow.test(line)) continue;
      findings.push(`[${scope}] ${r.name}: ${line.trim().slice(0, 100)}`);
    }
  }
}

// Optional deny-list: brand names, personal names — one term per line, # for comments.
if (existsSync('.jidoka-denylist')) {
  const terms = readFileSync('.jidoka-denylist', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  for (const term of terms) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [scope, fn] of [['tree', grepTree], ['history', grepHistory]]) {
      for (const line of fn(esc).split('\n')) {
        if (line.trim() && !SELF_REFERENCE.test(line)) findings.push(`[${scope}] deny '${term}': ${line.trim().slice(0, 100)}`);
      }
    }
  }
}

if (findings.length) {
  recordTrip('tree-not-history', 'scripts/pre-publish-guard.mjs'); // gate fired: a publish was blocked
  console.error('\n\x1b[31m✗ pre-publish-guard BLOCKED this push — private data found:\x1b[0m\n');
  for (const f of findings.slice(0, 40)) console.error('  ' + f);
  if (findings.length > 40) console.error(`  … and ${findings.length - 40} more`);
  console.error('\n  Clean the TREE and the HISTORY before pushing.');
  console.error('  History dirty? A clean rewrite (orphan commit) is required — force-push alone leaks');
  console.error('  dangling commits reachable by SHA. See .claude/skills/pre-publish-checklist.md.\n');
  process.exit(1);
}

console.error('\x1b[32m✓ pre-publish-guard: tree + history clean\x1b[0m');
process.exit(0);
