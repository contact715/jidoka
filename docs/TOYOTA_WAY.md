# The Toyota Way — our dev system

**One-line**: We build the way Toyota builds. Two pillars carry everything: **Jidoka** (built-in quality, so the product gets better) and **Kaizen** (continuous improvement, so the process gets better). This document maps each Toyota Production System principle to the concrete mechanism that implements it in our pipeline.

This is the source doc behind [Constitution §8 — Quality-First Principle](CONSTITUTION.md).

---

## The two pillars

| Pillar | Japanese | Improves | What it means here |
|---|---|---|---|
| **Jidoka** | 自働化 | the **product** | Quality is built into every unit of work. A defect is never passed to the next station. When quality drops below the line, the line stops (Andon). The judge picks the best solution, not the cheapest passing one. |
| **Kaizen** | 改善 | the **process** | The way we build improves wave over wave. Small fixes compound. Every retro feeds the next wave. |

Neither pillar is optional. Jidoka without Kaizen freezes; Kaizen without Jidoka drifts.

---

## Scope — this is Dev-System Kaizen

This document governs **Dev-System Kaizen**: how our own engineering pipeline gets better wave over wave (Constitution §8 + this file).

If a product also applies Kaizen to its end users (improvement dashboards, learning loops, customer-facing growth), that belongs in a separate product doc — a different scope that does not overlap with this one. This file governs only how we build.

---

## The seven principles → our mechanisms

Each TPS principle below is mapped to the file that implements it today. Where a principle is only partially built, the gap and its target wave are named.

### 1. Jidoka — built-in quality, stop-the-line

Quality is verified at the station, not after merge. Our quality gates (L0.95–L0.99) block a commit the moment a defect appears, and the Andon primitive halts the whole line.

- Gates: [`.claude/agents/security-scanner.md`](../.claude/agents/security-scanner.md), [`coverage-auditor.md`](../.claude/agents/coverage-auditor.md), [`a11y-auditor.md`](../.claude/agents/a11y-auditor.md), [`perf-profiler.md`](../.claude/agents/perf-profiler.md), [`constitutional-reviewer.md`](../.claude/agents/constitutional-reviewer.md)
- Halt primitive: `scripts/andon-halt-helpers.mjs:112` (`writeHaltState`)
- **New (wave-188)**: quality-andon — the line now stops when a winning candidate is *below the quality floor* on a critical phase, not only on a defect. Enforced in [`.claude/agents/best-of-N-judge.md`](../.claude/agents/best-of-N-judge.md).

### 2. Kaizen — continuous improvement of the process

The system reads its own history and improves itself. Patterns that recur across waves become skills or architectural changes.

- Cross-wave loop: `docs/SELF_IMPROVEMENT_PROTOCOL.md` + `.claude/agents/self-improvement-reviewer.md` (every 5 waves)
- Per-wave extraction: `.claude/agents/skill-extractor.md`
- Anti-pattern recurrence: `.claude/agents/meta-process-auditor.md`
- The record itself: `docs/retros/` (100+ wave retros)

### 3. Poka-yoke — mistake-proofing on the way in

Prevent the defect before it can be written, instead of catching it at the end. Partially built; the upstream half lands in W3.

- Today: type system, EARS acceptance criteria (`.claude/skills/ears-acceptance-criteria.md`), pre-flight checklist (`.claude/agents/pfca-agent.md`), security-pattern scan (`scripts/check-security-patterns.sh`)
- **Gap (→ W3)**: TS strict exhaustive checks and property-based invariants that make low-quality output structurally impossible to generate.

### 4. Andon — the stop-the-line cord

Anyone on the line can halt it. The halt is formally verified, not just coded.

- Helpers: `scripts/andon-halt-helpers.mjs`, `scripts/andon-resume.mjs`
- Formal spec: `docs/formal/AndonHalt.tla` (TLA+ model-checked)
- Human resume only — the line restarts when a person clears the cause, never automatically.

### 5. Genchi Genbutsu — go and see for yourself

Do not trust a summary of the result. Look at the rendered, running thing.

- Visual verification: `.claude/agents/visual-qa.md`, `.claude/skills/rendered-verification.md`
- Applied this wave: the spec was read line-by-line before implementation, not approved from its summary.

### 6. Standardized Work — today's best way becomes the standard

The current best-known method is written down and becomes the baseline everyone starts from, until someone proves a better one.

- Standards: `docs/CODING_STANDARDS.md`, the skill library `.claude/skills/`, every approved spec in `docs/specs/`
- **Killer feature (→ W4)**: quality-delta-record. When the judge picks a winner, store *why* it won (its rubric scores + the diff to the runner-up) and feed that into the next wave touching the same module. Quality compounds across waves instead of resetting. No competing agentic pipeline does this today.

### 7. Hansei — relentless reflection

Every wave ends with an honest look at what went wrong, down to the root cause, not the symptom.

- Retros: `docs/retros/` (with explicit "Honest gap" and "Anti-pattern" sections)
- Adversarial review: `.claude/agents/reflexion-critic.md` (per-commit)
- Root-cause discipline: `.claude/skills/root-cause-over-patch.md`

---

## What changed at the selection point (wave-188)

Before: the judge picked the candidate that passed the spec with the fewest lines. Quality was a side effect.

After: quality is the primary axis. AC-compliance and coverage are disqualification gates (a defect cannot win). The four quality criteria from Constitution §8 are the selection weight. Efficiency breaks ties only. A higher-quality candidate never loses to a cheaper one. See [`.claude/agents/best-of-N-judge.md`](../.claude/agents/best-of-N-judge.md).

---

## What this document is NOT

- Not a product doc. Product Kaizen is `TOYOTA_WAY.md`.
- Not a replacement for any gate, agent, or skill. It is the map that names why each exists.
- Not the full W3/W4 design. Those waves are scoped in `docs/specs/wave-188_MASTER_SPEC.md §5`.
