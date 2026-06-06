# GitHub Research Brief: Agent Pipelines, Spec-Driven Dev, Memory, Eval

**Date:** 2026-06-05
**Scope:** What's alive on GitHub (2025-2026) in four areas — spec-driven dev, multi-agent verification/debate, LLM-judge calibration, agent memory. Goal: steal specific mechanics to strengthen jidoka. Not replacing our engine, cherry-picking from theirs.

---

## TOP-15 RANKED BY USEFULNESS TO JIDOKA

---

### #1 — Graphiti (getzep/graphiti)
**Stars:** 27.1k | **Last release:** active 2026
**One line:** Temporal knowledge graph where every fact has a validity window — stored when it became true AND when it was superseded.
**What they have we don't:** Our mcp__memory knowledge graph stores facts but doesn't track when they became stale or were contradicted. Graphiti auto-invalidates old facts on write (not delete — preserves history) and lets you query "what was true at time T." Hybrid retrieval: semantic embeddings + BM25 keyword + graph traversal combined.
**Verdict: БЕРЁМ ПРИЁМ.** Plug into our memory layer: when an agent writes a new fact that contradicts an older one, invalidate the old record with a timestamp instead of silently overwriting. Practically: add `valid_until` to our knowledge graph node schema. Implement in `MEMORY_MERGE_PROTOCOL`.

---

### #2 — GitHub Spec-Kit (github/spec-kit)
**Stars:** 109k | **Last release:** v0.9.5, June 5 2026
**One line:** Spec-Driven Development toolkit — Constitution → Specify → Plan → Tasks → Implement, each as a distinct agent command with phase gates.
**What they have we don't:** A `constitution.md` file that defines non-negotiable governing principles, referenced throughout every subsequent phase. Their Simplicity Gate and Anti-Abstraction Gate make the agent explicitly justify any complexity — if the gate fails, the justification is logged in a Complexity Tracking section, creating a permanent accountability record.
**What we have they don't:** L0-L4 hierarchy, wave-based retros, meta-learning ledger, prosecutor-defender-judge. Theirs is phase-gated but has no adversarial verification and no meta-learning loop.
**Verdict: БЕРЁМ ПРИЁМ.** Adopt the explicit Complexity Gate: before any spec passes to implementation, agent must state "this is complex because X" or confirm "simple, no justification needed." Adds one step to our constitutional gate. Also: their constitution-first principle is exactly our CONSTITUTION.md — confirm it's referenced at every wave start, not just at install.

---

### #3 — LangMem (langchain-ai/langmem)
**Stars:** ~2k (part of 100k+ LangChain org) | **Active 2026**
**One line:** SDK for long-term agent memory — episodic, semantic, and procedural memory, with a "subconscious" background reflection pass that runs after conversations go idle.
**Key mechanic:** "Gradient" algorithm: after each session, an LLM critiques the agent's current system prompt, proposes a delta, and applies it. Agents rewrite their own instructions based on accumulated feedback. This is procedural memory — not just facts, but improving the agent's behavior rules.
**What we have vs them:** We have Kaizen retros that improve our spec prompts, but this is manual. LangMem does it automatically between sessions.
**Verdict: БЕРЁМ ПРИЁМ.** The "gradient" background reflection pattern — after each jidoka wave, a background step critiques the agent prompts that underperformed (surfaced by our meta-error ledger) and proposes a prompt delta. Currently our prompt-evolution is manual. This pattern makes it automatic. Lands in `auto-strengthen.mjs` + SELF_IMPROVEMENT_PROTOCOL.

---

### #4 — OpenSpec (Fission-AI/OpenSpec)
**Stars:** 53.1k | **Last release:** v1.4.1, June 3 2026
**One line:** Delta-based spec management — every change lives as a self-contained folder (proposal + design + tasks + delta specs), merged into master specs only after shipping.
**What they have we don't:** The archive pattern: completed changes move to `openspec/changes/archive/`. This means the spec tree stays clean and only reflects current-state reality, while history lives in archive — not in the main spec files as accumulated cruft.
**What we have they don't:** Hierarchical L0-L4 parents chain, adversarial gates, meta-learning.
**Verdict: БЕРЁМ ПРИЁМ.** Adopt the archive pattern in our spec hierarchy: completed wave specs move to `docs/specs/archive/` after wave retro, keeping the active spec tree representing only what's currently live. Reduces confusion when reading L3/L4 specs that contain stale completed items.

---

