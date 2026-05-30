# Agent Topology — Three-Lines-of-Defense Model

Generated reference for the agent roster (`docs/AGENT_ROSTER.md` is the source of truth).
Cross-line dispatch is governed by `scripts/check-cross-line-dispatch.mjs` (EU AI Act Art 14
audit trail). 31 roster roles across four groups.

## Pre-wave / Support (spec & knowledge)

Run before implementation; do not gate.

- **Chief Architect** (L0.75) — synthesizes the master spec
- **Micro Architect** / **Macro Architect** (L0.7) — internal / external view briefs
- **Surface Cartographer** (L0.7) — "does this already exist?" reuse map
- **Design System Architect** (L0.7) — design-contract brief
- **Skill Extractor** / **Metrics Aggregator** (post-wave) — learning capture

## First Line — Operations (build)

Do the work.

- **Orchestrator** (L0) — dispatch & sequencing
- **Chief Product Officer** / **Competitive Intelligence Officer** (L0.5)
- **frontend-agent** (L1) — implementation
- **test-engineer** / **test-runner** / **integration-tester** (L0.96) — tests
- **debug-agent** / **error-recovery-stub** (L0.96) — failure response

## Second Line — Risk & Compliance (gate)

Block on violation; never write product code.

- **Reflexion Critic** (L0.95) — adversarial post-impl review
- **Visual QA** (L0.95) — screenshot verification
- **Self-Improvement Reviewer** (L0.9) — cross-wave patterns
- **coverage-auditor** / **perf-profiler** / **a11y-auditor** / **security-scanner** (L0.96)
- **constitutional-reviewer** (L0.96) — Mission Compass gate
- **debate-prosecutor** / **debate-defender** (L0.97) — adversarial debate
- **pfca-agent** (L0.99) — pre-flight checklist

## Third Line — Independent Audit (verdict)

Independent of build and gate.

- **debate-judge** (L0.97) — debate verdict
- **best-of-N-judge** (L0.97) — selects best of N implementations
- **meta-process-auditor** (L0.98) — anti-pattern recurrence
- **Proactive Surfacing Agent** (L0.99-1) — surfaces latent concerns

## Why three lines

The model mirrors the Three Lines of Defense (IIA): Operations owns the work, Risk &
Compliance gates it, Independent Audit verifies the gate. An agent in one line cannot
silently dispatch across lines — cross-line dispatch requires a logged human override.
