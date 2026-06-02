# wave-cost-ledger Master Spec — running token-cost ledger + daily-limit alert

**Status**: Approved (validation wave)
**Chief Architect**: drafted
**Risk**: normal · **Surfaces**: backend (engine)

## Goal
Stop a token/cost runaway before it bills real money. `budget-gate` caps per-wave; `compute-cost`
computes a cost — neither keeps a RUNNING daily ledger with a hard limit + alert, and neither catches
the batch-retry amplification that triple-spent a real practitioner's budget.

## Objectives
- A running ledger of cost entries (date, tokens, cents, op), append-only.
- Daily spend total per date, in INTEGER CENTS (no float money — precision-guard discipline).
- A daily-limit assessment: ok / warn (≥80%) / block (≥100%).
- A batch-retry amplification guard: retrying a whole batch re-bills the items that already succeeded.

## Acceptance Criteria
- AC-1 `record` appends an entry without mutating the input ledger.
- AC-2 `dailySpendCents` sums only the entries for the given date.
- AC-3 `assess` returns level ok <80%, warn 80–99%, block ≥100% of the daily limit.
- AC-4 money is integer cents end-to-end (no float arithmetic on money).
- AC-5 `wouldAmplify` flags a wholesale batch retry that re-bills already-succeeded items.

## Non-goals
- Live provider billing API integration (DORMANT — product wires its real spend events).
- Per-provider rate negotiation.

## TL;DR
- Keeps a daily token-cost ledger and blocks/alerts before you blow a daily $ limit.
- Money is integer cents, so no float rounding error on money (the precision-guard rule).
- Catches the exact trap that triple-spent a real budget: retrying a whole batch re-charges the items
  that already succeeded.
