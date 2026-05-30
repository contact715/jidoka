# Skill: Reduced-Motion Isolation — Freeze animated counters/tickers at initializer, not just useEffect

> Wave: wave-20  |  Status: experimental  |  Tags: animation, reduced-motion, accessibility, useState, counter, ticker

---

## When to use

- Building an animated counter or ticker whose `useState` initial value must be semantically meaningful when motion is disabled (e.g., a revenue-loss counter that should show a "frozen at 60s" value rather than $0.00).
- Any component where the first rendered frame would visually flash an incorrect "start" value before a `useEffect` guard fires and stops the animation.
- Marketing sections with live-updating numbers: loss meters, throughput counters, voice-sphere pulse rates, marquee speed.
- Any `useInterval` / `setInterval` pattern that also needs to respect `prefers-reduced-motion`.

---

## Implementation guide

### Step 1 — Freeze the initial value in the useState initializer

Pass a lazy initializer function so the correct frozen value is computed synchronously on the first render. Without this, the component renders frame 1 with value `0`, then the `useEffect` fires and discovers motion is reduced — but that first frame may already be painted.

```tsx
const [elapsed, setElapsed] = useState<number>(() => {
  if (typeof window === "undefined") return 0; // SSR guard
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? FROZEN_VALUE   // e.g. 60 (seconds), or whatever the "paused" snapshot should be
    : 0;
});
```

### Step 2 — Guard the interval in useEffect

Even with a frozen initial value, always guard the interval itself so it is never started for reduced-motion users. Return early before `setInterval`.

```tsx
useEffect(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const id = setInterval(() => {
    setElapsed((Date.now() - startRef.current!) / 1000);
  }, 250);
  return () => clearInterval(id);
}, []);
```

### Step 3 — SSR safety

`window.matchMedia` throws during server rendering. Guard with `typeof window === "undefined"` in the initializer (Step 1). The `useEffect` body always runs client-side only, so no extra guard needed there.

### Step 4 — CSS animation companion (optional)

For CSS keyframe animations on the same component, add a `@media (prefers-reduced-motion: reduce)` block that sets `animation: none` so the CSS and JS states stay in sync.

```css
@media (prefers-reduced-motion: reduce) {
  .my-pulse-ring { animation: none !important; opacity: 0.3; }
}
```

---

## Example references

| What | File | Lines |
|------|------|-------|
| Full useLiveLoss hook with initializer + interval guard | `components/site/hvac/sections/HvacLossMeter.tsx` | L45–L67 |
| SSR guard in useState initializer | `components/site/hvac/sections/HvacLossMeter.tsx` | L48–L51 |
| useEffect early-return guard | `components/site/hvac/sections/HvacLossMeter.tsx` | L53–L55 |

---

## Anti-patterns / gotchas

- **Guard only in useEffect, not the initializer**: The component renders frame 1 with value `0`. For a dollar counter starting at $0 this flashes visibly before the guard fires. Fix: always set the frozen value in the `useState(() => ...)` initializer.
- **Omitting the SSR guard in the initializer**: `window.matchMedia` throws during Next.js server rendering. Fix: check `typeof window === "undefined"` first and return the neutral default (`0`).
- **Using `Date.now()` directly in the render body**: Violates pure-rendering rules and causes hydration mismatches. Fix: store the start time in a `useRef`, update derived state only inside the interval callback.
- **Querying `matchMedia` on every tick**: Wasteful and can cause jank. Fix: check once in the initializer and once in `useEffect` setup — not inside the interval callback.

---

## Wave history

First applied in wave-20 (HvacLossMeter revenue-loss ticker).

---

## Variations

<!-- Skill Extractor appends here when a new wave applies this skill with a twist. -->
<!-- Format: wave-NN — [brief description of the variation] -->
