# Skill: Font Picker Dev Widget — next/font + CSS variable scope on wrapper div

> Wave: wave-13 / wave-13c  |  Status: active  |  Tags: fonts, dev-tools, css-variables, next-font, debugging

---

## When to use

- You need to compare multiple typefaces on a page during design exploration without committing to one font.
- A feature page uses a non-system font family and you need a dev-only UI to switch between options at runtime.
- The font variable scope must be limited to one section of the page (not global `<html>`).

---

## Implementation guide

### Step 1 — Guard with `process.env.NODE_ENV`

The widget must never ship to production. Wrap the import and render:

```tsx
// In the page/layout that hosts the widget
{process.env.NODE_ENV === "development" && <FontPickerDevWidget />}
```

The widget file itself also checks at the top to make the guard explicit.

### Step 2 — CSS variable scope fix (wave-13c)

The critical pattern: apply the font to `[data-hvac-layout]` wrapper div AND to `document.documentElement` as a fallback. Do NOT scope only to `documentElement` — that breaks component-level overrides.

```ts
// components/site/hvac/widgets/FontPickerDevWidget.tsx:49-59
function applyFont(cssVar: string) {
  const hvacRoot = document.querySelector<HTMLElement>("[data-hvac-layout]");
  const resolved = hvacRoot
    ? getComputedStyle(hvacRoot).getPropertyValue(cssVar).trim()
    : null;
  const value = resolved || `var(${cssVar})`;

  if (hvacRoot) {
    hvacRoot.style.setProperty("--font-hvac-display", value);
  }
  document.documentElement.style.setProperty("--font-hvac-display", value);
}
```

The `getComputedStyle` call is needed because `next/font` injects CSS variables at the wrapper element level, not at `:root`. If you set the CSS variable before the computed value is available, you get `var(--font-picker-xxx)` as a literal string rather than the resolved font-family.

### Step 3 — Wrapper div attribute

The layout that hosts the fonts must have `data-hvac-layout` (or an equivalent data attribute for your feature):

```tsx
// In the HVAC layout wrapper
<div data-hvac-layout className="...">
  {children}
</div>
```

### Step 4 — 2-column layout for font options

```tsx
// Two-column grid: Sans (10) | Serif (10)
<div className="grid grid-cols-2 gap-1">
  {FONT_OPTIONS.filter(f => f.category === "sans").map(renderOption)}
  {FONT_OPTIONS.filter(f => f.category === "serif").map(renderOption)}
</div>
```

The `FONT_OPTIONS` array in `FontPickerDevWidget.tsx` defines `{ id, label, cssVar, category }` per font. The `cssVar` must match the CSS variable name injected by `next/font` in the corresponding `layout.tsx`.

### Step 5 — Persist selection in localStorage

```ts
const STORAGE_KEY = "hvac-dev-font";
// On mount
const saved = localStorage.getItem(STORAGE_KEY);
if (saved) applyFont(saved);
// On selection
localStorage.setItem(STORAGE_KEY, cssVar);
applyFont(cssVar);
```

---

## Example references

| What | File | Lines |
|------|------|-------|
| Full widget implementation | `components/site/hvac/widgets/FontPickerDevWidget.tsx` | L1–L80 |
| `applyFont` CSS var scope fix | `components/site/hvac/widgets/FontPickerDevWidget.tsx` | L49–L59 |
| `FONT_OPTIONS` array | `components/site/hvac/widgets/FontPickerDevWidget.tsx` | L23–L46 |

---

## Anti-patterns / gotchas

- **Don't call `applyFont` before the DOM is ready.** The `data-hvac-layout` element must exist. Call only inside `useEffect` or event handlers.
- **Don't scope only to `documentElement`.** `next/font` variables live on the wrapper element. Without the `getComputedStyle(hvacRoot)` resolution step the variable value is a `var()` literal string, not a font-family name.
- **Don't ship this widget to production.** `process.env.NODE_ENV === 'development'` must gate both the import and the render. If the file is imported unconditionally, Next.js tree-shaking may not eliminate it.
- **Don't set `--font-hvac-display` directly on `<html>`.** The layout override on the wrapper element has higher specificity and will win, causing inconsistency between the widget's selection and what the page actually renders.

---

## Wave reference

First applied: wave-13 (#4 font picker dev widget, 2-column layout).
CSS variable scope bug fixed: wave-13c (the `applyFont` function was rewritten — do not modify without reading the wave-13c commit).
