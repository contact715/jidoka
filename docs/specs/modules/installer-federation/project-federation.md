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

# Module — Project Steward & Integrity Charter

**Level:** L3 (Module) · **Domain:** [Installer & Federation](../../domains/installer-federation.md) · **id:** `project-federation`

## What it is

One steward agent per project as the single door to the framework; conflicts open a Defense Process with three non-silent outcomes (reject / adapt / evolve-philosophy).

## Lives in

- `docs/specs/wave-federation_MASTER_SPEC.md`
- `docs/PROJECT_CHARTER_TEMPLATE.md`
- `.claude/agents/project-steward.md`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — The charter template has all four sections (Roots, Trunk, Protected zones, Derivation)

```
grep: four required headers present
```

### AC-2 — The project-steward agent definition exists and references the Defense Process

```
grep: .claude/agents/project-steward.md mentions Defense Process
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
