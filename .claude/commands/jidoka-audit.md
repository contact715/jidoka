---
description: Meta-mistake audit + ghost detector — recurrence, regressions, declaration-over-implementation
---
Run the jidoka integrity audits and report honestly:
1. `node scripts/instantiation-audit.mjs` — ghost mechanisms (declared but not real). Must be 0.
2. `node scripts/meta-audit.mjs` — recurring mistake classes, gated/holding, regressions.
3. If a project: `node .jidoka/scripts/meta-audit.mjs`.

Report gated/holding count, any ungated recurrence, any regression, ghost count. If a regression or
ghost is found, name it and recommend the fix — do not silently fix.
