# best-of-N-judge — eval result

**Status: MEASURED — 3/3** on a 3-case golden set (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| BN-CORRECT-01 (correct vs buggy vs side-effect) | A | A | ✓ |
| BN-SPEC-01 (spec-pure vs faster-but-impure) | A | A | ✓ |
| BN-QUALITY-01 (equal correctness, simpler wins) | B | B | ✓ |

BN-QUALITY-01 is the important one: with equal correctness and tests, the judge broke the tie on
maintainability (simpler, no duplication) — exercising the "quality over passes-and-shorter" rubric,
not just correctness. BN-SPEC-01 confirms an explicit spec invariant disqualifies a faster candidate.

## Honest boundary
3 cases, one run, LLM non-deterministic — a snapshot. Scored deterministically by llm-eval-score
(extended to read a WINNER:/candidate-letter verdict).
