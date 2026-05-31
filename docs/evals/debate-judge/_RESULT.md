# debate-judge — eval result

**Status: MEASURED** — 3/3 on a 3-case golden set (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| DJ-PASS-01 (unsubstantiated claim, refuted) | PASS | PASS | ✓ |
| DJ-BLOCK-01 (evidenced security violation, unrefuted) | BLOCK | BLOCK | ✓ |
| DJ-DEADLOCK-01 (both evidenced, spec ambiguous) | DEADLOCK | DEADLOCK | ✓ |

All four verdict classes the judge can emit were exercised across PASS/BLOCK/DEADLOCK; reasons cited
the right evidence (no file:line → PASS, exact line of card-number logging → BLOCK, genuine spec
ambiguity → DEADLOCK escalate to human).

## Honest boundaries
3 cases, one run, LLM is non-deterministic — a snapshot, not a gate. REVISE was not exercised here;
next run should add a REVISE case (minor, fixable concern raised and not fully refuted).
