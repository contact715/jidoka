---
description: Run the build phase — dispatch implementation agents per the planned graph
argument-hint: <wave-id>
allowed-tools: Read, Bash, Edit, Write, Agent
---
Build wave $1.

1. Read where we are: `node scripts/run-state.mjs --resume $1`.
2. Mark build started: `node scripts/run-state.mjs --advance $1 --phase build --status running`.
3. Dispatch the build agents per the plan's surfaces (backend-agent / frontend-agent; data work via a
   general-purpose agent with the data task in its prompt),
   building against the REAL contract, not a guessed shape. Decompose per the repo limits
   (file ≤400 LOC, function ≤80 LOC). Before dispatching parallel writers, run
   `node scripts/parallel-guard.mjs` to detect write_scope overlap; overlapping writers go serial or in
   a git worktree.
4. On completion: `node scripts/run-state.mjs --advance $1 --phase build --status done`.

Then run `/jidoka-verify $1`.
