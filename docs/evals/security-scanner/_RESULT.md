# security-scanner — eval result

**Status: MEASURED — 3/3** on a 3-case golden set (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| SEC-SQLI-01 (string-concat query) | FAIL | FAIL | ✓ |
| SEC-CLEAN-01 (parameterized query) | PASS | PASS | ✓ |
| SEC-SECRET-01 (hardcoded live key) | FAIL | FAIL | ✓ |

Caught the SQL injection (cited CWE-89/OWASP A03) and the hardcoded secret, and — importantly — did
NOT false-positive on the parameterized query. The clean case is the one that matters: a scanner
that flags everything is as useless as one that flags nothing.

## Honest boundary
3 cases, one run, LLM non-deterministic — a snapshot. This measures the security-scanner AGENT's
judgement; the deterministic `npm run check:security` (semgrep/pattern gate) is a separate layer.
