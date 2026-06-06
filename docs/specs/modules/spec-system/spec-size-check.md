---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/spec-system.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Spec Size Pre-Build Gate

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `spec-size-check`

## What it is

Caps a spec at 8 objectives / 20 ACs / 3 surfaces / 600 lines. Keeps specs small enough to fit an agent context (the over-specification mitigation).

## Lives in

- `scripts/spec-size-check.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes (8 assertions)

```
node scripts/spec-size-check.mjs --self-test
```

### AC-2 — A spec at threshold passes; one over fails

```
node scripts/spec-size-check.mjs --metrics '{"objectives":9}'
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
