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

# Module — Cascade Compatibility Validator

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `cascade-validate`

## What it is

Given a root spec, prints COMPATIBLE / INCOMPATIBLE / AMBIGUOUS per child by semver diff. Exits 1 on INCOMPATIBLE in hard mode.

## Lives in

- `scripts/cascade-validate.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — A root with up-to-date children prints a verdict table, exit 0

```
node scripts/cascade-validate.mjs --root docs/CONSTITUTION.md --level L1
```

### AC-2 — A child on an older major version is INCOMPATIBLE

```
fixture: child major behind → INCOMPATIBLE row
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
