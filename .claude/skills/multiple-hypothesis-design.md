# Skill: Multiple-hypothesis design — sketch three, pick one with reasoning

> Wave: w28  |  Status: experimental  |  Tags: [design, decision-making]

---

## When to use

Before locking in any UX or architectural decision that has more than one reasonable answer. Trigger questions:

- "Should this be a modal or a slide-over or inline?"
- "Should this state live in Zustand or local React state?"
- "Should we extend the existing component or build a new one?"
- "Should the API return a list or paginate?"

If you find yourself typing the first answer that came to mind, stop. This skill triggers.

---

## Implementation guide

### Step 1 — Generate three approaches, not one

The minimum is THREE. Two-option comparison is biased — you'll pick the one that sounds better, which often means the one you described better. Three forces you to think structurally.

Format:

```
Option A — [name, ≤ 5 words]
  Mechanism: [1-2 sentences]
  Pro: [main benefit]
  Con: [main cost]
  Effort: S / M / L

Option B — ...
Option C — ...
```

Each option must be a real, implementable choice. "Do nothing" is sometimes a valid Option C — it forces you to articulate why the cost of action exceeds the cost of inaction.

### Step 2 — Score against criteria

Pick 2-3 criteria that matter for THIS decision:

- Time-to-ship
- Maintenance cost
- User-facing complexity
- Reversibility
- Performance
- Accessibility

Score each option (1-5 or H/M/L). The scoring isn't science — it's a forcing function to make trade-offs explicit.

### Step 3 — Pick with one-paragraph reasoning

Bad: *"Going with Option A."*

Good: *"Going with Option B. A is faster to ship but locks us into the modal pattern; we're trying to move AWAY from modals (per wave-25 retro). C would be ideal in 6 months but assumes a backend endpoint that doesn't exist. B compromises on speed for IA fit."*

The reasoning is the deliverable. The choice itself is the cheap part.

### Step 4 — Present to user as menu, not as decision

When the user is in the loop (most cases), present all three options with the trade-off matrix. Make YOUR recommendation explicit but let them override. This is the AskUserQuestion + multi-option pattern — much higher quality than asking the user a yes/no.

### Step 5 — Record the rejected options

In the commit message, retro, or spec, briefly note the rejected options. Future-you (or another agent) will encounter the same fork and benefit from knowing why this path was picked over the others.

---

## Anti-patterns / gotchas

- **Straw-man options**: presenting Option A as the obvious winner against two deliberately weak alternatives. Self-deception masquerading as analysis. Make sure each option is the best version of itself before scoring.
- **Analysis paralysis**: spending an hour generating 8 options when 3 was enough. The skill is "three then decide", not "all possible options".
- **Pretty matrix, no decision**: writing the comparison and then asking "which do you prefer?" without recommending. You're being paid to think; recommend, then let the user override.
- **Picking based on what's familiar**: noting the criteria honestly but still picking Option A because it's what you've done before. Confront this — comfort isn't a criterion.

---

## When NOT to use this skill

When there is only one defensible answer. Some decisions don't have alternatives worth sketching — `useState` vs `useReducer` for 1 boolean, for example. Use judgement; don't perform the ceremony for its own sake.

---

## Wave history

First applied in wave-28 — self-audit found single-approach default in waves 25 (inline form vs slide-over not weighed) and 26 (split-view vs drawer vs takeover surfaced only after user input).
