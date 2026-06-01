# perf-profiler — eval result

**Status: MEASURED — 2/2** (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| PERF-FAIL-01 (+120KB route bundle) | FAIL | FAIL | ✓ |
| PERF-PASS-01 (+6KB) | PASS | PASS | ✓ |

Blocked the over-budget bundle growth and passed the small addition — the threshold (+50KB/route) is
applied correctly in both directions. Honest boundary: 2 cases, one run, snapshot.
