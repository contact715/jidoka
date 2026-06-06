---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/meta-engine.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Meta-Audit Recurrence Detector

**Level:** L3 (Module) · **Domain:** [Meta-Engine & Self-Improvement](../../domains/meta-engine.md) · **id:** `meta-audit-engine`

## What it is

Classifies each recurring mistake class as HOLDING / REGRESSION / UNGATED against the gate registry. Exits 1 on ungated or regressed classes, or a broken gate.

## Lives in

- `scripts/meta-audit.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Engine test passes

```
node --test scripts/__tests__/meta-audit.test.mjs
```

### AC-2 — Empty ledger exits 0

```
node scripts/meta-audit.mjs
```

### AC-3 — A gate whose mechanism file is missing is flagged, exit 1

```
covered by meta-audit.test.mjs
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
