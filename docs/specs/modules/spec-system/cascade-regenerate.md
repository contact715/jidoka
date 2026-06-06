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

# Module — Cascade Version Propagator

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `cascade-regenerate`

## What it is

Propagates a non-breaking parent version bump into child parents[].version + last_validated_against_parents; logs each change. Refuses when breaking_change_in_v is set.

## Lives in

- `scripts/cascade-regenerate.mjs`

## Generated at runtime (not source, not in VCS)

- docs/cascade-log.md — created on first run

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — --dry lists would-update children without writing

```
node scripts/cascade-regenerate.mjs --root docs/CONSTITUTION.md --dry
```

### AC-2 — A root with breaking_change_in_v makes no changes (warns)

```
fixture: root with breaking flag → no writes
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
