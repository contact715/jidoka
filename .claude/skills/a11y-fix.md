# Skill: A11y fix — WCAG 2.1 AA violation remediation map

> Wave: wave-102  |  Status: experimental  |  Tags: [accessibility, wcag, axe-core, a11y, quality-gate]

---

## When to use

- a11y-auditor emits BLOCK (any "serious" or "critical" axe violation).
- a11y-auditor emits WARN (any "moderate" violation you want to close preemptively).
- Building a new interactive component — run axe-core before committing.
- Adding an icon-only button, a modal, a form, or a navigation landmark.

---

## Implementation guide

### Step 1 — Read the axe violation report

Each violation includes: rule ID, impact, element selector, and a fix hint URL. Start there.

```
[BLOCK] button-name (serious): icon-only button missing aria-label
  Element: button.icon-close[data-testid="close-modal"]
```

### Step 2 — Map rule ID to fix

| axe Rule ID | Impact | Problem | Fix |
|---|---|---|---|
| `button-name` | serious | Icon-only `<button>` has no text or `aria-label` | Add `aria-label="Close"` (or descriptive label) to the button |
| `color-contrast` | serious | Text color fails WCAG AA contrast ratio (4.5:1 text, 3:1 large) | Switch to a Tailwind token with sufficient contrast — check APCA threshold |
| `label` | critical | `<input>` or `<select>` has no associated `<label>` | Add `<label htmlFor="input-id">Label text</label>` or use `aria-label` |
| `landmark-one-main` | moderate | Page has zero or multiple `<main>` elements | Ensure exactly one `<main>` in the page layout |
| `region` | moderate | Content is not inside a landmark region | Wrap orphaned content in `<main>`, `<nav>`, `<aside>`, or `<section aria-label>` |
| `image-alt` | critical | `<img>` has no `alt` attribute | Add `alt="descriptive text"` or `alt=""` for decorative images |
| `link-name` | serious | `<a>` with no visible text or `aria-label` | Add visible text or `aria-label="destination description"` |
| `heading-order` | moderate | Heading levels skip (e.g. h1 → h3) | Restructure to h1 → h2 → h3 sequential |
| `aria-required-children` | critical | ARIA role requires child roles that are missing | Add correct child elements per ARIA spec |
| `focus-trap` | serious | Modal/dialog does not trap focus | Use Radix UI `Dialog` or add manual focus trap |

### Step 3 — Apply the fix

**button-name example:**
```tsx
// Before — axe: button-name (serious)
<button onClick={onClose}>
  <XIcon className="h-4 w-4" />
</button>

// After — fixed
<button onClick={onClose} aria-label="Close">
  <XIcon className="h-4 w-4" aria-hidden="true" />
</button>
```

**color-contrast example:**
```tsx
// Before — axe: color-contrast (serious) — zinc-400 on white fails 4.5:1
<span className="text-zinc-400">Status inactive</span>

// After — zinc-600 passes AA contrast on white backgrounds
<span className="text-zinc-600">Status inactive</span>
// Check: https://webaim.org/resources/contrastchecker/
```

**label example:**
```tsx
// Before — axe: label (critical)
<input type="text" id="search" placeholder="Search..." />

// After — fixed
<label htmlFor="search" className="sr-only">Search</label>
<input type="text" id="search" placeholder="Search..." />
// sr-only hides visually while remaining accessible
```

### Step 4 — Verify with axe scan

Re-run the a11y-auditor spec or run locally:
```bash
npx playwright test e2e/a11y-audit.spec.ts
```

Confirm the rule no longer appears in the violation list.

---

## Anti-patterns / gotchas

- **`aria-label` on non-interactive elements**: `aria-label` works on buttons, links, inputs, regions. It does NOT help on `<div>` or `<span>` unless they have a role.
- **Hiding the issue with `aria-hidden="true"` on the whole component**: this makes the component invisible to screen readers entirely. Use `aria-hidden` only on decorative elements inside an accessible wrapper.
- **Adding `alt=""` to informational images**: blank `alt` is for decorative images only. Informational images need descriptive alt text.
- **Ignoring color-contrast on placeholder text**: placeholder text contrast is typically lower than body text and often fails AA. Darken the placeholder color or accept the reduced opacity as a known limitation (document it).
- **Not using Radix UI Dialog for modals**: custom modal implementations almost always miss focus trap and aria attributes. Use `@radix-ui/react-dialog` (already installed) instead.

---

## Example references

| What | File | Lines |
|------|------|-------|
| Radix UI Dialog (focus trap, ARIA) | `components/ui/dialog.tsx` | full file |
| Screen-reader utilities (sr-only) | `app/globals.css` or Tailwind `sr-only` class | — |
| A11y agent definition | `.claude/agents/a11y-auditor.md` | full file |
| Web standards reference | `docs/WEB_STANDARDS.md` | — |

---

## Wave history

First applied in wave-102 (quality agency expansion — a11y-auditor gate introduction).
