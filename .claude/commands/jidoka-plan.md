---
description: Compose the orchestration graph for a task and open a resumable run-journal
argument-hint: <wave-id> [risk:trivial|normal|critical] [surfaces:backend,frontend,data]
allowed-tools: Read, Bash, Agent
---
Plan a wave. Args: $ARGUMENTS (wave-id, optional risk, optional surfaces).

1. Compose the graph for the task (the planner decides which phases earn their cost):
   `node scripts/orchestration-planner.mjs --task '{"risk":"<risk|normal>","surfaces":[<surfaces>]}'`
   (in an installed product use `.jidoka/scripts/orchestration-planner.mjs`).
2. Open the run-journal so the wave survives a context reset:
   `node scripts/run-state.mjs --init <wave-id> --task '{...the same task...}'`
3. If risk is not trivial, dispatch the spec phase the planner returned (architects + product team in
   parallel via the Agent tool), then `/jidoka-build <wave-id>`. Trivial → straight to `/jidoka-build`.

Report the composed phases and the journal path. Do not write product code in this step.
