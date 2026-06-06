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

# Module — Dead-Install Detector

**Level:** L3 (Module) · **Domain:** [Installer & Federation](../../domains/installer-federation.md) · **id:** `footprint-audit`

## What it is

Checks each installed script has a live caller in the target; detects a pre-existing native framework. Born from installing 51 scripts where 45 went dead.

## Lives in

- `scripts/footprint-audit.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes

```
node scripts/footprint-audit.mjs --self-test
```

### AC-2 — A script with no caller is classified dead

```
covered by footprint-audit --self-test (classifyFootprint)
```

### AC-3 — A target with 2+ native signals registers hasOwn:true → REDUNDANT

```
covered by --self-test (footprintVerdict)
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
