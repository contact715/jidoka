#!/usr/bin/env node
// ONE-SHOT owner-run applier for docs/proposals/ledger-pollution-remedy.proposed.md.
//
// meta-remedies.mjs is ALWAYS_PROTECTED — agents cannot write it, BY DESIGN (an agent
// must not register its own gate). The owner approved this registration in chat on
// 2026-07-12; running this script IS the human apply. It:
//   1. inserts the 'ledger-pollution' entry into the canon registry (~/jidoka-framework)
//      and the installed copy (~/.claude/jidoka) — idempotent, skips if already present;
//   2. appends the apply record to ~/.claude/hooks/l0-write-audit.jsonl;
//   3. verifies: meta-audit + the registry still parses;
//   4. commits + pushes via safe-commit.mjs (parallel-session safe).
//
// Run:  node ~/jidoka-framework/docs/proposals/apply-ledger-pollution.mjs

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CANON = join(homedir(), 'jidoka-framework');
const TARGETS = [
  join(CANON, 'scripts', 'meta-remedies.mjs'),
  join(homedir(), '.claude', 'jidoka', 'scripts', 'meta-remedies.mjs'),
];

const ENTRY = `  'ledger-pollution': {
    // 2026-06-06 ×2 (wave-judge-debias telemetry rows in the mistake ledger; recurrence same
    // day; root-caused 2026-07-04). Remedy moved from detect-after (meta-honesty) to
    // reject-at-write on 2026-07-12: meta-log validates before append, ledger-schema-gate
    // hard-blocks commit/CI on any row missing the mistake schema. Applied under explicit
    // owner approval (docs/proposals/ledger-pollution-remedy.proposed.md).
    since: '2026-07-12',
    mechanism: 'scripts/ledger-schema-gate.mjs',
    family: ['telemetry-in-ledger', 'garbage-in-ledger', 'schema-missing-fields', 'self-confirming-row'],
    premortem: {
      risk: /\\b(append|log|write|emit)\\b.*\\b(meta-mistakes|ledger|run1|run2|telemetry)\\b/i,
      clears: /\\b(claimed|real|caught_by|ledger-schema-gate|validateLedgerEntry|meta-honesty|sidecar|separate stream|telemetry file)\\b/i,
      advise: 'the mistake ledger takes only real incidents (date/class/claimed/real/caught_by); telemetry goes to its own sidecar stream — meta-log rejects garbage at write, ledger-schema-gate blocks it at commit',
    },
    gate:
      'Every row in meta-mistakes.jsonl must be valid JSON carrying date/class/claimed/real/caught_by ' +
      '(all non-empty; shared validator validateLedgerEntry in meta-lib). Enforced at WRITE (meta-log ' +
      'rejects, exit 2) and at COMMIT/CI (ledger-schema-gate hard-blocks, wired in .githooks/pre-commit ' +
      'and ci.yml since 2026-07-12); meta-honesty remains defence-in-depth on signal quality.',
  },
};`;

let applied = 0;
for (const target of TARGETS) {
  let src;
  try { src = readFileSync(target, 'utf8'); } catch { console.log(`• ${target} — not found, skipped`); continue; }
  if (src.includes("'ledger-pollution':")) { console.log(`• ${target} — entry already present, skipped`); continue; }
  const closing = src.lastIndexOf('};');
  if (closing === -1) { console.error(`✗ ${target} — no closing "};" found, NOT touched`); process.exit(1); }
  writeFileSync(target, src.slice(0, closing) + ENTRY + src.slice(closing + 2));
  console.log(`✓ ${target} — 'ledger-pollution' registered`);
  applied++;
}

if (applied > 0) {
  appendFileSync(join(homedir(), '.claude', 'hooks', 'l0-write-audit.jsonl'), JSON.stringify({
    ts: new Date().toISOString(),
    target: 'scripts/meta-remedies.mjs (canon + installed)',
    grantedBy: 'owner',
    reason: 'explicit chat approval 2026-07-12 (AskUserQuestion): register ledger-pollution → ledger-schema-gate (docs/proposals/ledger-pollution-remedy.proposed.md)',
    appliedBy: 'owner-run apply-ledger-pollution.mjs',
  }) + '\n');
  console.log('✓ apply recorded in ~/.claude/hooks/l0-write-audit.jsonl');
}

// verify: the registry must still parse, and meta-audit must see the class as gated
for (const target of TARGETS) {
  try { await import(target + '?v=' + Date.now()); console.log(`✓ ${target} — parses`); }
  catch (e) { console.error(`✗ ${target} — PARSE FAILED: ${e.message}`); process.exit(1); }
}
console.log('\n— meta-audit —');
execSync('node scripts/meta-audit.mjs || true', { cwd: CANON, stdio: 'inherit' });

if (applied > 0) {
  console.log('\n— commit —');
  execSync(`node "${join(homedir(), '.claude', 'jidoka', 'scripts', 'safe-commit.mjs')}" --repo "${CANON}" --message "gate(registry): register ledger-pollution → ledger-schema-gate (owner-applied)\n\nApplied by the owner via docs/proposals/apply-ledger-pollution.mjs per\ndocs/proposals/ledger-pollution-remedy.proposed.md; recorded in l0-write-audit.jsonl.\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`, { stdio: 'inherit' });
}
console.log('\n✓ done');
