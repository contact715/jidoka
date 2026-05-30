# Skill: Pill CTA Pattern — rounded-full, font-medium/semibold, sentence-case labels

> Wave: wave-10 / wave-13  |  Status: active  |  Tags: button, cta, pill, typography, design-system

---

## When to use

- Primary or secondary call-to-action buttons in hero sections, feature cards, or section intros.
- Inline action chips (status, mode indicators, floating labels).
- Anywhere the design uses a softly rounded button that does not match the sharp `rounded-card` system (which is for containers).

---

## Implementation guide

### Step 1 — The base pill class set

```tsx
"inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold"
```

For compact chips (status indicators, metric labels):

```tsx
"inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold"
```

### Step 2 — Primary filled variant

Uses a solid background from the brand token or BRAND_COLORS constant. White text. Hover reduces opacity, not the background color:

```tsx
style={{ backgroundColor: BRAND_COLORS.appBlueMid }}
className="... text-white hover:opacity-90 transition-opacity"
```

### Step 3 — Secondary outlined variant

```tsx
"border border-[color:var(--border-default)] text-[color:var(--text-primary)]
 hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface)]/40
 transition-colors"
```

Never use `bg-transparent`. Use `hover:bg-[color:var(--surface)]/40` for a subtle fill that works in both themes.

### Step 4 — Focus ring

All pill buttons must have a visible focus ring for keyboard navigation:

```tsx
"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
```

Or use the `FOCUS_RING` constant from `lib/styles.ts`:

```tsx
import { FOCUS_RING } from "@/lib/styles";
// then spread FOCUS_RING into className
```

### Step 5 — Label conventions

- Sentence case only: "Clone your voice", not "Clone Your Voice" or "CLONE VOICE".
- No trailing punctuation.
- Keep labels under 4 words. If more words are needed, reconsider whether this is a pill CTA or a full button.
- When pairing a pill with an icon, put the icon before the label. Use `w-3.5 h-3.5` for the icon size.

### Step 6 — Floating status pill (read-only)

For non-interactive status chips (e.g., "Live" badge, latency chip):

```tsx
"inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
 bg-[color:var(--surface-tertiary)] border border-[color:var(--border-default)]
 text-[11.5px] font-semibold text-[color:var(--text-secondary)]"
```

Add a `w-1.5 h-1.5 rounded-full` status dot in the appropriate color before the label text.

---

## Example references

| What | File | Lines |
|------|------|-------|
| Primary filled pill CTA | `components/voice/redesign/VoiceHero.tsx` | L150–L158 |
| Secondary outlined pill CTA | `components/voice/redesign/VoiceHero.tsx` | L159–L171 |
| Compact metric/status chip | `components/voice/redesign/VoiceHero.tsx` | L193, L227 |
| Floating Ask this project pill | `components/layout/parts/AskChip.tsx` | L31–L45 |
| HVAC hero pill (large variant) | `components/site/hvac/sections/HvacHeroSplit.tsx` | L150 |

---

## Anti-patterns / gotchas

- **Don't use `rounded-lg` for pill buttons.** `rounded-full` is the pill; `rounded-card` / `rounded-inner` are for containers. Mixing them creates inconsistent visual language.
- **Don't use `font-weight: 400` for pill CTAs.** Use `font-medium` (500) or `font-semibold` (600). Weight 400 makes the pill read as passive label text, not an action.
- **Don't use title-case labels.** "Clone Your Voice" reads as a heading, not a button. Sentence case is the project convention.
- **Don't omit `focus-visible` ring.** Pills are keyboard-focusable; without a visible ring they fail WCAG 2.4.7.
- **Don't use hover:bg on primary filled buttons.** Use `hover:opacity-90` — it works with any background color including brand colors from BRAND_COLORS constants.

---

## Wave reference

First applied: wave-10 (HVAC hero — HvacHeroSplit.tsx).
Extended: wave-13 (CollapsedPill component), wave-15 (VoiceHero CTA pills).
