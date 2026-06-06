---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/memory.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Agent Output Citation Contract

**Level:** L3 (Module) · **Domain:** [Memory & Knowledge](../../domains/memory.md) · **id:** `grounding-contract`

## What it is

Defines which claim types require citations and validates agent outputs against a citation schema; emits hallucination_detected on unresolved references.

## Lives in

- `docs/GROUNDING_CONTRACT.md`
- `scripts/check-source-grounding.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — A valid citation payload emits grounding_pass, exit 0

```
node scripts/check-source-grounding.mjs --dry-run
```

### AC-2 — An unresolvable reference emits hallucination_detected

```
fixture: bad chunk_id → unresolved_count>0
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
