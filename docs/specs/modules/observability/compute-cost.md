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

# Module — FinOps Agent Cost

**Level:** L3 (Module) · **Domain:** [Dashboard & Observability](../../domains/observability.md) · **id:** `compute-cost`

## What it is

Estimates per-wave token cost, cumulative spend, 3x-median anomaly detection, and cost-per-clean-wave unit economics. Every figure labelled est.

## Lives in

- `scripts/compute-cost.mjs`
- `docs/quality/cost-budget.json`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — --dry prints per-wave estimates without writing

```
node scripts/compute-cost.mjs --dry
```

### AC-2 — A wave cost >3x the 10-wave median emits a cost_anomaly event

```
fixture: spike wave → cost_anomaly
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
