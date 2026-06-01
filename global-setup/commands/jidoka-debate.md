---
description: Run an adversarial debate (prosecutor/defender/judge) on an analytical or decision question
argument-hint: <a comparison, decision, or analysis question>
allowed-tools: Read, Bash, Agent
---
Adversarial analysis of: $ARGUMENTS

1. Route it: `node scripts/debate-trigger.mjs --task '{"prompt":"$ARGUMENTS"}'` (in a product use
   `.jidoka/scripts/`). It says whether this warrants a debate and which mode (full / panel / none).
2. If full: dispatch two INDEPENDENT, repo-grounded agents via the Agent tool — a prosecutor (argue one
   side, find the flaw) and a defender (argue the other, refute) — each citing real evidence, then a
   judge synthesises. Record the rounds via `node scripts/debate-engine.mjs`.
3. If panel (N competing options): run a judge-panel / best-of-N over the options instead.
4. Give your answer FROM the debate's verdict, not from a single unexamined pass.

The system-level reflex: comparison, decision, and analysis questions get an adversary before the answer.
