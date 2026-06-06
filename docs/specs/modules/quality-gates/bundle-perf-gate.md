---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/quality-gates.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Bundle Size & Performance Gate

**Level:** L3 (Module) · **Domain:** [Quality Gates & Verification](../../domains/quality-gates.md) · **id:** `bundle-perf-gate`

## What it is

Per-route first-load JS delta against a baseline; blocks on >50 KB growth per route. Sole owner of bundle-read logic.

## Lives in

- `scripts/bundle-size-check.mjs`
- `scripts/bundle-delta.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — No .next build → SKIP, exit 0

```
node scripts/bundle-delta.mjs
```

### AC-2 — A route growing >50 KB → exit 1 naming the route

```
fixture: manifest with +60 KB route → exit 1
```

### AC-3 — --update rewrites the baseline without blocking

```
node scripts/bundle-size-check.mjs --update
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
