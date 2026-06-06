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

# Module — Lineage Graph Builder

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `lineage-graph-builder`

## What it is

Walks all docs, reads parents[].path, writes docs/specs/_LINEAGE.md (Mermaid) and _LINEAGE.json. Flags orphans and missing metadata.

## Lives in

- `scripts/build-lineage-graph.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Emits a Mermaid graph TD block and an orphan/missing-meta summary

```
node scripts/build-lineage-graph.mjs
```

### AC-2 — --json emits valid JSON with nodes[] and edges[]

```
node scripts/build-lineage-graph.mjs --json
```

### AC-3 — A spec with no edges is listed as ORPHAN

```
observe: orphan count in stdout
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
