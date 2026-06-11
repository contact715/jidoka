# Autonomous Quality Pipeline

**Introduced:** wave-102
**Depends on:** wave-95 (post-commit hooks), wave-96 (agent roster)

---

## Overview

The this project SDD pipeline has grown to where a human orchestrator polling for test results manually is the bottleneck. This document describes the autonomous quality pipeline that runs between every commit and every merge, without human intervention except at explicitly defined escalation points.

The goal: every wave commit passes through a deterministic quality chain. Tests are written before code. Automated agents parse results. Three gate agents block merge on critical violations. Constitutional alignment is checked independently of spec compliance.

Before wave-102, the pipeline reached approximately 85% autonomous quality coverage. The missing 15% was: tests written after implementation, no systematic coverage tracking, no accessibility or security gate, and no constitutional check independent of Reflexion Critic.

---

## Full pipeline sequence

After chief-architect writes the spec and Orchestrator dispatches:

1. **test-engineer** — reads ACs from spec, writes `*.test.ts` stubs, commits before impl
2. **frontend-agent** — reads spec + existing stubs, implements
3. **test-runner** — post-commit: runs `npx vitest run --reporter=json` and `npx playwright test --reporter=json`
4. **[parallel gate group]** — runs simultaneously after test-runner passes:
   - **coverage-auditor** — compares lcov against `docs/metrics/coverage-baseline.json`
   - **a11y-auditor** — runs `@axe-core/playwright` WCAG 2.1 AA scan
   - **security-scanner** — runs `npm audit` + `semgrep` + `trufflehog`
5. **perf-profiler** — runs `scripts/bundle-delta.mjs` after build output is available
6. **constitutional-reviewer** — reads diff + `docs/MISSION.md`, answers 5 Mission Compass questions
7. **reflexion-critic** (L0.95) — spec compliance + regression check (up to 5 rounds, see below)
8. **skill-extractor** — post-wave hook, extracts patterns from retro

If any step emits BLOCK: pipeline halts at that step. debug-agent is triggered for test/coverage failures.

---

## Parallel gate group

Coverage, a11y, and security gates run in parallel (Step 4) for speed. All three must pass (or gracefully skip) before constitutional-reviewer runs.

Perf-profiler (Step 5) runs after build — it is not part of the parallel group because it requires a completed `npm run build` output.

---

## Escalation conditions

Human intervention is required in exactly these cases:

| Condition | Triggered by | Action required |
|---|---|---|
| Spec ambiguity (AC is untestable as written) | test-engineer | Human or chief-architect clarifies AC |
| Mission Compass VIOLATION | constitutional-reviewer | Human reviews VIOLATION before pipeline resumes |
| Security HIGH or CRITICAL finding | security-scanner | Human approves remediation plan |
| Iteration cap reached (5 rounds — see below) | Orchestrator | Human reviews accumulated critique log |
| debug-agent confidence < 80% on fix > 20 LOC | debug-agent | Human or frontend-agent reviews proposed fix |

Auto-apply is bounded to: confidence >= 80% AND fix <= 20 LOC. All other fixes require human review.

---

## Iteration cap

The reflexion-critic iteration cap is raised to 5 rounds within this pipeline:

- Rounds 1-5: REVISE routes back through the appropriate agent:
  - Test failure → debug-agent → test-runner re-run
  - Implementation gap → frontend-agent → re-implementation
  - Spec ambiguity → chief-architect → spec revision
  - Mission violation → constitutional-reviewer → human review (escalates immediately, does not consume a round)
- Round 5 REVISE → BLOCK: Orchestrator surfaces to human with full critique log

The 5-round cap replaces the 2-round cap documented in reflexion-critic.md (which remains at 2 rounds for its own internal gate logic). The 5 rounds refer to the full pipeline loop, not a single critic pass.

---

## Auto-progression

After all gates pass and reflexion-critic emits APPROVE:
- If no human-required escalation was triggered during the wave, Orchestrator auto-dispatches the next queued wave
- Skill-extractor runs as a background post-wave hook (non-blocking)
- Metrics Aggregator writes dashboard row

If a human-required escalation was triggered but resolved without BLOCK, pipeline resumes from the point of interruption.

---

## Resumable run-state (survives a context reset)

