# jidoka Dashboard — spec

> One visual interface over the dev engine: every project on jidoka, its dev-pipeline stage,
> its production pipeline, and what's hanging (tasks/backlogs), live. Web UI + GDoc export.
> Target: the **jidoka framework** (a tool of the engine, sees ALL projects) — NOT any one product.

## Purpose
Today the dev + production pipeline runs but is invisible. This is the window: pick a project,
see its funnel stage, its open tasks, its health, in real time — so orienting takes a glance, not a grep.

## Scope (in)
- **Multi-project switcher** — discover every `~/*/.jidoka` install + the framework repo; switch between them.
- **Dev-pipeline funnel** — RACI stages (dor → spec → impl → dod → closure) with the current/blocked stage lit.
- **Tasks / what's hanging** — aggregated across artifact streams: active meta-lessons, recent gate-trips,
  approval queue, halt state, reflexion/self-improvement queues.
- **Production pipeline** — `dora-events` (deploy frequency, lead time, change-fail) as the prod-side funnel.
- **Health** — eval pass-rate, halt status, recent gate trips → one green/amber/red signal.
- **Live watch** — Server-Sent Events on artifact change; the UI updates without a refresh.
- **GDoc export** — a shareable snapshot of the current project's funnel + tasks.

## Killer features (depth, per user "заложи глубоко круто")
- Live (real-time SSE, not poll).
- All projects at a glance + drill-in per project.
- "What's hanging" unified across ≥5 backlog streams, priority-sorted, with the source named.
- Andon: a red banner the instant a project is halted.
- Meta-ledger active lessons surfaced (recurrence risk visible, not buried in jsonl).
- One-click GDoc export for sharing the state with a human who isn't in the terminal.

## Architecture
- `scripts/dashboard/collectors.mjs` — pure summarizers + fs gather (the data layer). Self-tested.
- `scripts/dashboard/serve.mjs` — node http server + `/api/*` + SSE + `fs.watch` (entry: `npm run jidoka:dashboard`).
- `scripts/dashboard/ui.html` — single-page UI (switcher · funnel · tasks · production · health · live).
- `scripts/dashboard/gdoc-export.mjs` — markdown snapshot → Google Doc (MCP/API; stub-to-file until wired).

## Data sources (per project, framework `docs/…` or installed `.jidoka/…`)
- projects: dirs containing `.jidoka/` + the framework root.
- pipeline: `docs/governance/raci.json` (stages) + halt-state + git branch.
- tasks: `docs/audits/{meta-mistakes,gate-trips,approval-queue,cross-line-verdicts}.jsonl`,
  `.claude/reflexion-queue/`, halt-state.
- production: `docs/audits/dora-events.jsonl`.
- health: `docs/evals/_baseline.json` (pass_rate) + halt + recent gate-trips.

## Acceptance criteria
- **AC1** collectors discover every `.jidoka` project + the framework.
- **AC2** pipeline funnel reflects the RACI stage list.
- **AC3** tasks aggregate from ≥4 artifact streams with the source named per item.
- **AC4** `serve.mjs` returns the UI at `/`, JSON at `/api/data?project=`, and an SSE stream at `/api/stream`.
- **AC5** UI switches projects and shows funnel + tasks + health, updating live on file change.
- **AC6** GDoc export produces a shareable snapshot (file first; GDoc when the connector is wired).
- **AC7** `collectors.mjs --self-test` passes (pure summarizers correct).

## Distribution
Ships in the framework `scripts/dashboard/`; wired as `npm run jidoka:dashboard`; offered by
`install-global.sh` (global `~/.claude/jidoka`) and noted by `install-into.mjs` for per-project use.
