# Skill: tool or skill or subagent — decide before adding capability

> Wave: 56  |  Status: experimental  |  Tags: [architecture, dispatch, decision-tree]

---

## When to use

EVERY time you're about to add a new capability to the system, ask first: which container does this belong in? Wrong container = bloat + worse outcomes.

The three containers Anthropic ships in Claude Code:
- **Tool**: single-purpose deterministic API (database.query, fs.write)
- **Skill**: reusable markdown instructions Claude reads on-demand
- **Subagent**: delegated parallel execution with its own context window

Code with Claude 2026 talk "Tool, skill, or subagent? Decomposing an agent that outgrew its prompt" makes this an explicit decision framework. We've been intuiting it for 28+ waves (Cartographer, DSA, SI Reviewer = subagents; the 17 .md files = skills; lint rules + audit scripts = tools). This skill codifies the choice.

---

## The three definitions

### Tool

A **deterministic API call** the orchestrator makes inline. Returns immediately. Examples in our system:
- `Bash` (run a shell command)
- `Read` / `Write` / `Edit` (file ops)
- `Grep` / `Glob` (search)
- Custom npm scripts (`npm run check:design-drift`, `npm run outcome:check`, etc.)
- Eslint rules (`no-raw-control-height`, etc.)
- Husky hooks (`post-commit`, `commit-msg`)

**Cost**: small, deterministic, predictable.
**Failure mode**: nothing — tools don't have output quality concerns, only correctness.
**Decision rule**: if the operation has a SINGLE correct answer and you can specify the inputs/outputs precisely, it's a tool.

### Skill

A **reusable markdown instruction** Claude reads when relevant. Lives at `.claude/skills/<slug>.md`. Examples:
- `outcome-driven-loop.md` (wave-53) — codifies when to use outcome loops
- `dispatch-by-tier.md` (wave-54) — codifies Haiku/Sonnet/Opus routing
- `surface-audit-before-touch.md` (wave-27) — pre-edit discipline
- `adversarial-self-review.md` — review-your-own-claim discipline
- `rendered-verification.md` (wave-33) — run e2e:visual before declaring done

**Cost**: zero compute; loaded into context on demand.
**Failure mode**: skill text says X but agent does Y. Drift. Catch via SI Reviewer.
**Decision rule**: if the answer requires Claude's JUDGMENT but the same checklist applies every time, it's a skill. Reminders for Claude, not code for the machine.

### Subagent

A **delegated execution with its own context window**, run in parallel or sequence. Examples:
- Surface Cartographer (wave-39) — codebase grep on a fresh context
- Self-Improvement Reviewer (wave-41) — reads N retros on a fresh context
- Reflexion Critic (wave-22) — diff review on a fresh context
- Chief Architect (wave-16) — spec synthesis on a fresh context

**Cost**: substantial (~30K-200K tokens depending on tier).
**Failure mode**: token spend without commensurate output quality. Catch via outcome gating (wave-53).
**Decision rule**: if the work needs its OWN CONTEXT (reads many files, accumulates intermediate state, produces a substantive artifact), it's a subagent.

---

## The decision tree

Ask, in order:

### Q1. Can a deterministic check produce the answer?

- **YES** → **Tool**. Implement as bash/script/eslint rule/lint config. Example: "is `h-9` used in the codebase?" → `git grep -c 'h-9' app/`. Done. Not a skill, not a subagent.

If you're tempted to write a SKILL that says "Claude, count the h-9 usages and report", you're misusing the abstraction. Build a tool. The skill should say "before doing X, RUN the tool".

### Q2. Does the work require Claude's judgment but follow a repeatable checklist?

