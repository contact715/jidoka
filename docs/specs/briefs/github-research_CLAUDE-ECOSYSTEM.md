# GitHub Research: Claude Code Ecosystem (June 2026)

Context for "us": jidoka is a zero-dependency Node.js dev engine on top of Claude Code: 7-phase multi-agent pipeline, wave journals (docs/runs), quality gates, jidoka top TUI (live sessions via ~/.claude/session-env + fs.watch), web dashboard (port 7717), statusline, hooks. Already installed: ccusage, ccboard, Claude-Code-Agent-Monitor, Context7 MCP.

---

## Top-15 Repos, Ranked by Usefulness to jidoka

---

### 1. smtg-ai/claude-squad
**7.7k stars | Last release: May 23, 2026 | Go**
Manages multiple Claude Code / Codex / Gemini agents in separate git worktrees + tmux sessions from one terminal.

- СТАВИМ: YES, for launching parallel jidoka waves. claude-squad gives each wave its own worktree + tmux pane. Wire it at wave dispatch: instead of a raw `claude` subprocess, call `cs new --name wave-{id} --worktree`. It plugs into `docs/runs` naturally — one squad session = one wave journal. No overlap with our TUI (squad is a launcher, jidoka top is a monitor).
- БЕРЁМ ПРИЁМ: Their "auto-accept mode + review before push" model. jidoka's wave executor could adopt an explicit "approve diff before merge" step between Execute and Verify phases — currently we merge blind.
- МИМО: n/a, this is genuine addition.

---

### 2. gsd-build/get-shit-done (+ open-gsd/gsd-core)
**64k stars (archived) / 2.9k active | Last release: June 4, 2026 | JS**
Spec-driven meta-prompting: 5-phase loop (Discuss → Plan → Execute → Verify → Ship), 69 commands, 24 agents, parallel wave execution with fresh 200k-token subagent contexts.

- СТАВИМ: No. GSD is its own complete pipeline — installing it into jidoka would duplicate the 7-phase pipeline wholesale.
- БЕРЁМ ПРИЁМ: Two specific ideas: (a) their STATE.md + CONTEXT.md artifacts that survive across subagent boundaries — jidoka's wave journals already exist but they're in docs/runs; adding a lightweight CONTEXT.md written by Execute, read by Verify would close a gap. (b) "Fresh subagent context per executor" — GSD explicitly spawns each parallel executor with a clean 200k-token context rather than inheriting the orchestrator's bloated window. jidoka could adopt this: gate the wave dispatcher to verify each subagent starts fresh.
- МИМО: The product itself is a duplicate.

---

### 3. VoltAgent/awesome-claude-code-subagents
**21.3k stars | Active | Markdown prompts**
154 subagents across 10 domains with standardized frontmatter (role, tools, model routing). Includes orchestration, meta-agents, model selection per task.

- СТАВИМ: Partial. Pull the Meta & Orchestration category (14 agents) and the Research & Analysis category (11 agents) directly into jidoka's agents/ folder. They use proper Claude Code frontmatter — drop-in compatible.
- БЕРЁМ ПРИЁМ: Their model-routing frontmatter pattern: `model: claude-opus-4` for critical gates, `model: claude-haiku-4` for fast checks. jidoka's quality gates currently don't route by model cost. Adding a `model:` field to gate definitions would cut costs on tier-1 checks.
- МИМО: Language-specialist agents (33 Python/Go/etc agents) — too generic, not pipeline-aware.

---

### 4. wshobson/agents
**36.4k stars | Go/JS | Multi-platform**
84 plugins, 192 agents, 156 skills, 102 commands — single Markdown source compiled to Claude Code, Codex, Gemini, Cursor, Copilot formats.

- СТАВИМ: No. Too broad, cross-platform output adds noise, and our skills/agents already have jidoka-specific context these don't have.
- БЕРЁМ ПРИЁМ: Their single-source compilation model. jidoka could maintain one canonical agent definition in Markdown and have a build step emit Claude Code TOML + a plain-text version for the docs. Currently jidoka agents are single-format only.
- МИМО: The collection itself — 192 generic agents bloat context.

---

### 5. simple10/agents-observe
**587 stars | Last release: June 4, 2026 | Node/React**
Hooks → SQLite → WebSocket → React 19 dashboard. Shows real-time tool calls, agent hierarchy (parent-child), token/cost per event, session history with human-readable names.

