---
status: Active
level: L1
type: roadmap
owner: platform
created: 2026-05-31
---

# Hardening Roadmap — close the honest gaps

After the frontier wave (6 modules), North Star, and the first hardening pass (pipeline-contract,
northstar-gate, 1 agent measured, kaizen-loop), three honest gaps remain. This roadmap closes them
in order. Each phase ships a real mechanism, proves it with shown output, states its honest
boundary, and commits. No phase is "done" without an executable proof in the same step.

## Where we are (measured, not claimed)
- eval suite: 17/17 deterministic cases, in CI.
- engine self-tests: 9/9. unit tests: 14/14. ghosts: 0. regressions: 0.
- LLM agents measured: **1 of ~10** (constitutional-reviewer, 3/3 on a 3-case golden set).
- sandbox: policy-level proxy (no real-time enforcement). kaizen-loop: logic FULL, product data DORMANT.

## Principle for every phase
mechanism + self-test + eval case + 0 ghosts + honest boundary labelled + commit. Same bar as the
frontier modules. LLM-agent runs are snapshots (non-deterministic) — the deterministic scorer goes
in CI, the model run does not.

---

## R1 — Measure the judges (DORMANT → MEASURED)
The biggest gap: we trust LLM judges we have not measured. Lift the core ones.
- **R1.1** Grow constitutional-reviewer golden set (3 → 6: add a scope-creep case, a borderline
  PASS, a mission-alignment case). Run the new cases. `[FULL run + scored]`
- **R1.2** reflexion-critic: golden cases (PASS/REVISE/BLOCK) + real run + score. `[FULL]`
- **R1.3** debate-judge: golden cases (PASS/REVISE/BLOCK/DEADLOCK) + real run + score. `[FULL]`
- **R1.4** `agent-eval-dashboard.mjs` — one place that reads every agent's _RESULT and reports
  measured/dormant + accuracy + date. self-test. Surfaces "1 of N measured" honestly. `[FULL]`

## R2 — Real-time policy enforcement (proxy → enforcement)
policy-sandbox checks after the fact. Make it BLOCK in real time via a PreToolUse hook, so an
out-of-scope write is stopped, not just reported. This is the honest intermediate step toward an
OS sandbox (still not kernel isolation — labelled).
- **R2.1** `policy-enforce-hook.sh` — PreToolUse hook: on Write/Edit, resolve the acting agent's
  write_scope from the registry and block paths outside it. `[FULL at hook layer]`
- **R2.2** Wire into `~/.claude/settings.json` PreToolUse, husky-safe (do not clobber existing).
- **R2.3** Prove: an in-scope write passes, an out-of-scope write is blocked. self-test + eval.

## R3 — kaizen-targets for the real products (structure now, numbers in-product)
- **R3.1** `docs/kaizen-targets.json` for Mosco + WhatsApp agent, metrics derived from each
  NORTH_STAR §3 Goal (metric, direction, target). Series left as a single current point or empty,
  clearly marked DORMANT until the product's data-analyst feeds real numbers. `[structure FULL, data DORMANT]`
- **R3.2** kaizen-loop runs against them and reports (honest: "no series yet → cannot assess").

## R4 — Honest system-state dashboard
- **R4.1** Refresh `docs/HONEST_SYSTEM_STATE.md`: measured-agent count, eval status, what is FULL vs
  PROXY vs DORMANT, the OS-sandbox gap stated plainly. One source of truth for "what really works".

## Out of scope (named, not hidden)
- **Full OS/kernel sandbox** (seccomp/containers per agent) — a separate project, not a script.
  R2 is the honest hook-layer step toward it, explicitly not kernel isolation.
- **Always-on LLM judging in CI** — non-deterministic + token cost; deterministic scoring only.

## Definition of done
All R1–R4 phases: self-test green, in CI, 0 ghosts, README/counts + snapshot refreshed, committed +
pushed, every FULL claim proven by shown output, every PROXY/DORMANT labelled.
