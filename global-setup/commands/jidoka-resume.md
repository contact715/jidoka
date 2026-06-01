---
description: Resume a wave from disk after a context reset — reports position and the next step
argument-hint: [wave-id]
allowed-tools: Read, Bash
---
Resume work: `node scripts/run-state.mjs --resume $ARGUMENTS` (no id → the latest wave).

It prints which phases are done and which to dispatch next. Read that, state the position back in one
line, then continue from the next pending phase (`/jidoka-build` or `/jidoka-verify` as appropriate).

This is the GSD STATE.md pattern: position lives on disk, so an interrupted build does not restart from
the user's prompt. Durable lessons stay in mcp__memory; this is run position only.
