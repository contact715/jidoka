# Rules — Component & File Decomposition

Project-level decomposition limits referenced by `CLAUDE.md` and enforced mechanically
by `npm run check:structural` (baseline-ratchet: the metric may not regress).

## Hard limits

1. **One file = one composable concern.** A page rendering N sections = N files, not one blob.
2. **No JSX component file over ~400 LOC.** Approaching 400 → split.
3. **No single component function over ~80 LOC.** Beyond → extract subcomponents.
4. **No more than ~6 useState/useEffect per component.** Beyond → extract a hook or split.

## Page-level files

`app/.../page.tsx` is assembly only: imports + layout + 1–2 hooks for params. A page over
200 LOC is a smell.

## State location

- Local UI state → `useState` only for that component.
- Cross-component → store (no prop-drilling past 2 levels).
- Server state → fetch hook + cache, never inline `fetch().then()` in component bodies.
- Derived state → `useMemo`/compute inline, never `useState`+`useEffect` mirroring.

## Enforcement

`scripts/check-structural.sh` measures file/function LOC and hook counts against
`scripts/.structural-baseline.json`. New code must stay under the limits; the ratchet
prevents the baseline from drifting upward. This rule file is the human-readable contract;
the script is the mechanism.
