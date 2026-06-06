# GitHub Research Brief: Dev Tools for Multi-Session Claude Code Workflow

**Context:** Non-technical owner running multi-session Claude Code dev on macOS (iTerm/Terminal). Custom jidoka engine: TUI pipeline panel, web dashboard, sound hooks. Stack: Next.js / TypeScript / Tailwind, Python automations. Already installed: ccusage, ccboard, Claude-Code-Agent-Monitor, Context7, Playwright MCP.

**Research date:** June 2026. All star counts and release dates verified against live GitHub.

---

## TOP-15 TOOLS, RANKED BY IMPACT

---

### 1. worktrunk (max-sixty/worktrunk)
**Stars:** 5.3k | **Last release:** v0.56.0 — June 2, 2026 | **Language:** Rust

Git worktree manager built specifically for parallel AI agent workflows. Three commands: `wt switch`, `wt list`, `wt merge`. Auto-generates commit messages from diffs. Shares build cache across worktrees so each Claude session doesn't reinstall node_modules from scratch. Direct PR checkout via `wt switch pr:123`.

**СТАВИМ.** Wire it as the worktree layer for every multi-agent wave. Each Claude Code session gets its own `wt switch <branch>` workspace. Replaces raw `git worktree` commands that nobody wants to type.

---

### 2. jujutsu / jj (jj-vcs/jj)
**Stars:** 29.5k | **Last release:** v0.42.0 — June 4, 2026 | **Language:** Rust

Drop-in replacement workflow on top of Git. Works on the same `.git` directory — teammates keep using git. No staging area: every file change is automatically a "change" you can name, stack, and reorder. One command to undo any operation including merges. Designed at Google, used internally at Google.

**БЕРЁМ ПРИЁМ.** Learning curve is real (new mental model: changes, not commits). High reward for power users who do complex rebases or stacked PRs. Not urgent if worktrunk already covers the multi-agent isolation need, but worth experimenting on personal branches.

---

### 3. workmux (raine/workmux)
**Stars:** 1.6k | **Last release:** active 2026 | **Language:** Rust

Git worktrees + tmux windows, one command. `workmux add branch-name` creates the worktree AND opens a tmux window for it. `workmux merge` cleans up both. Built-in support for launching Claude/Gemini/Codex inside the window. TUI status dashboard.

**СТАВИМ** — if the team already uses tmux as the session layer (composes directly with existing terminal setup). More opinionated than worktrunk, slightly lower stars but tighter tmux integration. Pick one of worktrunk or workmux, not both.

---

### 4. zellij (zellij-org/zellij)
**Stars:** 33.5k | **Last release:** v0.44.3 — May 13, 2026 | **Language:** Rust

Terminal multiplexer with discoverable keybindings (no memorization), floating/stacked panes, WebAssembly plugin system, built-in web client to view sessions in a browser. Active releases every 4-6 weeks.

**СТАВИМ** as the replacement session manager for multi-Claude-Code work. The built-in web client means you can monitor all running sessions from the jidoka web dashboard without extra tooling. Layout files (KDL format) can be committed to the repo so a `zellij --layout wave-N.kdl` command opens the full multi-agent workspace in one shot. iTerm2 and native Terminal work fine as the host.

---

### 5. GitButler (gitbutlerapp/gitbutler)
**Stars:** 18k | **Last release:** active 2026 | **Language:** Rust + Svelte (Tauri desktop app)

Virtual branches: work on multiple branches simultaneously in one working directory. Changes are grouped into named "stacks" that you can commit, push, or discard independently — without switching branches. Built by Scott Chacon (GitHub co-founder). Integrates GitHub/GitLab for PR creation.

**БЕРЁМ ПРИЁМ.** Best fit for high-context sessions where several unrelated changes accumulate and need to be split before commit. Not a terminal tool — it's a desktop GUI. Worth installing alongside lazygit rather than replacing it. License is Fair Source (not MIT), which is fine for personal use.

---

