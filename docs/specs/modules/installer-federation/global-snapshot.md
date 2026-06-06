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

# Module — Global Setup Version Capturer

**Level:** L3 (Module) · **Domain:** [Installer & Federation](../../domains/installer-federation.md) · **id:** `global-snapshot`

## What it is

Pulls live ~/.claude state back into global-setup/ for versioning, rewriting home paths to $HOME so the snapshot is portable.

## Lives in

- `scripts/snapshot-global.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Snapshot exits 0 and writes present files, warning on absent ones

```
node scripts/snapshot-global.mjs
```

### AC-2 — Every written file uses $HOME, no absolute home paths

```
checked by pre-publish-guard home-path rule
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
