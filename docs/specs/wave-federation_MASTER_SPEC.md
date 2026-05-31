---
status: Active
level: L1
type: master-spec
owner: platform
created: 2026-05-31
---

# wave-federation Master Spec — Project Federation & Integrity Defense

The framework (jidoka) must never reach into a project and break it from the outside. Instead the
framework's Orchestrator does a **handshake with the project's own guardian**, who knows the system
from head to toe and defends its integrity. They exchange tasks as two heads, not one overwriting
the other.

## §0 Problem
When jidoka works on a project (Mosco, Castells, any future one), the framework Orchestrator can
edit files directly. That risks contradicting the project's philosophy, tech stack, or architecture
— silently reshaping or breaking it. There is no single project-side authority that (a) owns the
whole project, (b) is the one door the framework talks through, and (c) defends integrity against
incoming changes.

## §1 Concept — federation of two orchestrators
```
  jidoka Orchestrator  ──(plan / request)──►  project-steward  ──►  project's own agents
        ▲                                          │  (owns the Integrity Charter,
        └──────────(request / verdict)─────────────┘   runs the Defense Process)
```
- **One guardian per project: `project-steward`.** Predictable single entry point in every project.
  Where the project already has its own Orchestrator/chief-architect (Mosco), the steward
  coordinates THROUGH them; it does not duplicate execution — it owns integrity + the charter.
- **Bidirectional.** The framework sends plans/tasks to the steward; the steward can also initiate
  requests to the framework ("I need a refactor / a review / a feature built").
- **The tree grows from philosophy.** North Star (root) → Integrity Charter (trunk: tech stack,
  architecture model, hierarchy, invariants) → specs/features (branches). A branch that contradicts
  the root or trunk triggers defense — you cannot change the product against itself.

## §2 Components

### 2.1 `project-steward` (new role)
The project's head-to-toe guardian and single door to the framework. Reads the Integrity Charter +
North Star; runs the Defense Process on every incoming change; coordinates the project's own agents
to execute approved work; can initiate requests back to the framework. Does NOT rubber-stamp.

### 2.2 `PROJECT_CHARTER.md` (the integrity contract — grows from North Star)
Per project, owned by the steward. Sections:
- **Roots** — the North Star principles the project is built on (link to NORTH_STAR.md).
- **Trunk (invariants)** — what follows from the roots and must hold: tech stack, architecture model
  (e.g. "agent-based, human-in-approval"), hierarchy, non-negotiables.
- **Protected zones** — files/decisions that cannot change without the Defense Process (e.g. the
  agent model, the data model, auth, the core stack choice).
- **Derivation** — how branches (features, specs) are expected to grow from the trunk, so a
  contradiction is detectable.

### 2.3 Defense Process (the project's immune system)
Every incoming change is classified against the Charter: **helps / neutral / conflicts**.
- helps/neutral → proceed (neutral deprioritised).
- **conflicts → NOT silently rejected and NOT silently done.** A defense investigation opens:
  1. **Intent** — why is this wanted (the real goal behind the request)?
  2. **Breach** — which invariant / tree-node does it contradict, and how badly?
  3. **Resolution — one of three, never silent:**
     - **REJECT** — it would break the project and the intent does not justify it. Protect.
     - **ADAPT** — find a way to achieve the intent WITHOUT breaching the invariant.
     - **EVOLVE** — if the intent is strategically more important than the current philosophy,
       change the North Star ON PURPOSE (logged), then re-derive the tree downward.
- Worked example: "replace Mosco's agents with a custom open-framework CRM" contradicts the
  invariant "agent-based, human-in-approval" rooted in the North Star → defense opens → almost
  certainly REJECT or radically ADAPT, never a silent rewrite.

### 2.4 Handshake protocol (in dev-pipeline)
When the framework works inside a PROJECT (not the framework repo itself):
1. Discover the project's `project-steward` + read `PROJECT_CHARTER.md` + `NORTH_STAR.md`.
2. Before any change, present the plan to the steward.
3. Steward runs the Defense Process → PASS / ADAPT / BLOCK(defense investigation).
4. BLOCK → surface the investigation to the human (intent, breach, options) — do not proceed.
5. Bidirectional: steward may also open a request to the framework.

### 2.5 `charter-check.mjs` (mechanism)
Structural gate (FULL): the Charter exists, is complete (roots/trunk/protected-zones/derivation
filled, not template), and a wave's plan/spec is bound to it (names which invariant it touches).
The semantic helps/adapt/conflicts judgement is the steward's LLM call (PROXY/agent, not faked).

## §3 Honesty boundaries
- `project-steward` role + `PROJECT_CHARTER` + handshake protocol + `charter-check` structure = FULL.
- The semantic conflict judgement (does THIS change contradict the philosophy) = the steward agent
  (LLM), measured like other judges via golden cases — not a deterministic script.
- The steward does not get OS-level power over the project; it is a protocol + gate, not a sandbox
  (consistent with the hardening roadmap's honest sandbox boundary).

## §4 Implementation order (each: mechanism + self-test/proof + commit)
- **F1** `project-steward.md` role + `PROJECT_CHARTER_TEMPLATE.md` + `charter-check.mjs` (+ self-test, eval).
- **F2** Handshake wired into `dev-pipeline` (step 0.5: in a project → steward + charter before work)
  and into the framework Orchestrator playbook.
- **F3** `install-into` ships project-steward + charter template + charter-check into new projects;
  charter-check joins the product pre-push gate.
- **F4** Fill `PROJECT_CHARTER.md` for Mosco + Castells from their North Star + real structure; prove
  charter-check passes; dry-run the Defense Process on the worked example.
- **F5** Snapshot global, refresh counts, commit + push.

## §5 Definition of done
All F1–F5: self-test green + in CI, 0 ghosts, counts/snapshot refreshed, committed + pushed; every
FULL claim shown; the steward's semantic judgement labelled PROXY/agent (not deterministic).
Worked example ("rip out the agents") demonstrably opens a defense investigation, not a silent edit.
