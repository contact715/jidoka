---
status: Active
version: 1.0.0
level: L1
type: core-arch
owner_role: platform
parents:
  - path: docs/MISSION.md
    version: 1.0.0
    relationship: implements
  - path: docs/PRODUCT_PHILOSOPHY.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-05-27
last_validated_against_parents: 2026-05-27
last_updated: 2026-05-27
---

# Hierarchical Spec System — this project

**Status**: Active
**Introduced**: wave-117
**Related**: `docs/MODULE_SPEC_SYSTEM.md`, `docs/CODING_STANDARDS.md §Hierarchical spec assignment`

---

## 1. Five-level pyramid

```
        ┌─────────────────┐
        │       L0        │   Constitution (1 doc)
        │   MISSION.md    │   Owner signs off on every MAJOR change
        └────────┬────────┘
                 │ implements
        ┌────────▼────────┐
        │       L1        │   Core Architecture (2-5 docs)
        │ AGENT_PLAYBOOK  │   Platform team. Patterns all L2-L4 inherit.
        │ FRONTEND_ARCH   │
        └────────┬────────┘
                 │ refines
     ┌───────────▼───────────┐
     │          L2           │   Domain Specs (docs/specs/domains/)
     │  [voice-domain].md    │   One per product vertical or system boundary.
     │  [billing-domain].md  │   Lead-tech owner. Defines L3 inventory.
     └───────────┬───────────┘
                 │ implements
    ┌────────────▼────────────┐
    │           L3            │   Module Specs (docs/specs/modules/)
    │  [frontliner].md        │   One per agent, funnel, surface, or infra.
    │  [lead-qual-funnel].md  │   Tech owner. Acceptance criteria per module.
    └────────────┬────────────┘
                 │ implements
┌───────────────▼─────────────────┐
│               L4                │   Wave Specs (docs/specs/wave-NN_MASTER_SPEC.md)
│  wave-117_MASTER_SPEC.md        │   One per sprint-level unit of work.
│  wave-108_MASTER_SPEC.md        │   Dispatcher owner. Transient — archives after ship.
└─────────────────────────────────┘
```

---

## 2. Per-level purpose

| Level | Name | Example docs | Owner role | Scope |
|---|---|---|---|---|
| L0 | Constitution | `docs/MISSION.md` | owner | Non-negotiable principles, mission, role definitions. Never changes without MAJOR bump and owner approval. |
| L1 | Core Architecture | `docs/FRONTEND_ARCHITECTURE.md`, `docs/.claude/AGENT_PLAYBOOK.md` | platform | System structure, patterns, extension points. Changes trigger cascade-validate across all L2-L4. |
| L2 | Domains | `docs/specs/domains/voice-domain.md` (pending) | lead-tech | Product vertical or system boundary. Owns the inventory of L3 modules. L2 is sparse until wave-118 backfill. |
| L3 | Modules | `docs/specs/modules/agents/frontliner.md` | tech | Single agent, funnel, surface, or infra unit. Has full AC suite. Linked waves section tracks history. |
| L4 | Waves | `docs/specs/wave-117_MASTER_SPEC.md` | dispatcher | Sprint-level work unit. References L3 modules it modifies. Transient — retro written at ship. |

---

## 3. Cascade mechanism

When an L0 or L1 document changes, every child spec that declares a `parents[].path` pointing at it may be affected. The cascade pipeline has two scripts:

### cascade-validate — detect drift

```sh
# Check all specs that depend on MISSION.md
node scripts/cascade-validate.mjs --root docs/MISSION.md --level L0

# Output: verdict table per child spec
# COMPATIBLE  — parent version bumped by patch only
# INCOMPATIBLE — parent version bumped by MAJOR → exit 1
# AMBIGUOUS   — parent MINOR bump OR keyword-signature mismatch → stderr warning
```

The pre-commit hook runs this automatically when `docs/MISSION.md` or `docs/CONSTITUTION.md` is staged. With `cascade_hard_block: false` (default), an INCOMPATIBLE result prints a warning but does not block the commit. Set `cascade_hard_block: true` in `.sdd-config.json` to enable hard enforcement.

### cascade-regenerate — propagate non-breaking changes

```sh
# After bumping MISSION.md from version 1.0.0 → 1.0.1 (patch):
node scripts/cascade-regenerate.mjs --root docs/MISSION.md

# Updates parents[].version and last_validated_against_parents in all
# direct child spec files. Appends to docs/cascade-log.md.
# Does NOT run if breaking_change_in_v is set on the root spec.
```

Use `--dry` on both scripts to preview without writing.

### build-lineage-graph — visualise the graph

```sh
node scripts/build-lineage-graph.mjs
# Writes docs/specs/_LINEAGE.md — Mermaid graph TD diagram.
# Flags orphan specs (no in/out edges) and specs missing level/version.
```

