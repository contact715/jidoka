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

# Module — Constitutional Drift Monitor

**Level:** L3 (Module) · **Domain:** [Quality Gates & Verification](../../domains/quality-gates.md) · **id:** `constitutional-drift-monitor`

## What it is

Computes a 7-day rolling VIOLATION rate per Mission-Compass Q-number; alerts at 2σ; halts in hard-block mode. Soft by default.

## Lives in

- `scripts/detect-constitutional-drift.mjs`

## Generated at runtime (not source, not in VCS)

- docs/audits/constitutional-events.jsonl — created on first run

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Fewer than 5 events for a Q → no alert (N<5 guard)

```
node scripts/detect-constitutional-drift.mjs
```

### AC-2 — Soft mode exits 0 even when an alert fires

```
config: constitutionalDrift.hardBlockEnabled=false → exit 0
```

### AC-3 — Hard mode crossing 2σ calls writeHaltState and exits 42

```
config: hardBlockEnabled=true + breach fixture → exit 42
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
