---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/quality-gates.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Andon Halt State Machine

**Level:** L3 (Module) · **Domain:** [Quality Gates & Verification](../../domains/quality-gates.md) · **id:** `andon-halt-system`

## What it is

Shared stop-the-line library for the 9 halt-authority agents. Atomic writeHaltState to .sdd-halt-state.json, append-only audit to docs/audits/halt-events.jsonl. Formally modelled in TLA+.

## Lives in

- `scripts/andon-halt-helpers.mjs`
- `scripts/andon-resume.mjs`
- `docs/formal/AndonHalt.tla`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — writeHaltState creates .sdd-halt-state.json with wave, agent, reason populated

```
behavior: writeHaltState() → .sdd-halt-state.json present with active fields
```

### AC-2 — Each halt appends exactly one line to halt-events.jsonl (append-only)

```
audit: docs/audits/halt-events.jsonl line count increments by 1 per halt
```

### AC-3 — The TLA+ model of the halt invariant checks without violation

```
node scripts/run-tla.mjs
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
