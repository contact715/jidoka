---
status: Template
version: 1.0.0
level: L0
type: template
owner_role: owner
parents: []
children: []
breaking_change_in_v: null
created: 2026-05-25
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# Mission — <YOUR PRODUCT>

> This is a template. Replace the product specifics with your own. Keep the structure — the framework's `constitutional-reviewer` and several agents read the **Mission Compass** at the bottom. (In the framework repo itself this file stays a template; the framework's own L0 is `docs/NORTH_STAR.md`.)

## What this product is

<One paragraph: what the product does, for whom, and the single outcome it optimizes.>

## Core roles

<List the product's operational user roles. The framework uses these to check that work strengthens a real role position, not a side feature.>

---

## Mission Compass

Every spec, before dispatch, must answer **yes** to all five. A violation blocks dispatch at P0.

1. **Role position** — does this strengthen one of the product's core role positions?
2. **Value path** — does the work pass through a real product stage / value path, not a dead end?
3. **Approval seat** — does a human stay in the approval seat for consequential actions?
4. **Role scope** — does it respect role and permission scope (no cross-tenant access, no privilege creep)?
5. **Primary surface** — does it follow the product's primary interaction pattern (for example chat-first, or API-first)?

`constitutional-reviewer` runs these five questions independently and emits PASS or VIOLATION with the question number. Any VIOLATION halts the pipeline.
