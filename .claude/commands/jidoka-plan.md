---
description: Compose the orchestration graph for a task and open a resumable run-journal
argument-hint: <wave-id> [risk:trivial|normal|critical] [surfaces:backend,frontend,data]
allowed-tools: Read, Bash, Agent
---
Plan a wave. Args: $ARGUMENTS (wave-id, optional risk, optional surfaces).

1. Compose the graph for the task (the planner decides which phases earn their cost):
   `node scripts/orchestration-planner.mjs --task '{"risk":"<risk|normal>","surfaces":[<surfaces>]}'`
   (in an installed product use `.jidoka/scripts/orchestration-planner.mjs`).
2. Check the plan is ready BEFORE building: `node scripts/plan-check.mjs --task '{...the same task...}'`.
   It blocks a plan that would under-deliver (a phase with no agents, no gate, critical risk without
   debate). Fix the plan before proceeding.
3. Open the run-journal so the wave survives a context reset:
   `node scripts/run-state.mjs --init <wave-id> --task '{...the same task...}'`
4. If risk is not trivial, dispatch the spec phase the planner returned (architects + product team in
   parallel via the Agent tool), then `/jidoka-build <wave-id>`. Trivial → straight to `/jidoka-build`.

Report the composed phases and the journal path. Do not write product code in this step.
