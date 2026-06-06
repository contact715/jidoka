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
  - path: docs/DASHBOARD_SPEC.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Domain — Dashboard & Observability

**Level:** L2 (Domain) · **Parent:** [docs/DASHBOARD_SPEC.md](../../DASHBOARD_SPEC.md) · **Constitution:** §7

## Purpose

Making the line visible: a multi-project dashboard plus FinOps/DORA metric computers that turn the audit streams into trends a human can read.

## Module inventory (L3)

This domain owns 4 modules. Each has its own L3 spec with acceptance criteria tied to an executable check.

| Module | Label | Primary file | Spec |
|---|---|---|---|
| `dashboard-collectors` | Dashboard Data Layer | `scripts/dashboard/collectors.mjs` | [L3 spec](../modules/observability/dashboard-collectors.md) |
| `gdoc-export` | Snapshot Exporter (Markdown + HTML) | `scripts/dashboard/gdoc-export.mjs` | [L3 spec](../modules/observability/gdoc-export.md) |
| `compute-dora` | DORA Delivery Metrics | `scripts/compute-dora.mjs` | [L3 spec](../modules/observability/compute-dora.md) |
| `compute-cost` | FinOps Agent Cost | `scripts/compute-cost.mjs` | [L3 spec](../modules/observability/compute-cost.md) |

## Boundary

Modules in this domain MUST declare this file as a parent (`docs/specs/domains/observability.md`). A module spec without a parent link is flagged ORPHAN by `regenerate-coverage-report.mjs`. New modules require an L3 spec and a row in the table above in the same wave.
