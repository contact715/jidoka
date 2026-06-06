---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/meta-engine.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Meta-Gate Registry (Remedies)

**Level:** L3 (Module) · **Domain:** [Meta-Engine & Self-Improvement](../../domains/meta-engine.md) · **id:** `meta-gate-registry`

## What it is

Source of truth mapping each mistake class to its gate: since-date, mechanism file, prose rule, family, and pre-mortem regex pair.

## Lives in

- `scripts/meta-remedies.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes

```
node scripts/meta-remedies.mjs --self-test
```

### AC-2 — Every entry mechanism points to a file on disk

```
checked by meta-audit broken-gate rule
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
