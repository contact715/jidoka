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
  - path: docs/SELF_IMPROVEMENT_PROTOCOL.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Domain — Meta-Engine & Self-Improvement

**Level:** L2 (Domain) · **Parent:** [docs/SELF_IMPROVEMENT_PROTOCOL.md](../../SELF_IMPROVEMENT_PROTOCOL.md) · **Constitution:** §7

## Purpose

Kaizen of the dev system: a mistake ledger, a recurrence auditor that turns repeats into mandatory gates, prompt evolution for the agents, and a red team that hardens the whole.

## Module inventory (L3)

This domain owns 5 modules. Each has its own L3 spec with acceptance criteria tied to an executable check.

| Module | Label | Primary file | Spec |
|---|---|---|---|
| `meta-mistake-ledger` | Meta-Mistake Ledger & Primitives | `scripts/meta-lib.mjs` | [L3 spec](../modules/meta-engine/meta-mistake-ledger.md) |
| `meta-audit-engine` | Meta-Audit Recurrence Detector | `scripts/meta-audit.mjs` | [L3 spec](../modules/meta-engine/meta-audit-engine.md) |
| `meta-gate-registry` | Meta-Gate Registry (Remedies) | `scripts/meta-remedies.mjs` | [L3 spec](../modules/meta-engine/meta-gate-registry.md) |
| `prompt-evolution-system` | Prompt Evolution System | `scripts/prompt-evolution.mjs` | [L3 spec](../modules/meta-engine/prompt-evolution-system.md) |
| `red-team` | Red Team (Adversarial Tester) | `scripts/red-team.mjs` | [L3 spec](../modules/meta-engine/red-team.md) |

## Boundary

Modules in this domain MUST declare this file as a parent (`docs/specs/domains/meta-engine.md`). A module spec without a parent link is flagged ORPHAN by `regenerate-coverage-report.mjs`. New modules require an L3 spec and a row in the table above in the same wave.
