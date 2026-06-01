# debate-defender — eval result

**Status: MEASURED — 1/2** (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| DEF-REFUTE-01 (unfounded race-condition claim) | PASS (refute) | PASS | ✓ |
| DEF-CONCEDE-01 (real plaintext card logging) | FAIL (concede) | PASS | ✗ |

## The miss is an eval-protocol gap, not a reasoning error
On DEF-CONCEDE-01 the defender (which has Read/Grep/Bash by role) ignored "judge ONLY the scenario",
ran 4 tool calls to scan the REAL repo diff, found no card-logging there, and returned PASS. Its
reasoning about the real tree was sound — but it judged the wrong thing. A tool-equipped agent drifts
to the live repository instead of the hypothetical scenario.

**Signal (not hidden):** eval cases for agents with file access must isolate them — run under
`sandbox-run` with no repo read, or strip tools for the eval, or phrase the scenario as the only
input. The golden expected verdict was NOT changed to match the agent. Recorded as a real 1/2 + an
eval-protocol fix to make next time.

## Honest boundary
2 cases, one run, snapshot. The refute case (sound) shows the judgement works; the concede miss is
about isolation, to be fixed in the eval harness.
