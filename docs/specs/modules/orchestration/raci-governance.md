---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/orchestration.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — RACI/DACI Governance Matrix

**Level:** L3 (Module) · **Domain:** [Agent Orchestration & Pipeline](../../domains/orchestration.md) · **id:** `raci-governance`

## What it is

Source-of-truth responsibility matrix. raci.json drives generated raci.md. Every activity has exactly one human-accountable seat (EU AI Act Art 14).

## Lives in

- `docs/governance/raci.json`
- `docs/governance/raci.md`
- `scripts/validate-raci.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — A valid matrix validates with 0 violations

```
node scripts/validate-raci.mjs
```

### AC-2 — An accountable that is an agent slug (not human:) is a violation, exit 1

```
fixture: accountable=agent → exit 1
```

### AC-3 — --emit-md regenerates raci.md from raci.json

```
node scripts/validate-raci.mjs --emit-md
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
