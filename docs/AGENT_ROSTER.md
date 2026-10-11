# Agent Roster (canonical reference)

Who does the work in jidoka and who checks it. Agent definitions live in `.claude/agents/`;
deterministic checks live in `scripts/`. On 2026-10-10 the roster was cut from 48 role agents to
the 6 that were actually dispatched in the previous 30 days; the other 42 had zero dispatches. Their
jobs moved to the orchestrator and to the scripts listed below. The previous version of this file
is in git history.

## Lines of defense (IIA Three Lines Model, 2020)

| Line | Name | Meaning here |
|---|---|---|
| **First** | Operations | Writes code and runs it: owns the output of the wave. |
| **Second** | Risk-Compliance | Challenges or gates First Line output; can block, does not implement. |
| **Third** | Independent Audit | Renders the binding verdict after First and Second Line finish. |
| **Pre-wave / Support** | Planning and records | Produces inputs to the wave or records of it. |

These annotations are internal metadata and are not surfaced to end-user roles.

### Line-assignment table

Accountability per activity: `docs/governance/raci.json` (source of truth), validated by
`scripts/validate-raci.mjs` against this table.

| Agent | L-tier | Line: |
|---|---|---|
| Orchestrator | L0 | Line: First — Operations |
| backend-agent | L1 | Line: First — Operations |
| frontend-agent | L1 | Line: First — Operations |
| execution-gate | L0.96 | Line: First — Operations |
| reflexion-critic | L0.95 | Line: Second — Risk-Compliance |
| coverage-gate | L0.96 | Line: Second — Risk-Compliance |
| dependency-audit | L0.96 | Line: Second — Risk-Compliance |
| run-checklist | L0.99 | Line: Second — Risk-Compliance |
| debate-prosecutor | L0.97 | Line: Second — Risk-Compliance |
| debate-defender | L0.97 | Line: Second — Risk-Compliance |
| debate-judge | L0.97 | Line: Third — Independent Audit |
| audit-meta-process | L0.98 | Line: Third — Independent Audit |

`backend-agent`, `frontend-agent`, `reflexion-critic` and the three `debate-*` rows are agents
(`.claude/agents/*.md`). The other rows are deterministic scripts (`scripts/<name>.mjs`); they have
no judgement of their own and cannot be talked out of a verdict.

## Who does what

- **Orchestrator** (the main session): business questions, the master spec, the test plan,
  decomposition, debugging, release and the lessons. Helpers: Claude Code built-ins
  `general-purpose` and `Explore` for parallel research and drafts. Flow: `dev-pipeline` skill;
  graph per task: `scripts/orchestration-planner.mjs`.
- **backend-agent / frontend-agent**: implement against the approved spec and the real contract.
- **reflexion-critic**: post-implementation review of the diff against the master spec
  (PASS / REVISE / BLOCK, at most 2 rounds).
- **debate-prosecutor / debate-defender / debate-judge**: adversarial verification on critical
  changes and on analytical or decision questions (`scripts/debate-trigger.mjs` decides,
  `scripts/debate-engine.mjs` records).
- **execution-gate**: actually runs the project's tests or command; static checks are not proof.
- **coverage-gate**: coverage ratchet against the stored baseline.
- **dependency-audit**: blocks high and critical dependency vulnerabilities.
- **run-checklist**: pre-flight checklist before a wave is dispatched; can halt.
- **audit-meta-process**: detects recurrence of documented anti-patterns across waves; can halt.

## Cadences of self-maintenance

| Cadence | Mechanism |
|---|---|
| Every commit | `.githooks/pre-commit` gates (scope: staged files) |
| Every wave | `run-state.mjs` journal, `acceptance-verdict.mjs`, `extract-retro-memory.mjs` |
| Daily | `routine-daily.sh` (skills freshness, pending human steps) |
| Weekly | Kaizen run: `kaizen-engine.mjs`, `meta-trend.mjs`, `meta-audit.mjs` |
| On demand | `jidoka.mjs`, `/jidoka-*` commands |
