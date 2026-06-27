---
description: Run the quality gates on the wave and prove it executes, not just compiles
argument-hint: <wave-id>
allowed-tools: Read, Bash, Agent
---
Verify wave $1.

1. `node scripts/run-state.mjs --advance $1 --phase gate --status running`.
2. Run the gates: reflexion-critic (spec compliance), constitutional-reviewer (mission), plus
   security-scanner / coverage / a11y / perf as the surfaces require. On a critical wave run the
   adversarial debate: `node scripts/debate-engine.mjs`.
3. Execution proof, not just static checks: actually run the project's tests/command via
   `node scripts/execution-gate.mjs --run`. Untrusted or generated code runs isolated:
   `node scripts/sandbox-run.mjs --scope <build-dir> --cmd "<test>"` (kernel sandbox, no escape).
4. Goal-backward check: if `docs/runs/$1/goal.json` exists,
   `node scripts/verify-goal-backward.mjs --goal docs/runs/$1/goal.json` traces the wave goal back to
   shipped evidence and reports objectives NOT actually delivered (complements the forward AC→test map).
5. Independent acceptance verdict — THE forcing function against "declared done, not proven":
   - Ensure `docs/runs/$1/acceptance.json` lists every acceptance criterion from the master spec as a
     RUNNABLE proof command: `{ "acs": [ { "id": "AC1", "command": "<cmd whose exit code proves it>", "note": "…" } ] }`.
     If missing, author it from the spec's AC now — a test, a `--self-test`, a grep that must match, a
     Playwright run. A claim with no runnable proof is not an acceptance criterion.
   - Dispatch a FRESH subagent (clean context, not the one that wrote the code) to RE-RUN the proofs:
     `node scripts/acceptance-verdict.mjs $1` → writes `docs/runs/$1/verdict.json` with each exit code.
     Re-running in a fresh context is what makes the verdict independent (the reflexion-critic pattern).
   - Not optional: `run-state.mjs` REFUSES to close the wave's final phase without a passing
     `verdict.json`. A red verdict keeps the wave open and routes to debug-agent.
6. Trajectory check (optional, path-not-just-outcome): `node scripts/trajectory-eval.mjs --wave $1`
   compares the agents that actually ran (agent-traces) against the agents plan() requires for the
   wave's task — surfacing a required agent that was SKIPPED (e.g. a critical wave shipped without
   security-scanner / debate). Precise only when agent-trace --ingest tags rows with the wave; else
   it reports approximate and does not fail.
7. Green → `node scripts/run-state.mjs --advance $1 --phase gate --status done`. Red →
   `--status failed --note "<what broke>"` and route to debug-agent before re-running.
