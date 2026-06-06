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

# Module — Anti-Pattern Recurrence Detector

**Level:** L3 (Module) · **Domain:** [Quality Gates & Verification](../../domains/quality-gates.md) · **id:** `meta-process-audit`

## What it is

Reads recent retros, blocks new wave dispatch when a documented anti-pattern recurs in 2+ retros (REGRESSION_DETECTED). Emits one word: PASS / REGRESSION_DETECTED / CATALOG_UPDATE_NEEDED.

## Lives in

- `scripts/audit-meta-process.mjs`
- `docs/ANTI_PATTERNS_CATALOG.md`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — No recurrence → prints PASS, exit 0

```
node scripts/audit-meta-process.mjs
```

### AC-2 — A slug recurring in 2 retros → REGRESSION_DETECTED, exit 1

```
fixture: two retros sharing a slug → exit 1
```

### AC-3 — A retro citing a fixed file that no longer exists → REGRESSION_DETECTED

```
fixture: retro cites missing enforcement file → exit 1
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
