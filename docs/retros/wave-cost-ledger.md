# Wave Retro — wave-cost-ledger

## Wave ID
wave-cost-ledger

## Title
Running token-cost ledger + daily-limit alert + batch-retry amplification guard

## Date
2026-06-02

## Status
Shipped (validation wave)

---

## Goal
Stop a token/cost runaway before it bills real money, and catch the specific batch-retry amplification
that triple-spent a real practitioner's budget. See `docs/runs/wave-cost-ledger/discovery.md`.

---

## What worked
- `scripts/cost-ledger.mjs` shipped with all five acceptance criteria proven by an 11-assertion `--self-test` (record is non-mutating, daily sum per date, ok/warn/block thresholds, integer-cents money, `wouldAmplify` flags wholesale batch retry). Wired into `package.json` (`cost:ledger`), `jidoka.mjs`, and `gate-audit.mjs`.
- Money is integer cents end-to-end, so there is no float rounding error on money. This satisfies the precision-guard discipline by construction.
- The wave ran as a real end-to-end pipeline (commit cadf84f) and the run caught 2 false-positives in the engine's OWN gates.

## What failed
- Two gate false-positives surfaced on the wave's own real code: `precision-guard` flagged a code comment that merely contained money words, and `resource-guard` flagged a local array `.push` as if it were a database write. Both were real defects in the gates, not in the product. Both were fixed AND locked in as named regression cases inside each gate's self-test, so they cannot silently come back.
- The run-state journal was created and then never advanced: it sat at `discovery / pending / events: []` while commit cadf84f landed the finished deliverable ~8 minutes later. The journal lied by omission until this reconciliation.
- Discovery and memory left no artifact at first. The discovery note and this retro close that.

---

## Patterns observed
- A gate is only trustworthy after it has run on real product code. Synthetic self-tests passed while the gates were 95% wrong on real files in an earlier Mosco wave; here, running on real code immediately exposed 2 false-positives. Validate gates against reality, not against their own fixtures.
- Same journaling-lag pattern as wave-gsd-merge: built + proven, journal still `pending`. The fix is the same playbook update — advance the journal in the same session the work lands.

## Playbook update proposed
Every gate change must ship with a regression case derived from a REAL false-positive/false-negative it
got wrong, added to that gate's self-test (as done here for precision-guard and resource-guard). A gate
fix without a locked regression case is not done.

## Stats
- Wave duration: ~1 session (validation wave)
- Agents involved: spec (chief-architect), build (engineering-lead / backend), gate (precision-guard + resource-guard + eval), debug (false-positive fixes), memory (this retro)
- Files added: scripts/cost-ledger.mjs, this retro, discovery note
- Files modified: precision-guard.mjs, resource-guard.mjs (+ regression cases), package.json, jidoka.mjs, gate-audit.mjs, eval baseline 84→85
- LOC delta: ~ +250
