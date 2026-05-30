---
status: Active
version: 1.0.0
level: L1
type: governance
owner_role: platform
wave: wave-179
created: 2026-05-28
machine_readable_twin: docs/quality/glossary-registry.json
validator: scripts/validate-glossary.mjs
---

# Ubiquitous Language — Domain Glossary

This is the human-readable companion to `docs/quality/glossary-registry.json`. It defines the canonical terms for both this project product domain and this project dev-governance system, marks the known conflicts explicitly, and references authoritative source documents via anchor links.

**What this is not.** This is not a tone guide (that is [docs/VOICE_GUIDE.md](../VOICE_GUIDE.md)), not a stage-taxonomy document (that is [docs/FUNNEL_REGISTRY.md](../FUNNEL_REGISTRY.md)), and not a role-permission reference (that is [docs/ROLE_PERMISSION_MATRIX.md](../ROLE_PERMISSION_MATRIX.md)). This glossary references those documents via anchors for the terms they own; it does not reproduce their rows.

**Synonym authority for roles.** The deprecated synonyms for role terms (technician, dispatcher, owner/admin) are subsets of `normalizeRole()` in `lib/types/roles.ts:54-64`. That function is the canonical alias map. The glossary does not define a parallel map.

**Validator.** Run `node scripts/validate-glossary.mjs` (or `npm run glossary:validate`) to check the eight bounded target docs for deprecated-synonym usage. The validator is context-aware: it does not flag 'agent' in dev-system docs like `AGENT_PLAYBOOK.md`.

---

## Known conflicts

Six real term conflicts exist in the corpus today. They are documented here and marked `lifecycle: Conflicted` in the registry. The validator surfaces them as `CONFLICT-OPEN` on every run (exit 0). Resolution requires a Chief Architect + Director decision in a future wave.

1. **"agent" — dual-context overload.** In the product domain, "agent" means a per-role AI assistant driving a funnel stage (Frontliner, Dispatcher-agent, Summarizer, HR Agent). In the dev-system domain, "agent" means a named dev-process automation entity (frontend-agent, Reflexion Critic, constitutional-reviewer). 1655+ occurrences across both contexts with no disambiguation marker. No rename is planned in v1 — the conflict is documented and monitored.

