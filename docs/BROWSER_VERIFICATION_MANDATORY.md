---
status: Active
version: 1.0.0
level: L1
type: core-arch
owner_role: platform
parents:
  - path: docs/NORTH_STAR.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-07-02
last_validated_against_parents: 2026-07-02
last_updated: 2026-07-12
---

# Browser Verification is Mandatory (dev-engine forcing function)

**Owner escalation 2026-07-02 (projectx-app):** "на системном уровне ты должен это делать
всегда, а то у тебя в каждой сессии ты не делаешь проверку в браузере и пропускаешь!
такого не должно быть! открываешь в плейврайте скрин проверяешь."

The screenshot self-critique already lived as Q7 inside the Spatial Design Pre-Flight rule,
but a rule buried inside another rule, held only by memory, gets skipped session after
session. So the engine now carries it as (1) its own binding rule and (2) a Stop-hook
forcing function, per the "record in BOTH places" discipline (global and dev-engine).

## Rule

Any change observable in a browser (component, page, style, layout, interaction) must be
looked at in a real browser before "done". `tsc --noEmit` green and tests passing prove
LOGIC; the browser proves it LOOKS and BEHAVES right. Both are required to ship.

Workflow every time observable UI is edited:

1. Drive a browser — the BUILT-IN Claude Code browser first (mcp__Claude_Browser__* /
   preview tools; owner's standing choice 2026-07-12). Playwright or claude-in-chrome are
   fallbacks only (headless runs, or the user's real logged-in Chrome). Navigate
   to the exact affected screen.
2. Screenshot and READ it (spatial-design Q7: "designed, or bolted on?"). Check the states
   you touched: empty, long text, narrow, dark.
3. Report with the screenshot / observation as the proof artifact.

## "No data / server down" is not an excuse

Construct the state instead of skipping the look:

- **Throwaway route** — a temp page rendering the component with hardcoded props for the
  changed cases (wrap in required providers, e.g. a drag-drop context), open, screenshot,
  then delete. Origin proof: the DealCard "Due" chip fix, 2026-07-02, when the pipeline
  board had zero deals because the backend session had expired.
- **Isolated worktree** — if a parallel session owns the dev server, don't fight it; use a
  worktree, or point the browser tool at the running server's port (HMR already has your
  edit).
- **Mocks** — enable only on a server you own; never restart or re-env another session's.

## Forcing function

`hooks/browser-verify-gate.mjs` (installed to the global hooks dir, wired into global
settings `hooks.Stop`). On Stop it scans the session transcript; if observable UI was
edited (TSX / JSX / CSS and similar files under the app, components, or src trees, tests
excluded) but no browser tool was called, it blocks the stop ONCE with a reminder. Fail-open (any error →
passes) and block-once-per-session (never a lockout). Legitimate pass: a UI-extension file
edited for a genuinely non-visual reason — say so explicitly in the final message.

## Composes with

- `docs/MULTI_LEVEL_VERIFICATION.md`
- The Spatial Design Pre-Flight rule (Q7 LOOK) — this doc is its enforcement.
- The global rule mirror in the user's home Claude config.
