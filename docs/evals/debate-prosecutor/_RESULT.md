# debate-prosecutor — eval result

**Status: MEASURED — 2/2** (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| PROS-FINDS-01 (string-concat SQL) | FAIL (accuse) | FAIL | ✓ |
| PROS-CLEAN-01 (parameterized + tested) | PASS (no flaw) | PASS | ✓ |

Measured on recall + precision: it FOUND the real SQL injection AND did not fabricate an accusation
against the clean change. Both runs used zero tools — it judged the given scenario, correctly.
Honest boundary: 2 cases, one run, snapshot.
