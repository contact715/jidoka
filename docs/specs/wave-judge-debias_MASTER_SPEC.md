---
status: Draft
version: 1.0.0
level: L3
type: master-spec
wave: wave-judge-debias
owner_role: chief-architect
parents:
  - path: docs/NORTH_STAR.md
    version: 1.0.0
    relationship: governs
  - path: docs/CONSTITUTION.md
    version: 2.0.0
    relationship: constraints
complexity: non-trivial
created: 2026-06-06
last_updated: 2026-06-06
---

# wave-judge-debias — Master Spec

## 1. Goal (business terms)

Every verdict the judge layer emits — in debates and best-of-N comparisons — must be trustworthy
regardless of which candidate was listed first or whether the judge drifted from the spec to general
opinion. Today both failure modes are silent: a position-biased or spec-unanchored verdict looks
valid but reflects ordering luck, not quality.

This wave embeds two mechanical checks from JudgeLM (ICLR 2025) into the existing judge layer:

- **POSITION-DEBIAS**: for any comparison, the judge evaluates twice with the candidate order
  swapped; the two outcomes are merged; a divergence above threshold is flagged
  `position-sensitive` — a signal that the verdict is unreliable and needs human review.
- **SPEC-ANCHOR**: the accepted wave spec (or AC list) is always available to the judge as an
  explicit anchor document; the judge must cite it; without an anchor the judge is warned, not
  blocked.

Framework Compass answers (all five must be "yes" per `docs/NORTH_STAR.md §Framework Compass`):

1. Q1 — raises reliability of the judge layer (quality line strengthened).
2. Q2 — every AC is backed by an inline `--self-test` case.
3. Q3 — `position-sensitive` flag halts auto-merge; human stays in the approval seat.
4. Q4 — extends `debate-engine.mjs` and the two judge agent prompts; no new script unless
   the debias merge logic cannot fit in `judge-panel.mjs`.
5. Q5 — `position-sensitive` events are appended to `docs/audits/meta-mistakes.jsonl` for
   Kaizen retro pickup.

---

## 2. What already exists (cite precisely)

| Artifact | Relevant lines | Role in this wave |
|---|---|---|
| `scripts/debate-engine.mjs` | 19-25 `debatePlan()` | Add position-swap variant of round 3 |
| `scripts/debate-engine.mjs` | 38-41 `finalVerdict()` | Add `positionSensitive` flag to return value |
| `scripts/judge-panel.mjs` | 38-52 `aggregate()` | Extend to accept two vote-arrays (normal + swapped) and emit merged verdict + flag |
| `scripts/judge-panel.mjs` | 59-82 `--self-test` block | Extend with position-debias cases |
| `~/.claude/agents/debate-judge.md` | Lines 29-35 Inputs table | Add `spec-anchor` input row |
| `~/.claude/agents/debate-judge.md` | Lines 78-99 Evaluation rubric | Add spec-anchor citation requirement |
| `~/.claude/agents/best-of-N-judge.md` | Lines 29-36 Inputs table | Add `spec-anchor` input row |
| `~/.claude/agents/best-of-N-judge.md` | Lines 64-113 rubric | Add spec-anchor citation requirement + position-swap note |

`judge-calibration.mjs` — does NOT exist in the repo; skip.
`dispatch-parallel-implementations.mjs` — does NOT exist in the repo; skip.

---

## 3. What we add vs what we change

| Action | Item | Reason |
|---|---|---|
| Modify | `scripts/debate-engine.mjs` | Add `positionSwap(plan)` helper and `debiasedVerdict()` that calls the judge twice, merges, flags |
| Modify | `scripts/judge-panel.mjs` | Extend `aggregate()` signature to accept optional `swappedVotes`; add `positionSensitive` to return; extend `--self-test` |
| Modify | `~/.claude/agents/debate-judge.md` | Add spec-anchor input row + citation requirement in rubric + POSITION-SWAP instruction |
| Modify | `~/.claude/agents/best-of-N-judge.md` | Add spec-anchor input row + citation requirement + position-swap instruction |
| Create | nothing new | all mechanics fit in the files above |

LOC budget: `debate-engine.mjs` stays under 120 LOC total; `judge-panel.mjs` stays under 120 LOC
total. Each added function under 40 LOC. Respect `docs/CODING_STANDARDS.md` 80-LOC/function rule.

---

## 4. Detailed design

### 4.1 POSITION-DEBIAS — `debate-engine.mjs`

Add two exported functions (no imports required — pure logic):

```
positionSwap(plan)
  Input:  debatePlan() array
  Output: copy of the plan with prosecutor/defender swapped in every round
  Zero side-effects. Deterministic.

debiasedVerdict(normalJudgeVerdict, swappedJudgeVerdict, { threshold = 1 } = {})
  Input:  two VERDICT strings (PASS | REVISE | BLOCK | DEADLOCK)
  Output: { verdict, positionSensitive: boolean, run1, run2 }
  Logic:
    - Assign numeric weight: PASS=0, REVISE=1, BLOCK=2, DEADLOCK=3
    - delta = |weight(run1) − weight(run2)|
    - positionSensitive = delta >= threshold  (default threshold = 1)
    - merged verdict = the stricter (higher-weight) of the two
      (conservative: if one run says BLOCK, merged is BLOCK regardless)
    - if positionSensitive: log to docs/audits/meta-mistakes.jsonl
      { ts, wave, class: "position-sensitive", run1, run2 }
```

The orchestrator runs both rounds. The engine assembles the result. It does NOT call the LLM
itself (debate-engine is still a pure orchestration helper, same as today).

`finalVerdict()` (existing) gains an optional `positionSensitive` passthrough so callers can
surface the flag downstream without breaking the existing `unrefutedBlocker` logic.