- **YES** → **Skill**. Write a markdown file with the checklist + when to use + anti-patterns. Example: "before editing a UI surface, take a screenshot and audit the WHOLE view" — this needs judgment (what's wrong?) but follows the same procedure every time. The skill says "look before you touch" + "here are the patterns to spot".

If the skill would need to ENUMERATE every possible decision context, it's actually a subagent — the work doesn't fit a checklist.

### Q3. Does the work need its own context window (reads many files, accumulates state, produces an artifact)?

- **YES** → **Subagent**. Define an agent role in `.claude/agents/<role>.md` with charter, inputs, outputs, ceilings. Example: "audit the codebase for duplicate surfaces" — too big for inline orchestrator context, needs separate read budget, produces a structured report. That's a subagent (Surface Cartographer).

If the subagent's job could be a checklist over `< 5 files`, it's actually a skill + a tool. Don't dispatch a context window for what fits in 200 lines of markdown.

---

## Combinations

The three are LAYERED, not exclusive. Best results from combining:

```
Skill says:   "Before any non-trivial wave, run the Cartographer to find existing implementations."
Subagent:     Cartographer reads the codebase + writes a brief.
Tool:         The brief includes file:line citations the user can click.
```

```
Skill says:   "Sweeps must have an outcome gate."
Tool:         npm run outcome:check --name=design-drift-zero-heights
Subagent:     Mechanical sweep agent runs until outcome met or budget exhausted.
```

When you're sure of the SHAPE of the work, all three should be present:
- Tool that measures
- Skill that says "use the tool here"
- Subagent that does the heavy lifting between measures

When ANY of the three is missing, the system has a hole.

---

## Anti-patterns

- **Skill that should be a tool**. "Skill: count the raw heights and report." Just build the tool. Don't make Claude grep + count + format every time.
- **Tool that should be a skill**. "Tool: decide if this commit is a refactor or a feature." That's judgment, not a function. Skill the rubric; let Claude apply it.
- **Subagent that should be a skill + tool**. "Subagent: read the design system docs and tell me which tokens to use." If the docs are < 5 files and the answer is mechanical lookup, it's a skill ("look up tokens in `docs/DESIGN_SYSTEM.md` via `rg`") + a tool (the grep). Don't burn a context window for that.
- **Subagent that's actually 3 subagents**. "Subagent: audit the codebase for duplicates, design drift, AND philosophy gaps." Too broad. Three subagents, run in parallel.
- **Skill that's a wishlist**. "Skill: try to ship a beautiful page." Not a checklist; not deterministic; no judgment rubric. That's a goal, not a skill.

---

## Concrete inventory (current state, wave-56)

| Capability | Container | Why |
|---|---|---|
| Find raw `h-9` usages | Tool (`git grep` / npm script) | Deterministic count |
| Decide if a wave needs Cartographer | Skill (`tool-or-skill-or-subagent.md` — this one) | Judgment + checklist |
| Run whole-repo duplicate audit | Subagent (Cartographer) | Own context, big artifact |
| Validate spec against design system | Skill | Judgment, repeatable checklist |
| Enforce h-9 → h-control in CI | Tool (ESLint rule) | Deterministic |
| Read N retros + find cross-wave patterns | Subagent (SI Reviewer) | Own context, big synthesis |
| Remember to run e2e:visual before commit | Skill (`rendered-verification.md`) | Reminder, not action |

---

## When to refactor

A capability that started as one container often migrates over time:

- **Tool → skill**: when the tool exists but Claude keeps forgetting to use it. Write a skill that says "remember to call <tool>".
- **Skill → tool**: when the same skill action is performed every time deterministically. Build the tool, the skill becomes "the tool exists, call it".
- **Skill → subagent**: when the skill grows over 400 LOC + needs to read multiple files + produces an artifact. Promote to subagent.
- **Subagent → skill + tool**: when a subagent dispatch is too expensive for the work + the work is more mechanical than judgment. Decompose.

The wave-29.4 LeadDetailsPanel decomposition (595 LOC → 413) is the COMPONENT version of this. Same instinct applies to capabilities: decompose when one container outgrows its shape.

---

## Refactoring example (hypothetical)

Suppose we have a 800-LOC `surface-audit-before-touch.md` skill that's become unwieldy. The decomposition:

1. **Tool**: `npm run audit:current-surface` — screenshots the current route + outputs a structured "elements at risk" list
2. **Subagent**: `Visual Surface Cartographer` — receives the screenshot + structured list, returns a "what changed since baseline" report
3. **Skill** (now shrunk to 100 LOC): "before any UI edit, RUN the tool + INTERPRET the cartographer output + DECIDE which changes are intentional"

Same outcome, better-shaped containers, lower per-dispatch cost.

---

## Pattern observed (skill author's note)

We've intuited this framework for 28+ waves. Without writing it down, every new capability addition was a 5-minute negotiation with myself. Now it's a 30-second decision against an explicit tree.

Skills like this one don't change BEHAVIOR — they reduce DECISION COST. Same outcome, less friction per occurrence. The compounding benefit is real.

---

## Out of scope

- **Multi-agent coordination patterns** (Commander/Detector/Navigator from Anthropic Code with Claude 2026) — that's about how subagents COMBINE, not about which container.
- **MCP servers as tools** — they're tools too, but with persistent state. Could be a follow-up skill `mcp-or-tool` if it bites.
