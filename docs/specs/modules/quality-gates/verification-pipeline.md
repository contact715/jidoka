---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/quality-gates.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Four-Tier Verification Pipeline

**Level:** L3 (Module) · **Domain:** [Quality Gates & Verification](../../domains/quality-gates.md) · **id:** `verification-pipeline`

## What it is

Main verification entry point. Checks andon halt first, then Tier1 (parallel) → Tier2 (specialists) → Tier3 (debate, conditional) → Tier4 (escalation). Writes docs/metrics/verification-pipeline-<wave>.json.

## Lives in

- `scripts/run-verification-pipeline.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — A dry run at low effort skips Tier 3 and exits 0

```
node scripts/run-verification-pipeline.mjs --wave selftest --effort S --dry-run
```

### AC-2 — An active andon halt with andonCord.enabled blocks before any tier (exit 42)

```
manual: set .sdd-halt-state.json active → run-verification-pipeline exits 42
```

### AC-3 — A constitutional VIOLATION in Tier 2 appends to docs/audits/cross-line-verdicts.jsonl

```
audit: docs/audits/cross-line-verdicts.jsonl grows on violation
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
