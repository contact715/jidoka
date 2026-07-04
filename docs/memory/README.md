# docs/memory — reasoning-bank capture

This directory holds the **reasoning bank**: the contrast signal from the adversarial
stack, captured before the engine force-deletes it.

## Why this exists

The engine already pays tokens to generate:

- **losing best-of-N attempts** — `dispatch-parallel-implementations.mjs` removes every
  attempt worktree after the judge picks a winner;
- **REVISE/BLOCK reflexion reviews** — `dequeue-reflexion.mjs` unlinks a reviewed queue item.

Once the worktree or queue file is gone, that trajectory is **unrecoverable**. Part A of the
2026-W27 enrichment recommendation inserts a single persist step just before each deletion,
so the signal is kept instead of dropped into `/dev/null`.

## What is stored

The store (reasoning-bank.jsonl, gitignored) holds one append-only JSON record per
captured artifact:

```json
{ "ts": "…", "source": "best-of-N|reflexion", "kind": "attempt|reviewed|loser|winner",
  "key": "<wave or task class>", "verdict": null, "meta": { … }, "content": "<raw diff/review>" }
```

It is a **runtime stream** (bulky raw diffs, machine-specific), so it is gitignored like
`docs/audits/*.jsonl`. This README is the tracked doc; the raw store is local.

Inspect the local bank:

```
node scripts/reasoning-bank.mjs --list
```

## What comes next (not in this change)

Part B — a `strategy` category in `extract-retro-memory.mjs` — will distill these contrastive
pairs into forward-looking, task-class-keyed strategies ("in class X do Y / avoid Z"). Those
distilled strategies (small, human-readable) will be versioned, unlike this raw capture.
Strategy **injection** is gated behind judge calibration, so contrast is captured freely now
and only distilled-into-guidance once the judges that produced the verdicts are measured.

Helper: `scripts/reasoning-bank.mjs` · Test: `scripts/test-reasoning-bank.mjs`.