### get-spec-context — AI agent ancestry discovery

```sh
# Before dispatching wave work, the orchestrator calls:
node scripts/get-spec-context.mjs --feature voice
# Prints full L4→L0 ancestry chain for the matched spec.
# Use --format json for structured output.
```

---

## 4. Industry references

### OMG MDA — four-level metamodel (M0-M3)

The Object Management Group's Model Driven Architecture defines M0 (runtime instances), M1 (models), M2 (metamodels), and M3 (meta-metamodel / MOF). The L0-L4 hierarchy is the direct intellectual descendant: L0 plays the role of M3 (the unchangeable foundation), L4 plays M0 (the concrete instance). OMG MDA identified in the 1990s that architecture erosion in large enterprise systems traces to local-level documents updated without checking metamodel consistency — precisely the problem cascade-validate closes.

### TLA+ refinement mapping — COMPATIBLE / INCOMPATIBLE / AMBIGUOUS vocabulary

Leslie Lamport's TLA+ refinement vocabulary defines "COMPATIBLE" as a relationship where a lower-level specification implements a higher-level one without violating its invariants. Wave-117 borrows this three-state vocabulary: COMPATIBLE (patch diff — no behavioral change), INCOMPATIBLE (MAJOR bump — behavioral contract broken), AMBIGUOUS (MINOR bump or keyword-signature failure — human review required). This is more precise than a binary "changed / unchanged" check.

### Kubernetes CRD webhook validation — soft-to-enforce graduation

Kubernetes custom resource definitions ship admission webhooks in warn mode first, then graduate to enforcing mode after operator confidence builds. Wave-117 adopts the same pattern: `cascade_hard_block: false` is the default (30-day soft trial), with explicit opt-in to `cascade_hard_block: true` once compliance exceeds 80%. This prevents early false positives from blocking legitimate work.

### OpenAPI $ref composition — version tracking closes silent breaking changes

OpenAPI and GraphQL Federation both demonstrate that schema inheritance without explicit version tracking causes silent breaking changes at runtime. The `parents[].version` field in the YAML frontmatter closes exactly this gap: every child spec records the exact version of each parent it was written against. cascade-validate compares this recorded version against the parent's current version to detect drift.

### AWS CDK construct hierarchy — orphan detection as CI concern

AWS CDK's construct hierarchy (App > Stack > Construct) shows that orphan detection — nodes with no parent or no children — is a first-class CI concern, not an afterthought. build-lineage-graph.mjs flags orphan specs explicitly to surface specs that are neither constitutional documents (L0/L1, intentionally parentless) nor properly wired into the hierarchy.

---

## 5. RFC gate

An RFC (Request for Comment) is required before an L0 or L1 spec change is accepted. The RFC is not a separate file or directory — it is an ADR at `**Status:** Proposed` with a time-bounded `**Comment period:**` bold-field.

### Trigger threshold

An RFC comment period is required when:

1. `cascade-validate.mjs` returns INCOMPATIBLE or AMBIGUOUS for the proposed change, OR
2. The change edits an L0 document directly (any file at `level: L0` in its YAML frontmatter).

L1 patch edits that produce a COMPATIBLE cascade-validate result may proceed to an Accepted ADR without a comment period.

### Comment period

- Duration: 48 hours from the start date in `**Comment period:**` (hard expiry).
- No blocking objection within 48 hours = implicit accept.
- Comments go in the `## Stakeholder comments` section of the ADR file.
- Named commenters: Chief Architect (mandatory) + owning Domain Director or owner role for L0 edits (mandatory).

### Enforcement model

Wave-157 Atlantis PR-approval model: propose, document, never auto-mutate. The RFC gate is a policy enforced by the Spec Reviewer at spec-review time, not an automated commit blocker. `cascade-validate.mjs` already runs on pre-commit and surfaces INCOMPATIBLE/AMBIGUOUS verdicts. Adding a hard-block script is deferred pending soft-model compliance data.

See `docs/decisions/README.md` §RFC gate for the full policy, named-commenter rules, and `rfc_ref` linkage requirements.

### RFC index

In-flight RFCs are listed in `docs/decisions/_RFC_INDEX.md`. Regenerate with `npm run rfc:regen`.

---

## 6. Anti-patterns

### Anti-pattern 1: Editing a child spec without updating `last_validated_against_parents`

When you edit an L3 module spec because an L1 architectural document changed, always update `last_validated_against_parents` to today's date. Without this update, cascade-validate cannot distinguish "this spec was reviewed after the parent change" from "this spec was never checked." Run `node scripts/cascade-regenerate.mjs --root <parent>` to propagate the date automatically for non-breaking changes.

