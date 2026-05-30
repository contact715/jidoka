# Skill: Pre-mortem checklist — imagine the failure before you start

> Wave: w28  |  Status: active  |  Tags: [planning, risk]

---

## When to use

Before starting any wave > 50 LOC, before dispatching the FE Agent, before kicking off any non-reversible operation (DB migration, public release, brand-affecting change).

A post-mortem asks "what went wrong?" after the fact. A pre-mortem asks "imagine it's already gone wrong — what are the top three reasons?" BEFORE the fact. The pre-mortem cost is ~5 min. The post-mortem cost is whatever the failure cost.

---

## Implementation guide

### Step 1 — Cast forward to a failure scenario

Sit down (mentally) and write the failure post-mortem as if the wave already shipped and broke. Format:

```
# Wave-NN POST-MORTEM (PRE-MORTEM PROJECTION)

Failure scenario: [what went visibly wrong, ≤ 1 sentence]

Top 3 contributing causes (in priority order):
1. [what we missed]
2. [what we assumed]
3. [what we shipped on faith]

How we could have caught it:
1. [pre-flight check we should run]
2. [tool / agent / skill that would have flagged]
3. [conversation / question we should have had with user]
```

Force yourself to write three causes. Single-cause pre-mortems are usually denial.

### Step 2 — Translate to pre-flight checks

For each "how we could have caught it" item, decide:
- Add as an AC in the spec? → run before declaring done
- Add as a Reflexion check? → adversarial review prompt
- Add as a user clarification? → AskUserQuestion before starting
- Add as a regression test? → write the test before the code

### Step 3 — Identify the irreversible action

Find the one line of the wave that, if wrong, is hardest to undo. Database migration? Production deploy? Email send? Public commit? Treat THAT step with the most pre-flight attention.

For reversible actions, the pre-mortem still has value but the urgency is lower.

### Step 4 — Run the actual wave with the pre-flight checks armed

The pre-mortem is worthless if you don't change behaviour. Each pre-flight check is a gate — fail-open by default but flag the failure visibly in the wave retro.

### Step 5 — Compare to actual post-mortem (if shipped)

After the wave ships, compare the projected failure to actual outcomes. Did your projected causes happen? Did unprojected ones happen? This calibrates your pre-mortem quality over time.

---

## Common pre-mortem failure modes this project has seen

From self-audit:

1. **Tunnel vision** — wave fixes the element but breaks the surrounding layout. Pre-flight: surface audit (skill: `surface-audit-before-touch`).
2. **React Compiler memo error** — manual useMemo with narrow deps conflicts with Compiler inference. Pre-flight: lint-check after every memo edit.
3. **Mock data drift** — wave adds mock that becomes "real" in user's mind. Pre-flight: mark mock additions with `[DEMO]` label in UI.
4. **Pre-existing warning normalisation** — warnings in modified file get committed because "they're not new". Pre-flight: list pre-existing issues in commit message.
5. **Scope creep into "while I'm here"** — wave swells past plan because of opportunistic edits. Pre-flight: hard cap on files touched.
6. **Single-approach decision** — picked the first reasonable option without weighing alternatives. Pre-flight: `multiple-hypothesis-design` skill.

Use this list as a starter — your wave's specific risks may differ.

---

## Anti-patterns / gotchas

- **Generic pre-mortem**: "we might miss something" is not a cause. Be specific or skip the exercise.
- **Pre-mortem with no behaviour change**: writing the doc and then proceeding as if you didn't. The point is to alter what you do, not to perform planning.
- **Optimism that ignores history**: if the codebase has burned you with X before, X is in your top 3 again until you institutionally fix X.

---

## Machine-readable output block

Wave-156 extends this skill with a machine-readable output format for `scripts/run-premortem.mjs`.

### YAML frontmatter schema

Each `docs/quality/risk-assessments/wave-NNN.md` file produced by the pre-mortem agent begins with:

```yaml
---
wave: wave-NNN
generated_at: ISO8601-timestamp
lenses: 4
llm_model: claude-sonnet-4-5
---
```

### Risk themes table schema

```markdown
| theme | likelihood | impact | mitigation | source_lens |
|-------|-----------|--------|------------|-------------|
| <string> | H|M|L | H|M|L | <string> | Lens 1|2|3|4 |
```

Fields:
- `theme` — short failure class name (e.g. "dependency-version-mismatch", "scope-underspecified")
- `likelihood` — H (high), M (medium), or L (low)
- `impact` — H (high), M (medium), or L (low)
- `mitigation` — non-empty free text recommendation
- `source_lens` — which of the 4 lenses surfaced this theme (or "synthesis" if it emerged in synthesis call)

Minimum 3 rows required for `phase-premortem.md` PM2 to pass. If synthesis produces fewer than 3 distinct themes, a WARN is emitted to stdout and the artifact is written with whatever themes exist.

### Taxonomy append format

Each run appends rows to `docs/quality/risk-assessments/_TAXONOMY.md`:

```markdown
| wave-NNN | YYYY-MM-DD | <theme> | H|M|L | H|M|L | <source_lens> |
```

The taxonomy is append-only. No pruning in v1. Compaction is a v2 concern.

---

## Wave history

First applied in wave-28 — self-audit identified absence of pre-mortem step in standard wave kickoff (waves 24, 25, 26 all hit predictable issues that a 5-min pre-mortem would have surfaced).

Extended in wave-156 — LLM-semantic projection via 4-lens parallel dispatch + synthesis. Status upgraded from experimental to active. Machine-readable output format defined above. Enforcement mechanism: `scripts/run-premortem.mjs`.
