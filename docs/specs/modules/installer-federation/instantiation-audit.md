---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/installer-federation.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Ghost Automation Detector

**Level:** L3 (Module) · **Domain:** [Installer & Federation](../../domains/installer-federation.md) · **id:** `instantiation-audit`

## What it is

Catches docs that cite nonexistent workflows/hooks, doc counts that drifted from reality, and missing critical input objects. Blocks on any ghost.

## Lives in

- `scripts/instantiation-audit.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — A clean repo exits 0

```
node scripts/instantiation-audit.mjs
```

### AC-2 — A reference to a nonexistent workflow → ghost, exit 1

```
fixture: cite a missing workflow file (a path under the workflows dir not on disk) -> ghost, exit 1
```

### AC-3 — --warn reports the same condition but exits 0

```
node scripts/instantiation-audit.mjs --warn
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
