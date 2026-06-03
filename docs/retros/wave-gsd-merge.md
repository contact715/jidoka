# Wave Retro — wave-gsd-merge

## Wave ID
wave-gsd-merge

## Title
Merge GSD's best into jidoka without diluting the moat (borrows A-F + 5 meeting-borrows)

## Date
2026-06-01

## Status
Shipped

---

## Goal
Take the genuinely useful mechanisms from GSD and from a high-volume agentic-dev practitioner call, port them into the jidoka engine, and prove each one runs. Filter out product-side and ToS-gray ideas; keep only what makes the engine itself stronger.

---

## What worked
- Six structural borrows shipped and traced to passing evidence by the wave's own verifier: A resumable run-state (`scripts/run-state.mjs`), B drive-commands + anti-ghost (`scripts/check-commands.mjs`), C proportional install profiles (`scripts/install-into.mjs`), D engine mutation testing (`scripts/mutation-test.mjs`), E goal-backward verification (`scripts/verify-goal-backward.mjs`), F guided onboarding + `QUICKSTART.md`.
- Five meeting-borrow scripts shipped, each with a deterministic `--self-test`: `model-router`, `skill-selector`, `spec-size-check`, `spec-tldr`, `trend-scan` (commit edbe877).
- `verify-goal-backward --goal docs/runs/wave-gsd-merge/goal.json` exits 0: every A-F objective is delivered, traced backward to a real proof command. 12/12 self-tests green across both layers.
- The borrow was disciplined: `model-router` routes by tier×cost×privacy with a local fallback but does NOT swap subscription tokens to evade ToS. The moat stayed intact.

## What failed
- self-test-blindspot (logged `docs/audits/meta-mistakes.jsonl`): the temp-copy `isMain` guard never fired on the macOS `/var` symlink, so a batch of self-tests silently never ran. A self-test that does not execute reads as green. Found and fixed inside the wave, but it shipped first.
- The MEMORY phase was left undone for a full day: the work was real and proven, but no retro or skill was written and the run-state journal was never advanced past `current: tests`. This retro closes that gap.

---

## Patterns observed
- self-test-blindspot is now the top recurring class in the ledger (3×). The shared failure: a verification that cannot actually run still returns success. The durable fix is a meta-check that the self-test body executed at least one assertion, not just that it exited 0.
- Journaling lag: a wave can be fully built and proven while its run-state journal still says `pending`. The dashboard correctly showed the lag (that is what surfaced this). The journal is only as honest as the `--advance` calls the orchestrator remembers to make.

## Playbook update proposed
After a wave's gates pass, the memory phase must produce a retro file AND call `run-state.mjs --advance <wave> --phase memory --status done` in the same session. A green wave with a `pending` journal is an incomplete wave.

## Stats
- Wave duration: ~2 sessions (2026-06-01 build, 2026-06-02 memory + journal reconciliation)
- Agents involved: discovery (debate), spec (chief-architect), build (engineering-lead), gate (verify-goal-backward + framework gates), memory (this retro)
- Files added: 11 borrow scripts + run-state mechanism + QUICKSTART
- Files modified: install-into, package.json wiring
- LOC delta: ~ +1500 (engine scripts)
