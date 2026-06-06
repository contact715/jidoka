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

# Module — Spec-to-Graph Staging Extractor

**Level:** L3 (Module) · **Domain:** [Memory & Knowledge](../../domains/memory.md) · **id:** `specs-to-memory-extractor`

## What it is

Extracts spec frontmatter + ACs into a staging JSON for the memory graph. Exports extractACs() reused by the AC-coverage mapper.

## Lives in

- `scripts/sync-specs-to-memory.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — --dry prints spec/entity/relation counts without writing

```
node scripts/sync-specs-to-memory.mjs --dry
```

### AC-2 — A dangling depends_on is warned and produces no relation

```
fixture: unknown depends_on → warning
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
