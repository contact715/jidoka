# Skill: outcome-driven loop — stop best-effort exits

> Wave: 53  |  Status: experimental  |  Tags: [process, dispatch, gating]

---

## When to use

Whenever a dispatch has a MACHINE-CHECKABLE definition of "done" and the work might require multiple iterations.

Examples where outcomes apply cleanly:
- Sweep waves: "raw_control_heights == 0", "raw_text_px == 0"
- Audit cleanups: "audit-backlog escalated_count === 0"
- Typecheck: "tsc --noEmit exit 0"
- Coverage: "test coverage on changed lines == 100%"
- Drift ratchets: "design-drift-snapshot baseline not exceeded"

Examples where outcomes DON'T apply (skip the loop, single-pass dispatch is right):
- Open-ended design work ("make the page feel premium")
- Spec writing ("propose a master spec")
- Audit-only work ("count drift; report")
- One-shot product features

---

## Why this exists

Without outcome gating, dispatches exit on "best effort". Wave-48 (sweep) is the case study: the sub-agent did 282 replacements then stopped because the residual (h-10..h-14) had no token equivalents. Outcome `raw_control_heights == 0` would have either:
- Forced the agent to propose new tokens (h-form / h-tablerow) and continue, OR
- Escalated to the user with a specific "I cannot proceed because no token exists for 40px" request

Either is better than silent partial completion.

Anthropic's "Outcomes" feature (Code with Claude 2026) ships this as a platform primitive. We approximate with `scripts/outcomes-registry.json` + `scripts/outcome-check.mjs` + this skill.

---

## Implementation guide

### Step 1 — Register the outcome

Add an entry to `scripts/outcomes-registry.json`:

```json
{
  "name": "design-drift-zero-heights",
  "description": "All raw control heights replaced with tokens.",
  "check": "test \"$(jq -r .raw_control_heights scripts/.design-drift-baseline.json)\" -le 0",
  "target": 0,
  "owner_wave": "wave-48"
}
```

The `check` command must exit 0 when met, non-zero otherwise. Stay deterministic — no LLM-in-the-loop checks. The point is a HARD GATE.

### Step 2 — Wrap the dispatch

Orchestrator-side pattern (in the dispatch prompt or skill):

```
1. Run: node scripts/outcome-check.mjs --name=<outcome>
2. If exit 0 → outcome met, skip dispatch
3. If exit 1:
   a. Dispatch sub-agent with sweep task
   b. After sub-agent returns, re-run outcome check
   c. If still unmet AND iteration < budget → goto a
   d. If still unmet AND iteration === budget → escalate to user with concrete blocker
```

The dispatch prompt should explicitly include the outcome:

> "Drive `raw_control_heights` from current baseline to 0. After your sweep, the orchestrator will run `npm run outcome:check -- --name=design-drift-zero-heights` and re-dispatch if not met. You have 3 iterations budget."

### Step 3 — Pick the budget honestly

Budget = max iterations before escalation. Default = 3.

- 1 = single-pass, no loop benefit (just use a regular dispatch)
- 2-3 = reasonable for sweep work; agent learns from first iteration
- 5+ = the outcome is probably mis-specified or the work needs an architectural change, not iteration

If you find yourself wanting budget = 10, the outcome is wrong. Make it smaller and ship sub-outcomes.

---

## Anti-patterns

- **Outcome as soft suggestion** — "try to get drift to 0 but it's ok if you don't". Defeats the point. Either gate or don't.
- **Outcome with non-deterministic check** — LLM judges whether output is "good". Move that to an eval, not an outcome.
- **Outcome on an open-ended task** — "ship a beautiful page". No machine-checkable definition of done. Don't force outcomes here.
- **Outcome that paints the agent into a corner** — sub-agent CAN'T complete it without changing scope (e.g. sweep `h-10` but no `h-form` token exists). Either pre-create the token or scope the outcome around what IS achievable.

---

## Stop criteria

Iteration ends when ANY of:
1. Outcome check exits 0 (target met) → success
2. Budget exhausted (e.g. 3 iterations) → escalate to user with specific blocker
3. Sub-agent returns "I cannot make progress because X" → escalate with the X
4. Same diff for 2 iterations in a row → loop is stuck; escalate

---

## Concrete usage examples

### Sweep continuation (wave-48 redo)

```
budget=3
while ! npm run outcome:check -- --name=design-drift-zero-heights; do
  dispatch "Continue h-token sweep. Current count: $(jq -r .raw_control_heights scripts/.design-drift-baseline.json). Target: 0. Read TODO(design-system) annotations from wave-48 and either propose tokens for h-10/h-14 or migrate to existing scale."
  bash scripts/design-drift-audit.sh   # refresh baseline
  ((iter++)); [ "$iter" -ge "$budget" ] && break
done
```

### Audit-backlog cleanup

```
budget=2
while ! npm run outcome:check -- --name=audit-backlog-clean; do
  dispatch "Action one ESCALATED proposal from audit-backlog. Re-run banner to verify."
  ((iter++)); [ "$iter" -ge "$budget" ] && break
done
```

---

## Pattern observed (skill author's note)

The user-pushback that produced this skill was wave-45b: "0 of 5 SI proposals actioned" — single-pass dispatches don't iterate, so partial completion sits.

Outcomes converts "did you finish?" from a soft self-report into a hard machine check. The orchestrator can't claim done if the check fails. That's the discipline shift.
