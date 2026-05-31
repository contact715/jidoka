# reflexion-critic — eval result

**Status: MEASURED** — 2/3 on a 3-case golden set (run 2026-05-31).

| case | expected | agent | match |
|---|---|---|---|
| RC-PASS-01 (diff matches spec + test) | PASS | PASS | ✓ |
| RC-REVISE-01 (partial vs spec, fixable) | REVISE | REVISE | ✓ |
| RC-BLOCK-01 (side-effects in a "pure function") | BLOCK | REVISE | ✗ |

## The miss is a calibration boundary, not a clear error
On RC-BLOCK-01 the spec said "pure function" and the diff added a disk write + a network call. The
agent returned **REVISE** (judging the side-effects removable), the golden expected **BLOCK** (a
fundamental spec contradiction + an undeclared network side-effect). Both are defensible. I did NOT
change the golden to match the agent — that would be reward-hacking, the exact thing this system
guards against. Recorded as a real 2/3.

**Signal:** either calibrate reflexion-critic to BLOCK (not REVISE) when a change contradicts an
explicit invariant AND adds an undeclared network/disk side-effect, or accept REVISE as reasonable.
That is a human calibration decision, surfaced honestly rather than hidden by a tuned score.

## Honest boundaries
3 cases, one run, LLM is non-deterministic — a snapshot. Next: add more BLOCK-vs-REVISE boundary
cases to pin the threshold, and re-run.
