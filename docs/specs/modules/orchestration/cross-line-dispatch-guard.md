---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/orchestration.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Cross-Line Dispatch Guard

**Level:** L3 (Module) · **Domain:** [Agent Orchestration & Pipeline](../../domains/orchestration.md) · **id:** `cross-line-dispatch-guard`

## What it is

Blocks a First-Line agent dispatching a Second-Line agent (and vice versa) without a named override. Every verdict is an append-only audit artifact.

## Lives in

- `scripts/check-cross-line-dispatch.mjs`
- `docs/audits/cross-line-verdicts.jsonl`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — A cross-line dispatch without override blocks in hard mode (exit 1)

```
node scripts/check-cross-line-dispatch.mjs --self-check
```

### AC-2 — An override with empty approver is rejected (anonymous bypass blocked)

```
fixture: crossLineOverride.approver="" → exit 1
```

### AC-3 — A valid override appends a WARN record and exits 0

```
fixture: named approver+reason → exit 0, jsonl grows
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
