# Skill: Monday-Style Table — Grouped rows, sticky first column, inline edit, status popovers

> Wave: wave-5+  |  Status: active  |  Tags: table, pipeline, inline-edit, sticky, grouping

---

## When to use

- Building a data table where rows need to be grouped by a categorical field (stage, status, owner).
- The first column (checkbox + name) must stay visible during horizontal scroll.
- Cells need inline editing without leaving the row.
- A status/stage cell should open a popover picker on click.

---

## Implementation guide

### Step 1 — Decompose up-front

The full pattern is already implemented at `components/pipeline/table/`. Never collapse it into one file. Required shape:

```
components/<feature>/table/
  <Feature>Table.tsx          # orchestrator — wires hooks, passes data down
  parts/
    <Feature>TableHeader.tsx  # <thead> with sticky logic + column drag/resize
    <Feature>TableBody.tsx    # iterates grouped stages, renders GroupHeader + DealRow
    GroupHeader.tsx           # collapsible stage-row spanning all columns
    GroupAddRow.tsx           # inline "add item" row at bottom of each group
    DealRow.tsx               # single data row — imports CoreCell / CustomFieldEditCell
    SelectionBar.tsx          # bulk actions bar (appears when rows selected)
    TableFilterBar.tsx        # filter chips above the table
    useTableKeyboard.ts       # arrow-key + Enter navigation hook
    usePipelineTableData.ts   # memoized grouping, filtering, sorting
    usePipelineTableCallbacks.ts  # event handlers extracted from orchestrator
```

### Step 2 — Sticky first column

In `<thead>`, the checkbox `<th>` gets `sticky left-0 z-30`. The name column `<th>` gets `sticky left-10 z-20` plus a box-shadow right border:

```tsx
// PipelineTableHeader.tsx:82
className="sticky left-0 z-30 bg-[color:var(--surface-tertiary)] w-10 border-b border-[color:var(--border-default)]"

// PipelineTableHeader.tsx:163
"sticky left-10 z-20 bg-[color:var(--surface-tertiary)] border-r border-[color:var(--border-default)] shadow-[1px_0_0_0_var(--border-default)]"
```

The `<thead>` row itself also gets `sticky top-0 z-20` so the header freezes on vertical scroll.

### Step 3 — Group rows by stage

The `usePipelineTableData` hook returns `grouped: GroupedStage[]`. Each entry has `{ stage, deals, total }`. `PipelineTableBody` iterates `grouped` and renders `<GroupHeader>` followed by the stage's `<DealRow>` list.

Collapsed stages are tracked in `Set<string>` in the orchestrator:

```tsx
// PipelineTable.tsx:91-95
const toggleGroup = useCallback((stageId: string) => {
  setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(stageId)) next.delete(stageId);
    else next.add(stageId);
    return next;
  });
}, []);
```

### Step 4 — Status cell with popover

Status cells live in `components/pipeline/table/cells/CoreCell.tsx`. The popover pattern uses `usePopoverDismiss.ts` (click-outside / Escape dismiss). Open the popover by setting local `editing: boolean` state on cell click.

---

## Example references

| What | File | Lines |
|------|------|-------|
| Orchestrator wiring | `components/pipeline/table/PipelineTable.tsx` | L30–L60 |
| Stage grouping memo | `components/pipeline/table/PipelineTable.tsx` | L46–L48 |
| Collapse toggle | `components/pipeline/table/PipelineTable.tsx` | L91–L95 |
| Sticky `<thead>` | `components/pipeline/table/parts/PipelineTableHeader.tsx` | L79–L84 |
| Sticky name column | `components/pipeline/table/parts/PipelineTableHeader.tsx` | L163 |
| GroupedStage interface | `components/pipeline/table/parts/PipelineTableBody.tsx` | L12–L16 |
| GroupHeader component | `components/pipeline/table/parts/GroupHeader.tsx` | L16–L50 |

---

## Anti-patterns / gotchas

- **Don't put sticky + `overflow: hidden` on the same element.** Sticky position breaks inside an overflow-hidden ancestor. The table's scroll container must be `overflow-x: auto`, not `hidden`.
- **Don't hardcode background colors on sticky cells.** Use `bg-[color:var(--surface-tertiary)]`. Light/dark switching replaces the CSS variable; a hardcoded `bg-zinc-900` breaks light theme.
- **Don't manage grouping state inside `PipelineTableBody`.** The orchestrator owns `collapsed: Set<string>` and passes `onToggleGroup` down — body is purely presentational.
- **Don't put `useEffect` callbacks inside `PipelineTableBody`.** All side effects live in the orchestrator or extracted hooks.

---

## Wave reference

First applied: wave-5 (#3 pipeline table implementation).
Sticky column logic hardened: wave-5 (#6).
Column drag/resize added: wave-6 (#2).
