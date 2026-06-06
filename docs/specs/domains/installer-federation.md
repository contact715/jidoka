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
  - path: docs/specs/wave-federation_MASTER_SPEC.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Domain — Installer & Federation

**Level:** L2 (Domain) · **Parent:** [docs/specs/wave-federation_MASTER_SPEC.md](../../specs/wave-federation_MASTER_SPEC.md) · **Constitution:** §7

## Purpose

How the framework gets into a project, stays in sync, proves it is wired to something live, and federates with a per-project steward instead of silently overwriting.

## Module inventory (L3)

This domain owns 5 modules. Each has its own L3 spec with acceptance criteria tied to an executable check.

| Module | Label | Primary file | Spec |
|---|---|---|---|
| `project-installer` | Per-Project Engine Installer | `scripts/install-into.mjs` | [L3 spec](../modules/installer-federation/project-installer.md) |
| `footprint-audit` | Dead-Install Detector | `scripts/footprint-audit.mjs` | [L3 spec](../modules/installer-federation/footprint-audit.md) |
| `instantiation-audit` | Ghost Automation Detector | `scripts/instantiation-audit.mjs` | [L3 spec](../modules/installer-federation/instantiation-audit.md) |
| `global-snapshot` | Global Setup Version Capturer | `scripts/snapshot-global.mjs` | [L3 spec](../modules/installer-federation/global-snapshot.md) |
| `project-federation` | Project Steward & Integrity Charter | `docs/specs/wave-federation_MASTER_SPEC.md` | [L3 spec](../modules/installer-federation/project-federation.md) |

## Boundary

Modules in this domain MUST declare this file as a parent (`docs/specs/domains/installer-federation.md`). A module spec without a parent link is flagged ORPHAN by `regenerate-coverage-report.mjs`. New modules require an L3 spec and a row in the table above in the same wave.
