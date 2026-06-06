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

# Module — Wave Lifecycle & Run State

**Level:** L3 (Module) · **Domain:** [Agent Orchestration & Pipeline](../../domains/orchestration.md) · **id:** `wave-lifecycle`

## What it is

Journals a wave's phase to docs/runs/<wave>/state.json so work survives a context reset and can be resumed without auto-executing.

## Lives in

- `scripts/run-state.mjs`
- `docs/runs/`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Run-state self-test passes

```
node scripts/run-state.mjs --self-test
```

### AC-2 — --init creates state.json at phase=init, status=pending

```
node scripts/run-state.mjs --init selftest --task '{"risk":"low"}'
```

### AC-3 — --resume after a reset names the last phase and next step

```
node scripts/run-state.mjs --resume selftest
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
