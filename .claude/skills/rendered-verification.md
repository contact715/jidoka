# Skill: Rendered verification — see the pixel before saying "done"

> Wave: w33  |  Status: experimental  |  Tags: [process, qa, visual, anti-tunnel-vision]

---

## When to use

Before declaring done on **any** UI-touching change. Specifically:

- After modifying a `.tsx` file in `components/` or `app/(dashboard)/`
- After changing `globals.css` / `tailwind.config.ts` / any design-token file
- After replying "fixed" to a user-reported visual issue
- When the user sends a screenshot of a problem — verify your fix on a screenshot, not just on the diff

The trap this prevents: TypeScript compiles, ESLint passes, lint-staged is happy, and the rendered page is still broken (layout shift, missing element, wrong color in the actual paint, prop name typo'd as string literal that compiled fine).

Wave-28 audit captured this as gap #10: "I rarely (almost never) actually open the browser to see what shipped. I rely on TS clean + ESLint clean + grep ACs. None of those catch 'the spacing looks wrong' or 'the color is too saturated'."

---

## Implementation guide

### Step 1 — Decide which surface(s) you touched

For each modified file, identify which route(s) render it:

```
components/conversations/lead-details/parts/UnifiedNextAction.tsx
  → /clients?view=inbox  (rail, when a deal is selected)
components/pipeline/table/parts/GroupHeader.tsx
  → /clients?view=list
components/pipeline/KanbanBoard.tsx
  → /clients?view=board
```

If you can't name the route(s), stop. The change isn't traceable to a visible surface — fix that first (likely a util / hook, which doesn't need this skill).

### Step 2 — Run the visual regression spec

```bash
npm run e2e:visual
```

Three scenarios:

- **All pass** → ✅ no regressions; if your change was supposed to be visible, the spec didn't catch it (consider adding a new visual spec for the surface)
- **Failure on UNRELATED route** → ⚠️ your change had collateral damage (e.g. a shared component); investigate before commit
- **Failure on EXPECTED route** → ✅ your change rendered as intended; run `npm run e2e:visual:update` to accept new baseline + commit it with the design change

### Step 3 — Screenshot inspection (if mid-session)

If the visual spec fails or you want to see the result without running Playwright:

```bash
# Open the route in browser (dev server must be running on :3000)
open "http://localhost:3000/clients?view=inbox&leadId=901"
```

When the user is in-session, they can verify visually faster than you can spin up Playwright. **It's fair to ask: "Open this URL and confirm the change looks right."** Better than silently shipping wrong.

### Step 4 — Capture the verification in the commit message

Don't just say "TS clean, ESLint clean." Say one of:

```
Verification:
- Visual regression passes (e2e:visual)
- Baseline updated: e2e/clients-visual.spec.ts-snapshots/inbox-lisa-rail.png
```

OR:

```
Verification:
- TS+lint clean. Visual not run — change is non-visible (store action only).
```

The audit trail lets future-you (or another agent) trust what was checked.

---

## Anti-patterns / gotchas

- **"Visual check skipped because the diff looks small"**: small diffs CAUSE the worst regressions — a one-token color swap that compiles fine but kills contrast. Run the spec.
- **"It worked on my machine"**: visual specs run in deterministic Playwright Chromium; user might see something else. If they say "it's broken", trust them + reproduce.
- **Updating baseline without thinking**: `e2e:visual:update` is a load-bearing button. Each baseline commit should be intentional. If you find yourself running it routinely to "make the build pass", you're hiding regressions.
- **Skipping because "the change is too small to be visible"**: type that up. Then run the visual spec to confirm. Often it's not too small.

---

## When the framework can't help (yet)

- Mobile breakpoints — visual specs currently target only Desktop Chrome (1440×900). Mobile-safari project exists in `playwright.config.ts` but no visual spec uses it. wave-31c follow-up.
- Animation states — visual specs use `reducedMotion: 'reduce'`. If your change is to a non-reduced animation, the spec won't catch it.
- Dark mode — only light mode covered. wave-31d follow-up.

In those cases, fall back to step 3 (manual screenshot) + ASK the user to verify.

---

## Wave history

First applied in wave-33 after wave-28 self-audit identified "I rely on TS+lint instead of actual rendering" as gap #10. Codified once wave-31 + wave-31b made the framework available (visual specs + CI).