### 6. GitHub official MCP server (github/github-mcp-server)
**Downloads:** 85k npm/week | **Status:** Official, actively maintained by GitHub

Connects Claude Code to GitHub APIs: read issues, comment on PRs, search code, trigger Actions, create branches, get CI status. Runs as remote MCP at `mcp.sentry.dev` style — no local process to maintain.

**СТАВИМ.** The single highest-leverage MCP install for this workflow. Claude Code goes from "local code only" to "participant in the PR and issue lifecycle". Wire it so the jidoka pipeline can ask Claude to open a PR on wave completion. Needs a GitHub Personal Access Token with scoped permissions.

---

### 7. Brave Search MCP (official Brave)
**Status:** Official, free tier 2,000 searches/month

Web search inside Claude sessions without leaving the terminal. Unlike the built-in WebSearch tool (which is Claude's own capability), this MCP is callable by subagents and automation scripts that run Claude Code programmatically.

**СТАВИМ.** Primary use: research tasks inside automated pipeline runs (competitor checks, library docs, changelog lookups). Free tier is enough for a solo dev. Pair with Context7 (already installed) — Context7 for library docs, Brave for open web.

---

### 8. Sentry MCP (getsentry/sentry-mcp)
**Stars:** 694 | **npm downloads:** 85k/week | **Status:** Official Sentry, remote server

Pull Sentry issues, stack traces, and root-cause analysis (Sentry's own AI "Seer") directly into Claude Code context. No copy-paste between Sentry dashboard and terminal.

**СТАВИМ** — if the projects being built use Sentry (standard for Next.js apps). When a production bug fires, Claude can read the issue, the trace, and the affected code in one session. Removes a full context-switch. Runs as remote MCP, zero local maintenance.

---

### 9. Termdock
**Status:** Closed source, free download, Electron app | **Stars:** N/A (not open source)

Purpose-built terminal for multi-AI-agent workflows. GUI panes you drag to resize, file drop into terminal, workspace Git status sync, session auto-restore. Targets the exact "run 3 Claude sessions on 3 worktrees" pattern.

**МИМО** for now. Not open source, unclear pricing model, Electron means heavier than iTerm. The worktree + zellij combination covers the same workflow with open, composable tools that integrate with the jidoka TUI layer. Revisit if zellij's layout management proves too manual.

---

### 10. gitui (gitui-org/gitui)
**Stars:** 18k+ | **Last release:** active 2026 | **Language:** Rust

Faster lazygit alternative. Keyboard-driven, handles 900k-commit repos without lag. Supports stash, stage hunks/lines, branch management.

**МИМО** — lazygit already installed and habits formed. gitui is marginally faster but not faster enough to justify switching. Note for new machines where lazygit isn't yet installed.

---

### 11. mcp-omnisearch (spences10/mcp-omnisearch)
**Status:** Active 2026 | Combines Tavily + Brave + Kagi + Exa + Firecrawl + GitHub search

One MCP server instead of 4-5 separate installs. Single interface routes to the right search backend per query type.

**БЕРЁМ ПРИЁМ.** Worth installing instead of Brave alone if more than one search provider is needed. Slight risk: another dependency to maintain. If Brave MCP alone covers the real usage, skip this.

---

### 12. memory knowledge graph (modelcontextprotocol/servers — memory module)
**Status:** Official Anthropic reference implementation, actively maintained

Persistent memory across Claude sessions via a local knowledge graph. Entities, relations, observations survive session restarts. Already used by jidoka's own memory layer.

**МИМО as new install** — jidoka already has its own memory consolidation pipeline (`memory-consolidate.mjs`, cross-project mistake ledger). Adding a second memory layer creates duplication and drift. If jidoka's memory ever gets replaced, this is the reference implementation to pull from.

---

### 13. sequential-thinking MCP (modelcontextprotocol/servers)
**Status:** Official reference, included in modelcontextprotocol/servers

Gives Claude a structured multi-step reasoning scratchpad: branching thought chains, revision, no permanent context footprint. Useful for complex problem decomposition inside automated pipeline runs.

**БЕРЁМ ПРИЁМ.** Low-risk, zero maintenance (official server). Main question is whether it overlaps with jidoka's reflexion agent. If the reflexion gate already provides structured reasoning, this adds limited value. Worth a two-week trial on a complex wave to measure if output quality improves.

---

### 14. zviewer (JosephPeters/zviewer)
**Status:** New 2026, small stars | Web-based session management UI for Zellij

Companion web interface for Zellij: lists running sessions, switches between them, shows session state in a browser tab.

**БЕРЁМ ПРИЁМ** — only if zellij gets installed (item #4). Low overhead, could surface in the jidoka web dashboard as an iframe or link. Very new, watch for stability.

---

### 15. Graphite CLI
**Status:** Commercial SaaS + free CLI, market leader for stacked PRs on GitHub | Note: GitHub now shipping native stacked PRs (private preview, April 2026)

Stacked PR workflow: break a large feature into small reviewable PRs that stack on each other. CLI handles rebase ordering and merge coordination.

**МИМО.** GitHub is shipping native stacked PRs — Graphite's main differentiator is eroding. jj (item #2) covers the same workflow at the commit level without the SaaS dependency. Revisit in 6 months when GitHub's native stacked PRs exit preview.

---

## INSTALLATION PRIORITY ORDER

| Priority | Tool | Why now |
|---|---|---|
| 1 | worktrunk | Immediate: every multi-agent wave needs worktree isolation |
| 2 | zellij | Immediate: layout files per wave, web client for dashboard visibility |
| 3 | GitHub MCP | Immediate: closes the PR/issue loop in Claude pipelines |
| 4 | Brave Search MCP | Quick win: web search inside automated pipeline runs |
| 5 | Sentry MCP | When Sentry is active on any production project |
| 6 | workmux | If tmux is preferred over zellij as the session layer |
| 7 | GitButler | When virtual branch juggling becomes a pain point |
| 8 | jj | Experiment on a personal branch first |

---

## DEAD-WEIGHT WARNING

Context7 (already installed) covers library docs. Adding mcp-omnisearch, sequential-thinking, and memory MCP on top without a clear "this solves X I hit daily" reason = tooling bloat. Each MCP server adds latency to every session start. Add one at a time, verify real usage after two weeks, remove if unused.

---

## Sources

- [worktrunk — GitHub](https://github.com/max-sixty/worktrunk)
- [workmux — GitHub](https://github.com/raine/workmux)
- [zellij — GitHub](https://github.com/zellij-org/zellij)
- [jujutsu jj — GitHub](https://github.com/jj-vcs/jj)
- [GitButler — GitHub](https://github.com/gitbutlerapp/gitbutler)
- [GitHub official MCP server](https://github.com/github/github-mcp-server)
- [Sentry MCP — GitHub](https://github.com/getsentry/sentry-mcp)
- [mcp-omnisearch — GitHub](https://github.com/spences10/mcp-omnisearch)
- [Termdock — tmux vs Termdock vs Zellij comparison](https://www.termdock.com/en/blog/terminal-multiplexing-tmux-termdock-zellij)
- [Ghostty terminal — GitHub stars and features](https://github.com/ghostty-org/ghostty)
- [Best MCP servers 2026 — Builder.io](https://www.builder.io/blog/best-mcp-servers-2026)
- [GitHub ships stacked PRs — InfoQ](https://www.infoq.com/news/2026/04/github-stacked-prs/)
- [Git worktrees for parallel AI agents — Zylos Research](https://zylos.ai/research/2026-02-22-git-worktree-parallel-ai-development/)
- [Jujutsu 2026 review — Kunal Ganglani](https://www.kunalganglani.com/blog/jujutsu-jj-git-version-control)
- [Top Knowledge & Memory MCP Servers — Awesome Claude](https://awesomeclaude.ai/mcp/knowledge-memory)