### #5 — Mem0 (mem0ai/mem0)
**Stars:** 41k | **Active 2026**
**One line:** Intelligent memory layer — extracts salient facts from conversations rather than storing raw chunks, with graph memory option (entities as nodes, relationships as edges).
**Key mechanic:** Two-phase pipeline: Extract (LLM identifies which facts from a message pair are worth keeping) then Update (merge with existing, detect contradictions). Retrieval fuses semantic similarity + keyword + entity matching in parallel, then combines scores.
**What we have vs them:** Our mcp__memory stores what we explicitly write. Mem0's extraction phase means the system decides what's worth remembering — we don't have that filter.
**Verdict: БЕРЁМ ПРИЁМ.** Add an extraction step to our retro/memory write: before writing to the knowledge graph, run a short LLM pass that filters "what from this session is actually worth persisting?" Currently everything the agent decides to write gets written. The extraction filter improves signal-to-noise in our memory over time. Implement as a pre-write hook in `export-memory-snapshot.mjs`.

---

### #6 — SWE-Gym (SWE-Gym/SWE-Gym) — Verifier Training
**Stars:** 685 | **ICML 2025**
**One line:** Training environment that produces outcome verifiers — models that score agent solutions and enable best-of-N selection at inference time.
**Key mechanic:** Verifiers trained on agent trajectories (not just final answers) learn to recognize good reasoning paths, not just correct outputs. Best-of-N: run the agent N times, let the verifier pick the winner. Result: 32% on SWE-Bench (new open SoTA at time of paper).
**What this means for us:** Our debate gate (prosecutor-defender-judge) is a single-pass adversarial review. We don't generate multiple solution candidates and score them.
**Verdict: БЕРЁМ ПРИЁМ (future wave).** In high-stakes waves, run our code-generation agent 3x with different temperature/prompts, then run a lightweight scoring pass to pick the best output before passing to the judge gate. Not a model training exercise — just the "run N, score, pick 1" inference pattern. Lands in our gating pipeline.

---

### #7 — JudgeLM (baaivision/judgelm)
**Stars:** 434 | **ICLR 2025 Spotlight**
**One line:** Fine-tuned LLM judge with three concrete bias-correction techniques that push agreement with GPT-4 to 89%.
**Three techniques:**
1. Swap augmentation — evaluate both answer orderings, average scores. Removes position bias (models favor the first answer shown).
2. Reference support — give the judge a reference answer to anchor against. Removes hallucination.
3. Reference drop — randomly omit the reference during training so the judge stays robust when no reference is available.
**What we have vs them:** Our judge gate uses a single-pass prompt. No swap, no reference anchoring.
**Verdict: БЕРЁМ ПРИЁМ.** Implement swap augmentation in our debate judge step: evaluate the candidate solution once with prosecutor argument first, once with defender argument first, then average. Cost: 2x LLM calls for the judge — worth it for catching position bias. Reference support: pass the accepted spec as the judge's anchor document. Both fit in our existing `judge` gate prompt.

---

### #8 — AutoGen (microsoft/autogen)
**Stars:** 58.7k | **Now in maintenance — new work in microsoft/agent-framework**
**One line:** Multi-agent conversation framework; 4-agent debate loop in ~20 LLM calls minimum.
**What's useful:** Their teacher-planner-reviewer pattern: three specialized agents in a loop where the reviewer blocks progress until it says "DONE." We already have a similar structure (reflexion, constitutional, judge). The explicit "DONE" signal from a reviewer agent (not the implementer declaring themselves done) is the specific mechanic worth noting.
**What we have they don't:** Our gates are external hooks not embedded in the agent loop, which is stronger.
**Verdict: МИМО (pattern already covered).** We already do adversarial gate chains. AutoGen is now in maintenance mode. The "DONE gate owned by reviewer not implementer" principle is already implicit in our constitutional gate — make it explicit in gate prompts rather than adopting AutoGen.

---

### #9 — AG2 (ag2ai/ag2)
**Stars:** 4.6k | **v0.13.3, June 5 2026**
**One line:** Open-source fork of AutoGen after the Microsoft/community split; same nested-chat and group-chat patterns, actively maintained.
**Verdict: МИМО.** Architecturally same patterns as AutoGen. Low stars relative to alternatives. No mechanics beyond what AutoGen already offered. Active community, but nothing we can steal that isn't already covered.

---

### #10 — OpenHands (OpenHands/OpenHands)
**Stars:** 74k | **ICLR 2025**
**One line:** Autonomous software engineering agent platform — event-stream architecture, self-correction via observation-action-observation loops.
**Key mechanic:** Event stream as the agent's memory within a session: every action AND its environment observation (result) is stored and visible to the agent's next decision. Self-correction is implicit — the agent sees its own failures and replans. No explicit reviewer, just the event log forcing honest state.
**What we have vs them:** We have explicit gates. They have continuous implicit self-correction from the environment feedback stream.
**Verdict: БЕРЁМ ПРИЁМ.** Add the action-observation log pattern to our debug agent: when the debug agent produces a fix, the pipeline should explicitly surface the prior failure observation as context for the fix, not just the error message. Currently we pass the error. Passing the full action→failure trace gives the debug agent better context. Small prompt change, big context quality gain.