2. **"dispatcher" — human role vs AI agent.** [docs/ROLE_PERMISSION_MATRIX.md#five-roles](../ROLE_PERMISSION_MATRIX.md#five-roles) names the human product user role "Dispatcher". The product philosophy also names a universal AI agent "Dispatcher." Same string for a human and an AI within the product bounded context.

3. **"technician" vs "tech" — short-form alias.** [docs/MISSION.md#who-buys](../MISSION.md#who-buys) uses "technician / service-tech / installer" interchangeably. [docs/ROLE_PERMISSION_MATRIX.md#five-roles](../ROLE_PERMISSION_MATRIX.md#five-roles) uses "Tech" as the canonical short form. No declared canonical winner across docs. `normalizeRole()` normalizes both to the `technician` RoleKey internally.

4. **"operator" — informal alias without canonical status.** "Operator" appears in some internal docs and product copy as an informal label for a product end-user (often the dispatcher). It is not in the five canonical roles, not a `RoleKey` in `lib/types/roles.ts`, and not in `ROLE_PERMISSION_MATRIX.md`. Canonical replacement: "dispatcher."

5. **"wave" — work unit vs telemetry field.** In the dev-system, "wave" means a sprint-level unit of work (e.g. wave-179). The same string is also the name of the `wave` envelope field in every telemetry event ([docs/specs/telemetry-schema-v1.md#canonical-envelope-fields](../specs/telemetry-schema-v1.md#canonical-envelope-fields)). Two distinct uses sharing one string.

6. **Autonomy-mode vocabulary — residual conflict.** The canonical `AutonomyMode = "shadow"|"suggest"|"autonomous"|"off"` is defined at `lib/types/agentPolicy.ts:22`. `AgentWorkspaceHeaderV2.tsx` already uses this canonical form (lines 25-39, via the `MODES` array). The legacy 3-state (`automatic/semi-automatic/manual`) is marked deleted at `agentPolicy.ts:8`. Two residual conflicts remain: (a) `docs/FRONTEND_GAPS_VS_AGENT_LAYER.md:91-104` still cites stale vocabulary; (b) the migration comment at `agentPolicy.ts:10` references a `Deal.aiMode: "auto"|"semi"|"semi-auto"|"manual"` per-deal duplicate that has since been migrated out of `lib/types/pipeline.ts`. Flagged at `docs/FRONTEND_GAPS_VS_AGENT_LAYER.md:91-104`. Resolution: update the stale doc and remove the obsolete migration comment in a dedicated cleanup wave.

---

## Product domain terms

These terms apply in product-context documents: MISSION.md, FUNNEL_REGISTRY.md, VOICE_GUIDE.md, ROLE_PERMISSION_MATRIX.md.

For jargon retire-lists and per-role tone guidance, see [docs/VOICE_GUIDE.md#jargon-table](../VOICE_GUIDE.md#jargon-table) and [docs/VOICE_GUIDE.md#per-role-voice-personas](../VOICE_GUIDE.md#per-role-voice-personas).

For funnel stage taxonomy, see [docs/FUNNEL_REGISTRY.md#six-standard-funnels](../FUNNEL_REGISTRY.md#six-standard-funnels).

### Five canonical product roles

Source: [docs/MISSION.md#who-buys](../MISSION.md#who-buys) and [docs/ROLE_PERMISSION_MATRIX.md#five-roles](../ROLE_PERMISSION_MATRIX.md#five-roles).

| Canonical form | Deprecated synonyms | Notes |
|---|---|---|
| owner | root, admin | Top-level user. Sees everything. RoleKey `admin` internally. Synonyms from `normalizeRole()` line 57. |
| dispatcher | router | Routes jobs, handles schedule. Synonym `router` from `normalizeRole()` line 59. CONFLICTED with Dispatcher AI agent — see Known conflicts #2. |
| technician | tech, field | Field worker. Short form `tech` widely used but CONFLICTED — see Known conflicts #3. Synonyms from `normalizeRole()` line 60. `service-tech` and `installer` appear in MISSION.md prose as natural-language expansions but are NOT in `normalizeRole()` and are not enforced deprecated synonyms. |
| lead-tech | lead technician, supervisor | Quality-checks dispatch and tech work. |
| office | office manager, billing | Invoices, payments, collections. |

**Role synonym authority**: `lib/types/roles.ts:54-64` `normalizeRole()`. The deprecated synonyms above are subsets of that function's input cases.

### Product entities

| Canonical form | Deprecated synonyms | Source anchor |
|---|---|---|
| lead | (none canonical) | [MISSION.md#ai-funnels--the-structural-unit-of-work](../MISSION.md#ai-funnels--the-structural-unit-of-work) |
| job | work order, ticket | [MISSION.md#ai-funnels--the-structural-unit-of-work](../MISSION.md#ai-funnels--the-structural-unit-of-work) |
| estimate | quote, proposal | [FUNNEL_REGISTRY.md#6-estimate](../FUNNEL_REGISTRY.md#6-estimate) |
| invoice | bill, receipt | [ROLE_PERMISSION_MATRIX.md#matrix--entities--roles--actions](../ROLE_PERMISSION_MATRIX.md#matrix--entities--roles--actions) |
| funnel | pipeline, workflow | [MISSION.md#ai-funnels--the-structural-unit-of-work](../MISSION.md#ai-funnels--the-structural-unit-of-work) |
| stage | step, phase | [FUNNEL_REGISTRY.md#per-stage-contract-schema](../FUNNEL_REGISTRY.md#per-stage-contract-schema) |
| approval-rule | auto-approve rule, approval threshold | [FUNNEL_REGISTRY.md#per-stage-contract-schema](../FUNNEL_REGISTRY.md#per-stage-contract-schema) |

---

## Dev-system terms

These terms apply in dev-system-context documents: AGENT_PLAYBOOK.md, AGENT_ROSTER.md, HIERARCHICAL_SPEC_SYSTEM.md, telemetry-schema-v1.md.

| Canonical form | Definition (brief) | Deprecated synonyms | Source anchor |
|---|---|---|---|
| wave | A sprint-level unit of work in the dev-governance system. CONFLICTED with the `wave` telemetry field. | sprint, iteration | [HIERARCHICAL_SPEC_SYSTEM.md#1-five-level-pyramid](../HIERARCHICAL_SPEC_SYSTEM.md#1-five-level-pyramid) |
| halt | Pipeline stop requiring human review. Exit code 42. | stop, block, pause | [AGENT_ROSTER.md#five-cadences-of-self-maintenance-wave-41-architecture-promoted-wave-55e](../AGENT_ROSTER.md#five-cadences-of-self-maintenance-wave-41-architecture-promoted-wave-55e) |
| andon | The Andon Cord escalation pattern. Pulls halt on governance violation. | andon cord, andon halt | [AGENT_ROSTER.md#five-cadences-of-self-maintenance-wave-41-architecture-promoted-wave-55e](../AGENT_ROSTER.md#five-cadences-of-self-maintenance-wave-41-architecture-promoted-wave-55e) |
| lens | A named reading scope for an L0.7 Quad-Lens Architect (Micro, Macro, Cartographer, DSA). | perspective, view | [AGENT_ROSTER.md#l07--quad-lens-architects-parallel](../AGENT_ROSTER.md#l07--quad-lens-architects-parallel) |
| cadence | The frequency at which a self-maintenance activity runs. Five values defined. | frequency, schedule | [AGENT_ROSTER.md#five-cadences-of-self-maintenance-wave-41-architecture-promoted-wave-55e](../AGENT_ROSTER.md#five-cadences-of-self-maintenance-wave-41-architecture-promoted-wave-55e) |
| drift | Deviation of an implementation from its parent spec. Two sub-types: spec drift and design drift. | deviation, mismatch | [HIERARCHICAL_SPEC_SYSTEM.md#cascade-mechanism](../HIERARCHICAL_SPEC_SYSTEM.md#cascade-mechanism) |
| SLO | Service Level Objective — quality metric threshold. | service level, quality threshold | [telemetry-schema-v1.md#payload-fields--slo_evaluated-slo-eventsjsonl-9th-stream](../specs/telemetry-schema-v1.md#payload-fields--slo_evaluated-slo-eventsjsonl-9th-stream) |
| DORA | DevOps Research and Assessment — four standard delivery metrics. | (none) | [telemetry-schema-v1.md#canonical-event_type-values](../specs/telemetry-schema-v1.md#canonical-event_type-values) |
| reflexion | Post-implementation adversarial review pass by the Reflexion Critic. | reflection, post-mortem review | [AGENT_ROSTER.md#l095--post-implementation-review](../AGENT_ROSTER.md#l095--post-implementation-review) |
| gate | A quality checkpoint validator that must exit 0 before work proceeds. | checkpoint, guard, check | [AGENT_ROSTER.md#l096--quality-gates-wave-102](../AGENT_ROSTER.md#l096--quality-gates-wave-102) |
| registry | A machine-readable JSON file as authoritative typed collection. Shape: `{_schema, <collection>: []}`. | catalog, manifest | [AGENT_ROSTER.md#file-locations](../AGENT_ROSTER.md#file-locations) |
| autonomy-mode | AI agent operational mode. CONFLICTED across three naming systems — see Known conflicts #6. | automatic, semi-automatic, auto, shadow, suggest, autonomous | [AGENT_ROSTER.md#l0--orchestrator](../AGENT_ROSTER.md#l0--orchestrator) |

---

## Scope boundaries

This glossary defines term meanings and tracks synonym deprecation. It does not:

- Govern tone or register (see [docs/VOICE_GUIDE.md](../VOICE_GUIDE.md))
- Define funnel stage data models (see [docs/FUNNEL_REGISTRY.md](../FUNNEL_REGISTRY.md))
- Govern role permissions (see [docs/ROLE_PERMISSION_MATRIX.md](../ROLE_PERMISSION_MATRIX.md))
- Replace `normalizeRole()` as the role-alias authority (see `lib/types/roles.ts:54-64`)

Any term whose definition overlaps with a VOICE_GUIDE jargon row carries a `canonical_source_anchor` pointing to `docs/VOICE_GUIDE.md#jargon-table`. The row is not reproduced here.
