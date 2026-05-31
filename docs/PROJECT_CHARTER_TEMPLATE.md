---
status: Template
level: L0
type: integrity-charter
owner_role: project-steward
created: 2026-05-31
---

# Integrity Charter — <PRODUCT NAME>

> The trunk of the project tree. Grown from `docs/NORTH_STAR.md` (the root). The project-steward
> owns this file and defends it. Any incoming change is checked against it; a contradiction opens
> the Defense Process (reject / adapt / evolve-philosophy), never a silent edit. Keep it tight —
> the invariants that, if broken, break the project. Replace every `<...>`; delete this block.

## 1. Roots (from the North Star)
<The North Star principles this project is built on. Link docs/NORTH_STAR.md. 2-4 lines. e.g.
"agents do the work, humans make the calls" / "closed system, per-agent sandbox".>

## 2. Trunk — invariants (what follows from the roots and must hold)
<The non-negotiables. Break one and the project is no longer itself. Each checkable. e.g.
- Architecture model: agent-based, human-in-approval (Approve/Reject/Edit on every action).
- Tech stack: <the chosen stack>; not swapped without the Defense Process.
- Hierarchy: <how the system is layered>.
- Security model: <e.g. per-agent least privilege, data isolation>.>

## 3. Protected zones (no change without the Defense Process)
<Files/decisions that cannot change silently. e.g. the agent model, the data model, auth, the core
stack choice, the funnel engine. Touching these REQUIRES a defense investigation.>

## 4. Derivation (how branches grow from the trunk)
<How features/specs are expected to descend from the invariants, so a contradiction is detectable.
e.g. "every funnel stage maps to an agent with an approval point" / "every feature ladders to a
North Star goal". This is what makes 'this change contradicts the tree' a checkable statement.>

## 5. Defense Process (reference)
Incoming change → classify helps / neutral / conflicts.
- helps / neutral → approve (route to the project's agents).
- conflicts → defense investigation: **Intent** (real goal) → **Breach** (which invariant, how bad)
  → **Resolution**: REJECT (protect) | ADAPT (reach the intent without breaching) | EVOLVE (change
  the North Star on purpose, logged, re-derive downward). Never silent. Human decides EVOLVE/REJECT.