---

### #11 — Letta (letta-ai/letta)
**Stars:** 22k | **Active 2026**
**One line:** MemGPT evolved into a full stateful agent platform — three-tier memory (core/recall/archival) with programmatic paging between tiers.
**Key mechanic:** Sleep-time memory reflection: a background process runs after the agent goes idle, reviews conversation history, and consolidates/summarizes into archival storage. This is separate from active-session memory — it happens asynchronously.
**What we have vs them:** Our `memory-consolidate.mjs` does something similar but it's manually triggered. Letta's sleep-time pass is automatic and continuous.
**Verdict: БЕРЁМ ПРИЁМ.** Make `memory-consolidate.mjs` trigger automatically after each wave retro completes (not just monthly routine). Add it as the final step in `routine-weekly.sh`. This is already built — just needs the automation wire.

---

### #12 — CrewAI (crewAIInc/crewAI)
**Stars:** 50k+ | **Active 2026**
**One line:** Role-based multi-agent framework with a built-in self-evaluation loop flow — one crew generates, another evaluates, first crew revises if rejected.
**What's useful:** Their `self_evaluation_loop_flow` is a clean reference implementation of generate-evaluate-revise. The evaluator Crew checks explicit criteria (character count, forbidden elements, style rules) before declaring valid. Simple and readable.
**What we have vs them:** Our constitutional gate does this but is prompt-based rather than criteria-checklist-based. Their approach is more auditable.
**Verdict: БЕРЁМ ПРИЁМ (minor).** In our constitutional gate, convert the "check against constitution" prompt into an explicit checklist with binary pass/fail per item. Evaluator returns a structured result like {item: "no hallucinated facts", pass: true/false, note: "..."}. Easier to audit and debug than a freeform judgment.

---

### #13 — SWE-agent (SWE-agent/SWE-agent)
**Stars:** 19.4k | **v1.1.0, May 2025**
**One line:** Princeton research agent that fixes real GitHub issues — defined by a single YAML config that shapes how the LM interacts with the filesystem.
**What's useful:** The single-YAML ACI (Agent-Computer Interface) pattern — the entire tool interface and behavior is defined in one human-readable config. Swapping models or adjusting agent behavior = editing YAML, no code change. Makes the agent's "surface area" auditable.
**What we have vs them:** Our agents are defined across multiple prompt files and scripts. No single ACI config.
**Verdict: МИМО (strategic, not urgent).** Consolidating our agent interface definitions is a good long-term refactor but not a quick steal. Flag for a future architecture wave.

---

### #14 — Awesome-LLM-as-a-Judge (llm-as-a-judge/Awesome-LLM-as-a-judge)
**Stars:** 556 | **Active**
**One line:** Survey repo covering all LLM-judge research — bias types, calibration papers, ensemble methods.
**What's useful as a reference:** JudgeBlender pattern (ensembling multiple judge models and averaging). Self-preference bias documentation (a model judging its own output inflates scores by ~15%). Uncertainty-based routing (use a strong judge only when a weak judge is uncertain).
**Verdict: МИМО (reference only).** Not a tool to adopt, but use as a reading list when hardening our judge gate. The self-preference bias finding is directly relevant: our judge should not be the same model that generated the candidate solution.

---

### #15 — mini-SWE-agent (SWE-agent/mini-swe-agent)
**Stars:** active, released 2025 | 74% on SWE-Bench in 100 lines
**One line:** Proof that a radically minimal agent (100 lines Python, no giant framework) scores near state-of-the-art on coding benchmarks.
**Why it matters:** This is the anti-pattern warning for us. 100 lines beats complex orchestration on measurable tasks. When we add gates and loops, we should regularly run our pipeline on a benchmark subset to confirm each layer actually adds quality, not just process theater.
**Verdict: БЕРЁМ ПРИЁМ (mindset).** Schedule a benchmark sanity check after each new gate is added: does the gate improve output quality on our golden case set, or just add latency? If a gate never fires, it's dead weight.

---

## SUMMARY TABLE

