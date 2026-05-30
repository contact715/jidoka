# Skill: Dual Chat Disambiguation — AskAssistant (agent) vs MessageComposer (customer channel)

> Wave: wave-6  |  Status: active  |  Tags: chat, inbox, layout, ux, z-index, disambiguation

---

## When to use

- A page or drawer shows two chat inputs simultaneously: one for sending messages to a customer and one for querying this project AI agent.
- The two inputs need to be visually distinct so operators don't accidentally send agent queries to a customer channel.
- One input must be always accessible without scrolling (pinned), the other may be toggled.

---

## Implementation guide

### Step 1 — Understand the two roles

| Surface | Component | Role | Destination |
|---------|-----------|------|-------------|
| Bottom-pinned composer | `MessageComposer` | Reply to customer | SMS / WhatsApp / Yelp / etc. |
| Floating chip / drawer | `AskChip` + `DashboardCabinetChrome` | Query this project AI | Internal AI — never sent to customer |

The `MessageComposer` is inside the conversation view. The `AskAssistant` chip is a global fixed-position element in `DashboardCabinetChrome` (layout-level, not page-level).

### Step 2 — Z-index layering

```
--z-combo: 55   ← AskChip + CabinetChrome panel
modals/drawers  ← higher (e.g., 60-80)
MessageComposer ← z-index not needed, in normal flow
```

The chip uses `z-[var(--z-combo)]` (CSS variable, defined in `globals.css`). Never use a magic number here — use the CSS variable.

### Step 3 — Position the floating chip

The chip is `fixed bottom-20 right-4`. The `bottom-20` (80px) clears the `MessageComposer` which is approximately 64px tall when collapsed. If the composer height changes, adjust `bottom-*` accordingly — document the dependency in a comment.

```tsx
// components/layout/parts/AskChip.tsx:33
"fixed bottom-20 right-4 z-[var(--z-combo)]",
```

### Step 4 — Visual differentiation

`MessageComposer` uses `bg-[color:var(--surface)]` with a standard border — it looks like a standard text input.

`AskChip` uses a Sparkles icon and "Ask this project" label with `text-[color:var(--text-secondary)]` — muted compared to the composer, signaling secondary/internal nature. When expanded into a drawer panel, `DashboardCabinetChrome` uses a distinct header with this project logo.

### Step 5 — The `hasAiChatModule` prop

`MessageComposer` accepts `hasAiChatModule?: boolean` (default `true`). When true, it renders an AI toggle button within the composer for AI-assisted reply drafting. This is different from AskAssistant — it augments the customer reply, not replaces it.

```tsx
// components/conversations/MessageComposer.tsx:62 + L231
hasAiChatModule?: boolean;
// ...
{hasAiChatModule && ( /* AI toggle button */ )}
```

---

## Example references

| What | File | Lines |
|------|------|-------|
| AskAssistant chip (collapsed state) | `components/layout/parts/AskChip.tsx` | L21–L60 |
| Chip z-index + fixed position | `components/layout/parts/AskChip.tsx` | L33–L35 |
| DashboardCabinetChrome (expanded drawer) | `components/layout/DashboardCabinetChrome.tsx` | whole file |
| MessageComposer role comment | `components/conversations/MessageComposer.tsx` | L18–L28 |
| `hasAiChatModule` prop | `components/conversations/MessageComposer.tsx` | L62, L231 |

---

## Anti-patterns / gotchas

- **Don't merge the two inputs into one component with a mode toggle.** The separate placement (bottom-center vs bottom-right floating) is intentional — spatial separation disambiguates purpose before the user reads any label.
- **Don't hardcode `bottom-20` without a comment referencing composer height.** The value will confuse future agents. Always explain the dependency.
- **Don't use a hardcoded z-index integer.** Always reference `--z-combo` from the CSS token system.
- **Don't render AskChip inside the conversation page component.** It lives in the layout so it persists across all dashboard routes.

---

## Wave reference

First applied: wave-6 (inbox dual-chat resolution, spec: `INBOX_DUAL_CHAT_RESOLUTION.md` Option C).
