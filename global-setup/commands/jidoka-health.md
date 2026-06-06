---
description: Full jidoka health check — eval, engine self-tests, ghosts, measured judges, regressions
allowed-tools: Read, Bash, Grep
---
Run the jidoka health check and report concisely (do NOT fix anything — just report pass/fail).
Use `scripts/` in the framework repo, or `.jidoka/scripts/` in an installed project.
If the current directory is NEITHER (no `scripts/eval-suite.mjs` and no `.jidoka/`) — e.g. you are
in the global install `~/.claude/jidoka`, which is a generated artifact, not the repo — locate the
framework repo clone first (`mdfind -name eval-suite.mjs` or the known clone, e.g.
`~/claude-code-dev-framework`) and run ALL checks there. Never report a script as "missing"
without first checking the framework repo.

1. Eval suite: `node scripts/eval-suite.mjs` — pass-rate, any regression.
2. Engine self-tests: run `--self-test` on each engine script that has one; count green.
3. Ghosts: `node scripts/instantiation-audit.mjs` — must be 0.
4. Measured judges: `node scripts/agent-eval-dashboard.mjs` — N of M measured.
5. Regressions: `node scripts/meta-audit.mjs` — gated/holding/regressions.
6. Git: clean tree? unpushed commits?

Report each line with ✓/✗ and the number. End with one honest sentence on overall health.
