---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/spec-system.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Spec Context & Ancestry Lookup

**Level:** L3 (Module) · **Domain:** [Hierarchical Spec System](../../domains/spec-system.md) · **id:** `get-spec-context`

## What it is

Given a feature, finds the matching spec and walks its L4→L0 ancestry. The forcing function behind read-the-chain-before-coding.

## Lives in

- `scripts/get-spec-context.mjs`
- `docs/audits/spec-context-runs.jsonl`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — A real feature prints the ancestry chain

```
node scripts/get-spec-context.mjs --feature spec
```

### AC-2 — A miss exits 0 with a not-found message and logs the run

```
node scripts/get-spec-context.mjs --feature __nope__
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
