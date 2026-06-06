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

# Module — Per-Project Engine Installer

**Level:** L3 (Module) · **Domain:** [Installer & Federation](../../domains/installer-federation.md) · **id:** `project-installer`

## What it is

Profile-resolved copy of engine scripts into a target .jidoka/, wiring hooks and npm scripts, with a footprint check that refuses to duplicate a native framework.

## Lives in

- `scripts/install-into.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes (profile invariants: kernel-in-every-profile, import-closure)

```
node scripts/install-into.mjs --self-test
```

### AC-2 — --profile=core installs exactly the kernel list

```
observe: core profile file set
```

### AC-3 — A target with its own framework gets a REDUNDANT/OVERLAP verdict before copy

```
covered by footprint-audit
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
