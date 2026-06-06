---
status: Template
version: 1.0.0
level: L3
type: module
owner_role: platform
parents:
  - path: docs/specs/domains/<your-domain>.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: <YYYY-MM-DD>
last_validated_against_parents: <YYYY-MM-DD>
last_updated: <YYYY-MM-DD>
---

# Module — <Module Label>

**Level:** L3 (Module) · **Domain:** [<Domain Label>](../../domains/<your-domain>.md) · **id:** `<module-id>`

## What it is

<One paragraph: what this module does and why it exists.>

## Lives in

- `scripts/<file>.mjs`

## Acceptance criteria

Each AC names the executable check that proves it.

### AC-1 — <observable outcome>

```
node scripts/<file>.mjs --self-test
```

## Linked waves

<wave-NN — what it changed>
