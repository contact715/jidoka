# Skill: Adversarial self-review — try to break your own work before shipping

> Wave: w28  |  Status: experimental  |  Tags: [process, qa, falsification]

---

## When to use

- Before any commit that contains > 30 LOC of new code.
- Before declaring a wave done.
- Before responding "this is fixed" to a user.

The instinct after finishing a piece of work is to **verify** it (does it pass tests? does TS compile?). Verification finds known failure modes. Adversarial review finds **unknown** failure modes by deliberately trying to break the thing.

Industry note (2026): single-agent self-review collapses into sycophancy. A fresh-context critic catches drift; same-context "let me check it again" usually doesn't. When the context is yours and you can't dispatch a separate critic, you must FORCE the adversarial framing on yourself.

---

## Implementation guide

### Step 1 — Switch frames explicitly

Don't drift into adversarial mode — declare it. Write at the top of your scratchpad:

> "I am now an adversarial reviewer. My job is to find at least ONE real flaw in what I just shipped. If I can't find one, I haven't tried hard enough."

This sounds silly. It works.

### Step 2 — Run the four canonical attacks

For any UI change:
1. **Empty state**: what does this render when there's no data? Zero items? Null props?
2. **Long-content state**: what happens with a 200-character user name? 50 deals in one stage?
3. **Error state**: what if the API returns 500? What if the optimistic update rolls back?
4. **Edge interactions**: double-click, rapid clicks, keyboard nav, mobile touch, screen reader.

For any logic change:
1. **Boundary inputs**: 0, -1, empty string, null, undefined, NaN
2. **Concurrency**: what if two events fire in different orders?
3. **Permissions**: what if the user lacks the role to see this?
4. **State staleness**: what if the store mutated between render and click?

### Step 3 — Run the "what did I just change" check

Pull up the diff. For each modified line, ask: "what's the worst input that hits THIS line?" If you can think of one and you haven't tested for it, you have an open risk.

### Step 4 — Force one real concession

If after step 1-3 you have NO flaws, you've failed step 1. Try harder. Common dodges:
- "Edge cases unlikely to happen in practice" — note them anyway
- "Out of scope" — say it explicitly in the commit message
- "Pre-existing" — say it explicitly + decide whether to fix in-wave

Ship with the acknowledged concession in the commit message OR fix it before commit. Either is fine; silently shipping while ignoring known flaws is not.

### Step 5 — When possible, dispatch a Reflexion Critic

The Reflexion Critic agent runs on a separate context and is structurally adversarial — it's the externalised version of this skill. For waves > 100 LOC, dispatch it. Same-context self-review is a backstop, not a replacement.

---

## Anti-patterns / gotchas

- **Praise-disguised-as-review**: "I checked, it all looks great." This is not review. If you don't have at least one concrete observation (positive or negative), you didn't review.
- **Pattern-matching to past success**: "I've done this 10 times before" — irrelevant; the inputs are different this time.
- **Skipping because TS + tests pass**: those find known failures only. The bugs that hurt are the ones you didn't think to test.
- **Adversarial fatigue**: don't run this on trivial changes (typo fixes, comment edits). Reserve for substantive work or you'll dilute the habit.

---

## Wave history

First applied in wave-28 — self-audit found pattern of declaring "all clean" while ignoring obvious in-file issues.
