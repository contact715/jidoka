# Spec — `jidoka wave`: the end-to-end wave executor

Status: DRAFT for review (spec-first). Not built yet. Written 2026-06-03.
Author: orchestrator. Reviewer: human (you).

## 1. Problem (the real gap, grounded)

Jidoka already has every piece of a dev pipeline, but they run as separate fragments,
so there is no single "run a wave from task to green" flow. Concretely, today:

- `orchestration-planner.mjs` outputs the phase graph (discovery → spec → tests → build →
  gate → debug → [launch] → memory), each phase carrying `agents[]`, `skills[]`, `gates[]`,
  `verifyN`. It PLANS. It does not run anything.
- `run-state.mjs` journals a wave (`initState` / `advanceState` / `nextStep` / `saveState`)
  and on `--resume` REPORTS the position. Its own header says resume "does NOT auto-execute
  the continuation". It TRACKS. It does not drive.
- `PHASE_GATES` lists which gates each phase should run, but nothing RUNS those gate scripts
  per phase during a wave. The list is declarative; execution is manual and scattered.
- 11 `/jidoka-*` drive commands exist (plan, build, verify, resume, ship, …) but each is a
  separate step a human triggers; there is no one command that walks the whole graph,
  dispatches each phase's agents, runs that phase's gates, journals, and loops on failure.

Result: the pipeline is real on paper, fragmented in practice. "Make it really work" =
close the loop into ONE driven, observable, resumable walk with proof at every phase.

## 2. Acceptance (what "works" means — observable, not asserted)

Given `jidoka wave "<task>"`, the system MUST:

1. Plan the phase graph proportional to risk (reuse `orchestration-planner`).
2. Walk phases IN ORDER. For each phase: dispatch the phase's agent(s), then run the
   phase's gates; record PASS/FAIL to the run-state journal before advancing.
3. On a gate FAIL: enter the `debug` phase, attempt a fix, re-run the failed gate. Loop
   with a hard cap (default 2 rounds/phase). If still failing, HALT (andon) with the exact
   failing gate + journal position — never advance past red.
4. Be resumable: a killed/paused wave continues from the first not-done phase via run-state.
5. End state: a diff, every phase's gates green, a complete run-state journal at
   `docs/runs/<wave>/STATE.md`, and a memory write. The dashboard reads the same journal.

DONE = a real task driven through this end to end, all gates green, journal complete,
shown in one transcript. No "done" without that proof artifact.

## 3. What it INTEGRATES (do not reinvent — reuse exactly)

- Planning: `orchestration-planner.mjs` (phases + per-phase agents/gates/verifyN). REUSE.
- Journal/position/resume: `run-state.mjs` (`phasesFromPlan`, `initState`, `advanceState`,
  `nextStep`, `renderStateMd`, `saveState`, `runDir`). REUSE.
- Per-phase agents: dispatched by the orchestrator via the Agent tool (the `agents[]` per
  phase). The executor is orchestrator-driven; a `.mjs` cannot dispatch agents.
- Gates: the existing per-phase gate scripts named in `PHASE_GATES`. REUSE.
- Halt: the existing andon/halt mechanism. REUSE.
- Dashboard: OUT OF SCOPE here — the parallel session owns it; it only READS run-state.

## 4. The ONE new deterministic piece: `phase-gate-runner.mjs`

The only genuinely missing mechanical glue. Given a phase name + the plan, it runs that
phase's `gates[]` scripts and returns a structured `{ phase, results:[{gate, pass, output}],
ok }`. This is what lets the executor gate each phase MECHANICALLY instead of "the gates are
listed somewhere". Pure-ish, self-tested, ~80–120 LOC.

```
node scripts/phase-gate-runner.mjs --phase gate --plan <plan.json>   # runs that phase's gates
  → exit 0 + {ok:true}  | exit 1 + the failing gate(s)
```

Boundary (honest): it runs the gate scripts that are mechanical (resource-guard,
precision-guard, dead-code, type-coverage, contract-check, dependency-audit, …). LLM-judge
gates (reflexion-critic, constitutional-reviewer) stay orchestrator-dispatched as agents in
the same phase — the runner reports which gates are mechanical-vs-agent so neither is skipped.

## 5. The executor flow (orchestrator-driven, the closed loop)

Delivered as ONE drive command (tighten `/jidoka-build` into the full walk, or a new
`/jidoka-wave`). The orchestrator follows this; deterministic steps call the scripts above.

```
plan      = orchestration-planner(task)                 # the graph
state     = run-state.initState(wave, task)             # journal opens
for phase in plan.phases:
    dispatch phase.agents        (Agent tool, real subagents, honor verifyN)
    g = phase-gate-runner(phase, plan)                  # mechanical gates
    if not g.ok:
        round = 0
        while not g.ok and round < CAP(=2):
            dispatch debug-agent on g.failing            # root-cause + fix
            g = phase-gate-runner(phase, plan)
            round++
        if not g.ok: andon-halt(phase, g.failing); STOP  # never pass red
    run-state.advanceState(state, phase, 'done', note)   # journal the phase
    run-state.saveState(root, state)
memory phase: kaizen + skill-extract + req-trace/prod-harvest
final: render journal, emit diff + green summary
```

## 6. Resumability

`jidoka wave --resume <wave>` → `run-state.nextStep` gives the first not-done phase; the
executor re-enters the loop there. No re-running completed phases. (run-state already
computes position; the executor adds the missing "and then actually continue".)

## 7. Out of scope (explicitly, to avoid scope creep + collision)

- The dashboard (parallel session owns it; executor only writes run-state it reads).
- New agents or new gates (use the existing roster + gate set).
- The engine cleanup the parallel session is doing (audit findings, dead-code) — independent.
- Auto-merge / auto-ship — `ship` stays a separate human-triggered command.

## 8. Decomposition + limits

- `scripts/phase-gate-runner.mjs` — new, ≤120 LOC, pure logic + self-test + eval case.
- One drive command (`/jidoka-wave` or tightened `/jidoka-build`) — the walk; no logic
  duplication, it calls planner + runner + run-state.
- run-state: small addition only if needed (a `--next-gate` helper). No rewrite.
- No file >400 LOC, no function >80 LOC.

## 9. Proof plan (how we'll know it works, before saying "done")

1. `phase-gate-runner --self-test` green + eval case.
2. Dry wave on a TRIVIAL task (risk=trivial → minimal graph): walks build → gate → memory,
   journal written, gates run, shown end to end.
3. One REAL small framework task driven through the full walk: diff produced, every phase
   green in the journal, andon proven by forcing one gate red and seeing it HALT not pass.
4. `footprint-audit` / `instantiation-audit` clean (no dead/ghost added).

## 10. Open questions for the reviewer

- New command `/jidoka-wave`, or fold the walk INTO the existing `/jidoka-build`? (Default:
  new `/jidoka-wave` = the full walk; keep `/jidoka-build` as the single build phase.)
- Debug-loop cap default 2 — ok?
- Should the memory phase auto-run frontier evals (agent-benchmark/trajectory/calibration),
  or only on `critical` risk? (Default: critical only, to keep trivial waves cheap.)
