# wave-frontier Master Spec — Close the gap to frontier autonomous agentic development

**Status:** Complete (all 6 modules shipped 2026-05-31) · **Level:** L1 · **Owner:** platform · **Created:** 2026-05-30

> **Shipped 2026-05-31.** All 6 modules: deterministic self-test green, in CI via `npm run eval`
> (12/12 = 100%), instantiation-audit 0 ghosts, counts + global snapshot refreshed, committed.
> M1 eval-suite `scripts/eval-suite.mjs` · M2 judge-panel `scripts/judge-panel.mjs` · M3 budget
> `scripts/budget-gate.mjs` · M4 policy `scripts/policy-sandbox.mjs` · M5 orchestration
> `scripts/orchestration-planner.mjs` · M6 memory `scripts/memory-consolidate.mjs`. Two real
> mistakes were caught in-loop and turned into mechanisms (policy-glob crash → eval caught it;
> baseline-fixation → eval-suite now refuses to baseline a failing suite). Honesty: M1-M6 cores
> are FULL; LLM judging (M2) and OS-level isolation (M4) remain PROXY/DORMANT as labeled in §1.

> Goal: move jidoka from ~35-45% of autonomous frontier toward "agents do the work, the human
> only makes business decisions". Based on a cited comparative analysis against Anthropic
> (Dynamic Workflows, Bloom evals, Claude Code sandboxing, reward-hacking research), OpenAI
> (Agents SDK, eval-driven dev, o3 inference search), DeepMind (AlphaEvolve, FunSearch, AlphaProof).

## §0 The gap (why this wave exists)

