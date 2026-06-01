---
description: Start a new project or feature the disciplined way — North Star and business questions first
argument-hint: [one-line description of the project or feature]
allowed-tools: Read, Bash, Write, AskUserQuestion, Agent
---
Start: $ARGUMENTS

Do NOT jump to code. Run the dev-pipeline opening:
1. North Star: does the product have `docs/NORTH_STAR.md`? Check with
   `node scripts/northstar-check.mjs --doc docs/NORTH_STAR.md` (in a product use `.jidoka/scripts/`).
   Missing → the CPO fills it from the template by asking business questions (why it exists, the
   1-3 year goal, invariants, what we will NOT do). Do not invent answers, ask.
2. Business questions (via AskUserQuestion): who uses it, why, constraints, success criteria, and the
   Kaizen question — which business metric this moves, how we measure it, how it learns from real use.
3. Once clear, open a wave with `/jidoka-plan <wave-id>` and proceed plan → build → verify → ship.

This is the most important step: clarity before code.
