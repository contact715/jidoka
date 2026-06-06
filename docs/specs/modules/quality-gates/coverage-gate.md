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

# Module — Coverage Delta Gate

**Level:** L3 (Module) · **Domain:** [Quality Gates & Verification](../../domains/quality-gates.md) · **id:** `coverage-gate`

## What it is

Diffs per-file line coverage against the baseline; blocks if any file drops >5%. The sole owner of coverage delta math (other gates must not reimplement).

## Lives in

- `scripts/coverage-delta.mjs`

## Generated at runtime (not source, not in VCS)

- docs/metrics/coverage-baseline.json — created on first run

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Absent coverage/lcov.info → SKIP, exit 0 (graceful)

```
node scripts/coverage-delta.mjs
```

### AC-2 — A file dropping >5% → FAIL row, exit 1

```
fixture: lcov with a 6% drop → exit 1
```

### AC-3 — An empty baseline initialises from current coverage, exit 0

```
fixture: empty baseline → first-run init
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
