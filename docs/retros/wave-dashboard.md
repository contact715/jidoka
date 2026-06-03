# Wave Retro — wave-dashboard

## Wave ID
wave-dashboard

## Title
Multi-project pipeline dashboard: real pipeline + Kanban board + iPad + journal reconciliation

## Date
2026-06-02

## Status
Shipped

---

## Goal
Make the jidoka dev-pipeline visible: a zero-dep local dashboard that shows every project's pipeline,
the real phase graph with live wave status, and a left-to-right Kanban board of waves by stage. Then
reconcile the run-state journals so the board tells the truth.

---

## What worked
- Zero-dep dashboard shipped (node http + SSE live-watch + pure-summarizer collectors), 4 projects discovered. Self-test 18/18 green.
- The pipeline is built from three real sources, never fabricated: the canonical phase graph (`orchestration-planner.plan()`), the live run-state journal (`docs/runs/<wave>/state.json`), and real agent outcomes (`agent-traces.jsonl`). commits b97cd4c → e96aef6 → 605834e.
- Horizontal Kanban board (stage columns, wave cards by current phase) + drill-down detail, responsive on iPad (board scrolls, cards stack, LAN URL printed for same-Wi-Fi access).
- Journal reconciliation: dug both in-flight waves, re-verified every "done" myself, closed the 3 genuine gaps with real artifacts (2 retros + 1 discovery), advanced both to 100% with proof in each phase note. commit 0535c7a.
- Session tracked: this wave + `docs/audits/backlog.jsonl` so done/not-done survives the session and shows on the dashboard's "Что висит".

## What failed
- Built the WRONG thing twice before the right one: first a RACI funnel (5 static strings, not a pipeline), then a vertical single-wave view, before the user's actual ask landed (a left-to-right board). Cost: 2 rebuilds. Lesson: for a visual feature, confirm the SHAPE (board vs list vs detail) before building, not after.
- Did not confirm the stack up front (chose vanilla zero-dep without asking); the user expected Next.js. It happened to align, but it was an un-confirmed assumption.
- Three real bugs shipped mid-build: git-log `%h|%s|%cr` unquoted (shell read `|` as pipes → empty timeline), iPad grid blow-out (missing `min-width:0` → page overflow), zsh not word-splitting an unquoted var (advance commands no-op). All found and fixed with proof.
- The "only Загрузка" defect: the UI hung silently with no error state when the server was unreachable. A forever-loading screen with no diagnostic is a real UX bug.

## Patterns observed
- Journaling lag is systemic: both reconciled waves were built + proven but their run-state journals still said `pending`. The dashboard is what surfaced it. Fix: the memory phase must call `run-state.mjs --advance` in the same session the work lands (now in both retros' playbook).
- Confirm SHAPE and TARGET before building a visual or a feature. Two of this session's three rebuilds trace to building before the shape/stack was confirmed.

## Playbook update proposed
For any visual/UI feature, the spec phase must state the SHAPE explicitly (board / list / timeline / detail) and the user must confirm it before build. A dashboard or view built on an assumed shape is a likely rebuild.

## Stats
- Wave duration: 1 session
- Agents involved: discovery (self), spec (self), build (self), 2 forensic audit agents (wave reconciliation), gate (playwright e2e + framework gates), memory (this retro)
- Files added: scripts/dashboard/{serve,collectors,ui,gdoc-export}.mjs/html, 3 retros, 1 discovery, backlog.jsonl
- Files modified: install-global.sh, CLAUDE.md (Target-Scope), 2 wave journals
- LOC delta: ~ +900 (dashboard) + reconciliation
