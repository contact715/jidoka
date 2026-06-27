# Proposal (PILOT-only, not adopted): external tools that need a sandbox/product first

From the 2026-06-10 GitHub research (43 agents, 34 repos verified). Four candidates are worth a
SANDBOX PILOT but were NOT adopted into the engine — building them blind would sit dead or leak data.
The four cheap, no-dependency adopts (injection-watch, ccusage cross-check, agentdojo scenarios,
trajectory-eval) shipped this wave; these are the deferred ones, recorded so the research isn't lost.

## 1. zilliztech/claude-context — semantic code search (MCP)
- **Why:** our memory search is grep-only (exact words); no semantic search. Real gap. Live (~11.8k★).
- **Blocked on:** default config LEAKS code to OpenAI's cloud (cost of error = whole client codebase).
  Local-only mode needs Docker + Ollama + Milvus — heavy for a non-programmer, dead without auto-index.
- **Pilot gate:** isolated sandbox, ONE repo, local-only; prove (a) zero code leaves the machine,
  (b) measured token saving on 2-3 tasks, (c) setup is sane. No permanent wiring until all three.

## 2. ChromeDevTools/chrome-devtools-mcp — real web-perf numbers (MCP, Google official)
- **Why:** our perf gates (load-test, canary, compute-slos) are DORMANT — no one feeds them numbers.
  This gives objective page speed (load, responsiveness, layout shift) for Product-Kaizen.
- **Blocked on:** it's PRODUCT-repo work, not an engine feature — needs a live deployed URL (exists
  only at deploy stage) + manual glue from its output into our gate.
- **Pilot gate:** in one product, prove one real speed number flows into a gate as a green proof.

## 3. promptfoo — full OWASP attack catalog (local)
- **Why:** broadest red-team attack catalog; donor of fresh attacks for our injection-watch/red-team.
- **Blocked on:** the research found OpenAI ACQUIRED promptfoo (2026-03-09) — a direct Anthropic
  competitor now owns it. Risky to put a Claude-framework defense path on a competitor's tool.
- **Pilot gate:** SNAPSHOT its attack catalog one-way into our red-team (no live dependency); watch
  1-2 quarters whether the open version degrades before any deeper use.

## 4. Fission-AI/OpenSpec — single slash-flow spec UX (54k★)
- **Why:** one thing we lack — a tidy unified /propose → /apply → /archive UX a non-programmer can use.
- **Blocked on:** the bridge to our spec lineage (parents[]) is fragile — OpenSpec is flat, no parent
  tags; a bridge would be brittle text-guessing. We already have an entry (dev-pipeline by phrase).
- **Pilot gate:** take only the UX IDEA (a drafts box before our spec gate); prove a drafted change
  flows into our existing spec pipeline with no manual glue before exposing it in any product.

## Skipped outright (dupes of ours, or no live insertion point)
Inspect AI, DeepEval, PyRIT, garak, Letta/mem0/cognee (heavy Docker + cloud leak + AGPL), Lefthook,
Changesets, OpenLLMetry, ast-grep MCP, Postgres/Grafana/Sentry MCP (no such infra in any current
product yet). See the research transcript for the full reasoning.
