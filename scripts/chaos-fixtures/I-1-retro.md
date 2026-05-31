---
wave: chaos-test
type: retro
status: fixture
---

# Retro — chaos-injection fixture (NOT a real wave)

This file exists only for `chaos-inject.mjs` scenario I-1. It carries the catalog anti-pattern slug
`partial-closure-via-documentation` so that, when copied into `docs/retros/` twice under `__chaos__`
names, `audit-meta-process.mjs` sees the slug in 2+ retros and fires `REGRESSION_DETECTED`.

## What went wrong
The `partial-closure-via-documentation` anti-pattern: a concern was marked addressed by writing a
document instead of building a mechanism. Recorded here to exercise the recurrence defense.
