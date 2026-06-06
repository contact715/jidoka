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

# Module — Episodic-to-Semantic Digest

**Level:** L3 (Module) · **Domain:** [Memory & Knowledge](../../domains/memory.md) · **id:** `memory-consolidate`

## What it is

Recency-weighted (30-day half-life) consolidation of the mistake ledger into ACTIVE/WATCH/DORMANT tiers, annotated gated vs live-risk. The session-start lessons digest.

## Lives in

- `scripts/memory-consolidate.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes (9 checks)

```
node scripts/memory-consolidate.mjs --self-test
```

### AC-2 — A gated class is annotated gated:true; an ungated one shows live risk

```
observe: memory-consolidated.md tiering
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
