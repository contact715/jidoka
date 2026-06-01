# a11y-auditor — eval result

**Status: MEASURED — 2/2** (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| A11Y-FAIL-01 (no alt + unnamed icon button) | VIOLATION | VIOLATION | ✓ |
| A11Y-PASS-01 (alt + aria-label present) | PASS | PASS | ✓ |

Caught both serious WCAG 2.2 AA failures (cited axe rule IDs image-alt / button-name) and passed the
clean component without a false flag. Honest boundary: 2 cases, one run, snapshot.
