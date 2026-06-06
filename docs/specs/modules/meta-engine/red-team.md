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

# Module — Red Team (Adversarial Tester)

**Level:** L3 (Module) · **Domain:** [Meta-Engine & Self-Improvement](../../domains/meta-engine.md) · **id:** `red-team`

## What it is

Attacks the framework's own defenses across six classes; every success becomes a permanent golden case or catalog entry. Never weakens a gate.

## Lives in

- `scripts/red-team.mjs`
- `.claude/agents/red-team.md`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes (deterministic attack catalog self-verifies)

```
node scripts/red-team.mjs --self-test
```

### AC-2 — Attacks against policy-enforce-hook protected paths fail cleanly

```
node scripts/policy-enforce-hook.mjs --self-test
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
