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

# Module — Spec Index Generator

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `spec-index-generator`

## What it is

Builds the master spec lookup table from frontmatter across docs/specs/.

## Lives in

- `scripts/regenerate-specs-index.mjs`
- `docs/specs/_INDEX.md`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — --dry prints the table without writing

```
node scripts/regenerate-specs-index.mjs --dry
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
