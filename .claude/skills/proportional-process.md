# Skill: Proportional process — match dispatch weight to task weight

> Wave: w28  |  Status: experimental  |  Tags: [process, orchestration, cost]

---

## When to use

Before dispatching agents for any new task. Specifically before reaching for the standard "Chief Architect → Spec Reviewer → FE → Reflexion → Visual QA → Guardian → Skill Extractor → Metrics → Ship" 9-step pipeline.

The mistake: treating every task as if it needs the full pipeline. The pipeline exists for waves with real architectural complexity. A 50-LOC polish or a 1-line bug fix gets buried under 9 dispatches of overhead.

Industry note (2026): N-way agent debate scales quadratically in cost. Past ~3 agents per decision, latency + spend explodes without measurable quality lift.

---

## Implementation guide

### Step 1 — Size the task before picking the process

Estimate in LOC + surface count + risk:

| Tier | LOC | Files touched | Risk | Process |
|---|---|---|---|---|
| **Trivial** | < 20 | 1 | None (typo, comment, copy) | Direct edit, single commit. No dispatch. |
| **Small** | 20–80 | 1–3 | Low (visual polish, single-component fix) | Direct edit + TS/lint check + commit. Spec optional (1-paragraph inline note). |
| **Medium** | 80–300 | 3–10 | Medium (new feature, multiple components, store change) | Inline spec (write yourself, 200 words) + impl + adversarial self-review + commit. |
| **Large** | 300+ | 10+ | High (architectural change, cross-cutting, new data flow) | **Full pipeline**: Micro + Macro Architects → Chief Architect → Spec Reviewer → FE → Reflexion → Visual QA → Guardian → Ship. |

### Step 2 — Default to the smallest process that fits

Bias toward LESS process. The pipeline overhead is real:
- Each agent dispatch costs ~5-20K tokens
- Each step adds latency the user feels
- Each handoff is a place coordination can fail

If you're between two tiers, pick the smaller one and add steps only when a step delivers concrete value.

### Step 3 — Skip the spec when the task is its own spec

A polish wave like "make the form more compact" doesn't need a 1000-word spec. The screenshot + 2-3 specific changes ARE the spec. Writing 900 words of ceremony around 60 LOC of changes is process theater.

The Chief Architect's job is to make the IMPLEMENTATION predictable. If the implementation is already predictable (single file, single concern, no architectural question), the spec adds zero predictability and just costs tokens.

### Step 4 — Always do these, regardless of size

Even on trivial tasks:
- TS check
- ESLint check on touched files
- Read the diff before commit
- Commit message that describes WHY, not just WHAT
- Push only after the pre-commit hooks pass

The minimum bar is a real bar. Below it you're shipping uncalibrated.

### Step 5 — When in doubt, ask the user

If you genuinely can't size the task, ask: *"This is either a 30-min polish or a 2-hour refactor depending on scope. Which one are you asking for?"* Saves a wave of mis-built work.

---

## Anti-patterns / gotchas

- **Process worship**: running the full 9-step pipeline because "that's what good agents do." It's what good agents do FOR LARGE WORK. For small work, it's overhead masquerading as rigour.
- **Skipping the minimum bar**: shipping a typo fix without TS check because "it's just a typo" — except the typo was in a TypeScript identifier. Always run the cheap checks.
- **Spec theater**: writing 900-word specs for 50-LOC waves because the playbook template has 8 sections. The template is a maximum, not a minimum.
- **Pipeline as procrastination**: dispatching agents to delay actually editing the file. If you can fix it in 5 minutes, fix it in 5 minutes.

---

## Examples from history

| Wave | Actual scope | Process used | Right answer |
|---|---|---|---|
| wave-25 | ~700 LOC, new component family, store action | 5-step pipeline | ✅ correct fit |
| wave-26 | ~500 LOC, new layout + store fields | 5-step pipeline | ✅ correct fit |
| wave-27 | ~150 LOC, color discipline + spacing | 1-step (inline spec, direct impl) | ✅ correct fit |
| wave-27.1, 27.2, 27.3 | < 80 LOC each, direct fixes | Direct edit + commit | ✅ correct fit |

When the pipeline got skipped (wave-27 series) the speed-to-ship was 10-20 min vs 60-90 min for full pipeline. Same quality outcome.

---

## Wave history

First applied in wave-28 — self-audit found over-dispatch pattern in early waves 24-26 where 5-step pipeline ran for changes that fit Medium tier.