A wave's position is journaled to `docs/runs/<wave>/{state.json,STATE.md}` by `scripts/run-state.mjs`, so a build interrupted mid-wave resumes from disk instead of from the user re-typing the request (the GSD `STATE.md` pattern in our idiom). Phases come from `orchestration-planner.plan()`, the single definition of the graph, so this tracks position, not a second truth; the `mcp__memory` graph stays the learning store.

- At wave start: `node scripts/run-state.mjs --init <wave> --task '{"risk":..,"surfaces":[..]}'`
- After each phase: `node scripts/run-state.mjs --advance <wave> --phase <name> --status done|failed [--note ..]`
- On a fresh session (after a context reset), first run `node scripts/run-state.mjs --resume`. It reports which phases are done and which to dispatch next.

Boundary: `--resume` reports position plus the next step, it does not auto-execute the continuation (the orchestrator reads it and proceeds). Resumes to a phase boundary, not mid-phase. The journal is accurate only insofar as the orchestrator calls `--advance` (the dev-pipeline skill mandates these calls). In a product the script lives at `<project>/.jidoka/scripts/run-state.mjs` (delivered by install-into).

---

## Wave-id claims (parallel sessions)

Numeric wave ids are reserved mechanically, not by convention. Before creating ANY wave artifact (spec, run-state init, retro), a session claims the next free number:

```
node scripts/claim-wave-id.mjs        # prints wave-N (in a product: <project>/.jidoka/scripts/)
```

The claim is a one-line record appended to `docs/specs/_CLAIMED_WAVES.jsonl` and pushed as a micro-commit built directly on top of the fetched remote head via git plumbing — the local branch, index, and working tree are untouched, so a dirty tree or a branch that is N commits behind cannot block the claim. A rejected push means a parallel session took the number in those same seconds: the script re-fetches and takes the next one (CAS semantics on pure git, no server). Used-number sources are unioned: local `docs/retros|specs|runs`, the remote tree, commit subjects, and the claim registry itself.

Why "git fetch before picking an id" was not enough: the chosen number lived only in session memory until the first commit — an hours-wide race window. Real incident: projectx 2026-06-10, two parallel sessions took the same number three times in one day, two pushes rejected, hand-merge conflicts in generated files. The session-start digest (`hooks/session-start-digest.mjs`) additionally warns when the registry holds a fresh (<24h) claim — at session start any fresh claim is by definition another session's.

---

## Known limitations

- **pre-merge fires on local `git merge` only.** The `.githooks/pre-merge-commit` hook fires when running `git merge` locally. It does NOT fire when merging a pull request via the GitHub UI. Teams using GitHub's merge button bypass this gate. To enforce quality gates on GitHub merges, configure branch protection rules with required status checks in GitHub Actions CI.

- **semgrep and trufflehog require external installation.** Neither is an npm package. The security-scanner agent degrades gracefully (SKIP) if they are not in PATH. For full security coverage, install both on the development machine:
  - semgrep: `brew install semgrep` or `pip install semgrep`
  - trufflehog: `brew install trufflehog` or `curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh`

- **E2E requires a running dev server.** Playwright tests require the dev server on port 3000. The `playwright.config.ts` webServer config attempts to start it automatically, but if port 3000 is in use or the server fails to start within the timeout, E2E tests are skipped (graceful degrade).

- **@axe-core/playwright is not yet installed.** The a11y-auditor agent requires `npm install -D @axe-core/playwright`. Until installed, the a11y gate skips gracefully. Add this to the project devDependencies when activating the a11y gate.

- **Coverage requires @vitest/coverage-v8.** Added in wave-102 T.16. If the package is absent, `npx vitest run --coverage` errors and coverage-auditor skips.

- **Partial ship = partial protection.** This pipeline is fully active only when all wave-102 tasks are shipped. A partial ship leaves gaps in the gate chain.

---

## Activation

This pipeline is active as of wave-102 commit. The post-commit async gate runs after every commit that passes the pre-commit hook. The pre-merge blocking gate runs before every local `git merge`.

To run the full gate suite manually:
```bash
node scripts/run-quality-gates.mjs --wave wave-NN
```

To skip E2E (unit-only pass):
```bash
node scripts/run-quality-gates.mjs --wave wave-NN --skip-e2e
```

Closes: wave-102 T.15 AC-D2