The analysis found: strong **quality discipline** (constitutional gating, TLA+, instantiation-audit,
closed-loop meta-engine) surrounded by **compensating weaknesses** that drop us below frontier:
no agent-eval suite (can't prove the framework doesn't regress), single judge (reward-hackable),
no execution budget (can't leave it running), no per-agent isolation (blast radius), static
orchestration (pipeline decides, not the task), KV-only memory (no consolidation).

Without an **eval suite** every other improvement is blind — it is the fitness signal that turns
skill-extractor into evolution and meta-engine's "better" into a machine-checked claim. So it is built first.

## §1 Honesty boundaries (read before judging completion)

This wave builds REAL, executable mechanisms (zero-dep node where possible), but some frontier
capabilities are bounded by the environment. Each module states what is FULL vs PROXY vs DORMANT:
- **FULL** — works end-to-end, proven by a command whose output is shown.
- **PROXY** — a real mechanism that approximates a frontier capability the environment can't give
  natively (e.g. policy-level isolation instead of OS sandbox; deterministic eval scoring instead
  of always-LLM judging). Marked as such, never claimed as the frontier version.
- **DORMANT** — scaffolding + seed, activates when real data/LLM/target is wired (honest, not fake).

A module is "done" only with an executable proof in the same step. No declaration-over-implementation.

## §2 Modules (with acceptance criteria)

### Module 1 — Agent eval suite `[priority 1, highest leverage]`
The fitness signal for the whole system.
- **AC-1.1** `docs/evals/<agent>/golden-cases.jsonl` seeded for ≥3 key agents (constitutional-reviewer,
  reflexion-critic, chief-architect), ≥5 cases each. `[FULL for structure]`
- **AC-1.2** Deterministic scoring layer: each case carries machine-checkable assertions (regex/
  must-contain/must-not-contain/verdict-match) scored WITHOUT an LLM. `[FULL — runs zero-dep]`
- **AC-1.3** Baseline registry `docs/evals/_baseline.json` — per-agent pass-rate; a run compares
  against it and flags regression (>5% drop). `[FULL]`
- **AC-1.4** LLM-judge layer optional (run-evals already has it) — DORMANT until run with a model. `[DORMANT, honest]`
- **AC-1.5** `npm run eval` runs the deterministic suite, exits 1 on regression. Wired into CI. `[FULL]`
- **AC-1.6** Fitness hook: eval pass-rate feeds meta-trend as the "are we getting better" metric. `[FULL]`

### Module 2 — Diverse judge panel `[priority 2]`
Kill the single-judge reward-hacking failure point.
- **AC-2.1** `scripts/judge-panel.mjs` — runs N judges (default 3) with DISTINCT rubrics (correctness /
  spec-compliance / adversarial-skeptic), aggregates by majority. `[FULL — mechanism; LLM calls DORMANT]`
- **AC-2.2** Rubric rotation: rubrics are pulled from a registry so two runs don't use identical framing
  (anti-overfit to one judge prompt). `[FULL]`
- **AC-2.3** Disagreement surfaced: if judges split, output is `CONTESTED` (escalate to human), not a
  silent majority. `[FULL]`
- **AC-2.4** Deterministic self-test proving majority/contested/consensus logic without LLM. `[FULL]`

### Module 3 — Cost/tool budget enforcement `[priority 3]`
The hard ceiling that makes "leave it running" safe.
- **AC-3.1** `scripts/budget-gate.mjs` — reads a per-wave budget (tool calls / est. tokens), tracks
  consumption from telemetry, exits 1 when exceeded. `[FULL]`
- **AC-3.2** `docs/quality/budget-policy.json` — declarative limits per tier (trivial/normal/critical). `[FULL]`
- **AC-3.3** Runaway guard: a single agent exceeding its solo cap halts before the global cap. `[FULL]`
- **AC-3.4** Deterministic self-test (under / at / over budget). `[FULL]`

### Module 4 — Policy sandbox (write_scope + tool-grant enforcement) `[priority 4]`
Blast-radius limit at policy level (PROXY for OS sandbox).
- **AC-4.1** `scripts/policy-sandbox.mjs` — given an agent slug + a changed-file list, verifies every
  path is inside that agent's `write_scope` (from agent-access-registry); flags out-of-scope writes. `[FULL]`
- **AC-4.2** Tool-grant check: an agent's declared_tools is the allowlist; using an undeclared tool is
  a violation (checked against the registry). `[FULL]`
- **AC-4.3** Honest boundary doc: this is POLICY isolation, not OS isolation — names the limitation and
  points at Claude Code Sandboxing as the real-OS path when available. `[PROXY, documented]`
- **AC-4.4** Deterministic self-test (in-scope pass, out-of-scope block). `[FULL]`

### Module 5 — Dynamic orchestration `[priority 5]`
The task picks the agent graph, not a fixed pipeline (PROXY for Anthropic Dynamic Workflows).
- **AC-5.1** `scripts/orchestration-planner.mjs` — given a task descriptor (type, risk, surfaces,
  stack), emits the ordered agent graph to dispatch (which teams, which gates, parallel vs serial). `[FULL — planner]`
- **AC-5.2** Rules registry `docs/quality/orchestration-rules.json` — declarative: trivial → skip
  architects; product wave → product team; backend touched → backend-agent + security; etc. `[FULL]`
- **AC-5.3** dev-pipeline skill references the planner: orchestrator calls it to compose the graph
  instead of running the full static flow every time. `[FULL — wiring]`
- **AC-5.4** Honest boundary: this composes from a FIXED agent set by rules; it does not yet generate
  novel agents at runtime (that's the true Dynamic-Workflows frontier). Documented. `[PROXY]`
- **AC-5.5** Deterministic self-test (trivial task → minimal graph; critical backend → full graph). `[FULL]`

### Module 6 — Memory consolidation `[priority 6]`
Episodic+semantic memory with consolidation, not raw KV.
- **AC-6.1** `scripts/memory-consolidate.mjs` — reads the cross-project ledger + retros, clusters by
  class/theme, emits a consolidated `~/.claude/jidoka/memory-consolidated.md` (the "what we've learned"
  digest the orchestrator reads at session start). `[FULL]`
- **AC-6.2** Recency+frequency weighting: a lesson seen often and recently ranks above a one-off. `[FULL]`
- **AC-6.3** Decay: lessons untouched for a long window are demoted (ties into meta-decay). `[FULL]`
- **AC-6.4** Deterministic self-test on a synthetic ledger. `[FULL]`

## §3 Order of implementation (each closes independently with proof + commit)
1. Module 1 (eval suite) — fitness foundation, unblocks the rest.
2. Module 2 (judge panel) — removes single-point reward-hacking.
3. Module 3 (budget) — safety ceiling for autonomy.
4. Module 4 (policy sandbox) — blast-radius limit.
5. Module 5 (dynamic orchestration) — task-driven graph.
6. Module 6 (memory consolidation) — durable cross-project learning.

## §4 Out of scope (honest)
- True OS-level sandbox per agent (needs Claude Code Sandboxing API / containers) — Module 4 is the policy PROXY.
- Runtime novel-agent generation (Anthropic Dynamic Workflows) — Module 5 composes from a fixed set.
- RL training loop / model fine-tuning — we orchestrate a frontier model, we don't train it.
- Always-on LLM judging in CI — too costly; deterministic layer is primary, LLM layer is opt-in.

## §5 Definition of done for the wave
All 6 modules: deterministic self-test green, wired into the engine (CI/dev-pipeline/meta-trend),
instantiation-audit 0 ghosts, README/roster counts updated, global snapshot refreshed, committed + pushed.
Every FULL claim proven by shown command output; every PROXY/DORMANT labeled.
