---
status: Active
version: 1.0.0
level: L0
type: constitution
owner_role: platform
parents: []
children: []
breaking_change_in_v: null
created: 2026-05-25
last_validated_against_parents: 2026-05-27
last_updated: 2026-05-25
---

# this project Constitution

> The set of DURABLE choices that govern every wave. If something is in this file, it doesn't get re-decided per-spec.
>
> Specs link to ONE doc (this one) instead of six. Lower cognitive load for Chief Architect synthesis.
>
> Adopted: wave-60. Sources existing canonical docs as sections rather than duplicating their content.

---

## What the Constitution IS

1. **A single canonical pointer**. Each section is a one-paragraph synopsis + a link to the full source doc.
2. **Versioned with the code**. Lives in the repo. Changes via PR with rationale.
3. **The thing Chief Architect cites instead of 6 separate docs.** Spec format §1 references this file; the §1 reader follows the link to the relevant section here.
4. **A boundary**. If something changes weekly, it's not constitutional — it's a config or a setting.

## What the Constitution IS NOT

- Not a wishlist or roadmap.
- Not a style guide for prose (that's `VOICE_GUIDE.md`).
- Not implementation details (those live in spec files).
- Not the philosophy doc itself (this LINKS to it; doesn't replace it).

---

## 1. Product mission

**One-line**: this project is the Multi-Agent Operating System for home-services and auto-shop SMBs (5-50 employees). Agents do the work, humans approve and decide.

**Full source**: [`docs/MISSION.md`](MISSION.md)

**Mission Compass** (5 questions every spec must answer "yes" to before dispatch):
1. Strengthens one of the five role positions (owner / dispatcher / tech / lead-tech / office)?
2. Work passes through an AI funnel stage?
3. Human stays in the approval seat?
4. Respects role scope?
5. Chat-first / page-second pattern?

A spec failing any compass question is rejected by SR-11. The compass is the constitution's enforcement layer in the spec review stage.

---

## 2. Product philosophy

**One-line**: Six end-to-end scenarios (Sales / Service / Installation / Maintenance / HR / Reputation) running on universal-agent + funnel-builder + Knowledge-Base architecture. 10 principles. Internal artifact, not marketing copy.

**Full source**: [`docs/PRODUCT_PHILOSOPHY.md`](PRODUCT_PHILOSOPHY.md) (or the Russian variant [`docs/PRODUCT_PHILOSOPHY_RU.md`](PRODUCT_PHILOSOPHY_RU.md) for native context)

**Kaizen layer**: [`docs/TOYOTA_WAY.md`](TOYOTA_WAY.md) — continuous-improvement principles that govern HOW we ship, not WHAT we ship.

**Key axioms** for spec authors:
- Universal agent roster spans all verticals (not one-vertical-per-agent).
- Funnel-builder is the central differentiator — drag stages, agents auto-attach.
- Knowledge Base layer is shared infrastructure (not per-feature scratchpad).
- Approve / Edit / Decline card is the canonical interaction motif.
- Security is architectural (sandbox, prompt-injection defense, audit log, role-gated access) — claims must be backed by code.

---

## 3. Voice + copy register

**One-line**: Engineer-to-operator tone. Concrete > aspirational. Named roles, named outcomes, no marketing inflation.

**Full source**: [`docs/VOICE_GUIDE.md`](VOICE_GUIDE.md)

**Banned vocabulary** (SR-5 enforces in user-facing strings):
- "orchestrator", "preset", "variant", "BRANDNAME" (capitalised)
- generic AI marketing words: "transformative", "pivotal", "groundbreaking", "leverage", "synergy", "innovative", "robust", "seamless"
- promotional inflation: "nestled in", "showcasing", "testament to"

**Required register**:
- Names (per-role personas: Frontliner addresses Owner; Dispatcher addresses Scheduler; etc.)
- Numbers (no "many" / "several" — say "47 days" / "3.2 days").
- Verbs not nouns (action, not aspiration).

Specs must reference voice examples by file:line if rewriting copy.

---

## 4. Role permission model

**One-line**: Five operational roles (owner / dispatcher / tech / lead-tech / office). JWT-claim-based via `useAuth().user.role`. Demo role-switcher (`useRoleStore`) is local-only — never used for permission decisions.

**Full source**: [`docs/ROLE_PERMISSION_MATRIX.md`](ROLE_PERMISSION_MATRIX.md)

**Enforcement**:
- SR-12 blocks any spec that gates a surface via `useRoleStore.operationalRole` (demo store, can be flipped from localStorage).
- All role gates read from `useAuth().user.role` (server-issued).
- Permission matrix lives in `ROLE_PERMISSION_MATRIX.md` — spec changes that grant new permissions MUST update the matrix in the same wave.

---

## 5. Funnel registry

**One-line**: 7 canonical funnels (Sales / Service / Installation / Maintenance / HR / Reputation / Quality Control). Pre-built templates with stage owners pre-bound to agent kinds.

**Full source**: [`docs/FUNNEL_REGISTRY.md`](FUNNEL_REGISTRY.md)

**Registry A** (canonical): `lib/funnels/templates/*.json` — 6 JSON files with role IDs.
**Registry B** (vertical packs): `components/pipeline/PipelineTemplateSelector.tsx` — 8 hardcoded packs with `funnelTemplateId` reference to Registry A (wave-49b wired 6 of 8; 2 explicit TODO(wave-49c) for missing subscription templates).

The duplicate-registry pattern surfaced in wave-45 audit. The Cartographer protocol (wave-39) now greps registries during synthesis to prevent re-emergence.

---

## 6. Design system

**One-line**: Single token system (height / spacing / colour / radius / shadow) enforced via ESLint rules + drift ratchet CI + visual baselines.

**Full source**: [`docs/DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)

**Token tiers**:
- Heights: `h-icon` (24) / `h-chip` (28) / `h-control` (32) / `h-cta` (36) / `h-form` (40) / `h-touch` (44) / `h-cardheader` (48)
- Surface: `--surface-primary` / `--surface-secondary` / `--surface-tertiary` (CSS vars)
- Text: Tailwind text-xs..text-xl scale (raw `text-[Npx]` blocked by ESLint per wave-44)
- Semantic palettes (off-limits): `HEAT_COLORS` / `STAGE_COLORS` / `PlatformBadge`

**Enforcement**:
- ESLint `app-custom/no-raw-control-height` (wave-44) on interactive elements
- ESLint `app-custom/no-raw-text-px-size` (wave-44) for typography
- ESLint `app-custom/no-tinted-surface-bg` (wave-29.2) blocks `bg-{color}-500/N` on card-sized surfaces
- Drift ratchet CI (wave-46) fails build if any category count goes up
- DSA agent (wave-43) writes per-spec design contract referencing this section

---

## 7. Agency / dev system

**One-line**: 4 L0.7 architects (Micro + Macro + Cartographer + DSA) → Chief Architect synthesis → FE Agent execution → Reflexion Critic post-commit → Self-Improvement Reviewer cross-wave. 5 cadences self-maintenance.

**Full source**: [`docs/AGENT_ROSTER.md`](AGENT_ROSTER.md) + `.claude/AGENT_PLAYBOOK.md` (the latter is gitignored — local agent definitions)

**Cadences** (durable chart in `AGENT_ROSTER.md`):
- Per-commit (size-gated) — Reflexion queue
- Per-commit (selective) — wave-artifact validator
- Per-5-waves — Self-Improvement Reviewer queue
- Weekly — `npm run routine:weekly`
- Monthly — `npm run routine:monthly`

---

## 8. Quality-First Principle

**One-line**: In every technical phase, the highest-quality solution wins. Quality is the primary selection axis; speed and token cost are subordinate. (wave-188)

This is our **Jidoka** pillar: quality is built into each unit of work, not inspected after the fact. The full Toyota-to-dev-system mapping lives in [`docs/TOYOTA_WAY.md`](TOYOTA_WAY.md).

**Definition of quality** — four criteria, scored Likert 1–5 each at the selection point:
1. **Architectural Coherence** — follows established project patterns (Zustand stores, apiClient, design system); introduces no parallel abstraction.
2. **Maintainability under extension** — within LOC limits (400/file, 80/function); no hidden coupling; still readable in six months.
3. **Edge-case resilience** — null / empty / error / loading / race states handled with evidence (tests), not only the happy path.
4. **Design durability** — fixes the root cause; no patch-over, no added debt.

**Trade-off rule**: quality wins over speed and cost. Expensive measures (N≥3 parallel candidates, hard quality-andon) apply only to **critical phases** — those touching L0/L1 artifacts (Constitution, MISSION, master specs, agent charters, andon/gate machinery), security / auth / billing / money / PII, foundational waves, or ≥3 modules / a shared store / a public API contract. Non-critical phases weight quality strongly but do not hard-stop.

**Reconciliation with Minimal footprint** (CLAUDE.md Engineering Principles): minimal footprint still holds against padding and duplication, never against clarity or defensive code. Clarity outranks line count. The two rules meet at: no bloat, no shortcut.

**Enforcement point**: [`.claude/agents/best-of-N-judge.md`](../.claude/agents/best-of-N-judge.md). The judge applies this definition as its rubric — AC-compliance and coverage are disqualification gates, the four criteria are the primary selection weight, efficiency breaks ties only.

---

## How specs use the Constitution

Old (pre-wave-60):
```markdown
## 1. Vision
... per docs/MISSION.md ... per docs/PRODUCT_PHILOSOPHY.md ... per docs/VOICE_GUIDE.md ... per docs/ROLE_PERMISSION_MATRIX.md ...
```

New (wave-60+):
```markdown
## 1. Vision
... per Constitution §1 (Mission) and §2 (Philosophy) — see docs/CONSTITUTION.md ...
```

Chief Architect spec template (§1 Vision, §7 Mission Compass cross-check) now cites Constitution sections by number. The reader follows ONE link to navigate the canonical sources.

The 6 source docs (MISSION / PRODUCT_PHILOSOPHY / VOICE_GUIDE / ROLE_PERMISSION_MATRIX / FUNNEL_REGISTRY / DESIGN_SYSTEM) remain as the durable content. The Constitution is a navigation layer, not a content replacement.

---

## Amendment process

A constitutional amendment is any change to:
- Mission compass questions (§1)
- The 10 product principles (§2)
- The 5 operational roles (§4)
- The 7 funnel definitions (§5)
- The token tiers (§6)
- The 5 cadences (§7)
- The Quality-First Principle (§8)

Procedure:
1. Open a wave whose spec explicitly proposes the amendment in §8 Open questions.
2. Chief Architect synthesis cites the existing Constitution section + the proposed change + the rationale.
3. Spec Reviewer flags any spec that AMENDS the Constitution without naming the amendment in §8 — implicit changes are P0 (constitution drift).
4. Approved amendment: the source doc is edited AND this Constitution file's section synopsis is updated in the same PR.

Non-constitutional changes (UI polish, performance, bug fixes, new features that don't touch §1-§8) do NOT need this process.

### Applied amendments
- **wave-188** (2026-05-29) — added §8 Quality-First Principle, the Jidoka pillar of the Toyota Way. Source: `docs/specs/wave-188_MASTER_SPEC.md`. Companion: `docs/TOYOTA_WAY.md`.

---

## What we deliberately DIDN'T put here

- **Backend contracts** — those are in `the backend` (read-only from this repo per CLAUDE.md).
- **Marketing / brand site** — `components/site/**` uses a separate token system (`--site-*`). Off-limits for the dashboard's design system.
- **Per-customer customisation** — this project is multi-tenant; per-tenant overrides live in `tenantStore`, not here.
- **Roadmap / vision** — that's `docs/PRODUCT_PHILOSOPHY.md` and product strategy, not constitutional.
- **Code style** — `docs/CODING_STANDARDS.md`. Style is configurable; constitution is binding.

---

**Last constitutional change**: wave-60 (this file's adoption).
