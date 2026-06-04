---
description: Run one dev wave end to end — plan → walk phases → gate each → debug↺ → memory, with proof at every phase.
argument-hint: "<task>" | --resume <wave-id>
allowed-tools: Read, Bash, Edit, Write, Agent
---

# /jidoka-wave — the end-to-end wave executor

Drive ONE dev wave from a task to green, walking the planned phase graph with a proof at every
phase. This is the executor that ties the pieces into one flow: the **planner** plans, **run-state**
journals, **phase-gate-runner** gates each phase mechanically, and YOU (the orchestrator) dispatch
the agents. Spec: `docs/specs/JIDOKA_WAVE_EXECUTOR_SPEC.md`.

Input: `$ARGUMENTS` = the task (free text).

## Walk

1. **Plan.** Derive `{type, risk, surfaces}` from the task, then:
   `node scripts/orchestration-planner.mjs --task '<json>' --json`
   → the ordered phase graph; each phase carries `agents[]`, `skills[]`, `gates[]`, `verifyN`.

2. **Open the journal.** `run-state.initState(wave, task)` → `docs/runs/<wave>/STATE.md`.
   The dashboard reads this file — do NOT build a second status surface here.

3. **Walk each phase IN ORDER.** For each phase:
   - Load the phase's mandated superpower skill (`skills[]`) before acting.
   - **Dispatch** the phase's `agents[]` via the Agent tool — real subagents. On the `gate` phase
     honor `verifyN` (run N independent verifiers).
   - **Gate the phase mechanically:**
     `node scripts/phase-gate-runner.mjs --phase <phase> --plan <plan.json> --changed "$(git diff --name-only)"`
     - `needs-input` gates (mutation-test / spec-size-check / plan-check): supply the input
       (changed files / the spec file / the task json) and run them — do not leave them unrun.
     - `dormant` gates (load-test / e2e / canary): note them, do not block.
     - `unknown` gate → STOP: the plan references a gate with no runner rule; close that gap first.
   - **On a failing gate → debug loop:** dispatch `debug-agent` on the exact failing gate, apply the
     fix, re-run `phase-gate-runner`. Loop **≤ 2 rounds**. Still red →
     **ANDON HALT** (`writeHaltState`): stop the line, report the failing gate + journal position.
     **Never advance past red.**
   - `run-state.advanceState(state, phase, 'done', note)` → `saveState`. Then the next phase.

4. **Memory phase.** `kaizen-loop` + skill-extract + `req-trace` / `prod-harvest`. On `critical`
   risk only: the frontier evals (agent-benchmark / trajectory-score / judge-calibration).

5. **Done — only with proof.** The diff, plus `docs/runs/<wave>/STATE.md` showing every phase green
   and every gate accounted for (green / needs-input-and-run / dormant-noted). No "done" without
   that artifact in the same turn.

## Resume

`/jidoka-wave --resume <wave>` → `run-state.nextStep` reports the first not-done phase; re-enter the
walk there. Completed phases are not re-run.

## Honesty contract

- Never fake-pass a gate. `dormant` = reported, `needs-input` = supplied-and-run or reported, `unknown` = HALT.
- The gate phase's LLM-judges (reflexion-critic, constitutional-reviewer) are agents you dispatch —
  `phase-gate-runner` covers only the script-gates; run both, skip neither.
- Proportional: trivial task → minimal graph (architects skipped); critical → full graph + frontier evals.
