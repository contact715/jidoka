# Skill: Marketing Section Decompose — Split >400 LOC section into parts/ subcomponents

> Wave: wave-9, wave-20  |  Status: experimental  |  Tags: decomposition, components, marketing, parts, architecture

---

## When to use

- A marketing section file is approaching or has exceeded 400 LOC.
- A section contains a subcomponent that renders meaningfully on its own AND appears 2+ times, OR has its own internal state.
- A JSX subtree inside the section is nested more than 4 levels deep and is a self-contained visual unit (e.g., a card, a row, a column).
- You are building a new marketing section that you know will have 3+ distinct visual sub-units (e.g., role rows, funnel stage nodes, approval cards).

Do NOT split just to hit a number. A 350 LOC file that is pure composition (mapping a data array to identical cards) does not need splitting. Split when subcomponents have independent state or are reused.

---

## Implementation guide

### Step 1 — Identify the split boundary

Before touching any code, name the subcomponents. Rule: if you cannot name it in one noun phrase ("RoleRow", "FunnelStageNode", "ApprovalCard"), the boundary is not clean yet.

### Step 2 — Create the parts/ directory

```
components/site/<vertical>/sections/parts/
  <SectionName><Subcomponent>.tsx   # e.g. RoleRow.tsx, RoleScope.tsx
  <shared-utils>.ts                 # e.g. funnel-shared.ts — types + constants used by 2+ parts
```

Keep the `parts/` directory co-located with the section file, not in a global `components/ui/` unless the pattern is genuinely reusable across verticals.

### Step 3 — Orchestrator file stays under 200 LOC

The parent section file (e.g., `HvacRoleAssistants.tsx`) should contain only:
- State that spans multiple parts (e.g., `activeId` shared between all rows)
- Keyboard navigation / WAI-ARIA wiring at the container level
- The mapping loop that renders parts
- Import + layout markup

If the orchestrator grows past ~200 LOC, a hook (`hooks/useSectionData.ts`) should absorb data fetching or complex derived state.

### Step 4 — Naming convention

```
<SectionName><SubcomponentRole>.tsx
```

Examples from this repo:
- `RoleRow.tsx` (collapsed + expanded row for HvacRoleAssistants)
- `RoleScope.tsx` (left column inside an expanded row)
- `RoleApprovalExample.tsx` (right column inside an expanded row)
- `FunnelStageNode.tsx` (single node card for HvacFunnelConstructor)
- `funnel-shared.ts` (shared types + color maps for funnel parts)

### Step 5 — Export via named export, not default

```tsx
// parts/RoleRow.tsx
export function RoleRow({ ... }: RoleRowProps) { ... }
```

Import in orchestrator:
```tsx
import { RoleRow } from "./parts/RoleRow";
```

### Decomposition shape

```
components/site/hvac/sections/
  HvacRoleAssistants.tsx        # orchestrator, ~155 LOC
  HvacFunnelConstructor.tsx     # orchestrator, ~397 LOC
  parts/
    RoleRow.tsx
    RoleScope.tsx
    RoleApprovalExample.tsx
    FunnelStageNode.tsx
    funnel-shared.ts
    AutoApprovedStrip.tsx
    ChatMessage.tsx
    OldNewColumn.tsx
```

---

## Example references

| What | File | Lines |
|------|------|-------|
| Orchestrator with cross-part state + keyboard nav | `components/site/hvac/sections/HvacRoleAssistants.tsx` | L1–L155 |
| parts/ directory with 5 subcomponents | `components/site/hvac/sections/parts/RoleRow.tsx` | L1–end |
| Larger orchestrator near 400 LOC limit | `components/site/hvac/sections/HvacFunnelConstructor.tsx` | L1–L397 |
| Shared types/constants for a section's parts | `components/site/hvac/sections/parts/funnel-shared.ts` | L1–end |

---

## Anti-patterns / gotchas

- **Splitting one tiny piece (10–20 LOC) with no internal state**: Adds file overhead with no benefit. Fix: only extract when the subcomponent has its own state OR appears 2+ times in the section.
- **Putting parts/ in a global components/ui/ folder**: Makes the parts appear reusable when they are section-specific, causing confusion. Fix: keep parts/ co-located next to the section file unless genuinely cross-vertical.
- **Orchestrator growing past 200 LOC after splitting**: Usually means state management is still in the orchestrator that belongs in a hook. Fix: extract `hooks/useSectionState.ts`.
- **Using default exports in parts/**: Breaks fast-refresh reliability and makes barrel imports inconsistent. Fix: always named exports in parts/.
- **Naming parts generically** (e.g., `Card.tsx`, `Row.tsx`): Collides with global design system names. Fix: prefix with the section name (`RoleRow.tsx`, `FunnelStageNode.tsx`).

---

## Wave history

First applied in wave-9 (HvacFunnelConstructor).
wave-20 — Applied to HvacRoleAssistants; established parts/ naming convention with section-prefixed subcomponent names.

---

## Variations

<!-- Skill Extractor appends here when a new wave applies this skill with a twist. -->
<!-- Format: wave-NN — [brief description of the variation] -->
