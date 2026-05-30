# Skill: ElevenLabs-Style Sphere Hero — Asymmetric two-column hero with LiveGradientSphere

> Wave: wave-10 / wave-15  |  Status: active  |  Tags: hero, sphere, layout, animation, brand

---

## When to use

- Building a hero card for a voice/AI feature page inside the dashboard.
- The design calls for a dominant visual element (the sphere) counterbalancing text content.
- The sphere needs to communicate brand identity and stay GPU-composited (no canvas/WebGL).
- Needs reduced-motion compliance.

---

## Implementation guide

### Step 1 — Import LiveGradientSphere

```tsx
import { LiveGradientSphere } from "@/components/site/LiveGradientSphere";
```

The component takes `palette`, `size`, `cycleSeconds`, `ariaLabel`, `className`. `palette` is `[highlight, mid, deep, shadow]` as 4 hex strings.

For decorative use (no screen reader description needed), omit `ariaLabel` — the wrapper becomes `aria-hidden`.

### Step 2 — Define a palette constant outside the component

```tsx
// Keep palette outside JSX — prevents array identity churn on every render
const MY_SPHERE_PALETTE: [string, string, string, string] = [
  "#7C9EFF", // highlight
  "#4F71D8", // mid
  "#2D3F8A", // deep
  "#0D1540", // shadow
];
```

Import brand color primitives from `lib/brand-colors.ts` if the project palette is defined there, rather than hardcoding hex inside the component.

### Step 3 — Two-column asymmetric layout

Left column carries headline, metrics, CTAs. Right column carries the sphere. On mobile the sphere is hidden (`hidden sm:flex`).

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-8 items-center p-6 md:p-8">
  {/* Left: text content */}
  <div className="flex flex-col gap-4">
    {/* headline, metrics chips, CTA pills */}
  </div>

  {/* Right: sphere — hidden on mobile */}
  <div className="shrink-0 hidden sm:flex items-center justify-center" aria-hidden>
    <LiveGradientSphere palette={MY_SPHERE_PALETTE} size={220} cycleSeconds={10} />
  </div>
</div>
```

### Step 4 — Background glow behind the sphere

A blurred div behind the sphere bleeds the sphere color into the card background, creating depth. Use the sphere's mid-tone color with `opacity-20`:

```tsx
<div
  aria-hidden
  className="absolute inset-0 pointer-events-none"
  style={{ background: "radial-gradient(ellipse 60% 60% at 80% 50%, #4F71D840, transparent)" }}
/>
```

### Step 5 — Animate entrance with Framer Motion

Each region gets a `motion.div` with staggered `delay`:

```tsx
// Text block
initial={{ opacity: 0, x: -16 }}
animate={{ opacity: 1, x: 0 }}
transition={{ duration: 0.4, ease: "easeOut" }}

// Sphere
initial={{ opacity: 0, scale: 0.88 }}
animate={{ opacity: 1, scale: 1 }}
transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
```

---

## Example references

| What | File | Lines |
|------|------|-------|
| Full hero implementation | `components/voice/redesign/VoiceHero.tsx` | L1–L230 |
| Sphere import + palette | `components/voice/redesign/VoiceHero.tsx` | L20–L31 |
| Two-column layout | `components/voice/redesign/VoiceHero.tsx` | L57–L190 |
| Sphere right column | `components/voice/redesign/VoiceHero.tsx` | L176–L188 |
| CTA pill buttons | `components/voice/redesign/VoiceHero.tsx` | L143–L172 |
| Sphere component source | `components/site/LiveGradientSphere.tsx` | L1–L50 |

---

## Anti-patterns / gotchas

- **Don't define the palette array inline in JSX.** A new array reference on every render re-triggers the sphere's `useMemo`. Define it as a const at module level.
- **Don't use a sphere size above 380px for in-dashboard cards.** The CSS-based 3D illusion degrades above 400px; use canvas/Three.js for larger decorative spheres.
- **Don't forget `aria-hidden` on the sphere wrapper when used decoratively.** Without it, some screen readers announce the SVG internals.
- **Don't use `overflow-hidden` on the card without a `relative` parent.** The background glow `absolute` div needs a `relative` ancestor or it escapes the card bounds.

---

## Wave reference

First applied: wave-10 (HVAC hero split, HvacHeroSplit.tsx).
Extended: wave-15 (#1 Voice page hero — VoiceHero.tsx, first dashboard use of LiveGradientSphere).
