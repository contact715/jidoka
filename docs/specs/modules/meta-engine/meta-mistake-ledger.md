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

# Module — Meta-Mistake Ledger & Primitives

**Level:** L3 (Module) · **Domain:** [Meta-Engine & Self-Improvement](../../domains/meta-engine.md) · **id:** `meta-mistake-ledger`

## What it is

Shared library + CLI for the cross-project mistake ledger. Env-overridable LEDGER path; the substrate every meta script reads.

## Lives in

- `scripts/meta-lib.mjs`
- `scripts/meta-log.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Engine test passes

```
node --test scripts/__tests__/meta-lib.test.mjs
```

### AC-2 — meta-log appends one valid JSON line

```
node scripts/meta-log.mjs test-class "claimed" "real" user
```

### AC-3 — loadLedger returns [] when the file is absent (no crash)

```
covered by meta-lib.test.mjs
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
