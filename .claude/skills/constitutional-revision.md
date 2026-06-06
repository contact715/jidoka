# Skill: Constitutional revision — critique-revise-verify loop per Anthropic CAI

> Wave: wave-103  |  Status: experimental  |  Tags: [constitutional, ai-safety, revision-loop, mission-alignment]

---

## When to use

- When **constitutional-reviewer** agent emits VIOLATION verdict on Mission Compass Q1-Q5 check.
- When the violation is a **rewrite issue, not an architectural issue** — i.e. the spec's intent can be honored with revised implementation, no fundamental redesign needed.
- During post-impl phase, before reflexion-critic — caught early саves expensive reflexion iteration.
- When wave touches role permissions, agent autonomy thresholds, customer-facing text, or approval flow — these are constitutional-sensitive surfaces.
- NOT for use when violation requires new spec from chief-architect — escalate that to L0.75 instead.

---

## Pattern source

Anthropic Constitutional AI methodology (Bai et al., 2022) — "Constitutional AI: Harmlessness from AI Feedback" arXiv:2212.08073.

The original CAI loop:
1. Generate response
2. Critique against principles
3. Revise to address critique
4. Repeat until aligned

this project adaptation:
1. frontend-agent ships code per wave spec
2. constitutional-reviewer critiques against Mission Compass + PHILOSOPHY + ROLE_PERMISSION_MATRIX
3. If VIOLATION: this skill orchestrates revision rather than escalating to human
4. Cap: 3 iterations max — beyond that, escalate to chief-architect (spec was likely insufficient)

---

## Principle sources (read all before revision)

| Principle | Source | What it enforces |
|---|---|---|
| Mission Compass Q1-Q5 | `docs/MISSION.md` §"Mission Compass" | 5 questions every change must pass |
| 6 E2E scenarios | `docs/PRODUCT_PHILOSOPHY.md` | What product actually does for customer |
| 5-role scope matrix | `docs/ROLE_PERMISSION_MATRIX.md` | Per-role entity × action permissions |
| Voice per role | `docs/VOICE_GUIDE.md` | Brand voice consistency |
| Approval ceilings | `docs/archive/imported-product/AGENT_LAYER_ARCHITECTURE.md` §3.2 (архив продукта) | Default thresholds per role |
| Funnel-stage thinking | `docs/FUNNEL_REGISTRY.md` | Work flows through stages, not flat lists |

---

## Implementation guide

### Step 1 — Read the VIOLATION report

constitutional-reviewer emits a report with structure:
```
VERDICT: VIOLATION
Question: Q3 (human stays in approval seat)
Location: components/agents/workspace/SomeComponent.tsx:42
Evidence: <quote of code/text that violates>
Principle: <quote from MISSION/PHILOSOPHY/MATRIX>
```

Read all 5 fields. Verify Location is accurate — open the file at the cited line.

### Step 2 — Diagnose: rewrite-fixable OR architectural?

Ask 3 diagnostic questions:

**Q1.** Can the violation be fixed by changing code/text **within the current spec's scope**?
- YES → rewrite-fixable, proceed to Step 3
- NO → architectural issue, **escalate to chief-architect** (do NOT proceed)

**Q2.** Does the fix require modifying the spec's acceptance criteria?
- NO → safe to revise
- YES → spec mismatch, **escalate to chief-architect** (likely spec was incomplete)

**Q3.** Does the fix change the public API contract or breaking the surface?
- NO → safe
- YES → **escalate to chief-architect** (breaking change requires spec amendment)

If any answer escalates: stop. Write findings to `.claude/reflexion-queue/<sha>.md` for orchestrator routing.

### Step 3 — Generate revision

Draft a minimal-diff revision that:
- Honors the violated principle (cite specifically which one)
- Preserves the spec's intent (cite which AC it serves)
- Stays within the same files (no scope expansion)
- Includes a one-line code comment referencing the principle: `// per MISSION Compass Q3 — surfaces approval before autonomous action`

Example revision for Q3 violation:
```diff
- onSelect={(v) => { applyImmediately(v); }}
+ onSelect={(v) => { queueForApproval(v, { reason: "user-initiated" }); }}
+ // per MISSION Compass Q3 — selection requires approval before applying
```

### Step 4 — Self-verify before commit

Run the same 5-question Mission Compass check against the revised code:
1. Strengthens one of 5 roles? (which?)
2. Passes through AI funnel stage? (which?)
3. Human stays in approval seat? (how?)
4. Respects role scope? (which scope?)
5. Chat first, page second? (how does it surface in chat?)

If all 5 PASS → commit. If any FAIL → return to Step 3 with new revision.

### Step 5 — Commit with provenance

Commit message must reference:
- Original violation: `Closes: wave-NN constitutional-reviewer VIOLATION (Q3, SomeComponent.tsx:42)`
- Principle honored: `Honors: MISSION Compass Q3 (approval seat)`
- Iteration count: `Constitutional revision iteration: 1/3`

### Step 6 — Re-dispatch constitutional-reviewer

Verify the violation is resolved:
- If PASS → wave continues to reflexion-critic
- If VIOLATION (same) → revision was insufficient, return to Step 3 with deeper diagnosis
- If VIOLATION (new) → previous fix introduced new violation, return to Step 3 with awareness of both
- If iteration cap (3) reached → escalate to chief-architect with full revision history

---

## Anti-patterns

| Don't | Why | Do instead |
|---|---|---|
| Disable the constitutional-reviewer check | Defeats the entire safety layer | Escalate the spec to chief-architect |
| Add an exception/exemption comment | Specials accumulate, become invisible | Rewrite to honor principle |
| Bypass with `// @constitutional-ignore` directive | No such directive exists; do not invent it | If genuinely exempt, document in ADR |
| Iterate 5+ times on same violation | Indicates spec issue, not implementation issue | Escalate at iteration 3 |
| Revise across spec scope boundaries | Scope creep, breaks single-wave atomicity | Open new wave for the additional change |
| Skip Step 4 self-verify | Catches second-order violations the LLM introduces | Always run all 5 questions before commit |

---

## Linked agents

- **constitutional-reviewer** (`.claude/agents/constitutional-reviewer.md`) — emits the VIOLATION report this skill responds to
- **debate-judge** (wave-103) — invoked at iteration 3 if revision deadlocks
- **chief-architect** — escalation target when spec amendment is required
- **reflexion-critic** — downstream consumer; this skill runs BEFORE reflexion to catch issues earlier

---

## Linked skills

- `.claude/skills/tdd-flow.md` — when violation involves missing test coverage
- `.claude/skills/test-failure-triage.md` — when revision breaks existing tests

---

## Output

Each invocation produces:
- 1 commit (revision)
- 1 line in commit message footer noting iteration N/3
- If escalated: 1 file in `.claude/reflexion-queue/<sha>.md` with diagnostic notes
