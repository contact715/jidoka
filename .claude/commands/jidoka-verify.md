---
description: Run the quality gates on the wave and prove it executes, not just compiles
argument-hint: <wave-id>
allowed-tools: Read, Bash, Agent
---
Verify wave $1.

1. `node scripts/run-state.mjs --advance $1 --phase gate --status running`.
2. Run the gates: reflexion-critic (spec compliance), constitutional-reviewer (mission), plus
   security-scanner / coverage / a11y / perf as the surfaces require. On a critical wave run the
   adversarial debate: `node scripts/debate-engine.mjs`.
3. Execution proof, not just static checks: actually run the project's tests/command via
   `node scripts/execution-gate.mjs --run`. Untrusted or generated code runs isolated:
   `node scripts/sandbox-run.mjs --scope <build-dir> --cmd "<test>"` (kernel sandbox, no escape).
4. Green → `node scripts/run-state.mjs --advance $1 --phase gate --status done`. Red →
   `--status failed --note "<what broke>"` and route to debug-agent before re-running.
