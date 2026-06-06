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
  - path: docs/MULTI_LEVEL_VERIFICATION.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Domain — Quality Gates & Verification

**Level:** L2 (Domain) · **Parent:** [docs/MULTI_LEVEL_VERIFICATION.md](../../MULTI_LEVEL_VERIFICATION.md) · **Constitution:** §7

## Purpose

The L0.95–L0.99 enforcement layer: gates that verify at the station and the andon primitive that stops the line. Jidoka pillar made executable.

## Module inventory (L3)

This domain owns 6 modules. Each has its own L3 spec with acceptance criteria tied to an executable check.

| Module | Label | Primary file | Spec |
|---|---|---|---|
| `verification-pipeline` | Four-Tier Verification Pipeline | `scripts/run-verification-pipeline.mjs` | [L3 spec](../modules/quality-gates/verification-pipeline.md) |
| `andon-halt-system` | Andon Halt State Machine | `scripts/andon-halt-helpers.mjs` | [L3 spec](../modules/quality-gates/andon-halt-system.md) |
| `coverage-gate` | Coverage Delta Gate | `scripts/coverage-delta.mjs` | [L3 spec](../modules/quality-gates/coverage-gate.md) |
| `bundle-perf-gate` | Bundle Size & Performance Gate | `scripts/bundle-size-check.mjs` | [L3 spec](../modules/quality-gates/bundle-perf-gate.md) |
| `meta-process-audit` | Anti-Pattern Recurrence Detector | `scripts/audit-meta-process.mjs` | [L3 spec](../modules/quality-gates/meta-process-audit.md) |
| `constitutional-drift-monitor` | Constitutional Drift Monitor | `scripts/detect-constitutional-drift.mjs` | [L3 spec](../modules/quality-gates/constitutional-drift-monitor.md) |

## Boundary

Modules in this domain MUST declare this file as a parent (`docs/specs/domains/quality-gates.md`). A module spec without a parent link is flagged ORPHAN by `regenerate-coverage-report.mjs`. New modules require an L3 spec and a row in the table above in the same wave.
