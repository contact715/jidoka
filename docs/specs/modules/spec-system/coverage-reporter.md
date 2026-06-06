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

# Module — Spec Coverage Report Generator

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `coverage-reporter`

## What it is

Measures module coverage (do the framework's canonical modules have L3 specs?) and per-level spec density L0–L4.

## Lives in

- `scripts/regenerate-coverage-report.mjs`
- `docs/specs/_COVERAGE.md`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — --dry prints a coverage summary without writing

```
node scripts/regenerate-coverage-report.mjs --dry
```

### AC-2 — An L2/L3 spec with no parents[] is flagged ORPHAN

```
observe: per-level ORPHAN notes
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
