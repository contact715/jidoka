# Skill: dispatch by tier — Haiku / Sonnet / Opus per work shape

> Wave: 54  |  Status: experimental  |  Tags: [dispatch, cost, performance]

---

## When to use

Every time you call the Agent tool with `subagent_type: general-purpose` (or any other agent that takes a `model` override), pick the tier explicitly. The default is Sonnet — that's overkill for mechanical work and underpowered for hard architectural synthesis.

Anthropic's "Advisor strategy" (Code with Claude 2026) reports **frontier quality at 5x lower cost** by routing tiered. Wave-48 sweep (mechanical h-token replacement) burned ~120K tokens on Sonnet — Haiku would have done it for ~25K with equivalent output.

---

## The three tiers

### Tier 1: Haiku — mechanical, deterministic, high-volume

When the work is "find a pattern, apply a replacement, repeat":
- Mechanical token sweeps (h-9 → h-control, etc.)
- Bulk import migrations
- File-by-file text replacement following an unambiguous rule
- Counting / aggregating / formatting outputs
- Renaming a symbol across a known set of files

Cost: cheap (~$0.25 / 1M input tokens at time of writing).
Throughput: high (~3-4x Sonnet speed).
Failure mode: gives up if the rule has many exceptions. Solution: pre-scope the work so exceptions are explicit (see wave-48 retro — the h-10..h-14 residual should have been a Haiku-bounded sweep with explicit TODO emission).

### Tier 2: Sonnet — audits, code review, spec writing, synthesis

When the work needs judgment but the shape is known:
- Codebase audits (Cartographer, Design-Drift, Philosophy-vs-Product)
- Code review (Reflexion Critic)
- Spec writing per a template (Chief Architect, Micro Architect, Macro Architect)
- E2E test writing / debugging
- Self-Improvement Reviewer reading retros for patterns
- Most product-feature dispatches (FE Agent for a wave)

Cost: middle (~$3 / 1M input tokens).
This is the DEFAULT. If unsure, Sonnet.

### Tier 3: Opus — architectural decisions, novel synthesis, deep tradeoffs

When the work decides something that compounds across many future waves:
- Triple/Quad-lens synthesis after the architects have written briefs — the spec that locks in for the wave
- Self-Improvement Reviewer when the prior 5 waves show a structural failure class (architecture change candidate, not skill addition)
- One-shot research on a novel pattern (paired-lens write-up, philosophy gap analysis)
- Cross-wave pattern detection across 20+ retros

Cost: expensive (~$15 / 1M input tokens) — 5x Sonnet.
Use sparingly. Most "architectural" decisions are actually Sonnet-tier; reach for Opus only when the decision is genuinely irreversible or when prior Sonnet attempts produced shallow output.

---

## How to dispatch with a tier

The Agent tool supports an optional `model` parameter:

```ts
Agent({
  description: "Wave-48 mechanical h-token sweep",
  subagent_type: "general-purpose",
  model: "haiku",   // ← explicit tier
  prompt: "..."
})
```

Valid values: `"haiku"`, `"sonnet"`, `"opus"`. Omit for default (= sonnet, or whatever the agent definition specifies).

Some pre-defined agents (Chief Architect, Surface Cartographer, etc.) have `model: sonnet` in their frontmatter. The `model` parameter on Agent invocation overrides that — useful for promoting a Cartographer dispatch to Opus when the codebase question is hard.

---

## Decision tree

Asking "which tier?":

1. **Does the work involve a SUBSTANTIVE judgment call?** (architectural tradeoff, prioritisation, novel synthesis)
   - YES + the decision compounds across 5+ future waves → **Opus**
   - YES + standard shape we've done before → **Sonnet**
   - NO → continue
2. **Is the work mostly reading + writing English (not code transforms)?** (audits, retros, reviews)
   - YES → **Sonnet**
   - NO → continue
3. **Is the work mechanical pattern-match + replace?**
   - YES → **Haiku**
   - NO → defaults to **Sonnet**

---

## Anti-patterns

- **Sonnet for sweeps**. Wave-48 lesson. Sweeps are Haiku unless they require per-callsite judgment, in which case scope them to bounded chunks and use Haiku-per-chunk.
- **Haiku for synthesis**. Haiku will produce literal-but-shallow synthesis. Use Sonnet minimum for any work that combines multiple inputs into a recommendation.
- **Opus for everything because "it's just better"**. 5x cost. Sonnet is good enough for 80%+ of dispatches. Opus is for the irreversible decisions.
- **Forgetting to specify the tier**. Default = Sonnet. If you're sure the work is Haiku-tier and you don't pass the model param, you're burning ~5x what you need.

---

## Calibration log (update as we learn)

| Work shape | Default tier | Observed tokens | Outcome |
|---|---|---|---|
| Mechanical h-token sweep across 184 files | **Should be Haiku** | wave-48 used Sonnet, ~120K | Acceptable but ~5x what Haiku would cost |
| Whole-repo duplicate audit (Cartographer) | Sonnet | wave-40 ~207K | Right tier |
| Cross-wave Self-Improvement Reviewer | Sonnet | wave-41 ~140K | Right tier |
| Philosophy-vs-Product audit | Sonnet | wave-45 ~162K | Right tier |
| Triple-lens architects + Chief Architect synthesis (wave-36) | Mixed: Micro=Sonnet, Macro=Sonnet, Chief=Opus would have been right | wave-36 ~155K | Sonnet throughout; Opus for synthesis would have caught the stripe-vs-title trigger ambiguity earlier |
| Mechanical sweep dispatch (wave-48b retry, wave-49b retry) | **Haiku rejected: "Prompt is too long"** | 0 tokens, 581 ms | **Haiku has smaller input context than Sonnet — prompts > ~5K tokens may reject.** Re-dispatched on Sonnet. Lesson: tight prompts (≤ 250 lines) are required for Haiku; otherwise fall back to Sonnet. |

## Haiku gotcha (wave-57 lesson)

Haiku rejected mechanical-sweep dispatches with **"Prompt is too long"** when given ~7K-token instructions with detailed step-by-step + code examples. The Haiku context window for the *input prompt* is smaller than Sonnet's. Workarounds:
1. Strip verbose instructions; keep the prompt under ~250 lines / ~5K tokens.
2. Move code examples to skill files in `.claude/skills/`; have the dispatch prompt reference them.
3. If the prompt genuinely needs to be long (e.g. multi-file context), use Sonnet — that's the right tier anyway.

**Practical heuristic**: if you're typing a prompt and it crosses one screen of plain text, you're in Sonnet territory. Haiku is for SHORT prompts driving high-volume mechanical work.

## Out-of-scope (for now)
- **Auto-tier selection** — a meta-agent that reads the dispatch prompt and picks the tier. Possible but adds latency + cost itself. Manual decision per dispatch is fine while we calibrate.
- **Per-tier budget caps** — could enforce "no Opus dispatch over 500K tokens". Skipped — tier choice is upstream of token budget.

---

## Quick reference card

```
Sweep / mechanical replace / bulk rename     →  Haiku
Audit / review / spec / retro analysis       →  Sonnet  (default)
Architectural synthesis / novel research     →  Opus    (rare)
```

If you're unsure: Sonnet. If you're sure it's mechanical: Haiku. If the decision will compound across 5+ waves: Opus.
