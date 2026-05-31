---
status: Active
level: L1
type: contract
owner_role: data-analyst
created: 2026-05-31
---

# Runtime Feedback Contract — how a product feeds reality back into Kaizen

`scripts/runtime-feedback.mjs` is FULL as a mechanism (proven E2E) but DORMANT on data until a
product emits events. This contract is what a product implements to make the loop live. No synthetic
data is ever committed as if it were real — the product supplies the numbers.

## The event stream: `<product>/docs/runtime-events.jsonl`
Append-only JSONL. Two event types:

### `metric` — a real measurement of a North Star / kaizen-targets metric
```
{"type":"metric","metric":"missed_leads_pct","value":14,"ts":"2026-05-31"}
```
- `metric` MUST match a metric in the product's `kaizen-targets.json`.
- `value` is the real reading from analytics.
- runtime-feedback appends it to that metric's series → kaizen-loop then assesses trend-vs-North-Star.

### `incident` — a production failure worth a lesson
```
{"type":"incident","class":"payment-fail","summary":"checkout 500ed for 12m, ~30 carts lost"}
```
- runtime-feedback turns it into a meta-log lesson candidate (production incident → the meta-engine).

## Sources (where the product gets the data)
- **metrics**: the product's analytics tables (the same ones data-analyst already queries) using the
  metric definitions data-lead agreed.
- **incidents**: the product's error tracker / on-call / postmortems.

## Cadence
- metrics: per Kaizen review (e.g. weekly) — one reading per metric per period builds the series.
- incidents: as they happen (or batched per review).

## Who owns it
The product's **data-analyst** emits the event stream (it already reads the real metrics). The
framework's `runtime-feedback` consumes it; `kaizen-loop` assesses; `kaizen-officer` folds the result
into the next wave.

## Wire it up (3 steps)
1. data-analyst appends real readings / incidents to `<product>/docs/runtime-events.jsonl`.
2. `node .jidoka/scripts/runtime-feedback.mjs --events docs/runtime-events.jsonl --targets docs/kaizen-targets.json`
3. `node .jidoka/scripts/kaizen-loop.mjs --targets docs/kaizen-targets.json` — now assessing on real data.

## Honest status
DORMANT until step 1 runs with real numbers. The mechanism + contract are ready; the product
supplies the stream. The full loop was proven E2E on a worked example (a metric series filling and
kaizen-loop going from "no-data" to "on-track") — what's missing is only the real feed.
