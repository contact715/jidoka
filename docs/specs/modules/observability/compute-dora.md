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

# Module — DORA Delivery Metrics

**Level:** L3 (Module) · **Domain:** [Dashboard & Observability](../../domains/observability.md) · **id:** `compute-dora`

## What it is

Computes the four DORA metrics from git log + halt/recurrence streams; applies 2024 four-tier bands. Soft by default; AI-calibration noted.

## Lives in

- `scripts/compute-dora.mjs`
- `docs/quality/dora-definitions.json`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — --dry prints per-metric values without writing

```
node scripts/compute-dora.mjs --dry
```

### AC-2 — A halt that resumes with no follow-up fix does not count as a change-fail (anti-gaming)

```
fixture: halt+resume, no R2 commit → no change-fail event
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