- СТАВИМ: Evaluate seriously. We have a web dashboard on port 7717 and ccboard already installed. If our dashboard does NOT show subagent parent-child trees and per-tool-call event streams, agents-observe fills that gap cleanly. The hook integration is a PostToolUse + SubagentStop wiring — 30 lines of JS. Specific connection point: jidoka's hooks/post-tool-use.mjs calls agents-observe's HTTP ingest.
- БЕРЁМ ПРИЁМ: Human-readable session names generated from the first user prompt. Our wave journals use wave IDs — adding an auto-generated human name would make docs/runs scannable without opening the file.
- МИМО: If ccboard + our dashboard already show tool-call streams, this duplicates.

---

### 6. disler/claude-code-hooks-mastery
**3.7k stars | Active | Python/UV**
All 13 hook lifecycle events with working implementations: Builder/Validator two-agent pairing, flow control via exit codes, statusline variants, PreCompact transcript backup.

- СТАВИМ: Yes — two hooks we likely don't have: (a) PreCompact backup: writes transcript to docs/runs/{wave}/transcript-backup.jsonl before context compaction, preventing data loss. (b) SubagentStop validation: automatically runs the Validator agent against the Builder's output on every subagent stop, not just at wave end.
- БЕРЁМ ПРИЁМ: UV single-file scripts for hook portability. Our hooks are .mjs — fine, but their UV pattern makes hooks installable with zero setup on any machine. Worth documenting the approach for future hooks.
- МИМО: Statusline — we already have ours.

---

### 7. Piebald-AI/claude-code-system-prompts
**10.8k stars | Updated June 5, 2026 | Reference**
Extracts every Claude Code system prompt, tool description, and sub-agent prompt from compiled source. 201 versions tracked with CHANGELOG.

- СТАВИМ: No code to install.
- БЕРЁМ ПРИЁМ: HIGH VALUE as a reference. Before writing any new jidoka agent or gate prompt, check this repo to see what language the model already responds to natively. For example: their documented Explore/Plan sub-agent prompts reveal the exact phrasing Claude Code uses for context windows. Writing jidoka prompts that clash with built-in framing is an invisible tax.
- МИМО: n/a — pure reference, not installable.

---

### 8. johannesjo/parallel-code
**703 stars | Last release: June 1, 2026 | TypeScript**
Spawns AI agents in parallel — each in its own git worktree+branch — with tiled diff review panels, inline comments, and merge-winner selection.

- СТАВИМ: Maybe, as a UI shell for jidoka's wave parallels. But overlap with claude-squad (#1) is high — pick one. parallel-code adds a richer diff-review UI; claude-squad is lighter. Decision: if worktree-based wave parallelism is a priority this quarter, evaluate parallel-code as the UI layer; otherwise skip.
- БЕРЁМ ПРИЁМ: Their "run 5 implementations in parallel, pick the winner" pattern — useful for jidoka's reflexion gate: spawn N prompt variants simultaneously, score outputs, select best. Currently reflexion is sequential.
- МИМО: As a full install alongside claude-squad — duplication.

---

### 9. disler/claude-code-hooks-multi-agent-observability
**1.4k stars | 381 forks | Python/UV**
All 12 hook events fed to a visualization server: swim lanes per agent, live pulse chart, task lifecycle (TaskCreate/Update), failure surfacing via PostToolUseFailure.

