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

# Module — Spec-vs-File Drift Checker

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `spec-drift-checker`

## What it is

Portable, zero-dependency check that every file reference and declared parent in spec markdown resolves to a real file. Skips docs/archive; ignores template placeholders.

## Lives in

- `scripts/spec-drift-check.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes (26 pure-logic assertions)

```
node scripts/spec-drift-check.mjs --self-test
```

### AC-2 — A reference to a nonexistent file is reported

```
observe: ⚠ finding for missing ref
```

### AC-3 — --hard exits 1 on any high-severity finding

```
node scripts/spec-drift-check.mjs --hard
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
