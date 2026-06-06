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

# Module — Prompt Evolution System

**Level:** L3 (Module) · **Domain:** [Meta-Engine & Self-Improvement](../../domains/meta-engine.md) · **id:** `prompt-evolution-system`

## What it is

Deterministic half of agent self-improvement: surfaces agents below 100% eval accuracy and confirms a patch is a strict improvement (higher accuracy, zero regression) before a human applies it.

## Lives in

- `scripts/prompt-evolution.mjs`
- `.claude/agents/prompt-evolver.md`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Self-test passes

```
node scripts/prompt-evolution.mjs --self-test
```

### AC-2 — isImprovement returns false if any passing case regresses

```
covered by prompt-evolution --self-test
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
