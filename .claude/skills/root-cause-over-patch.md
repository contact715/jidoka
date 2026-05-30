# Skill: Root-cause over patch — five whys before the diff

> Wave: w28  |  Status: experimental  |  Tags: [process, debugging, anti-tunnel-vision]

---

## When to use

- Any time a TS error, ESLint error, test failure, or runtime crash appears.
- Any time the user reports a bug.
- Any time CI flakes.

Especially when the patch is "obvious" (add `eslint-disable`, swap one variable, widen a type to `any`, retry once more). Obvious patches are the highest-risk failures — the cost shows up later.

---

## Implementation guide

### Step 1 — Repeat-back the symptom

Write the failing signal in plain language. Not "the lint failed" — "the React Compiler refused to memoize because manual deps narrower than inferred deps." Specificity gates everything that follows.

### Step 2 — Ask "why" five times

The five-whys ladder. Each answer must reference real code, not feelings.

Example (wave-24 commit failure):
1. **Why did commit fail?** Husky pre-commit hook returned non-zero.
2. **Why?** ESLint found 1 error: `react-hooks/preserve-manual-memoization`.
3. **Why?** Manual `useMemo` dep array was narrower than React Compiler's inferred deps.
4. **Why?** Used `dealContext?.dealId` (narrow) but React Compiler inferred `dealContext` (broad).
5. **Why did I write the narrow form?** Habit from pre-Compiler React; redundant once Compiler is on.

Root cause: **the codebase uses React Compiler — manual memoization is mostly obsolete**. The fix isn't "add the right deps", it's "remove the useMemo and let the Compiler handle it."

### Step 3 — Choose patch vs fix

- **Patch** (allowed under explicit conditions): time pressure to ship, root cause out of scope, root cause requires architectural change that needs its own spec.
- **Fix** (default): address the root cause directly.

If you patch, add a comment: `// TODO(wave-NN): root cause is X, patched here because Y.` And spawn a follow-up task. Never silently patch.

### Step 4 — Write the regression-protection step

Before declaring done, ask: what would prevent this same bug class from shipping again?

Options:
- A skill that calls out this pattern (add to `.claude/skills/`)
- A lint rule (custom rule in `eslint-plugin-app-custom/`)
- A pre-commit hook check
- A spec-template AC

Pick one. Implement it OR file it as a Process Engineer task.

---

## Anti-patterns / gotchas

- **Symptom-fix loop**: bug returns 3 weeks later in a different shape because you patched the visible symptom, not the underlying invariant. Cost compounds.
- **Why-stopping at "the framework does it"**: "React just works that way" is not a root cause. Why does React work that way? What invariant is it protecting? When does that invariant fail?
- **Five whys theater**: writing five whys for fun while still patching. The point is to change the action you take, not to prove you did the process.
- **Premature architectural rewrite**: the root cause might be "we picked the wrong framework 2 years ago." That's true and unactionable in this PR. Tag it as a long-term ADR candidate, patch the specific failure.

---

## Wave history

First applied in wave-28 after self-audit identified quick-patch pattern in wave-24 React Compiler memo error.
