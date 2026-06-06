---
status: Active
version: 2.0.0
level: L0
type: constitution
owner_role: platform
parents:
  - path: docs/NORTH_STAR.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: 2.0.0
created: 2026-05-25
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Jidoka Framework Constitution

> The set of DURABLE choices that govern every wave of work on the framework itself. If something is in this file, it doesn't get re-decided per-spec.
>
> Specs link to ONE doc (this one) instead of nine. Lower cognitive load for Chief Architect synthesis.
>
> Adopted: wave-60 (as the product constitution). Re-grounded to the framework itself: v2.0.0, 2026-06-05 — see Applied amendments. The pre-2.0 product content lives in git history and `docs/archive/imported-product/`.

---

## What the Constitution IS

1. **A single canonical pointer**. Each section is a one-paragraph synopsis + a link to the full source doc.
2. **Versioned with the code**. Lives in the repo. Changes via PR with rationale.
3. **The thing Chief Architect cites instead of 9 separate docs.** Spec format §1 references this file; the §1 reader follows the link to the relevant section here.
4. **A boundary**. If something changes weekly, it's not constitutional — it's a config or a setting.

## What the Constitution IS NOT

- Not a wishlist or roadmap.
- Not implementation details (those live in spec files).
- Not the philosophy doc itself (this LINKS to `NORTH_STAR.md` and `TOYOTA_WAY.md`; doesn't replace them).

---

## 1. Mission

**One-line**: Jidoka is the agentic engineering framework for Claude Code — it ships software at a senior team's quality bar, autonomously, and gets measurably better at it every wave.

**Full source**: [`docs/NORTH_STAR.md`](NORTH_STAR.md)

**Framework Compass** (5 questions every framework spec must answer "yes" to before dispatch):
1. Does it raise the quality of what the line ships, or the reliability of the line itself?
2. Is every claim backed by an executable proof (test, gate, script output)?
3. Can the defect it guards against halt the pipeline, with a human in the approval seat?
4. Does it land in the right home (framework vs product vs global) without duplicating what exists?
5. Does the system learn from it (retro, meta-engine entry, skill, golden case)?

A spec failing any compass question is rejected at review. `constitutional-reviewer` runs these five questions independently; any VIOLATION halts the pipeline. (Products run their own product-level Mission Compass instantiated from the `docs/MISSION.md` template.)

---

## 2. Philosophy — the two Toyota pillars

**One-line**: Jidoka (built-in quality — the product gets better) + Kaizen (continuous improvement — the process gets better). Neither is optional.

**Full source**: [`docs/TOYOTA_WAY.md`](TOYOTA_WAY.md) — maps each Toyota Production System principle to the concrete mechanism implementing it in the pipeline.

**Key axioms** for spec authors:
- A defect is never passed to the next station; gates verify at the station, not after merge.
- The line stops on quality drop (andon), not only on hard failure.
- Every wave feeds the meta-engine; mistakes become catalog entries and golden cases.
- Self-improvement applies to the agents and prompts too (`docs/SELF_IMPROVEMENT_PROTOCOL.md`).

---

## 3. Engineering standards

**One-line**: Senior-engineer discipline, encoded: decomposition limits, test discipline, security patterns, honest reporting.

**Full sources**: [`docs/CODING_STANDARDS.md`](CODING_STANDARDS.md), [`docs/TESTING.md`](TESTING.md), [`docs/SECURITY.md`](SECURITY.md), [`docs/DEBUGGING.md`](DEBUGGING.md), [`docs/DEVOPS.md`](DEVOPS.md)

**Non-negotiables**:
- No "done" without executable proof in the same turn.
- Decomposition limits: ≤400 LOC/file, ≤80 LOC/function (enforced, not aspirational).
- No fabricated data, credentials, or results — missing things are named, not faked.
- Honest scope: bounded work (top-N, sampled, partial) states its boundary explicitly.
- Secrets and PII never enter the repo.

---

## 4. Agent layer

**One-line**: A layered roster — product/architecture layers (L0.5–L0.7), execution (L1), quality gates (L0.95–L0.99), adversarial verification — each agent with one charter, one write-scope.

**Full source**: [`docs/AGENT_ROSTER.md`](AGENT_ROSTER.md) (+ `.claude/agents/*.md` — one charter file per agent)

**Enforcement**:
- An agent acts only inside its declared write-scope; scope-escape is a red-team attack class.
- Halt authority is explicit: only the named halt-authority agents may stop the line.
- New agents require a roster entry, a charter, and a RACI placement in the same wave (`docs/governance/raci.json`).

---

## 5. Pipeline

**One-line**: business questions → master spec (architect synthesis) → tests → code → gates → debate → debug → memory. Spec-first, never code-first.

**Full source**: [`docs/AUTONOMOUS_PIPELINE.md`](AUTONOMOUS_PIPELINE.md)

**Key invariants**:
- No implementation before an approved master spec for non-trivial waves.
- The spec contract binds backend and frontend; nobody invents a contract the other side hasn't agreed to.
- Wave artifacts (spec → diff → retro → metrics) form a complete, auditable chain.

---

## 6. Verification gates

**One-line**: Multi-level verification L0.95–L0.99: reflexion, constitutional review, security scan, coverage, a11y, perf, integration, debate, meta-process audit. Gates block; they don't advise.

**Full source**: [`docs/MULTI_LEVEL_VERIFICATION.md`](MULTI_LEVEL_VERIFICATION.md)

**Enforcement points**: `.claude/agents/` gate charters + `scripts/` gate runners + CI (`.github/workflows/ci.yml`). The andon primitive (`scripts/andon-halt-helpers.mjs`) is the single halt mechanism all gates share.

---

## 7. Spec system

**One-line**: Five-level spec tree — L0 constitution/north-star → L1 core architecture → L2 domains → L3 modules → L4 waves — with frontmatter lineage, cascade validation, drift detection, and coverage measurement.

**Full sources**: [`docs/HIERARCHICAL_SPEC_SYSTEM.md`](HIERARCHICAL_SPEC_SYSTEM.md), [`docs/MODULE_SPEC_SYSTEM.md`](MODULE_SPEC_SYSTEM.md)

**Enforcement**:
- Every spec carries frontmatter: status / version / level / parents[] / last_validated_against_parents.
- L0/L1 changes trigger cascade validation across children (`scripts/cascade-validate.mjs`).
- The spec-custodian agent audits structural integrity; `scripts/spec-drift-check.mjs` catches broken references.
- Wave specs (L4) are transient and reference the L3 modules they modify.

---

## 8. Quality-First Principle

**One-line**: In every technical phase, the highest-quality solution wins. Quality is the primary selection axis; speed and token cost are subordinate. (wave-188)

This is our **Jidoka** pillar: quality is built into each unit of work, not inspected after the fact. The full Toyota-to-dev-system mapping lives in [`docs/TOYOTA_WAY.md`](TOYOTA_WAY.md).

**Definition of quality** — four criteria, scored Likert 1–5 each at the selection point:
1. **Architectural Coherence** — follows established project patterns; introduces no parallel abstraction.
2. **Maintainability under extension** — within LOC limits (400/file, 80/function); no hidden coupling; still readable in six months.
3. **Edge-case resilience** — null / empty / error / loading / race states handled with evidence (tests), not only the happy path.
4. **Design durability** — fixes the root cause; no patch-over, no added debt.

**Trade-off rule**: quality wins over speed and cost. Expensive measures (N≥3 parallel candidates, hard quality-andon) apply only to **critical phases** — those touching L0/L1 artifacts (Constitution, NORTH_STAR, master specs, agent charters, andon/gate machinery), security / auth / billing / money / PII, foundational waves, or ≥3 modules / a shared store / a public API contract. Non-critical phases weight quality strongly but do not hard-stop.

**Reconciliation with Minimal footprint** (CLAUDE.md Engineering Principles): minimal footprint still holds against padding and duplication, never against clarity or defensive code. Clarity outranks line count. The two rules meet at: no bloat, no shortcut.

**Enforcement point**: [`.claude/agents/best-of-N-judge.md`](../.claude/agents/best-of-N-judge.md). The judge applies this definition as its rubric — AC-compliance and coverage are disqualification gates, the four criteria are the primary selection weight, efficiency breaks ties only.

---

## 9. Self-improvement

**One-line**: The framework learns from every wave: meta-engine mistake ledger, anti-pattern catalog, skill extraction, prompt evolution with regression guard, red-team hardening.

**Full sources**: [`docs/SELF_IMPROVEMENT_PROTOCOL.md`](SELF_IMPROVEMENT_PROTOCOL.md), [`docs/ANTI_PATTERNS_CATALOG.md`](ANTI_PATTERNS_CATALOG.md)

**Key invariants**:
- Every caught process mistake is logged (`scripts/meta-log.mjs`) with class, claimed-vs-real, and who caught it.
- Recurrence of a documented anti-pattern blocks new wave dispatch (meta-process-auditor) until a human resolves.
- Prompt changes to agents require golden-case evidence of strict improvement (prompt-evolver + regression guard).

---

## How specs use the Constitution

```markdown
## 1. Vision
... per Constitution §1 (Mission) and §2 (Philosophy) — see docs/CONSTITUTION.md ...
```

Chief Architect spec template (§1 Vision, §7 Compass cross-check) cites Constitution sections by number. The reader follows ONE link to navigate the canonical sources.

The source docs (NORTH_STAR / TOYOTA_WAY / CODING_STANDARDS / AGENT_ROSTER / AUTONOMOUS_PIPELINE / MULTI_LEVEL_VERIFICATION / HIERARCHICAL_SPEC_SYSTEM / SELF_IMPROVEMENT_PROTOCOL) remain the durable content. The Constitution is a navigation layer, not a content replacement.

---

## Amendment process

A constitutional amendment is any change to:
- The Framework Compass questions (§1)
- The two pillars and their mechanism mapping (§2)
- The engineering non-negotiables (§3)
- The agent-layer invariants (§4)
- The pipeline invariants (§5)
- The gate set and halt mechanism (§6)
- The spec-system levels and lineage rules (§7)
- The Quality-First Principle (§8)
- The self-improvement invariants (§9)

Procedure:
1. Open a wave whose spec explicitly proposes the amendment in §8 Open questions.
2. Chief Architect synthesis cites the existing Constitution section + the proposed change + the rationale.
3. Spec Reviewer flags any spec that AMENDS the Constitution without naming the amendment — implicit changes are P0 (constitution drift).
4. Approved amendment: the source doc is edited AND this Constitution file's section synopsis is updated in the same PR. L0 files are write-protected for agents (`policy-enforce-hook`); the final edit is applied by the human owner.

Non-constitutional changes (script fixes, new tests, dashboard polish, docs that don't touch §1–§9) do NOT need this process.

### Applied amendments
- **wave-188** (2026-05-29) — added §8 Quality-First Principle, the Jidoka pillar of the Toyota Way. Source: `docs/TOYOTA_WAY.md`.
- **spec-tree-overhaul** (2026-06-05) — v2.0.0 MAJOR: re-grounded the Constitution from the imported product (home-services SMB OS) to the framework itself. Added §1 NORTH_STAR + Framework Compass, §3 engineering standards, §9 self-improvement; replaced product sections (voice guide, role matrix, funnel registry, design system) with framework sections. Product-specific content archived under `docs/archive/imported-product/`. Approved and applied by the owner.

---

## What we deliberately DIDN'T put here

- **Product content** — missions, role matrices, funnels, design tokens of products built ON the framework live in those products' repos (instantiated from `docs/MISSION.md` and `docs/NORTH_STAR_TEMPLATE.md`).
- **Roadmap / vision** — that's product strategy per project, not constitutional.
- **Code style details** — `docs/CODING_STANDARDS.md`. Style is configurable; constitution is binding.
- **Operational run-state** — `docs/CURRENT_WAVE.md`, dashboards, metrics snapshots. They change too often to be constitutional.

---

**Last constitutional change**: v2.0.0 — re-grounding to the framework (2026-06-05).
