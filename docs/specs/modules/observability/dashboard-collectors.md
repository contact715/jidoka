---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/observability.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Dashboard Data Layer

**Level:** L3 (Module) · **Domain:** [Dashboard & Observability](../../domains/observability.md) · **id:** `dashboard-collectors`

## What it is

Pure summarizers + fs gather: discovers projects, assembles pipeline/tasks/production/health per project, degrades gracefully when streams are absent.

## Lives in

- `scripts/dashboard/collectors.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes (pure-summarizer checks)

```
node scripts/dashboard/collectors.mjs --self-test
```

### AC-2 — collectProject returns the four keys even with no artifact streams

```
covered by --self-test (graceful degrade)
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
