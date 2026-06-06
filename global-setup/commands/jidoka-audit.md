---
description: Meta-mistake audit + ghost detector — recurrence, regressions, declaration-over-implementation
allowed-tools: Read, Bash
---
Run the jidoka integrity audits and report honestly:
1. `node scripts/instantiation-audit.mjs` — ghost mechanisms (declared but not real). Must be 0.
2. `node scripts/meta-audit.mjs` — recurring mistake classes, gated/holding, regressions.
3. If a project: `node .jidoka/scripts/meta-audit.mjs`.

If the current directory has neither `scripts/instantiation-audit.mjs` nor `.jidoka/` (e.g. the
global install `~/.claude/jidoka` — a generated artifact, not the repo), locate the framework repo
clone (e.g. `~/claude-code-dev-framework`) and run the audits there.

Report gated/holding count, any ungated recurrence, any regression, ghost count. If a regression or
ghost is found, name it and recommend the fix — do not silently fix.
