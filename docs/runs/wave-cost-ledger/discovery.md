# Discovery — wave-cost-ledger

## The incident (job-to-be-done)
A high-volume agentic-dev practitioner triple-spent a real token budget in one run. The cause was not
a single expensive call. It was a batch-retry amplification: a batch of items partially succeeded, the
whole batch was retried, and the items that had already succeeded got re-billed. Existing controls did
not catch it.

## Why existing controls missed it
- `budget-gate` caps spend per wave, but enforces no RUNNING total across a day.
- `compute-cost` computes a cost for a unit of work, but keeps no append-only ledger and no daily limit.
- Neither models the retry-re-bills-success failure mode at all.

So there was a real, named gap: no running daily ledger with a hard limit + alert, and no guard against
batch-retry amplification.

## Decision
Build a small, dependency-free ledger primitive in the engine (`scripts/cost-ledger.mjs`) that:
- keeps an append-only ledger of cost entries,
- totals daily spend in integer cents (no float money — the precision-guard rule),
- assesses ok / warn (≥80%) / block (≥100%) against a daily limit,
- flags a wholesale batch retry that would re-bill already-succeeded items.

Live provider-billing integration is explicitly out of scope (DORMANT): the product wires its real
spend events into this primitive later. This wave is the validation layer, not the billing layer.

## Source
Grounded in the real triple-spend incident from the practitioner call; spec at
`docs/specs/wave-cost-ledger_MASTER_SPEC.md`.
