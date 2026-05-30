# Self-Improvement Protocol

How the agent system keeps improving itself across waves. Shipped in wave-41.

## The gap this closes

Per-wave loops already exist:
- **Skill Extractor** (wave-18) — reads ONE retro per wave, writes a skill if patterns repeat in that one retro
- **Reflexion Critic** (wave-22, auto-queue wave-33) — adversarial review of ONE commit
- **Skills aging audit** (wave-34) — quarterly check of skill citation counts

What's missing: **cross-wave pattern detection**. A pattern that appears in 3 retros under 3 different names won't get caught by any per-wave reader. The wave-39 Surface Cartographer was created exactly because of this gap — 4+ retros each touched the duplicate-surface failure class without anyone connecting the dots.

The Self-Improvement Reviewer (wave-41) reads a WINDOW of recent retros and looks for recurrence across the window.

## Trigger cadence

**Every 5 waves**. Post-commit hook (`scripts/check-self-improvement-due.sh`) checks the commit subject for `wave-NN` and fires when NN is divisible by 5. A queue file at `.claude/self-improvement-queue/wave-NN.md` notes the next agent to dispatch the reviewer.

**On demand**: `npm run agents:improve` forces a queue file regardless of the modulo check.

**Manual**: user can ask for "self-improvement pass" any time.

## The 6-step protocol (Reviewer agent)

1. **Enumerate retros in scope**: last 5 wave-NN.md files by default.
2. **Extract observations**: every bullet under "Patterns observed", "Honest gap", "Decision", "Anti-pattern", "Bash bug" sections. Tag each with source retro.
3. **Canonicalise**: two observations are "the same pattern" if their semantic content matches even when worded differently. Example pairs:
   - "bash + pipefail + grep no-match" ≈ "grep returns 1 when no match under set -e"
   - "didn't run visual specs" ≈ "rendered-verification not adopted" ≈ "visual check skipped"
   - "spec estimated 32 LOC, shipped 70" ≈ "LOC overshoot 2x" ≈ "implementation went off-spec"
4. **Count occurrences across retros**. Threshold: ≥ 3 in the 5-retro window (60%+ recurrence) = a SIGNAL.
5. **Diff against existing skills**: if a signalling pattern already has a skill, was the skill CITED in any recent retro? Zero citations = skill exists but isn't used (process gap, not skill gap).
6. **Decide skill vs architecture**: recurring patterns fixable by a 1-page reminder are skills. Recurring patterns where a skill already exists OR has been proposed and still fails are architecture changes (new agent, new hook, store invariant).

## Output

Report at `docs/audit-reports/{YYYY-MM-DD}-self-improvement-wave-{NN}.md`. Target 800-1500 words. Sections:
- Summary (counts)
- Recurring patterns (count ≥ 3) with variation list + verdict per pattern
- Skills with declining citations
- Proposed new skills
- Proposed architectural changes
- Drift signals (LOC estimate vs actual, token cost trend, wallclock trend)
- Honest gaps in the review itself

## Decision rules

- **Three is the threshold**. Patterns with count 1-2 are "watch-list", not findings.
- **Skill before architecture**. New architecture costs more; only escalate when skill solutions have already been tried or proposed.
- **Don't repeat past proposals**. If a previous SI review proposed X and X wasn't actioned, surface it with "escalating — proposed YYYY-MM-DD, not actioned". Track recidivism.
- **Cite specific retros**. Every recurrence claim carries source filenames.

## File locations

- Agent charter: `.claude/agents/self-improvement-reviewer.md` (gitignored)
- Trigger script: `scripts/check-self-improvement-due.sh` (tracked)
- npm command: `npm run agents:improve` (tracked via package.json)
- Queue: `.claude/self-improvement-queue/wave-NN.md` (gitignored, ephemeral)
- Reports: `docs/audit-reports/{YYYY-MM-DD}-self-improvement-wave-{NN}.md` (tracked, permanent)

## Relationship to other loops

| Loop | Granularity | Reader | Triggers |
|---|---|---|---|
| Reflexion Critic | One commit | Diff + spec | Post-commit hook (LOC + files thresholds) |
| Skill Extractor | One retro | Retro patterns observed | Post-wave hook (every wave) |
| Skills aging audit | All skills | Skill citation count over recent waves | `npm run skills:audit` |
| **Self-Improvement Reviewer** (this) | Window of 5 retros | All retro sections cross-referenced | **Every 5 waves OR on demand** |

## What this is NOT

- Not a code reviewer. Reflexion Critic does code review.
- Not a per-wave skill writer. Skill Extractor does that.
- Not a metrics generator. Metrics Aggregator does that.
- Not a guardian or tenant-safety check. Those are L2.

It's specifically about looking AT THE AGENT SYSTEM and asking "are we drifting".
