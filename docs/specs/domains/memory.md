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
  - path: docs/MEMORY_MERGE_PROTOCOL.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Domain — Memory & Knowledge

**Level:** L2 (Domain) · **Parent:** [docs/MEMORY_MERGE_PROTOCOL.md](../../MEMORY_MERGE_PROTOCOL.md) · **Constitution:** §7

## Purpose

How knowledge crosses sessions: the mistake ledger consolidated into a ranked digest, retros and specs staged for the knowledge graph, and the citation contract that keeps outputs grounded.

## Module inventory (L3)

This domain owns 5 modules. Each has its own L3 spec with acceptance criteria tied to an executable check.

| Module | Label | Primary file | Spec |
|---|---|---|---|
| `memory-consolidate` | Episodic-to-Semantic Digest | `scripts/memory-consolidate.mjs` | [L3 spec](../modules/memory/memory-consolidate.md) |
| `specs-to-memory-extractor` | Spec-to-Graph Staging Extractor | `scripts/sync-specs-to-memory.mjs` | [L3 spec](../modules/memory/specs-to-memory-extractor.md) |
| `retro-memory-extractor` | Retro-to-Graph Staging Extractor | `scripts/extract-retro-memory.mjs` | [L3 spec](../modules/memory/retro-memory-extractor.md) |
| `grounding-contract` | Agent Output Citation Contract | `docs/GROUNDING_CONTRACT.md` | [L3 spec](../modules/memory/grounding-contract.md) |
| `memory-merge-protocol` | Agent-Driven Graph Merge | `docs/MEMORY_MERGE_PROTOCOL.md` | [L3 spec](../modules/memory/memory-merge-protocol.md) |

## Boundary

Modules in this domain MUST declare this file as a parent (`docs/specs/domains/memory.md`). A module spec without a parent link is flagged ORPHAN by `regenerate-coverage-report.mjs`. New modules require an L3 spec and a row in the table above in the same wave.
