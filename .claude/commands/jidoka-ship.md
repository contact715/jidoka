---
description: Finalize a wave — pre-publish guard, close the journal, capture the lesson
argument-hint: <wave-id>
allowed-tools: Read, Bash, Agent
---
Ship wave $1.

1. `node scripts/pre-publish-guard.mjs` — no secrets / PII, no broken claims. Must pass before any push.
2. Memory + Kaizen: skill-extractor captures the lesson; durable facts go to mcp__memory; if there is a
   product metric, note how it will be measured and how the product learns from real use.
3. Close the journal: `node scripts/run-state.mjs --advance $1 --phase memory --status done`, then
   `node scripts/run-state.mjs --resume $1` should report the wave complete. This close is GATED by the
   independent acceptance verdict from `/jidoka-verify`: if `docs/runs/$1/verdict.json` is missing or
   failing, run-state refuses the close. Produce/refresh it with `node scripts/acceptance-verdict.mjs $1`
   (a fresh re-run of every AC proof) before shipping — "done" is proven, not declared.

A human triggers the actual push/merge. Agents propose, they do not push without permission.
