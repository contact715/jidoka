---
status: Active
version: 1.0.0
level: L2
type: domain
owner_role: platform
parents:
  - path: docs/CONSTITUTION.md
    version: 2.0.0
    relationship: implements
  - path: docs/AUTONOMOUS_PIPELINE.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Domain — Agent Orchestration & Pipeline

**Level:** L2 (Domain) · **Parent:** [docs/AUTONOMOUS_PIPELINE.md](../../AUTONOMOUS_PIPELINE.md) · **Constitution:** §7

## Purpose

How the agent roster is layered, governed (RACI/cross-line), and driven across a wave lifecycle. The spine that turns a request into ordered, accountable work.

## Module inventory (L3)

This domain owns 4 modules. Each has its own L3 spec with acceptance criteria tied to an executable check.

| Module | Label | Primary file | Spec |
|---|---|---|---|
| `agent-roster` | Agent Roster & Line Classification | `docs/AGENT_ROSTER.md` | [L3 spec](../modules/orchestration/agent-roster.md) |
| `raci-governance` | RACI/DACI Governance Matrix | `docs/governance/raci.json` | [L3 spec](../modules/orchestration/raci-governance.md) |
| `cross-line-dispatch-guard` | Cross-Line Dispatch Guard | `scripts/check-cross-line-dispatch.mjs` | [L3 spec](../modules/orchestration/cross-line-dispatch-guard.md) |
| `wave-lifecycle` | Wave Lifecycle & Run State | `scripts/run-state.mjs` | [L3 spec](../modules/orchestration/wave-lifecycle.md) |

## Boundary

Modules in this domain MUST declare this file as a parent (`docs/specs/domains/orchestration.md`). A module spec without a parent link is flagged ORPHAN by `regenerate-coverage-report.mjs`. New modules require an L3 spec and a row in the table above in the same wave.
