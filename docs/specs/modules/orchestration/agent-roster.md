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

# Module — Agent Roster & Line Classification

**Level:** L3 (Module) · **Domain:** [Agent Orchestration & Pipeline](../../domains/orchestration.md) · **id:** `agent-roster`

## What it is

Canonical record of every agent with L-tier, IIA Line, role, and trigger. Mirror of .claude/agents/ (which is gitignored).

## Lives in

- `docs/AGENT_ROSTER.md`
- `docs/governance/AGENT_TOPOLOGY.md`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — Every agent charter in .claude/agents/ has a roster row

```
audit: diff .claude/agents/*.md basenames vs AGENT_ROSTER.md rows
```

### AC-2 — Every roster row carries a Line: annotation

```
grep: no roster agent row missing Line:
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
