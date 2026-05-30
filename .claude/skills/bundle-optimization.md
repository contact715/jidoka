# Skill: Bundle optimization — code-splitting patterns for Next.js App Router

> Wave: wave-102  |  Status: experimental  |  Tags: [performance, bundle-size, dynamic-import, next-dynamic, tree-shaking, quality-gate]

---

## When to use

- perf-profiler emits BLOCK (any route grew > 50 KB or > 25% vs baseline).
- perf-profiler emits WARN (any route grew > 10% vs baseline).
- Importing a component or library that exceeds ~10 KB in raw size.
- A client-only component (uses `useEffect`, `useState`, or browser APIs) is blocking SSR unnecessarily.
- `npm run build` output shows a route's first-load JS growing beyond the expected range.

---

## Implementation guide

### Step 1 — Identify the offending import

Read the perf-profiler output table. Identify the route with the BLOCK or WARN condition.

Then find the heavy import that grew that route. Run a build-trace:
```bash
ANALYZE=true npm run build
```
(Requires `@next/bundle-analyzer` — if not installed, use `next build --no-lint --debug` and check `.next/build-manifest.json`.)

Or use the quick grep approach to find large imports added in the wave:
```bash
git diff HEAD~1 HEAD -- 'app/' 'components/' | grep '^+import' | grep -v test
```

### Step 2 — Apply dynamic() import for client-only components

The standard pattern for any component > 10 KB that is not needed on first paint:

```tsx
import dynamic from 'next/dynamic';

// Default export — simplest case
const HeavyChart = dynamic(() => import('./HeavyChart'), { ssr: false });

// Named export — requires .then() wrapper
const HeavyModal = dynamic(
  () => import('./HeavyModal').then((m) => ({ default: m.HeavyModal })),
  { ssr: false }
);

// With loading skeleton
const HeavyPanel = dynamic(() => import('./HeavyPanel'), {
  ssr: false,
  loading: () => <div className="animate-pulse h-40 bg-zinc-100 rounded-card" />,
});
```

`ssr: false` is required for components that use `window`, `document`, or browser-only APIs. Omit it if the component can render on the server (but the split is still worthwhile for performance).

### Step 3 — Tree-shaking: prefer named imports

When importing from a large library, always import only what you need:

```tsx
// BAD — imports the entire lodash bundle
import _ from 'lodash';
const sorted = _.sortBy(items, 'name');

// GOOD — imports only sortBy (tree-shakable)
import { sortBy } from 'lodash-es';
const sorted = sortBy(items, 'name');

// GOOD for date-fns, framer-motion, recharts, etc.
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { LineChart, XAxis } from 'recharts';
```

### Step 4 — Lazy-load below-the-fold sections

Marketing page sections, dashboard widgets below the fold, and settings panels that are not on the initial viewport should all use dynamic():

```tsx
// app/page.tsx
import dynamic from 'next/dynamic';

const PricingSection = dynamic(() => import('./parts/PricingSection'));
const FooterSection = dynamic(() => import('./parts/FooterSection'));
```

Server components do not need dynamic() for code-splitting — Next.js splits them automatically. This pattern is primarily for client components (`'use client'`).

### Step 5 — Verify the reduction

After applying dynamic():
```bash
npm run build
node scripts/bundle-delta.mjs
```

Confirm the route moved from BLOCK/WARN to OK in the delta output.

---

## Anti-patterns / gotchas

- **dynamic() on server components**: unnecessary and can cause hydration issues. Server components are already split by Next.js.
- **Named export without .then() wrapper**: `dynamic(() => import('./Foo'))` only works for default exports. Named exports need `.then(m => ({ default: m.FooComponent }))`.
- **ssr: false on a component that needs server data**: components that accept server-fetched props should not use `ssr: false` — they will not render without hydration.
- **dynamic() inside a render function**: calling `dynamic()` inside a component body creates a new dynamic import on every render. Define it at module scope.
- **Ignoring the baseline after intentional growth**: if a new feature legitimately grows the bundle, update the baseline: `node scripts/bundle-delta.mjs --update`. Do not leave a permanent WARN.

---

## Example references

| What | File | Lines |
|------|------|-------|
| Bundle size baseline | `scripts/.bundle-baseline.json` | full file |
| Bundle check script | `scripts/bundle-size-check.mjs` | L1-L161 |
| Bundle delta wrapper | `scripts/bundle-delta.mjs` | full file |
| Perf profiler agent | `.claude/agents/perf-profiler.md` | full file |

---

## Wave history

First applied in wave-102 (quality agency expansion — perf-profiler gate introduction).
