---
status: Active
version: 1.0.0
level: L1
type: core-arch
owner_role: platform
parents:
  - path: docs/NORTH_STAR.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-07-12
last_validated_against_parents: 2026-07-12
last_updated: 2026-07-12
---

# Proof-of-Work Gate — no "done" without something EXECUTED

**Status**: Active (Stop hook, wired 2026-07-12)
**Mechanism**: `hooks/proof-of-work-gate.mjs` (installed at `~/.claude/hooks/proof-of-work-gate.mjs`,
wired in `~/.claude/settings.json → hooks.Stop`, right after `browser-verify-gate.mjs`)
**Meta-class it gates**: `declaration-over-implementation` (the highest-scoring lesson in the
cross-project ledger — seen 5×) and its family: `claim-without-test`, `fixed-without-rerun`,
`wired-without-trace`, `code-edited-nothing-run`.

## Why it exists

Engineering Discipline rule #4 ("no done without proof") was documented but not enforced for
ordinary conversational work: the invocable `scripts/proof-gate.mjs` existed, yet nothing forced
it to run — a paper gate. Sessions kept declaring "fixed / wired / done" after editing code
without executing anything. The registry even listed the class as "gated" while the mechanism
had no caller (which is itself the `orphaned-gate` pattern).

## What it does

On every session Stop it scans the transcript's tool uses — what the session **did**, not what
it **said**:

- The session **edited source code** (ts, tsx, js, mjs, py, sh and other executable kinds;
  docs, markdown, and JSON/YAML config are deliberately excluded — precision over recall), **and**
- **nothing was executed after the last code edit**: no test / typecheck / build / script run
  via Bash, no browser verification tool

→ the stop is **blocked once** with a reason telling the agent to run a proof (the relevant
test, `--self-test`, `tsc`, or the script itself) and show its output before finishing.

The "after the last edit" ordering matters: run-test-then-edit-again (`fixed-without-rerun`)
still triggers.

## Safety contract (same as browser-verify-gate)

- **Fail-open**: any error, missing transcript, malformed input → exit 0. Never breaks a session.
- **Block once per session** (marker in `$TMPDIR/proof-of-work-gate/`): a nudge, never a lockout.
- Honours `stop_hook_active` — no re-trigger loops.
- Legitimate pass: if the edit is genuinely not executable (comment-only change), say so
  explicitly in the final message and stop again.

## Self-test

```
node hooks/proof-of-work-gate.mjs --self-test   # 13 checks
```

## Composes with

- `hooks/browser-verify-gate.mjs` — UI edits additionally need a browser LOOK; a browser tool
  call counts as proof for this gate too.
- `scripts/proof-gate.mjs` — the invocable typed-proof runner (a UI claim needs a browser proof,
  a data-removal claim needs a history scan). This hook forces *that a proof ran*; proof-gate
  checks *the proof is the right kind*.
- `scripts/meta-remedies.mjs` — the registry entry for `declaration-over-implementation` names
  this hook as the enforcing mechanism.
