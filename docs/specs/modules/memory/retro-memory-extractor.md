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

# Module — Retro-to-Graph Staging Extractor

**Level:** L3 (Module) · **Domain:** [Memory & Knowledge](../../domains/memory.md) · **id:** `retro-memory-extractor`

## What it is

Walks retros, extracts taxonomy sections (pattern/gap/decision/lesson/anti-pattern) into a deterministic staging JSON.

## Lives in

- `scripts/extract-retro-memory.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — --dry prints an extraction count and sample without writing

```
node scripts/extract-retro-memory.mjs --dry
```

### AC-2 — Identical retro content yields the same content-hash filename (deterministic)

```
observe: stable hash in staging filename
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
