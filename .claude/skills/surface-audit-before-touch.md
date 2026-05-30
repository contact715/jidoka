# Skill: Surface-audit before touch — zoom out before you commit

> Wave: w27.3  |  Status: experimental  |  Tags: [process, polish, ux, anti-tunnel-vision]

---

## When to use

**Always**, before any UI edit that touches a visible surface.

Concrete trigger situations:
- About to modify a single element / row / card inside a larger view.
- About to ship a "small fix" that only touches a few lines.
- Reviewing your own work before commit.
- User has pointed out a layout issue in a screenshot — before fixing the specific item they mentioned, zoom out and check the entire screen for sibling issues.

The trap this prevents: **tunnel-vision editing**. You see the element the user pointed at, you fix that one thing, you commit. You miss that the row above is wasteful, the spacing scale is broken three sections down, or the same anti-pattern repeats in two more places. The user has to file a second, third, fourth bug for the same surface.

---

## Implementation guide

### Step 1 — Take a full screenshot of the surface

Either ask the user for a screenshot of the whole view, or open the route yourself and view it. Do not work from a cropped element snippet alone — the cropped view hides spatial context.

### Step 2 — Count the horizontal bands

Look at the screenshot top-to-bottom. Count every visually distinct row / band / strip. For each one ask:

- What is this band's job?
- How tall is it (in px)?
- Could it be merged with the band above or below?
- Is the information density acceptable for the vertical space it consumes?

If you see ≥ 3 thin bands (< 32 px tall) stacked above the main content, that's almost always a consolidation opportunity. amoCRM, Linear, and Monday all consolidate aggressively — 1 toolbar row is the goal.

### Step 3 — Count distinct interactive sizes

Scan the screenshot for buttons / inputs / pills / dropdowns. Group them by height. If you find more than 2 distinct heights (e.g., one 26 px chip + one 32 px button + one 40 px primary CTA), that's a size-scale violation. Either pick one for each role (primary / secondary / chrome) and unify, or flag for a follow-up wave.

### Step 4 — Count distinct accent colours

Scan for any saturated colour (anything other than `--surface*` and `--text-*` tokens). Each saturated colour = one semantic concept. Two semantic concepts max per surface (primary action + one warning, OR primary + one attention). More than that = traffic-light effect.

### Step 5 — Check for duplicated affordances

Are there two controls that do the same thing? Two CTAs that mean "next action"? Two selectors that change the same model field? The user can usually tell at a glance. If the screenshot has a control and you can't immediately explain to yourself how it differs from a neighbour, **delete one**.

### Step 6 — Decide: fix in this wave OR flag follow-up

- If the issues are small (< 5 min each) and the wave is already touching the file: **fix them now**, mention in commit message.
- If the issues need a separate spec: **list them in the wave's retro** under "Out-of-scope follow-ups". Spawn a follow-up task or call them out to the user explicitly.

Never silently leave a known issue for the user to catch.

---

## Anti-patterns / gotchas

- **Cropped-screenshot tunnel vision**: User shows you a `launch-selected-element` with a 200×100 px snippet. You fix that element. You miss the surrounding 1200×800 layout. **Fix**: ask for the full-view screenshot, or open the route yourself.
- **"It's outside scope"**: Saying "the surrounding issues are pre-existing" doesn't help the user — they see the whole screen, not a diff. **Fix**: at minimum, list pre-existing issues in your reply so the user knows you saw them.
- **One-fix-per-message rhythm**: Treating each user message as a single bug to fix. **Fix**: every UI edit triggers a full-surface audit before commit.
- **Skipping the audit because "it's just a small change"**: The small change is precisely when the audit is cheapest — you already loaded the file context.

---

## Wave history

First applied in wave-27.3 after user feedback ("эта информация располагается в некорректном месте... я не понимаю, как и почему ты этого не видел").
<!-- Process Engineer appends lines here when this skill is re-applied in later waves. -->
