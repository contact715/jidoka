# Wave Metrics

This directory captures per-wave economics for this project development sessions. Data is written automatically by the Metrics Aggregator agent (`.claude/agents/metrics-aggregator.md`) at the end of every wave.

## Files

| File | Purpose |
|---|---|
| `_DASHBOARD.md` | Aggregated table across all waves — one row per wave |
| `_TEMPLATE.md` | Per-wave file template (reference only) |
| `wave-NN.md` | Per-wave detailed metrics (created automatically) |

## Schema columns

| Column | Description |
|---|---|
| Wave | Wave identifier (e.g. `wave-19`) |
| Date | ISO date the wave completed (YYYY-MM-DD) |
| Total tokens | Sum of prompt + completion tokens across all agent calls in the wave |
| Cache hit rate | `cache_read_tokens / total_prompt_tokens` — Anthropic 5-min TTL applies |
| Agent count | Number of agent dispatch calls in the wave |
| Wall-clock | Human-readable duration from wave start to post-wave hook completion |
| Status | `Shipped` / `Reverted` / `Partial` |

## Notes

- Token counts are best-effort: they depend on the Orchestrator logging Anthropic API headers. If headers are unavailable, the field records `n/a`.
- Cache hit rate varies significantly by session gap. Back-to-back calls within 5 minutes benefit from Anthropic prompt caching.
- The dashboard is append-only. Rows are never deleted or backfilled retroactively (waves before wave-19 have no data).
- Per-wave files are the source of truth. The dashboard is a derived summary.
