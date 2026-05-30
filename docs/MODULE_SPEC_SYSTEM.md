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

# Module Spec System

> Wave-108 foundation. This document explains what module specs are, how to author them, and how the tooling around them works.

---

## 1. Why module specs

The this project agent layer has 24 named agents, 9 canonical funnels, ~20 primary UI surfaces, and 6 cross-cutting infrastructure modules. Before wave-108, that knowledge was scattered across four constitutional docs:

- `AGENT_LAYER_ARCHITECTURE.md` — agents at a high level, no per-agent contract
- `FUNNEL_REGISTRY.md` — funnel stages, no per-funnel scope or role projection
- `PRODUCT_PHILOSOPHY.md` — 6 end-to-end scenarios, not structured for dispatch
- `ROLE_PERMISSION_MATRIX.md` — role permissions, not linked to specific modules

When a Chief Architect needs to dispatch a sub-task for the Frontliner or the Lead Qualification funnel, they currently read two to four docs and extract the relevant context manually. This creates briefing inconsistency — different dispatches extract different details — and slows down the Chief Architect's synthesis step.

Module specs solve this with a single-file contract per module. One file per agent, per funnel, per primary surface, per infrastructure module. Each file answers the same questions in the same order: what does this module do, what does it receive, what does it emit, how do the five roles interact with it, what backend endpoints does it drive, and what waves have touched it.

The DRY benefit: wave authors update `linked_waves` in the module spec when they ship a change. Dispatchers read the spec instead of scanning git log. Constitutional docs stay at the "why" level; module specs hold the "what and how".

---

## 2. Granularity guidance

A module spec covers exactly one bounded concern. The right level of granularity:

**Yes — a module spec:**
- An agent (Frontliner, Dispatcher Agent, KB Curator)
- A canonical funnel (Lead Qualification, Installation, HR/Onboarding)
- A primary UI surface (Inbox, Pipeline, Briefing, Calendar)
- A cross-cutting infrastructure concern (Approval Engine, Audit Log, Knowledge Base)

**No — too fine-grained:**
- An individual file (`conversationsStore.ts`)
- A sub-component (`ProposalCard.tsx`)
- A utility function (`formatLeadAddress()`)
- A hook that serves one component (`useInboxUnread`)

**No — too broad:**
- "The agent layer" (that is `AGENT_LAYER_ARCHITECTURE.md`)
- "All funnels" (that is `FUNNEL_REGISTRY.md`)
- "The dashboard" (that is `PRODUCT_NAVIGATION_AUDIT.md`)

The test: can a Chief Architect dispatch a wave task using only this spec file plus the template? If the spec is too fine, the answer is trivially yes for a trivial task. If the spec is too broad, the answer is no — there is too much to choose from.

---

## 3. Template walkthrough

The template lives at `docs/specs/modules/_MODULE_TEMPLATE.md`. Key fields:

**Frontmatter:**

| Field | Purpose |
|---|---|
| `status` | Draft → Reviewed → Approved → Implemented → Shipped → Retired |
| `version` | Semantic version. Increment minor for additions, major for breaking contract changes |
| `level` | Always `L3`. L1 = constitutional docs. L2 = domain layer (planned, wave-119) |
| `module_type` | `agent`, `funnel`, `surface`, or `infrastructure` |
| `owner_role` | The role that approves changes to this module spec |
| `parents` | Array of parent documents (path + version + relationship). Required for wave-117 cascade validation |
| `children` | List of downstream module specs that depend on this one |
| `breaking_change_in_v` | Version where a breaking contract change landed (blank until it happens) |
| `code_references` | List of real file paths that implement this module. At least one required |
| `linked_waves` | Changelog. One entry per wave that modifies the module |

**The 9 sections:**

1. **Vision** — 300-500 words. What does this module exist to do? Be concrete, name roles and funnels.
2. **Scope** — In scope / Out of scope. Cross-reference what owns the excluded concerns.
3. **Contracts** — Inputs from parents (source, format, required) and outputs to children (consumer, format, trigger).
4. **Behaviors** — Minimum 3 EARS statements + 1 Gherkin scenario. EARS format: "When X, the system shall Y."
5. **Data model** — TypeScript types referenced, Zustand store slice, events emitted.
6. **Role projection** — One bullet per role. State "No direct interaction" if a role does not touch this module.
7. **API contract** — Backend endpoint list. If none, write "N/A — frontend-only module".
8. **Open questions** — Numbered, each with an owner and expected resolution wave.
9. **Linked waves** — Changelog. Most recent first. Format: `wave-NN: <one-line summary>`.

---

## 4. Backfill priorities

The 49-module backfill runs across four waves:

| Wave | Category | Count | Reason for priority |
|---|---|---|---|
| wave-110 | Agents | 23 | Agents are the primary dispatch surface; every new sub-task needs an agent spec |
| wave-111 | Infrastructure | 5 | Infrastructure modules are depended on by all agents and funnels; cross-cutting specs unblock everything |
| wave-112 | Funnels | 8 | Funnel specs enable accurate stage-level dispatch and approval-rule documentation |
| wave-113 + wave-114 | Surfaces | 19 | Surfaces are farthest from the dispatch loop; can backfill after agents/infra/funnels |

Wave-108 seeds one spec per category (4 total, 8% coverage). Backfill brings coverage to 100%.

**Expected module counts per category:**

- Agents: 24 total (14 executor + 7 meta + 3 sub). See `docs/specs/modules/agents/README.md`.
- Funnels: 9 canonical. See `docs/specs/modules/funnels/README.md`.
- Surfaces: 20 primary surfaces listed, 10 in tracked denominator subset. See `docs/specs/modules/surfaces/README.md`.
- Infrastructure: 6 cross-cutting modules. See `docs/specs/modules/infrastructure/README.md`.

---

## 5. Anti-patterns

**Anti-pattern A: per-file specs.**
Module specs cover the module, not individual implementation files. A module spec for the Frontliner agent links to `agentsStore.ts` in `code_references` — it does not replace the TypeScript type definitions in that file. Never write a module spec for a single component, hook, or store slice.

**Anti-pattern B: static documents.**
Module specs are living documents. Every wave that modifies a module must add an entry to `linked_waves` in the frontmatter and to `## 9. Linked waves` in the body. A spec whose `last_updated` field is more than five waves old is stale and should be flagged in the retro. The pre-commit hook (wave-108) auto-stages `_MODULE_INDEX.md` updates, but you must manually update `last_updated` in the spec frontmatter when you modify a module.

**Anti-pattern C: TypeScript replacement.**
Module specs reference TypeScript types — they do not replace them. The `Data model` section (§5) lists the type names and file paths; the actual type definitions stay in `.ts` files. If a module spec and a TypeScript type contradict each other, the TypeScript type is the runtime source of truth.

---

## 6. Running the index

After authoring or modifying a module spec, regenerate the index:

```sh
node scripts/regenerate-modules-index.mjs
```

The pre-commit hook runs this automatically when any `docs/specs/modules/**/*.md` file is staged. To preview without writing:

```sh
node scripts/regenerate-modules-index.mjs --dry
```

The index output lives at `docs/specs/modules/_MODULE_INDEX.md`. Do not edit it manually — it is overwritten on every run.

The coverage report also picks up module spec counts automatically:

```sh
node scripts/regenerate-coverage-report.mjs --dry
# Output includes: L3 modules: X / 49 covered (Z%)
```
