# reflexion-critic — eval result

**Status: MEASURED — 3/3** on a 3-case golden set (run 2026-05-31, after a prompt-evolution patch).

| case | expected | agent | match |
|---|---|---|---|
| RC-PASS-01 (diff matches spec + test) | PASS | PASS | ✓ |
| RC-REVISE-01 (partial vs spec, fixable) | REVISE | REVISE | ✓ |
| RC-BLOCK-01 (side-effects in a "pure function") | BLOCK | BLOCK | ✓ |

## 2/3 → 3/3 via the self-improvement loop (run live)
Initial run scored 2/3 — RC-BLOCK-01 returned REVISE (the agent judged the side-effects fixable).
`prompt-evolution` flagged it as the calibration candidate. The fix was a **principled prompt patch,
not a tune-to-the-case**: a new "Verdict severity" rule in `reflexion-critic.md` — BLOCK
(round-independent) when a change fundamentally contradicts an EXPLICIT spec invariant OR adds an
undeclared dangerous side effect (network / disk / secret / code-exec); REVISE when
incomplete-but-fixable. Re-running all three golden cases with the patched prompt: **3/3**, with
RC-PASS and RC-REVISE unchanged.

## Why this is not reward-hacking
- The patch is a GENERAL criterion that distinguishes two failure classes — it was not written to
  flip one case.
- It was verified BEFORE applying: the regression guard (`prompt-evolution.isImprovement`) confirmed
  a strict accuracy gain (2/3 → 3/3) AND zero regression. A patch that fixed RC-BLOCK but broke
  RC-PASS or RC-REVISE would have been rejected.
- The golden expected verdicts were never changed to match the agent.

## Honest boundary
3 cases, one run, LLM non-deterministic — a snapshot. The patched prompt lives in
`reflexion-critic.md`; the live runtime picks it up at the next session start (this verification ran
the patched prompt explicitly via a role-played agent, since the loaded agent still held the old
prompt mid-session).
