// wave-134 generated stub — it.todo stubs are NOT coverage. Fill assertions via test-engineer dispatch.
// SOURCE: docs/specs/wave-frontier_MASTER_SPEC.md — ACs with no linked test as of generation time.
// AC-N tags must be added above each it() when a real assertion is written.

import { describe, it } from 'vitest';

describe('wave-frontier — AC coverage stubs', () => {
  // AC-1.1: - AC-1.1 `docs/evals/<agent>/golden-cases.jsonl` seeded for ≥3 key agents (constitutional-reviewer,
  it.todo('AC-1.1: - AC-1.1 `docs/evals/<agent>/golden-cases.jsonl` seeded for ≥3 key agents (constitutional-reviewer,');

  // AC-1.2: - AC-1.2 Deterministic scoring layer: each case carries machine-checkable assertions (regex/
  it.todo('AC-1.2: - AC-1.2 Deterministic scoring layer: each case carries machine-checkable assertions (regex/');

  // AC-1.3: - AC-1.3 Baseline registry `docs/evals/_baseline.json` — per-agent pass-rate; a run compares
  it.todo('AC-1.3: - AC-1.3 Baseline registry `docs/evals/_baseline.json` — per-agent pass-rate; a run compares');

  // AC-1.4: - AC-1.4 LLM-judge layer optional (run-evals already has it) — DORMANT until run with a model. `[...
  it.todo('AC-1.4: - AC-1.4 LLM-judge layer optional (run-evals already has it) — DORMANT until run with a model. `[...');

  // AC-1.5: - AC-1.5 `npm run eval` runs the deterministic suite, exits 1 on regression. Wired into CI. `[FULL]`
  it.todo('AC-1.5: - AC-1.5 `npm run eval` runs the deterministic suite, exits 1 on regression. Wired into CI. `[FULL]`');

  // AC-1.6: - AC-1.6 Fitness hook: eval pass-rate feeds meta-trend as the "are we getting better" metric. `[F...
  it.todo('AC-1.6: - AC-1.6 Fitness hook: eval pass-rate feeds meta-trend as the "are we getting better" metric. `[F...');

  // AC-2.1: - AC-2.1 `scripts/judge-panel.mjs` — runs N judges (default 3) with DISTINCT rubrics (correctness /
  it.todo('AC-2.1: - AC-2.1 `scripts/judge-panel.mjs` — runs N judges (default 3) with DISTINCT rubrics (correctness /');

  // AC-2.2: - AC-2.2 Rubric rotation: rubrics are pulled from a registry so two runs don't use identical framing
  it.todo('AC-2.2: - AC-2.2 Rubric rotation: rubrics are pulled from a registry so two runs don\'t use identical framing');

  // AC-2.3: - AC-2.3 Disagreement surfaced: if judges split, output is `CONTESTED` (escalate to human), not a
  it.todo('AC-2.3: - AC-2.3 Disagreement surfaced: if judges split, output is `CONTESTED` (escalate to human), not a');

  // AC-2.4: - AC-2.4 Deterministic self-test proving majority/contested/consensus logic without LLM. `[FULL]`
  it.todo('AC-2.4: - AC-2.4 Deterministic self-test proving majority/contested/consensus logic without LLM. `[FULL]`');

  // AC-3.1: - AC-3.1 `scripts/budget-gate.mjs` — reads a per-wave budget (tool calls / est. tokens), tracks
  it.todo('AC-3.1: - AC-3.1 `scripts/budget-gate.mjs` — reads a per-wave budget (tool calls / est. tokens), tracks');

  // AC-3.2: - AC-3.2 `docs/quality/budget-policy.json` — declarative limits per tier (trivial/normal/critical...
  it.todo('AC-3.2: - AC-3.2 `docs/quality/budget-policy.json` — declarative limits per tier (trivial/normal/critical...');

  // AC-3.3: - AC-3.3 Runaway guard: a single agent exceeding its solo cap halts before the global cap. `[FULL]`
  it.todo('AC-3.3: - AC-3.3 Runaway guard: a single agent exceeding its solo cap halts before the global cap. `[FULL]`');

  // AC-3.4: - AC-3.4 Deterministic self-test (under / at / over budget). `[FULL]`
  it.todo('AC-3.4: - AC-3.4 Deterministic self-test (under / at / over budget). `[FULL]`');

  // AC-4.1: - AC-4.1 `scripts/policy-sandbox.mjs` — given an agent slug + a changed-file list, verifies every
  it.todo('AC-4.1: - AC-4.1 `scripts/policy-sandbox.mjs` — given an agent slug + a changed-file list, verifies every');

  // AC-4.2: - AC-4.2 Tool-grant check: an agent's declared_tools is the allowlist; using an undeclared tool is
  it.todo('AC-4.2: - AC-4.2 Tool-grant check: an agent\'s declared_tools is the allowlist; using an undeclared tool is');

  // AC-4.3: - AC-4.3 Honest boundary doc: this is POLICY isolation, not OS isolation — names the limitation and
  it.todo('AC-4.3: - AC-4.3 Honest boundary doc: this is POLICY isolation, not OS isolation — names the limitation and');

  // AC-4.4: - AC-4.4 Deterministic self-test (in-scope pass, out-of-scope block). `[FULL]`
  it.todo('AC-4.4: - AC-4.4 Deterministic self-test (in-scope pass, out-of-scope block). `[FULL]`');

  // AC-5.1: - AC-5.1 `scripts/orchestration-planner.mjs` — given a task descriptor (type, risk, surfaces,
  it.todo('AC-5.1: - AC-5.1 `scripts/orchestration-planner.mjs` — given a task descriptor (type, risk, surfaces,');

  // AC-5.2: - AC-5.2 Rules registry `docs/quality/orchestration-rules.json` — declarative: trivial → skip
  it.todo('AC-5.2: - AC-5.2 Rules registry `docs/quality/orchestration-rules.json` — declarative: trivial → skip');

  // AC-5.3: - AC-5.3 dev-pipeline skill references the planner: orchestrator calls it to compose the graph
  it.todo('AC-5.3: - AC-5.3 dev-pipeline skill references the planner: orchestrator calls it to compose the graph');

  // AC-5.4: - AC-5.4 Honest boundary: this composes from a FIXED agent set by rules; it does not yet generate
  it.todo('AC-5.4: - AC-5.4 Honest boundary: this composes from a FIXED agent set by rules; it does not yet generate');

  // AC-5.5: - AC-5.5 Deterministic self-test (trivial task → minimal graph; critical backend → full graph). `...
  it.todo('AC-5.5: - AC-5.5 Deterministic self-test (trivial task → minimal graph; critical backend → full graph). `...');

  // AC-6.1: - AC-6.1 `scripts/memory-consolidate.mjs` — reads the cross-project ledger + retros, clusters by
  it.todo('AC-6.1: - AC-6.1 `scripts/memory-consolidate.mjs` — reads the cross-project ledger + retros, clusters by');

  // AC-6.2: - AC-6.2 Recency+frequency weighting: a lesson seen often and recently ranks above a one-off. `[F...
  it.todo('AC-6.2: - AC-6.2 Recency+frequency weighting: a lesson seen often and recently ranks above a one-off. `[F...');

  // AC-6.3: - AC-6.3 Decay: lessons untouched for a long window are demoted (ties into meta-decay). `[FULL]`
  it.todo('AC-6.3: - AC-6.3 Decay: lessons untouched for a long window are demoted (ties into meta-decay). `[FULL]`');

  // AC-6.4: - AC-6.4 Deterministic self-test on a synthetic ledger. `[FULL]`
  it.todo('AC-6.4: - AC-6.4 Deterministic self-test on a synthetic ledger. `[FULL]`');

});
