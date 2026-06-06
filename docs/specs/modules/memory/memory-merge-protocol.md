---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/memory.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Agent-Driven Graph Merge

**Level:** L3 (Module) · **Domain:** [Memory & Knowledge](../../domains/memory.md) · **id:** `memory-merge-protocol`

## What it is

The human-reviewable procedure to merge staged entities into the live knowledge graph. Idempotent; orphan-skip; eight observation tags.

## Lives in

- `docs/MEMORY_MERGE_PROTOCOL.md`
- `scripts/memory-staging-status.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Staging status lists unmerged files (or none)

```
node scripts/memory-staging-status.mjs
```

### AC-2 — --json emits a valid files[] array

```
node scripts/memory-staging-status.mjs --json
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
