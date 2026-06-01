# coverage-auditor — eval result

**Status: MEASURED — 2/2** (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| COV-FAIL-01 (45% coverage drop) | FAIL | FAIL | ✓ |
| COV-PASS-01 (coverage held + tests added) | PASS | PASS | ✓ |

Blocked the untested 45-point drop and passed the change that shipped with its tests — the 5% block
threshold is applied correctly. Honest boundary: 2 cases, one run, snapshot.
