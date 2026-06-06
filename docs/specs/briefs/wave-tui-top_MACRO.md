# Wave-tui-top Macro-Brief

## 1. Market scan

| Competitor | Their approach | Where they're strong | Where they fail |
|---|---|---|---|
| **btop** (direct: process monitor) | Alternate screen buffer, diff-based repaint at 60fps, color-coded columns, animated bar graphs for at-a-glance density | Zero flicker; graceful NO_COLOR/non-TTY fallback; fits any terminal width via auto-collapse | No concept of "stages" or "stuck"; every row is equal weight; no prioritisation of error state |
| **k9s** (direct: live resource list) | Filtered live-updating table; top-bar shows active context; "Error Zoom" drills directly to what's wrong; vim-style shortcuts | Error-first navigation; real-time diff rendering without full-screen redraw | Too many shortcuts; steep learning curve for non-technical users; no pipeline/stage mental model |
| **tuiboard** (direct: TUI kanban + Claude agent strip) | Markdown kanban columns + live agent strip from `~/.claude/`; responsive collapse at 100/120/150 cols; `r` to refresh | Closest to our model; responsive breakpoints are exactly what we need; agent strip concept matches our "lента агентов" | View-only agent zone is shallow (just session names); no stuck-detection; no andon/health section |
| **lazygit** (indirect: panel dashboard) | Six fixed panels; left-to-right spatial flow; panel focus shifts with Tab/arrows; status line always visible | Spatial layout teaches itself in one session; panel focus is obvious | Panels are equal weight; nothing floats to the top when something is broken |
| **gh-dash** (indirect: GitHub TUI) | Sections configured in YAML; vim navigation; no auto-refresh (manual `r`); clean two-column layout | Dead-simple keyboard contract: `q` quit, `r` refresh, `?` help | Static; no live-update; no health/andon concept at all |

---

## 2. Convention vs whitespace

**Convention** (btop + k9s + tuiboard all do this):
- Alternate screen buffer, `\x1b[?1049h` on enter, restore on exit. No exception.
- Diff/cursor-home repaint, not full clear. Full clear = flicker. Every serious TUI avoids it.
- `q` = quit, `r` = force refresh. Every tool uses exactly these two. Fight them and users will be confused.
- Responsive collapse: wide terminal shows everything, narrow terminal hides less-critical panels. tuiboard's 100/120/150 breakpoints are a clean reference.
- TTY detection: if piped (not a TTY), strip ANSI and emit a plain-text snapshot. No interactive TUI in a pipe.

**Whitespace** (nobody does this):
- A dedicated "stuck" surface. btop and k9s surface errors only when you drill in. tuiboard has no stuck-detection at all. Nobody floats a "halted items" section to the top of the screen automatically.
- "Wave → terminal window" link. No tool connects a named task/wave to the terminal session running it. This is a gap specific to our domain.
- Andon/health column as a first-class region. k9s has Error Zoom (one level down), btop has color on broken rows. Nobody has a persistent health sidebar that shows red/yellow/green for the whole pipeline at a glance.

---

## 3. Recommended baseline

**Pattern: btop-style alternate-screen diff renderer with tuiboard-style responsive panel collapse**

Enter alt screen on start, exit cleanly on `q` or SIGTERM. On each tick: move cursor to home (`\x1b[H`), repaint only lines that changed. Use Bubbletea (charmbracelet) as the framework — it implements `setSyncedUpdates`, buffered flush, and diff rendering via `cursedRenderer` out of the box. Do not roll a custom renderer.

For layout: three zones like tuiboard (pipeline columns, stuck/andon strip, agent feed), collapse rightmost zones at 100 and 120 columns.

Reference competitor to study: **tuiboard** (`github.com/NazzarenoGiannelli/tuiboard`) — responsive breakpoints, agent strip, `r`-to-refresh. Bubbletea renderer.go for the diff-render internals.

---

## 4. Killer differentiation

**Stuck-float: items past their expected duration automatically rise to the top section, with elapsed time and the last agent message visible without any interaction.**

Nobody ships this. btop surfaces high-CPU processes but only by sorting a flat list. k9s has Error Zoom but you have to navigate to it. tuiboard has no time-awareness at all.

Why nobody has shipped it: the other tools are generic (process monitor, git UI, GitHub dashboard). They have no domain knowledge about what "too long" means. We do: we know expected durations per pipeline stage from the wave spec.

User value: a non-technical owner opens the panel, sees "wave-auth stuck 47 min in spec-review (expected 20)" in red at the top — without pressing a single key.

How a competitor could copy it: they'd need domain knowledge of expected durations. For a generic tool that's configuration overhead nobody wants to add. For us it's native. Time to copy: one quarter minimum, and only if they narrow scope to our domain. Not a strong moat on its own, but combined with the wave-to-terminal link below it creates a cohesive story nobody else tells.

---

## 5. Friction-tax warning

**Flicker.** If we use a naive `clear` + full repaint instead of cursor-home diff-render, users coming from btop or any modern terminal tool will notice immediately. It looks broken. Cost: first-impression loss. Fix is zero extra code if we use Bubbletea correctly.

**Keyboard contract.** If we bind `q` to anything other than quit, every k9s and htop user will close the panel by accident in the first session. Convention is absolute here. Use `q` = quit, `r` = refresh, `?` = help. Nothing else on single keys unless it is additive (e.g. `1`/`2`/`3` to switch project).

**NO_COLOR + pipe.** If we don't handle non-TTY output, CI logs and shell scripts piping our output will receive raw ANSI escape sequences and look garbled. This is the first thing DevOps teams test. Bubbletea's termenv detects this automatically if we don't override it.

**Width collapse.** If the panel looks broken at 80 columns (a common SSH default), non-technical users will think the tool is broken. tuiboard's breakpoints (150 / 120 / 100 / board-only) are the right model. Implement before first demo.

---

## 6. Sources

- [Bubbletea screen management (DeepWiki)](https://deepwiki.com/charmbracelet/bubbletea/4.4-screen-management)
- [Bubbletea renderer.go (GitHub)](https://github.com/charmbracelet/bubbletea/blob/main/renderer.go)
- [tuiboard — live Claude Code agent view TUI](https://github.com/NazzarenoGiannelli/tuiboard)
- [k9s — Kubernetes terminal UI](https://k9scli.io/)
- [gh-dash — GitHub TUI dashboard](https://github.com/dlvhdr/gh-dash)
- [btop vs htop comparison (blackMORE Ops)](https://www.blackmoreops.com/top-atop-btop-htop-linux-monitoring-tools-comparison/)
- [BTY TTY trap — graceful degradation via pipes (Medium)](https://wk-j.medium.com/the-tty-trap-fixing-glows-tui-when-running-through-pipes-helix-editor-c7ef63112370)
- [Claude Code fullscreen / no-flicker rendering](https://code.claude.com/docs/en/fullscreen)
