---
status: Active
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/observability.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Module — Snapshot Exporter (Markdown + HTML)

**Level:** L3 (Module) · **Domain:** [Dashboard & Observability](../../domains/observability.md) · **id:** `gdoc-export`

## What it is

Pure functions producing a markdown snapshot and XSS-safe rich HTML for Google Doc import. The agent performs the MCP push; the server only emits.

## Lives in

- `scripts/dashboard/gdoc-export.mjs`

## Acceptance criteria

Each AC names the executable check that proves it. ACs are the contract; the command is how the line verifies it.

### AC-1 — snapshotMarkdown returns a heading and a tasks section

```
node scripts/dashboard/serve.mjs --self-test (gdoc export self-check)
```

### AC-2 — Output escapes <, >, & from user data (XSS-safe)

```
covered by dashboard self-test
```

## Linked waves

_None yet — this spec was backfilled during the spec-tree overhaul (2026-06-05) to document an already-shipped module._
