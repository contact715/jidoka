---
description: Project federation status — North Star, Integrity Charter, and the steward's defense readiness
allowed-tools: Read, Bash
---
Report the federation/integrity status of the CURRENT project (the one in cwd, not the framework):
1. North Star: `node ~/.claude/jidoka/scripts/northstar-check.mjs --doc docs/NORTH_STAR.md` (exists + complete?).
2. Integrity Charter: `node ~/.claude/jidoka/scripts/charter-check.mjs --doc docs/PROJECT_CHARTER.md` (exists + complete?).
3. Is there a `project-steward` agent (.claude/agents/project-steward.md)?

If any is missing, say so and offer to create it from the template (the steward owns the charter,
the CPO owns the North Star). Then summarize: can this project defend its integrity against an
incoming framework change? (charter present + steward present = yes.)
