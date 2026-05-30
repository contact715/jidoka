# Skill: Completion audit — mandatory before any "done" claim

> Wave: wave-145  |  Status: experimental  |  Tags: [meta, process, anti-tunnel-vision, closure, quality-gate]

---

## When to use

This skill fires **before any message** where the AI is about to write "done", "shipped", "complete", or "closed". It is not optional. Skipping it is the `optimistic-completion-bias` anti-pattern (`docs/ANTI_PATTERNS_CATALOG.md` entry 3).

Use in every situation where:
- A task, wave, or fix is being declared finished
- An acceptance criterion is being marked satisfied
- A "this addresses the issue" conclusion is being drawn
- A "fixed in this commit" claim is being made

---

## The mandatory 5-field block

Emit this block verbatim before any "done" claim. Fill all five fields. Do not skip fields or merge them.

```
## Completion audit (mandatory before "done" claims)
- **Goal:** <original ask in 1 line — copy from spec or task description>
- **Gaps remaining:** <enumerate with file:line references OR write exactly "0 — all gaps addressed">
- **Enforcement type:** documentation | active hook | hard block | external audit
- **Closure level:** N% (100% only if all gaps are explicitly addressed AND enforcement is not "documentation only")
- **If < 100%:** <explicit list of deferred items> + <why deferred> + <wave-NN when addressed OR "next session">
```

### Field definitions

**Goal**: One line restating what was asked. If the ask evolved during implementation, state the final agreed scope.

**Gaps remaining**: Every known incomplete item, enumerated explicitly. Use `file:line` references for code gaps. Use prose for process gaps. If there are zero gaps, write exactly "0 — all gaps addressed" — do not leave blank.

**Enforcement type**: The strongest enforcement mechanism that shipped for this task:
- `documentation` — a markdown file or comment was added; no automated check fires
- `active hook` — a pre/commit/post hook runs and enforces the rule automatically
- `hard block` — enforcement exits non-zero and stops the action (deploy, commit, dispatch)
- `external audit` — an agent or script is triggered by an external event and emits a verdict

Closure level cannot be 100% if enforcement type is `documentation` alone.

**Closure level**: A percentage. 100% means every goal item is shipped, every gap is zero, and enforcement is not "documentation only". If unsure whether a gap remains, closure level is < 100% until verified.

**If < 100%**: Required when closure level is below 100%. Must include:
1. The specific items not shipped (not "minor things")
2. Why they are deferred (capacity, dependency, deliberate trade-off)
3. When they will be addressed (a wave number OR "next session" — NOT "eventually" or "later")

---

## Anti-patterns this skill catches

| Anti-pattern | Fix |
|---|---|
| Declaring 100% when gaps remain | Enumerate gaps explicitly; set closure level to actual % |
| Using "minor" to minimise gaps | All gaps are gaps. Use "0" only when actually zero. |
| Deferring without a wave number | Always specify when deferred items will be addressed |
| Enforcement type "documentation" with 100% closure | Documentation alone is not full closure; set closure level ≤ 80% |
| Skipping the block because "it's obvious it's done" | The block is mandatory — "obvious" gaps are still gaps |

---

## Example — correct usage

```
## Completion audit (mandatory before "done" claims)
- **Goal:** Ship partial-fix detection hook in .husky/commit-msg
- **Gaps remaining:** 0 — all gaps addressed
- **Enforcement type:** active hook
- **Closure level:** 100%
- **If < 100%:** N/A
```

## Example — correct deferred usage

```
## Completion audit (mandatory before "done" claims)
- **Goal:** Enforce completion-audit convention across all AI outputs
- **Gaps remaining:** (1) LLM-semantic detection of partial-fix patterns not shipped (deterministic only); (2) hard-block not activated — currently warn-only
- **Enforcement type:** active hook (warn-only), documentation
- **Closure level:** 70%
- **If < 100%:** (1) Deferred — requires LLM call per commit (cost), addressed in wave-155+; (2) Deferred — 30-day soft trial before hard-block, set partial_fix_hard_block: true after trial
```

---

## Relations

- Prevents: `anti-pattern-optimistic-completion-bias`
- Prevents: `anti-pattern-partial-closure-via-documentation`
- Required by: `docs/CODING_STANDARDS.md §11`
- Mirror: `docs/skills/completion-audit.md` (git-tracked copy)
- Catalog: `docs/ANTI_PATTERNS_CATALOG.md` entries 2, 3

---

## Wave history

First defined in wave-145. Triggered by wave-117 retro finding: AI declared proactive-holistic-analysis fix "done" without enforcement mechanism layer.
