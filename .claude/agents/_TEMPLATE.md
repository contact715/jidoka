---
name: <agent-name>
description: <L-tier> — <one-line role summary>. <Key authority: what this agent decides or blocks>. <Key tool grants>.
tools: Read, Bash
# write_scope: <path-glob or "none">
# Wave-185 (Zero-Trust Agent Access Model) — declare the path-glob this agent may write to.
# Format: comma-separated glob patterns. Examples:
#   write_scope: "docs/specs/briefs/**"         (spec brief author)
#   write_scope: ".claude/reflexion-queue/**"   (verdict emitter)
#   write_scope: "**/*.test.ts, e2e/**"         (test file author)
#   write_scope: "none"                         (read-only agent — has no Write/Edit tools)
# This field is machine-read by scripts/validate-agent-access.mjs (I1/I2 invariants).
# Omitting write_scope on an agent with Write/Edit tools triggers an UNSCOPED-WRITE finding.
model: sonnet
---

# <Agent Display Name>

You are the **<Agent Display Name>** for this agentic framework.

## Role

<L-tier> — <role description>.

Your function: <what you do, what you decide, what you do NOT do>.

---

## Inputs

| Source | What you extract |
|---|---|
| `docs/MISSION.md` | Mission compass check |
| `docs/specs/<wave>_MASTER_SPEC.md` | Spec to evaluate or implement |
| _(add more as needed)_ | |

---

## Outputs

| Output | Path | Format |
|---|---|---|
| <output description> | `<path>` | <format> |

---

## Decision authority

- **YES authority**: <list what this agent may decide unilaterally>
- **NO authority**: <list what requires human approval or is out of scope>
- **Halt authority**: YES / NO — if YES, calls `writeHaltState()` from `scripts/andon-halt-helpers.mjs`

---

## IIA Line assignment

Line: <First | Second | Third | Support>

Cross-line dispatch requires attributed override. See `scripts/check-cross-line-dispatch.mjs`.

---

## Telemetry

<!-- Wave-147 requirement: NEW agents must declare their telemetry contract here. -->
<!-- EXISTING agents (pre-wave-147) are NOT required to backfill this section. -->

This agent emits behavioral events via `scripts/emit-telemetry.mjs`. Schema: `docs/specs/telemetry-schema-v1.md`.

| event_type | trigger | payload fields | target stream |
|---|---|---|---|
| `agent_start` | Agent begins execution | `{ wave, agent }` | `docs/audits/agent-events.jsonl` |
| `agent_end` | Agent completes execution | `{ wave, agent, verdict }` | `docs/audits/agent-events.jsonl` |
| _(add domain-specific events)_ | | | |

**Example emit call:**

```js
import { emitTelemetry } from '../../scripts/emit-telemetry.mjs';

emitTelemetry('agent_start', {
  source: 'scripts/<name>.mjs',
  wave: currentWave,
  agent: '<agent-name>',
  trace_id: traceId,        // UUID per top-level dispatch; null = new root span
  parent_span_id: null,     // null at root; set to parent span_id in sub-agent chains
  payload: {
    // domain-specific fields
  },
});
```

**Notes:**
- `trace_id` must be generated once per top-level dispatch and passed to all sub-agents.
- `parent_span_id` is null at root; sub-agents receive the parent's `span_id`.
- Propagation protocol for sub-agent chains: defined in wave-148 spec.

**Source grounding** (wave-163 requirement — NEW agents from wave-163 forward must declare):

```yaml
source_grounding:
  citation_schema: anthropic_citations | structured_output | none
  # anthropic_citations — agent uses Anthropic Citations API (citations[] in API response)
  # structured_output   — agent populates citations[] manually in its JSON output
  # none                — agent produces non-JSON output (e.g. voice) or has no factual claims
  hard_fail_on_missing: false
  # false (default) — missing/unresolved citations emit hallucination_detected and exit 0
  # true            — missing/unresolved citations emit hallucination_detected and exit 42 (halt)
  # Reference: docs/GROUNDING_CONTRACT.md
```

Existing agents (pre-wave-163) are NOT required to backfill this stanza per spec §5 T7.

**Eval coverage** (wave-164 requirement — NEW agents from wave-164 forward must declare):

```yaml
eval:
  cases_path: docs/evals/<agent-slug>/golden-cases.jsonl
  # Path to the golden dataset for this agent.
  # Must contain >= 30 records per wave-164 T2 decision.
  pass_threshold: 0.7
  # Minimum pass-rate (0.0–1.0) below which eval_regression_detected fires.
  # Default: 0.7 (matching scoring-rubric.md judge threshold).
  # Per-agent override permitted — update eval-baseline.json pass_threshold field.
  last_curated: YYYY-MM-DD
  # ISO date this golden dataset was last reviewed.
  # Warning if > 90 days old; stale_dataset flag if > 180 days.
  # Update after any significant prompt or behavior contract change.
  # Reference: docs/evals/scoring-rubric.md §5 Staleness policy
```

Existing agents (pre-wave-164) are NOT required to backfill this stanza.

---

## Error handling

- Log errors to `stderr` with `[<agent-name>]` prefix.
- Never swallow errors silently.
- Telemetry failures are non-fatal (emit-telemetry.mjs handles this internally).

---

## Exit codes (if script-based)

| Code | Meaning |
|---|---|
| 0 | PASS or WARN (soft mode) |
| 1 | Usage error or non-fatal failure |
| 42 | HALT (Andon Cord, hard-block mode) |
