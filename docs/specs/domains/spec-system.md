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
  - path: docs/HIERARCHICAL_SPEC_SYSTEM.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Domain — Hierarchical Spec System

**Level:** L2 (Domain) · **Parent:** [docs/HIERARCHICAL_SPEC_SYSTEM.md](../../HIERARCHICAL_SPEC_SYSTEM.md) · **Constitution:** §7

## Purpose

The machinery of the five-level spec tree itself: lineage, cascade validation, drift detection, size gating, ancestry lookup, and coverage measurement.

## Module inventory (L3)

This domain owns 9 modules. Each has its own L3 spec with acceptance criteria tied to an executable check.

| Module | Label | Primary file | Spec |
|---|---|---|---|
| `lineage-graph-builder` | Lineage Graph Builder | `scripts/build-lineage-graph.mjs` | [L3 spec](../modules/spec-system/lineage-graph-builder.md) |
| `cascade-validate` | Cascade Compatibility Validator | `scripts/cascade-validate.mjs` | [L3 spec](../modules/spec-system/cascade-validate.md) |
| `cascade-regenerate` | Cascade Version Propagator | `scripts/cascade-regenerate.mjs` | [L3 spec](../modules/spec-system/cascade-regenerate.md) |
| `spec-drift-checker` | Spec-vs-File Drift Checker | `scripts/spec-drift-check.mjs` | [L3 spec](../modules/spec-system/spec-drift-checker.md) |
| `spec-size-check` | Spec Size Pre-Build Gate | `scripts/spec-size-check.mjs` | [L3 spec](../modules/spec-system/spec-size-check.md) |
| `get-spec-context` | Spec Context & Ancestry Lookup | `scripts/get-spec-context.mjs` | [L3 spec](../modules/spec-system/get-spec-context.md) |
| `ac-coverage-mapper` | AC-to-Test Coverage Mapper | `scripts/map-ac-coverage.mjs` | [L3 spec](../modules/spec-system/ac-coverage-mapper.md) |
| `spec-index-generator` | Spec Index Generator | `scripts/regenerate-specs-index.mjs` | [L3 spec](../modules/spec-system/spec-index-generator.md) |
| `coverage-reporter` | Spec Coverage Report Generator | `scripts/regenerate-coverage-report.mjs` | [L3 spec](../modules/spec-system/coverage-reporter.md) |

## Boundary

Modules in this domain MUST declare this file as a parent (`docs/specs/domains/spec-system.md`). A module spec without a parent link is flagged ORPHAN by `regenerate-coverage-report.mjs`. New modules require an L3 spec and a row in the table above in the same wave.