### Anti-pattern 2: Assigning `level: L2` with no `parents` block (orphan L2)

A domain spec with `level: L2` but no `parents[].path` declaration is an orphan — it exists outside the hierarchy and cannot be validated. build-lineage-graph.mjs and _COVERAGE.md will flag it. Every L2 spec must declare at least one L1 parent with `relationship: refines`. Orphan L2/L3 specs indicate that the hierarchy hasn't been wired up, which defeats the purpose of cascade-validate.

### Anti-pattern 3: Using `breaking_change_in_v` for patch changes

The `breaking_change_in_v` field signals to cascade-regenerate that auto-propagation is unsafe — a human must manually review every child before updating. Setting it for a patch change (spelling fix, added paragraph) forces unnecessary manual work and trains teams to ignore the field. Reserve `breaking_change_in_v` for MAJOR semantic changes: renaming a canonical role, removing a mandatory funnel stage, deprecating a protocol.

---

## 7. Migration guide for existing specs

All existing `wave-NN_MASTER_SPEC.md` files are implicitly L4 but lack YAML frontmatter. The backfill is a three-step process (scheduled for wave-118):

**Step 1** — Add the YAML block above the existing bold-field frontmatter.

Copy the L4 template from `docs/specs/_LEVEL_TEMPLATES/L4_TEMPLATE.md`. Insert it at the very top of the file, before the `# Wave-NN Master Spec` heading:

```yaml
---
level: L4
type: wave
version: 1.0.0
owner_role: dispatcher
parents:
  - path: docs/FRONTEND_ARCHITECTURE.md
    version: 1.0.0
    relationship: implements
breaking_change_in_v: null
created: YYYY-MM-DD
last_validated_against_parents: YYYY-MM-DD
last_updated: YYYY-MM-DD
---
```

The existing `**Status**:`, `**Effort**:`, `**depends_on**:` bold fields remain valid — the two-pass parser reads YAML first and falls back to bold fields for fields not in the YAML block.

**Step 2** — Assign `level: L4` and choose the correct parent.

For most wave specs: parent is `docs/FRONTEND_ARCHITECTURE.md` with `relationship: implements`. If the wave also references `docs/MISSION.md` directly, add a second parents entry with `relationship: references`.

**Step 3** — Run the scripts.

```sh
node scripts/regenerate-specs-index.mjs  # _INDEX.md gets Level column populated
node scripts/build-lineage-graph.mjs     # _LINEAGE.md shows edges instead of orphans
```

No change to existing wave spec body content is required. The YAML block is additive.

---

## 8. Config reference

`.sdd-config.json` controls cascade enforcement alongside the existing `hard_block_ac` field:

| Field | Default | Effect |
|---|---|---|
| `cascade_hard_block` | `false` | When `true`: pre-commit hook exits 1 on INCOMPATIBLE child specs for L0 edits |
| `hard_block_ac` | `false` | Existing wave-95 field — AC reference enforcement |

Activate hard cascade enforcement after 30-day soft trial:

```sh
# Edit .sdd-config.json:
{ "cascade_hard_block": true }
```

---

## 9. Evolution log

| Wave | Date | Change |
|---|---|---|
| wave-117 | 2026-05-27 | Initial system — 5-level pyramid, cascade scripts, level templates, HIERARCHICAL_SPEC_SYSTEM.md |
| wave-118 | 2026-05-27 | L0/L1 metadata backfill — 3 L0 docs + 9 L1 docs receive YAML frontmatter; cascade-validate graph operational |
| wave-119 | 2026-05-27 | L2 domain layer — 7 bounded contexts introduced: customer-management, agent-orchestration, billing-revops, voice-stack, knowledge-base, funnel-engine, quality-engineering; lineage graph grows to 19 nodes (3 L0 + 9 L1 + 7 L2) |
| wave-160 | 2026-05-28 | L1_TEMPLATE.md bumped to v1.1.0 (ARC42 §10 Quality Requirements + §11 Risks added); L4_TEMPLATE.md bumped to v1.1.0 (§8 risk table standardized to 5-column format); docs/quality/ directory created with ISO 25010:2023 scorecard, QAS template, and quality register; ADR index auto-gen script added; phase-dor.md extended with L0 ADR citation item + 2 L1 architecture quality items |
| wave-167 | 2026-05-28 | RFC gate added as §5 — trigger threshold (cascade INCOMPATIBLE/AMBIGUOUS or L0 edit), 48-hour comment period, Atlantis enforcement model (propose, never auto-mutate). ADR template gains Comment period + rfc_ref fields + Stakeholder comments section. Decision genealogy traces table introduced at docs/rfcs/genealogy-traces.md. 14th telemetry stream (rfc-events.jsonl) added. |