### 4.2 POSITION-DEBIAS — `judge-panel.mjs`

Extend `aggregate(votes, swappedVotes?)`:
- When `swappedVotes` is absent: behavior identical to today (zero breaking change).
- When present: compute `aggregate(votes)` and `aggregate(swappedVotes)` independently, then
  call `debiasedVerdict(r1.verdict, r2.verdict)` from the updated debate-engine export. Return
  `{ verdict, positionSensitive, run1, run2, counts }`.

This keeps the merge logic in one canonical place.

### 4.3 SPEC-ANCHOR — agent prompts

Both `debate-judge.md` and `best-of-N-judge.md` get the same three changes:

**a. Inputs table** — new row:
```
| Spec anchor (optional) | Path supplied by the orchestrator via --spec-anchor flag or context.
  When present: treat every claim you make about the code as needing a citation
  to this document. State which AC your verdict relates to.
  When absent: emit WARN "no spec anchor — verdict based on rubric only", proceed. |
```

**b. Evaluation rubric** — new final check before emitting verdict:
```
Spec-anchor check: if anchor was supplied, your reasoning paragraph must reference
at least one AC from it by ID (e.g. "AC-3"). If your reasoning cites no AC and an
anchor was present, prepend "[ANCHOR-MISS]" to your verdict line so the orchestrator
can log it.
```

**c. Position-swap note** (debate-judge И best-of-N-judge — РАТИФИЦИРОВАНО 2026-06-06): изначально «debate-judge only»; строитель добавил адаптированную заметку и в best-of-N-judge, reflexion-critic постановил «семантически корректно для любого сравнивающего судьи» (кандидаты тоже сравниваются по порядку), spec-owner ратифицировал расширение вместо отката.
```
Note: the orchestrator may run you twice with prosecutor and defender swapped (POSITION-DEBIAS).
Each run is independent. Do not attempt to reconcile the two runs yourself — the debate-engine
handles merging. Evaluate each run as if it is the only run.
```

### 4.4 Spec anchor — script-level wiring

`debate-engine.mjs` gains an optional `--spec-anchor <path>` CLI flag. When passed, the path is
printed in the round plan output so the orchestrator knows to include the anchor content in each
judge dispatch. The script does NOT read the file itself (zero-dep rule: no fs read in the engine
except for transcript writes that already exist).

---

## 5. Acceptance criteria

| ID | Criterion | Verification method |
|---|---|---|
| AC-1 | `positionSwap(plan)` returns a plan with prosecutor/defender swapped in every round | `--self-test` in debate-engine.mjs |
| AC-2 | Two identical verdicts → `positionSensitive: false`, merged = that verdict | `--self-test` |
| AC-3 | PASS + BLOCK → `positionSensitive: true`, merged = BLOCK | `--self-test` |
| AC-4 | REVISE + REVISE → `positionSensitive: false`, merged = REVISE | `--self-test` |
| AC-5 | PASS + REVISE → `positionSensitive: true` (delta=1 >= threshold=1), merged = REVISE | `--self-test` |
| AC-6 | `aggregate(votes)` with no `swappedVotes` behaves identically to current behavior | existing `--self-test` cases must still pass unchanged |
| AC-7 | `aggregate(votes, swappedVotes)` returns `positionSensitive` field | new `--self-test` case in judge-panel.mjs |
| AC-8 | `debate-engine.mjs --spec-anchor docs/specs/wave-X_MASTER_SPEC.md --plan "..."` prints anchor path in round plan | manual run or `--self-test` |
| AC-9 | When `positionSensitive: true`, an entry is appended to `docs/audits/meta-mistakes.jsonl` | `--self-test` writes to a tmp file and checks |
| AC-10 | Existing callers that pass no `swappedVotes` and no `--spec-anchor` do not change behavior | existing self-tests pass unchanged |

---

## 6. What we are NOT doing

- No LLM calls in scripts. Orchestration and merge are mechanical; the LLM runs via Task as today.
- No new script files. Both changes fit in `debate-engine.mjs` and `judge-panel.mjs`.
- No hard block on missing spec anchor. `WARN` only — anchor is optional with graceful degradation.
- No change to the 4-verdict taxonomy (PASS / REVISE / BLOCK / DEADLOCK).
- No change to `aggregate()` majority rules for the non-position-debias path.
- No `judge-calibration.mjs` — that script does not exist and this wave does not create it.
- No `dispatch-parallel-implementations.mjs` — same.

---

## 7. Backward compatibility

All existing callers (any script that calls `aggregate(votes)` or `finalVerdict(verdict, opts)`)
work without change. Both new parameters (`swappedVotes` and `positionSensitive` passthrough) are
optional with explicit defaults. The `--self-test` flag on both scripts must still exit 0 with the
existing test cases before any new cases are added.

---

## 8. File size targets

| File | Current approx LOC | Target after wave |
|---|---|---|
| `scripts/debate-engine.mjs` | 83 | ≤ 120 |
| `scripts/judge-panel.mjs` | 99 | ≤ 130 |
| `~/.claude/agents/debate-judge.md` | 123 | ≤ 160 |
| `~/.claude/agents/best-of-N-judge.md` | 221 | ≤ 250 |

---

## 9. Open questions (for implementer, not blocking spec)

1. `docs/audits/meta-mistakes.jsonl` write in `--self-test` mode: write to a temp path (e.g.
   `/tmp/meta-mistakes-test.jsonl`) and confirm the entry structure, then delete. Confirm this
   approach is consistent with how other self-tests handle side-effect writes.
2. The `positionSwap` function swaps ALL rounds uniformly. Confirm whether cross-examination (round
   2) needs a different swap logic — or whether a simple prosecutor/defender swap per round is
   sufficient for the debate structure as defined in `debatePlan()`.