- СТАВИМ: No — agents-observe (#5) is more recent, JS-native (matches jidoka stack), and covers the same ground better.
- БЕРЁМ ПРИЁМ: Failure surfacing pattern: PostToolUseFailure hook writes a structured JSON failure record to docs/runs/{wave}/failures.jsonl. jidoka's current gate failure handling is terminal-only. A persistent structured failure log per wave would make post-mortems scriptable.
- МИМО: The full install — superseded by #5.

---

### 10. hesreallyhim/awesome-claude-code
**45.8k stars | 4k forks | Active (mid-reorganization)**
The canonical curated list: skills, hooks, slash-commands, agent orchestrators, apps, plugins.

- СТАВИМ: No — it's a list, not code.
- БЕРЁМ ПРИЁМ: Use as a discovery index when evaluating new jidoka additions. Before building a new gate or agent, check here first to avoid rebuilding something the community has already solved.
- МИМО: As an install target.

---

### 11. aaddrick/claude-pipeline
**115 stars | MIT | Markdown+JSON**
19 skills, 10 agents, 2 hooks, 14 JSON schemas, quality gates — a portable .claude/ folder.

- СТАВИМ: No — this is conceptually what jidoka already is, just smaller and less structured.
- БЕРЁМ ПРИЁМ: Their 14 JSON schemas for validating skill/agent definitions. jidoka has no schema validation on agent frontmatter — adding JSON Schema checks to the skills-audit.sh gate would catch broken agent definitions before runtime.
- МИМО: The pipeline itself.

---

### 12. ColeMurray/claude-code-otel
**421 stars | 4 commits | OTEL/Grafana**
Exports 8 metrics via OpenTelemetry to Prometheus+Grafana: session count, LOC, cost, token usage, PRs, commits, edit decisions.

- СТАВИМ: No. ccusage already tracks cost/tokens. OTEL adds Grafana infrastructure dependency — too heavy for a zero-dependency framework.
- БЕРЁМ ПРИЁМ: Their 8 metric definitions are a good checklist for jidoka's telemetry schema. Compare against scripts/telemetry-schema-registry.mjs to find gaps.
- МИМО: The install — infra dependency contradicts jidoka's zero-dependency constraint.

---

### 13. seunggabi/claude-dashboard
**29 stars | v0.13.1 March 2026 | Go/Bubble Tea**
k9s-style TUI: session table, JSONL history viewer, vim navigation, tmux backend.

- СТАВИМ: No — we built jidoka top already.
- БЕРЁМ ПРИЁМ: Their JSONL history browser (open any past session's conversation log with `/`). jidoka top currently shows live sessions only. Adding a "browse past sessions" panel reading ~/.claude/projects/**/*.jsonl would fill this gap with minimal code.
- МИМО: The tool itself — duplicate.

---

### 14. rohitg00/awesome-claude-code-toolkit
**2k stars | Curated list**
135 agents, 35 skills, 42 commands, 176 plugins, 20 hooks — directory + reference guide.

- СТАВИМ: No.
- БЕРЁМ ПРИЁМ: Their 20 hooks inventory — useful for auditing whether jidoka's hooks/directory covers all lifecycle events or has gaps.
- МИМО: The list itself.

---

### 15. nwiizo/ccswarm
**139 stars | v0.5.0 Feb 2026 | Rust**
Multi-agent orchestration via Claude Code CLI with git worktree isolation and TUI monitoring. CRITICAL GAP: coordination loop not implemented, ParallelExecutor not wired to orchestrator, AI returns keyword-based responses not real Claude calls.

- СТАВИМ: No — too early, core features are stubs.
- БЕРЁМ ПРИЁМ: Their channel-based message passing architecture (no shared state, typed channels between orchestrator and agents). jidoka's wave dispatcher uses file-based coordination; channel messaging would be more reliable for detecting agent completion. Worth studying for a future wave-coordination redesign.
- МИМО: The current install — not production-ready.

---

## Summary: What to Actually Do

Priority actions based on this research:

1. Evaluate claude-squad (#1) for wave parallelism — 1-day integration, genuine gap.
2. Pull subagents from VoltAgent collection (#3) Meta & Research categories — 2-hour copy.
3. Add PreCompact backup hook + SubagentStop validator from hooks-mastery (#6) — 4-hour work.
4. Check agents-observe (#5) against what ccboard + our port-7717 dashboard already show — install only if parent-child agent tree is missing from our current view.
5. Bookmark Piebald-AI system-prompts (#7) as a permanent reference for all future prompt writing.
6. Add PostToolUseFailure structured log (#9 idea) to docs/runs wave journals — 2-hour add.

---

## Sources

- [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad)
- [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)
- [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core)
- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
- [wshobson/agents](https://github.com/wshobson/agents)
- [simple10/agents-observe](https://github.com/simple10/agents-observe)
- [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery)
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
- [johannesjo/parallel-code](https://github.com/johannesjo/parallel-code)
- [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
- [aaddrick/claude-pipeline](https://github.com/aaddrick/claude-pipeline)
- [ColeMurray/claude-code-otel](https://github.com/ColeMurray/claude-code-otel)
- [seunggabi/claude-dashboard](https://github.com/seunggabi/claude-dashboard)
- [nwiizo/ccswarm](https://github.com/nwiizo/ccswarm)
- [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit)
- [GSD hits 48K stars — Augment Code](https://www.augmentcode.com/learn/gsd-stars-spec-driven-dev-claude-code)