| Rank | Repo | Stars | Verdict | Mechanic to steal | Lands in |
|---|---|---|---|---|---|
| 1 | getzep/graphiti | 27k | БЕРЁМ | Fact validity windows + invalidation on write | MEMORY_MERGE_PROTOCOL |
| 2 | github/spec-kit | 109k | БЕРЁМ | Complexity Gate with mandatory justification log | Constitutional gate |
| 3 | langchain-ai/langmem | ~2k | БЕРЁМ | Gradient background prompt-improvement pass | auto-strengthen.mjs |
| 4 | Fission-AI/OpenSpec | 53k | БЕРЁМ | Archive pattern for completed wave specs | Spec hierarchy |
| 5 | mem0ai/mem0 | 41k | БЕРЁМ | Extraction filter before writing to memory | export-memory-snapshot.mjs |
| 6 | SWE-Gym/SWE-Gym | 685 | БЕРЁМ (future) | Best-of-N with verifier scoring | Gating pipeline |
| 7 | baaivision/judgelm | 434 | БЕРЁМ | Swap augmentation + reference anchor for judge | Judge gate prompt |
| 8 | microsoft/autogen | 59k | МИМО | Pattern covered, maintenance mode | — |
| 9 | ag2ai/ag2 | 5k | МИМО | Same as AutoGen, nothing new | — |
| 10 | OpenHands/OpenHands | 74k | БЕРЁМ | Full action-observation trace to debug agent | Debug agent context |
| 11 | letta-ai/letta | 22k | БЕРЁМ | Auto-trigger memory consolidation post-wave | routine-weekly.sh |
| 12 | crewAIInc/crewAI | 50k | БЕРЁМ (minor) | Checklist-structured constitutional evaluation | Constitutional gate |
| 13 | SWE-agent/SWE-agent | 19k | МИМО (later) | Single YAML ACI config — future refactor | — |
| 14 | llm-as-a-judge/Awesome | 556 | МИМО (ref) | Reading list for judge hardening | — |
| 15 | SWE-agent/mini-swe | active | БЕРЁМ (mindset) | Benchmark sanity check per new gate | QA ritual |

---

## WHAT THE MARKET HAS THAT WE DON'T (gap summary)

1. **Temporal memory invalidation.** Everyone else treats memory as append-only. Graphiti proves fact validity windows are worth the complexity — stale facts are jidoka's current silent failure mode.

2. **Automatic prompt evolution.** LangMem's gradient pass makes agent instructions improve between sessions without human intervention. Our auto-strengthen.mjs exists but needs the automatic trigger wire.

3. **Structured judge output.** Our judge gate returns freeform text. JudgeLM + CrewAI both demonstrate that structured checklists (pass/fail per criterion) are more auditable and easier to act on than prose judgments.

4. **Extraction filter on memory writes.** Mem0 proves that not writing everything is smarter than writing everything. We're accumulating noise in our knowledge graph.

5. **Best-of-N inference.** No multi-agent framework generates multiple candidates and scores them by default. SWE-Gym shows it's the highest-leverage inference-time improvement available. We don't do this at all.

---

## WHAT WE HAVE THAT NOBODY SHIPS (our moats)

- L0-L4 spec hierarchy with parent-chain ancestry traversal. Spec-kit and OpenSpec are flat relative to this.
- Prosecutor-defender-judge adversarial gate as a first-class pipeline step (not just a single reviewer).
- Meta-error ledger with recurrence detection and Kaizen retros feeding back into spec prompts.
- Wave-based golden cases that carry ground truth forward across sessions.

These are structural advantages. Don't trade them for simplicity.

---

## Sources

- [github/spec-kit](https://github.com/github/spec-kit)
- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)
- [Spec-Driven Development comparison: Spec Kit, OpenSpec, GSD](https://somniosoftware.com/blog/spec-driven-development-in-practice-github-spec-kit-openspec-and-gsd-compared)
- [getzep/graphiti](https://github.com/getzep/graphiti)
- [Zep temporal knowledge graph paper](https://arxiv.org/abs/2501.13956)
- [mem0ai/mem0](https://github.com/mem0ai/mem0)
- [letta-ai/letta](https://github.com/letta-ai/letta)
- [langchain-ai/langmem](https://github.com/langchain-ai/langmem)
- [Agent Memory at Scale 2026 comparison](https://agentmarketcap.ai/blog/2026/04/10/agent-memory-vendor-landscape-2026-letta-zep-mem0-langmem)
- [baaivision/JudgeLM (ICLR 2025)](https://github.com/baaivision/judgelm)
- [llm-as-a-judge/Awesome-LLM-as-a-judge](https://github.com/llm-as-a-judge/Awesome-LLM-as-a-judge)
- [SWE-Gym/SWE-Gym (ICML 2025)](https://github.com/SWE-Gym/SWE-Gym)
- [SWE-agent/SWE-agent](https://github.com/swe-agent/swe-agent)
- [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent)
- [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands)
- [crewAIInc/crewAI self-evaluation loop](https://github.com/crewAIInc/crewAI-examples/tree/main/flows/self_evaluation_loop_flow)
- [microsoft/autogen](https://github.com/microsoft/autogen)
- [ag2ai/ag2](https://github.com/ag2ai/ag2)
- [Awesome-Agent-Memory](https://github.com/TeleAI-UAGI/Awesome-Agent-Memory)
- [When AIs Judge AIs — arxiv 2508.02994](https://arxiv.org/html/2508.02994v1)
