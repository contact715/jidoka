# Formal Model: AndonHalt (TLA+)

Wave-138 — Formal Model Checking (TLA+)

This directory contains the TLA+ formal specification of the Andon Halt-Resume
state machine used in this project development pipeline.

---

## What this models

The andon halt machine is the emergency stop mechanism for the verification
pipeline. It has one safety-critical invariant: **no active halt clears without
a human action** (either a field-validated Resume or an explicit ForceResume).

This spec formally encodes that invariant as a machine-checkable property and
runs it against all reachable states via TLC.

---

## Files

| File | Purpose |
|---|---|
| `AndonHalt.tla` | TLA+ specification (states, transitions, invariants, liveness) |
| `AndonHalt.cfg` | TLC model-check configuration (constants, invariants, properties) |
| `README.md` | This file — spec-to-code mapping, installation, usage |

---

## Spec-to-code mapping

Every TLA+ transition maps to a specific location in the implementation.

| TLA+ action | Implementation file | Lines | Description |
|---|---|---|---|
| `Halt` | `scripts/andon-halt-helpers.mjs` | 112-170 | `writeHaltState()` — writes sentinel, exits 42, no prior active halt |
| `QueueHalt` | `scripts/andon-halt-helpers.mjs` | 128-133 | Concurrent halt while active exists; appends to `queue[]` |
| `Resume` | `scripts/andon-resume.mjs` | 164-171 | Field-validated resume: `--approver`, `--reason`, `--root-cause` each >= 10 chars |
| `ResumeWithQueue` | `scripts/andon-resume.mjs` | 188-208 | Resume + promote queue[0] to active when queue is non-empty |
| `ForceResume` | `scripts/andon-resume.mjs` | 147-162 | `--force-clear` escape hatch: skips field validation, logs `FORCED_RESUME`, no approver required |
| `ToggleSoftMode` | `scripts/run-verification-pipeline.mjs` | 58-92 | `andonCord.enabled` flag in `.sdd-config.json`; `false` = soft mode (pipeline continues despite halt) |

| TLA+ invariant | Implementation reference | What it checks |
|---|---|---|
| `NoAutoResume` | `andon-resume.mjs` (both paths) | `active` clears only via `Resume` (human-approved) or `ForceResume` (named escape). No silent auto-clear. |
| `ExitBlocksWhenEnabled` | `run-verification-pipeline.mjs:75-81` | When `active!=NULL` and `enabled=TRUE`, pipeline is in blocking state (exit-42). |
| `AlwaysEventuallyResumable` | Both resume paths | A halted machine can always eventually reach RUNNING (liveness, requires fairness on Resume/ForceResume). |

| TLA+ state predicate | Real state | Code condition |
|---|---|---|
| `IsRunning` | RUNNING | `active = null`, no sentinel file |
| `IsHalted` | HALTED | `active != null`, `queue` empty, `andonCord.enabled: true` |
| `IsQueued` | QUEUED | `active != null`, `queue.length > 0`, `andonCord.enabled: true` |
| `IsSoftMode` | SOFTMODE | `active != null`, `andonCord.enabled: false` — pipeline gate does NOT block |

---

## States and transitions diagram

```
          Halt
RUNNING ─────────────────> HALTED
   ^                          |
   |                          | QueueHalt
   | Resume                   v
   | (3 fields >= 10 chars)  QUEUED
   |                          |
   | ForceResume              | Resume / ForceResume
   | (no approver,            | (clears active, promotes queue[0])
   |  FORCED_RESUME logged)   v
   <──────────────────────── HALTED (or RUNNING if queue drained)
         ToggleSoftMode
HALTED <─────────────────> SOFTMODE
  (enabled=TRUE)             (enabled=FALSE — pipeline NOT blocked)
```

---

## The ForceResume escape hatch

`ForceResume` is a **named, auditable transition** — not a hidden bypass.

- CLI flag: `--force-clear` in `scripts/andon-resume.mjs:147-162`
- No approver required (field validation skipped)
- Logs `event: 'FORCED_RESUME'` with `approver: null` to `docs/audits/halt-events.jsonl`
- Deletes the entire `.sdd-halt-state.json` sentinel (active + all queued halts cleared)

**NoAutoResume is honestly scoped:** it prohibits silent auto-clear (no action at
all). It does not prohibit ForceResume, because ForceResume is an explicit,
logged human action. A spec that omitted ForceResume would overstate the safety
guarantee — the real code has this path and must be modeled accurately.

---

## The soft-mode bypass

When `.sdd-config.json` has `andonCord.enabled: false`, the pipeline gate in
`run-verification-pipeline.mjs:83-90` warns but does NOT exit-42. This is the
SOFTMODE state in the spec.

The `ExitBlocksWhenEnabled` invariant is conditional on `enabled=TRUE` for this
reason. A spec that unconditionally asserted "HALTED always blocks" would be
modeling a stricter machine than what the code implements.

---

## Installation and running TLC locally

TLC requires Java and `tla2tools.jar`.

**Step 1 — Install Java:**

```bash
brew install openjdk   # macOS
# or download from https://adoptium.net
```

**Step 2 — Download tla2tools.jar:**

```bash
mkdir -p tools/tla
curl -L -o tools/tla/tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
```

The jar is NOT committed to git (binary artifact policy, ~10 MB).

**Step 3 — Run the model checker:**

```bash
npm run tla:check
# or directly:
node scripts/run-tla.mjs
```

The runner auto-detects whether Java and the jar are present. If either is
absent, it prints `TLC_UNAVAILABLE` and exits 0 — explicitly not a clean pass.

**Override jar path via environment variable:**

```bash
TLA_JAR_PATH=/path/to/tla2tools.jar npm run tla:check
```

---

## CI setup

In a CI pipeline, add a setup step before `npm run tla:check`:

```yaml
- name: Download tla2tools.jar
  run: |
    mkdir -p tools/tla
    curl -L -o tools/tla/tla2tools.jar \
      https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
```

No Java setup is needed if the CI runner already has Java (most do).

---

## Interpreting a counterexample

If TLC finds a counterexample, `run-tla.mjs` exits 1 and prints the trace.

A counterexample means TLC found a sequence of states starting from `Init`
and following valid `Next` transitions that reaches a state where an invariant
or property does not hold. This is a **real safety finding**.

Steps to interpret:

1. Read the TLC trace output above. Each step shows the variable values before
   and after a transition fires.
2. Identify which invariant was violated (`NoAutoResume`, `ExitBlocksWhenEnabled`,
   or `AlwaysEventuallyResumable`).
3. Map the violating transition back to the implementation using the
   spec-to-code table above.
4. Either fix the implementation or, if the invariant was incorrectly stated,
   update the spec with a justification.

A counterexample is a blocker, not a post-MVP item.

---

## Note on the live halt state

`.sdd-halt-state.json` may currently have an active halt (this is normal
during development). `run-tla.mjs` does NOT interact with the live halt state.
It checks the formal model in isolation. There is no interference between the
model checker and the running andon system.

---

## Keeping the spec in sync

If `scripts/andon-halt-helpers.mjs` or `scripts/andon-resume.mjs` change,
the TLA+ spec must be updated to match. The line references in
`AndonHalt.tla` comments are the sync checkpoints. Any PR touching the andon
scripts should also update `AndonHalt.tla` if the state machine changes.
