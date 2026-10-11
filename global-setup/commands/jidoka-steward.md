---
description: Project federation status — North Star, Integrity Charter, and whether the Charter is gated on pre-push
allowed-tools: Read, Bash
---
Report the federation/integrity status of the CURRENT project (the one in cwd, not the framework):
1. North Star: does `docs/NORTH_STAR.md` exist? If yes, `node ~/.claude/jidoka/scripts/northstar-check.mjs --doc docs/NORTH_STAR.md` (complete?).
2. Integrity Charter: does `docs/PROJECT_CHARTER.md` exist? If yes, `node ~/.claude/jidoka/scripts/charter-check.mjs --doc docs/PROJECT_CHARTER.md` (complete?).
3. Is the Charter gated? Look for `charter-check.mjs` in the project's pre-push hook (`.githooks/pre-push`, `.husky/pre-push`, or the path in `git config core.hooksPath`).

If a document is missing, say so and offer to create it from `docs/NORTH_STAR_TEMPLATE.md` or
`docs/PROJECT_CHARTER_TEMPLATE.md` (the product owner fills both). Then summarize: can this project
defend its integrity against an incoming framework change? (Charter present + complete + gated on
pre-push = yes.)
