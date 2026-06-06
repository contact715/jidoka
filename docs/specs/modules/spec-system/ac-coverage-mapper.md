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

# Module — AC-to-Test Coverage Mapper

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `ac-coverage-mapper`

## What it is

Extracts each spec AC, scans tests for wave-qualified AC tags, classifies each AC covered/uncovered. The spec→test traceability link.

## Lives in

- `scripts/map-ac-coverage.mjs`

## Generated at runtime (not source, not in VCS)

- docs/metrics/ac-coverage-map.json — created on first run

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — --dry prints Total/Covered/Uncovered AC counts

```
node scripts/map-ac-coverage.mjs --dry
```

### AC-2 — A bare // AC-1 without a wave qualifier does not count as coverage

```
fixture: untagged AC comment → uncovered
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
