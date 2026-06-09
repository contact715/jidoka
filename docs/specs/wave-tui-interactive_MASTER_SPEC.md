# wave-tui-interactive Master Spec — Make `jidoka top` an interactive dispatcher

**Status:** Draft · **Level:** L3 (module wave) · **Owner:** framework operator · **Created:** 2026-06-06
**Chief Architect:** drafted · **Spec Reviewer:** pending
**Parents:** `docs/specs/wave-tui-top_MASTER_SPEC.md` (the view-only panel this wave makes interactive)

> One-line: today `jidoka top` is a read-only window into the pipeline. This wave turns it into a
> dispatcher you can act from: select a session, press Enter, and you are already in that terminal
> window. Drill into a wave to see its phases and last events. Click with the mouse. Nothing about
> the read-only base contract changes — every existing acceptance test stays green.

---

## 1. Goal in business terms

**Role served:** the owner-as-dispatcher (the developer running several jidoka waves at once across
several terminal windows / tmux / zellij tabs). Not a product surface — this is dev-system tooling.

**The pain today.** The panel shows that a session is waiting for the owner, or that a wave is stuck.
But to *act* on it the owner has to leave the panel, remember which terminal window that session lives
in, and hunt for it by hand. The panel sees everything; it can do nothing.

**What this wave changes.** One screen — you see everything; press Enter — you are already in the
right window.

**Kaizen metric (the number we move):** *steps from "saw the problem" to "I am in that session".*
- Baseline: many (read panel → recall which window → alt-tab hunt → find it). Effectively unbounded,
  depends on how many windows are open.
- Target: **1** (move cursor to the row, press Enter — focus jumps to that terminal window/tab).
- How we measure it: the same launch log the base wave already writes
  (`docs/audits/tui-panel-launches.jsonl`) gains one optional field per focus action —
  `{ ts, action: 'focus', method, ok }` appended when Enter is pressed on a session row. `method` is
  which focus path fired (`terminal`/`iterm`/`tmux`/`zellij`/`warp`/`unknown`); `ok` is whether a real
  focus command ran (vs. a printed fallback hint). Over a week we can see: how often the jump worked,
  and which terminal types fall back. That is the feedback loop — if `warp`/`unknown` dominate, the
  next wave knows where the gap is.

**Honesty up front:** focus is not always possible (Warp, Claude desktop tabs, SSH, unknown
terminals). In those cases we do NOT pretend. We activate the app where we can and print a one-line,
copy-pasteable locator naming the exact window so the owner switches by hand. The metric counts those
honestly (`ok:false`).

---

## 2. Scope — what we build, and what we explicitly do NOT

### In scope
1. **Session selection + jump-to-terminal.** A cursor over the СЕССИИ list; Enter focuses that
   session's OS terminal window/tab using the focus decision table (§5, normative).
2. **Wave drill-down.** Enter on a ДОСКА (board) row expands an inline 3-line detail block under it
   (phases, last 3 events, owner note). Esc / Enter again collapses. One wave expanded at a time.
3. **Keyboard navigation.** Arrows move the cursor, Tab/Shift+Tab jump between sections, Enter acts,
   Esc collapses, plus the existing `q`/`r`/`←`/`→` from the base wave (unchanged meaning).
4. **Mouse (SGR 1006).** Click a row to select; click again (double-click window) = Enter; wheel
   scrolls. Mouse mode is enabled on entry and **torn down on every exit path**.
5. **Terminal identity for sessions.** The session-state hook records which terminal each session is
   in, so the panel knows where to jump. (Waves already carry `terminalId` from the base wave; this
   adds the same to sessions.)

### NOT doing (explicit, so nobody assumes it)
- **NOT** launching, advancing, or stopping waves from the panel. It dispatches *attention*, never
  *work*. The human stays in the approval seat (base-wave invariant preserved).
- **NOT** scrolling or showing transcripts of a session's conversation.
- **NOT** multi-select / batch actions. One cursor, one row.
- **NOT** switching Claude desktop's internal session tab. Research is explicit: Claude.app's asar has
  no session deep-link. The ceiling is app-activation (`open -b com.anthropic.claudefordesktop`) plus a
  hint. We do exactly that and no fragile Accessibility-UI clicking.
- **NOT** raising the host OS window for tmux/zellij beyond what the host-terminal focus step can do —
  when the multiplexer focus succeeds but the window can't be raised, we say so honestly.

---

## 3. Current state (what exists, verified against the real files)

Paths are the REAL locations (the base spec's prose said `scripts/dashboard/tui-top.mjs`; the file is
actually at `scripts/tui-top.mjs`). Line numbers are current as read.

| File | Real path | LOC now | Role |
|---|---|---|---|
| entry / impure shell | `scripts/tui-top.mjs` | **202** | args, raw-mode, poll loop, alt-screen, keys |
| pure renderer | `scripts/dashboard/tui-render.mjs` | 260 | `renderFrame(snapshot, collectedAt, cols)` → `string[]` |
| session hook | `hooks/session-state.mjs` | 146 | writes `~/.claude/session-env/state-<sid>.json` |
| run journal | `scripts/run-state.mjs` | 238 | already captures wave `terminalId` (base wave) |
| acceptance harness | `scripts/tui-top-acceptance.mjs` | 282 | 18 ACs run today, header says "14+5" |

**Already true (do not re-build):**
- `run-state.mjs:43-44` already sets wave `terminalId` from `TERM_SESSION_ID ?? ITERM_SESSION_ID`, with
  self-test cases at `:175-181`. Waves are covered. **Sessions are the gap.**
- `tui-render.mjs` is pure and self-tests its purity by grepping its own source for `Date.now(` /
  `process.stdout` / `readFileSync` (`:251-253`). Any new impurity in this file fails the test.
- `tui-top.mjs` already: enters alt-screen + hides cursor (`:104`), restores on exit/crash
  (`restore()` `:75-79`, wired to `exit`/`uncaughtException`/`unhandledRejection`/SIGTERM/SIGINT),
  has a single `onKey` handler (`:126`), reads sessions via `collectSessions` (`:29-45`), and writes
  the Kaizen launch log (`:48-56`).
- `collectSessions` (`tui-top.mjs:39`) maps `{ state, topic, activity, mtime, sessionId }` from each
  `state-<sid>.json`. No `terminalId` is read because the hook never writes one.

**Vocabulary locked to the UX fixtures** (do not invent new labels): sections `СЕССИИ` / `ЗАВИСЛО` /
`ДОСКА` / `ТЕРМИНАЛЫ` / `ЛЕНТА`; session states `working ▶` / `waiting ⏳` / `done ✓`; stage labels
`ПОИСК СПЕК ТЕСТЫ СБОРКА ГЕЙТ ДЕБАГ ПАМЯТЬ`; status symbols `✓ ▸ ! ○ ◦`; colors
`\x1b[32m`/`\x1b[33m`/`\x1b[31m`/`\x1b[90m`.

---

## 4. Architecture — the impure/pure boundary stays the law

```
tui-top.mjs  (IMPURE shell — owns ALL state, stdin, stdout, raw mode, mouse mode, subprocess focus)
  ├─ interaction state (locals in runLive): cursor, section, expanded, scroll{}, lastClick, lastHint
  ├─ key parser: arrows / Tab / Shift+Tab / Enter / Esc / q / r / ← → / mouse SGR
  ├─ reduceKey(ui, key, selectables) ──────────► pure, lives in tui-render.mjs, returns next ui
  ├─ focus dispatcher: resolve method per decision table → run osascript/tmux/zellij OR print hint
  └─ paint(snap, ui): renderInteractive(snap, at, cols, ui) → { lines, rows }; write rows→mouse map

tui-render.mjs  (PURE — no fs, no Date.now, no process.stdout, no stdin)
  ├─ renderFrame(snapshot, collectedAt, cols, ui = {})   ← existing path, ui added, default {} keeps callers
  ├─ renderInteractive(snapshot, collectedAt, cols, ui)  ← returns { lines, rows } for mouse mapping
  ├─ reduceKey(ui, key, selectables)                     ← pure selection reducer (moved here)
  ├─ buildSelectables(snapshot, collectedAt)             ← flat ordered selectable list (pure)
  ├─ parseMouse(chunk)                                   ← SGR parser → {button,col,row,press} | null
  └─ section renderers gain a `ui`/`opts.selected` so selected row = inverse + ▶ marker

session-state.mjs  (IMPURE hook, never-throw, exit-0, stdout-silent)
  └─ resolveTerminalId(env, ppidTty)  ← PURE helper (self-testable) → string|null
     captured ONCE per session into state-<sid>.json as `terminalId`
```

**Why this shape.** The renderer self-test enforces purity by grepping the source. The only purity-safe
way to give it selection is **data in, data out**: pass a `ui` object, return data. So selection,
scroll, expansion, and the mouse row-map are all caller-owned and threaded *in*; the renderer never
reads them from global state. The new pure pieces (`reduceKey`, `buildSelectables`, `parseMouse`) live
in `tui-render.mjs` so they are covered by its self-test and to relieve the entry file's LOC pressure
(§9).

---

## 5. Focus decision table — NORMATIVE

This table is the contract for the focus dispatcher. It is taken verbatim from the verified focus
research (tested on macOS 25.5: Terminal.app focus AppleScript compiles, `zellij action` targets
sessions, tty discovery works). Order matters: **multiplexer first, then host terminal.**

| Terminal type | Detect by (env captured at session start) | Focus action | Confidence |
|---|---|---|---|
| **Terminal.app** | `TERM_PROGRAM=Apple_Terminal` (or `TERM_SESSION_ID` set); resolve tty | `osascript` match tab by `tty`, `selected of tab` + `frontmost of window` + `activate` | TESTED |
| **iTerm2** | `TERM_PROGRAM=iTerm.app`, `ITERM_SESSION_ID` = `wXtYpZ:UUID` | `osascript` match session by `${ITERM_SESSION_ID#*:}`, `select s/t/w` + `activate` | UNTESTED-static (not installed; syntax from official docs) |
| **tmux** | `$TMUX` set, `$TMUX_PANE` = `%N` | `tmux select-window -t $TMUX_PANE \; select-pane -t $TMUX_PANE`; `switch-client -t` for multi-session; then run host-terminal focus on `client_tty` | TESTED-installed |
| **zellij** | `$ZELLIJ` set, `$ZELLIJ_SESSION_NAME` | `zellij --session "<name>" action go-to-tab-name "<tab>"` (+ `focus-pane-id`); prefer **name** over index; then host-terminal focus | TESTED-installed |
| **Warp** | `TERM_PROGRAM=WarpTerminal` | **No reliable focus.** Not AppleScript-window-scriptable (throws `-1728`). Print fallback hint. | TESTED |
| **Claude desktop** | parent proc `Claude.app`, bundle `com.anthropic.claudefordesktop` | `open -b com.anthropic.claudefordesktop` (app-activate only). **No tab switch** — no session deep-link in asar. Print hint. | TESTED |
| **unknown / SSH / VSCode** | none of the above match | Print fallback hint only. | n/a |

**TTY discovery (how a child hook finds its session's tty).** A hook's own stdout is a pipe
(`tty` → "not a tty"). Walk to the parent shell which owns the tty:
```
/dev/$(ps -o tty= -p "$PPID" | tr -d ' ')      # e.g. /dev/ttys003
```
Terminal.app's AppleScript `tty` property returns the FULL path `/dev/ttysNNN`; `ps` returns the bare
`ttysNNN` — **normalize** by prefixing `/dev/` before comparing.

**Detection order in the dispatcher (Node, zero-dep):**
```
1. if $ZELLIJ        → zellij branch (use $ZELLIJ_SESSION_NAME); ALSO resolve host tty + host-terminal focus
2. else if $TMUX     → tmux branch (use $TMUX_PANE); resolve client_tty + host-terminal focus
3. host terminal by TERM_PROGRAM:
     Apple_Terminal   → Terminal.app tty match
     iTerm.app        → iTerm2 UUID match (${ITERM_SESSION_ID#*:})
     WarpTerminal     → fallback hint (no reliable focus)
     parent Claude.app→ open -b com.anthropic.claudefordesktop + hint (no tab switch)
     vscode / SSH / unknown → fallback hint
```

**Reachability caveat (honest):** zellij/tmux focus only moves the cursor *inside* the multiplexer and
only if a client is attached; it cannot raise the OS window by itself. `go-to-tab` takes a shifting
*index*, so we use `go-to-tab-name`. When the in-multiplexer move worked but the window couldn't be
raised, the footer says so (§6 hint variants).

**Terminal.app focus AppleScript (verbatim, compiles):**
```applescript
on run argv
  set targetTTY to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        try
          if (tty of t) is targetTTY then
            set selected of t to true
            set frontmost of w to true
            activate
            return "ok"
          end if
        end try
      end repeat
    end repeat
  end tell
  return "notfound"
end run
```
Call: `osascript focus.applescript "/dev/ttys017"`.

**iTerm2 focus AppleScript (UNTESTED-static, syntax from official docs):**
```applescript
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "$UUID" then
          select s
          select t
          select w
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
```
where `UUID="${ITERM_SESSION_ID#*:}"`.

**Fallback UX when focus is impossible** (Warp, Claude tab, SSH, unknown): never fail silently. Activate
the app if possible, then print one copy-pasteable locator to stderr naming the window, tty, and cwd,
e.g. `[focus] не могу переключить это окно (Warp). Сессия на tty /dev/ttys003. Переключись вручную.`

---

## 6. Interaction model (UX contract, locked to fixtures)

### 6.1 Selection — one global cursor
A single integer `cursor` indexes a **flat, ordered list of selectable rows** rebuilt every paint.
Sections are non-selectable; only their rows are. Build order follows attention priority so the cursor
lands on what matters first:
```
selectables = [ ...stuckRows (ЗАВИСЛО), ...sessionRows (СЕССИИ), ...waveRows (ДОСКА) ]
```
Caller-owned `ui` (passed into the renderer, never read from globals):
- `cursor` — index into `selectables`, clamped to `[0, len-1]` **by the caller** (renderer never guards bounds).
- `section` — derived from which block `cursor` falls in (for Tab + footer context).
- `expanded` — the wave/stuck id currently expanded inline, or `null`.
- `scroll` — per-section top offset for the 8-row window.
- `lastHint` — optional flashed hint (e.g. "can't switch this window") for footer line 1.

### 6.2 Keys
- `↑` / `↓` — `cursor ± 1`, clamped; if off the visible window, `scroll` follows.
- `Tab` / `Shift+Tab` — jump cursor to the first row of the next / previous **non-empty** section
  (ЗАВИСЛО → СЕССИИ → ДОСКА → wrap).
- `Enter` — act on current row (§6.3).
- `Esc` — collapse if something is expanded, else no-op.
- `q` quit, `r` refresh, `←` `→` switch project (unchanged from base wave; project switch resets
  `cursor=0`, `expanded=null`).
- Escape sequences arrive as whole strings in `utf8` mode: Up `\x1b[A`, Down `\x1b[B`, Right `\x1b[C`,
  Left `\x1b[D`, Enter `\r` or `\n`, Tab `\t` (`\x09`), Shift+Tab `\x1b[Z`, Esc `\x1b` (bare).

### 6.3 Enter semantics
**Enter on a session row** → focus that session's OS terminal window/tab via the dispatcher (§5),
using the session's recorded `terminalId`. When focus is impossible, set `ui.lastHint` to an honest
one-liner that **names the window** and repaint; never pretend it worked.

**Enter on a wave row** → toggle inline expansion. Expanding pushes a 3-line detail block beneath the
row (rows below shift down). Detail (all pulled from the snapshot the caller already has — pure):
- phases line — all 7 stages with per-phase symbols, e.g.
  `✓ПОИСК ✓СПЕК ▸ТЕСТЫ ○СБОРКА ○ГЕЙТ ○ДЕБАГ ○ПАМЯТЬ`
- last-3-events — from the wave's `events` (newest first): `время · кто · что`
- note — the wave's owner-facing note, or `—`.
Only one wave expands at a time (expanding B collapses A). Stuck waves in ЗАВИСЛО expand the same way.
Detail lines are non-selectable, indented 4 spaces, dim (`\x1b[90m`); `↓` from an expanded row lands on
the next *wave* row, stepping over the block.

### 6.4 Selected-row marker (colorblind-safe, never color-only)
Selected row = inverse video `\x1b[7m … \x1b[0m` wrapping the **full padded width** (solid bar, not
ragged) PLUS a `▶` gutter marker replacing the normal 2-space indent. The existing `pad`/`strip`
helpers already discount ANSI when measuring width, so the highlight does not break column alignment.

### 6.5 Footer — context-sensitive, two lines
- Line 1 = action hint for the current row (changes as cursor moves; collapses only when zero
  selectables).
- Line 2 = constant key legend.

| Row under cursor | Footer line 1 |
|---|---|
| session working/waiting, reachable | `▶ {topic} — Enter: перейти в это окно` |
| session, NOT reachable | `▶ {topic} — это окно нельзя переключить отсюда (tmux jidoka/{n})` |
| session done | `✓ {topic} — сессия завершена` |
| wave collapsed | `▶ {wave} — Enter: показать детали волны` |
| wave expanded | `▼ {wave} — Enter/Esc: свернуть` |
| stuck wave | `! {wave} — застыло {dur}, Enter: что случилось` |
| nothing selectable | line 1 dropped |

Narrow (<100 cols): line 2 collapses to `↑↓ · Tab · Enter · q · r · ←→`; line 1 truncates with `…` but
is never dropped while a row is selected.

### 6.6 HALT freezes interaction
When `health.halt === true`: rows render non-selectable (dim, no `▶`), Enter is a no-op, footer line 1
shows the resume instruction. Nothing is dispatched while the pipeline is stopped. Priority order is
preserved everywhere: **HALT > ЗАВИСЛО > СЕССИИ > ДОСКА.**

### 6.7 State coverage
- **Empty section** → header omitted (matches `renderSessions([]) → []`), cursor build skips it.
- **No selectables at all** → existing empty state (`Нет активных волн` + `НЕДАВНО ЗАВЕРШИЛИСЬ`);
  footer drops line 1.
- **>8 rows in a section** → render at most `WINDOW = 8`; `scroll[section]` is the top index; cursor
  movement past an edge advances `scroll`. Clipped rows summarized by `▲ ещё N выше` / `▼ ещё N ниже`,
  shown only when clipped on that side.
- **Narrow (<100)** → board falls back to existing linear list (`boardLinear`), one selectable row per
  wave; identical interaction (flat `selectables`, `▶` marker, inverse bar, footer). Mouse map rebuilt
  for whichever layout rendered.

---

## 7. Mouse — SGR (1006), and the teardown contract

**Enable on entry, DISABLE on every exit path.** This is a hard requirement: a left-behind mouse mode
makes the user's terminal unusable after quit. The enable must sit right after the alt-screen enter
(`tui-top.mjs:104`); the disable must sit in `restore()` (`:77`) next to the existing
`\x1b[?25h\x1b[?1049l`, so it tears down on `q`, SIGTERM, SIGINT, `uncaughtException`,
`unhandledRejection`, and `process.on('exit')` alike.
```
enable  (after alt enter): \x1b[?1000h\x1b[?1006h
disable (in restore()):    \x1b[?1000l\x1b[?1006l
```
`?1000h` = report press/release. `?1006h` = SGR extended decimal coordinates (removes the 223-col limit,
trivial to parse).

**Bytes arriving on stdin** (one report per event), e.g. left-press at col 5 row 12:
```
ESC [ < 0 ; 5 ; 12 M           0x1b 0x5b 0x3c 0x30 0x3b 0x35 0x3b 0x31 0x32 0x4d
```
General shape `ESC[<Cb;Cx;Cy(M|m)` — `M`=press, `m`=release; `Cx`=col, `Cy`=row (1-based decimal ASCII);
`Cb`=button/modifier. `Cb` codes that matter: `0` left / `1` middle / `2` right; `+32` (bit 5) = motion
(drag — ignore); `64` wheel-up / `65` wheel-down (→ `↑`/`↓`); modifier bits `+4` Shift / `+8` Meta /
`+16` Ctrl (mask with `Cb & 0b11` for base button).

**Parser (pure, in tui-render.mjs):**
```
parseMouse(chunk) → matches /\x1b\[<(\d+);(\d+);(\d+)([Mm])/
  → { button: +g1, col: +g2, row: +g3, press: g4 === 'M' }  | null
```

**Row → selectable mapping.** `renderInteractive` returns `{ lines, rows }` where `rows` is a
`Map<screenRow(1-based Cy), selectableIndex>` built as selectable lines are pushed. On a press
(`M`, base button `0`):
1. `idx = rows.get(Cy)`; undefined (header/blank/footer) → ignore.
2. If `idx === cursor` and within `DOUBLE_MS` (≈400 ms) of the last press on the same row → treat as
   **Enter** (§6.3).
3. Else → `cursor = idx`; record `lastClick = { idx, time }`.
Wheel (`Cb` 64/65) moves the window regardless of pointer row. Release (`m`) and motion (`Cb & 32`) are
dropped.

---

## 8. Exact changes per file

### 8.1 `hooks/session-state.mjs` — capture session terminal identity
**Gap:** sessions carry no terminal identity, so the panel can't jump. Add it.

(a) **Pure helper** (self-testable), added near the other pure exports:
```js
// pure: resolve a stable-ish terminal identity for THIS session from env + parent tty (testable).
export function resolveTerminalId(env = {}, ppidTty = null) {
  const fromEnv = env.TERM_SESSION_ID || env.ITERM_SESSION_ID
    || (env.TMUX_PANE ? `tmux:${env.TMUX_PANE}` : null)
    || (env.ZELLIJ ? `zellij:${env.ZELLIJ_PANE_ID || ''}` : null);
  return fromEnv || (ppidTty ? `tty:${ppidTty}` : null);
}
```
Priority captured per research: `TERM_SESSION_ID`, then `ITERM_SESSION_ID`, then `TMUX_PANE` (precise
pane, prefer over bare `TMUX`), then `ZELLIJ_PANE_ID` (prefer over bare `ZELLIJ`), then the parent tty.

(b) **Static import** at top (sync, stays inside the never-throw sync `isMain` block):
```js
import { execFileSync } from 'node:child_process';
```

(c) **Capture ONCE per session** inside the `isMain` block, between the `nextState` call
(`session-state.mjs:137`) and `writeFileSync` (`:138`). `ps` is a subprocess, so run it only when
`prev.terminalId` is absent:
```js
if (!prev.terminalId) {
  let tty = null;
  try { tty = execFileSync('ps', ['-o', 'tty=', '-p', String(process.ppid)], { encoding: 'utf8' }).trim() || null; }
  catch { /* headless / no ps */ }
  next.terminalId = resolveTerminalId(process.env, tty);
} else {
  next.terminalId = prev.terminalId;
}
```
Why re-apply AFTER `nextState`, not inside the pure reducer: `UserPromptSubmit` returns a FRESH record
(`session-state.mjs:57`) that drops unknown fields, so the check must read `prev.terminalId` (not
`next.terminalId`) and re-stamp here. Use `process.ppid` (the `claude` process that owns the tty), not
`process.pid` (the node hook). This stays inside the existing try/catch envelope (`:129-144`); the hook
still `process.exit(0)` with nothing on stdout.

(d) **Self-test cases** added to the existing `selfTest()` array (pure helper only — the `isMain`
subprocess block stays untested, as today):
- `resolveTerminalId` prefers `TERM_SESSION_ID` over all else.
- `ITERM_SESSION_ID` used when `TERM_SESSION_ID` absent.
- `TMUX_PANE` → `tmux:%N` when no GUI id.
- `ZELLIJ` (no pane id) → `zellij:`.
- env empty + ppidTty → `tty:<ppidTty>`.
- env empty + no ppidTty → `null`.

(e) **jidoka install copy MUST be synced.** After changing the repo hook, copy the same change to
`~/.claude/jidoka/hooks/session-state.mjs` (the generated install used by every project). Per the
global rule, an environment-wide hook change lives in BOTH places. Proof in §10.

### 8.2 `scripts/tui-top.mjs` — keys, mouse, selection state, focus dispatcher
- **Read the new field:** in `collectSessions` (`:39`) add `terminalId: data.terminalId || null` to the
  pushed session object.
- **Mouse enable:** after `:104` (`\x1b[?1049h\x1b[?25l`) append `\x1b[?1000h\x1b[?1006h`.
- **Mouse disable:** in `restore()` (`:77`) change to
  `process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l')` so teardown rides every exit path.
- **Interaction state** as locals in `runLive` alongside `tick`/`prevSnapJson` (`:105`):
  `cursor`, `section`, `expanded`, `scroll = {}`, `lastClick = null`, `lastHint = null`.
- **Split `draw()` into `collect()` + `paint(snap, ui)`** so a keypress repaints the EXISTING snapshot
  (just move the cursor) instead of re-collecting from disk every key. `collect()` does the fs read +
  heartbeat bookkeeping; `paint()` builds `selectables`, clamps `cursor`, calls
  `renderInteractive(snap, at, cols, ui)`, stores the returned `rows` map, writes via the existing
  `buildRepaintBuffer`. The 1s poll / fs.watch path calls `collect()` then `paint()`; keys call
  `paint()` only.
- **Extend `onKey`** (one handler, no new listeners) to parse arrows/Tab/Shift+Tab/Enter/Esc/mouse,
  call the pure `reduceKey(ui, key, selectables)` for navigation, and run the focus dispatcher on Enter
  over a session row. Mouse chunks route through `parseMouse` → click/double/wheel logic (§7). Existing
  `q`/`r`/`←`/`→` behavior preserved.
- **Focus dispatcher** (impure, here): `resolveFocusMethod(env)` returns one of
  `zellij|tmux|terminal|iterm|warp|claude|unknown` per the §5 order; `runFocus(method, terminalId,
  env)` runs the matching `osascript`/`tmux`/`zellij`/`open` via `execFileSync`, or returns a fallback
  hint string. On result, append the metric line to the launch log (`{ ts, action:'focus', method, ok }`)
  and, on failure, set `ui.lastHint` + repaint. **No real `osascript` runs in tests** — the dispatcher
  takes an injectable `exec` (defaulting to `execFileSync`) so unit tests pass a stub.
- **Move the pure helpers out** (`heartbeatLine`, `buildRepaintBuffer`) into `tui-render.mjs` to free
  LOC headroom (§9). `tui-top.mjs` imports them back.

### 8.3 `scripts/dashboard/tui-render.mjs` — selection in, purity preserved
- **Signature:** `renderFrame(snapshot, collectedAt, cols, ui = {})`. Default `{}` keeps every existing
  caller and the whole acceptance harness valid unchanged. `ui = { cursor, section, expanded, scroll,
  lastHint }` is data-in/data-out → purity holds.
- **New pure export `renderInteractive(snapshot, collectedAt, cols, ui)`** → `{ lines, rows }` where
  `rows: Map<Cy, selectableIndex>`. `renderFrame` stays the pure-`string[]` path the self-test uses, so
  all current fixtures keep passing.
- **New pure exports:** `buildSelectables(snapshot, collectedAt)` (flat ordered list, §6.1),
  `reduceKey(ui, key, selectables)` (the navigation reducer — moved here so the self-test covers it),
  `parseMouse(chunk)` (§7 regex). Plus relocated `heartbeatLine`, `buildRepaintBuffer`.
- **Selection threads through section renderers via `opts.selected` / `ui`** (not new positional args):
  `renderStuckSection`, `renderSessions`, `renderBoard`/`boardLinear`/`boardKanban` wrap the matching
  row in inverse video + `▶` gutter. Selected wave injects the 3-line detail block when
  `ui.expanded === wave.wave`.
- **Footer** becomes the two-line context footer (§6.5) when `ui` carries a current row; with empty
  `ui` it renders exactly the current single-line legend (backward-compatible default).
- **Purity unchanged:** still no `fs`, no `Date.now(`, no `process.stdout`. The self-test purity grep
  (`:251-253`) must stay green; `reduceKey`/`parseMouse`/`buildSelectables` are pure string/data
  functions.

### 8.4 `scripts/tui-top-acceptance.mjs` — new ACs in a fresh namespace
Add a `groupInteractive()` with `IAC-*` IDs (no collision with `AC-*` / `AC-L*`), call it alongside the
others (`:268-271`), and bump the header count string (`:267`). The 18 existing ACs stay green.

---

## 9. LOC budgets and decomposition

| File | Budget | Now | Plan |
|---|---|---|---|
| `scripts/tui-top.mjs` | **260** (raised from 200 — justified below) | 202 | +keys/mouse/focus, −pure helpers moved out |
| `scripts/dashboard/tui-render.mjs` | 400 | 260 | +`renderInteractive`/`reduceKey`/`buildSelectables`/`parseMouse`/`heartbeatLine`/`buildRepaintBuffer` (~110 headroom) |
| `hooks/session-state.mjs` | 200 (raised from ~165) | 146 | +`resolveTerminalId` + capture + ~6 self-tests (~20 lines) |
| `scripts/tui-top-acceptance.mjs` | — | 282 | +`groupInteractive()` |

**Why `tui-top.mjs` may grow to 260.** It is the IMPURE shell — by design it owns ALL stdin/stdout/raw
mode/mouse/subprocess work, which is exactly what this wave adds (key parsing, mouse plumbing, the focus
dispatcher). That logic cannot move to the pure renderer without breaking the purity contract the
renderer self-test enforces. We first **shed the pure helpers** (`heartbeatLine`, `buildRepaintBuffer`,
the reducer/parsers) to `tui-render.mjs` (which has ~110 lines of room), keeping only genuinely impure
wiring in the entry file. If after that it still approaches 260, extract the focus dispatcher into a
sibling `scripts/dashboard/focus.mjs` (impure, but unit-testable via injected `exec`) rather than
breach the cap. The renderer is where new *logic* concentrates; the entry file only grows by impure
plumbing.

---

## 10. Acceptance criteria — EARS, executable, `IAC-*`

All ACs run from `scripts/tui-top-acceptance.mjs` (`groupInteractive`) unless noted. Fixtures are inline
(snapshot shape from `collectProject`); **no real `osascript`/`tmux`/`zellij` runs in tests** — the
focus dispatcher takes an injected `exec` stub.

**IAC-1 — selection renders inverse video + marker.**
WHEN `renderInteractive(snapshot, at, cols, { cursor })` is called with a `cursor` pointing at a
selectable row, the line for that row SHALL contain the inverse-video code `\x1b[7m` and the `▶` gutter
marker, AND no other selectable row SHALL contain `\x1b[7m`.

**IAC-2 — selection is data-in, renderer stays pure.**
WHEN the tui-render source is grepped, it SHALL contain no `Date.now(`, no `process.stdout`, no
`readFileSync`/`readFile(` (the existing purity test extended to the new functions), AND
`renderFrame(snapshot, at, cols)` called WITHOUT a `ui` arg SHALL return a `string[]` byte-identical to
the pre-wave output for the same fixture (default `ui = {}` is inert).

**IAC-3 — wave drill-down expands phases + events.**
WHEN `renderInteractive(snapshot, at, cols, { cursor: <waveRow>, expanded: <wave.wave> })` is called for
a wave fixture whose `phases` and `events` are set, the output SHALL include a detail block containing
the 7 stage labels with per-phase symbols AND the wave's most recent event text, indented and dim
(`\x1b[90m`); collapsing (`expanded: null`) SHALL remove that block.

**IAC-4 — mouse SGR parse maps to a row.**
WHEN `parseMouse('\x1b[<0;5;12M')` is called, it SHALL return `{ button: 0, col: 5, row: 12, press:
true }`; `parseMouse('\x1b[<0;5;12m')` SHALL return `press: false`; a non-mouse chunk SHALL return
`null`. AND GIVEN a `rows` map from `renderInteractive` where screen row 12 maps to selectable index 3,
a press at `Cy=12` SHALL select index 3.

**IAC-5 — mouse mode is enabled and torn down.**
WHEN `tui-top.mjs --self-test` runs, it SHALL assert the enable sequence `\x1b[?1000h\x1b[?1006h` is
written after alt-screen enter AND the disable sequence `\x1b[?1000l\x1b[?1006l` is present in
`restore()` output. WHEN `restore()` is invoked on the crash path (`_inAltScreen = true`), its captured
stdout SHALL include `\x1b[?1000l\x1b[?1006l` (mouse torn down on every exit path).

**IAC-6 — non-TTY flat path unchanged (no ANSI, no selection).**
WHEN `tui-top.mjs` is spawned with piped (non-TTY) stdout, the output SHALL contain no `\x1b`, SHALL NOT
enable mouse mode, SHALL carry no selection markers, and the process SHALL exit 0. (This is the existing
AC-10 contract — IAC-6 asserts the interactive additions did not regress it; it does not duplicate the
original test.)

**IAC-7 — session state file gains terminal fields (hook self-test).**
WHEN `node hooks/session-state.mjs --self-test` runs, it SHALL exit 0 with the new `resolveTerminalId`
cases passing: `TERM_SESSION_ID` wins over all; `ITERM_SESSION_ID` used when it is absent; `TMUX_PANE`
→ `tmux:%N`; `ZELLIJ` → `zellij:`; empty env + ppidTty → `tty:<ppidTty>`; empty env + no ppidTty →
`null`.

**IAC-8 — focus dispatcher chooses the right method per env (unit, injected exec).**
WHEN `resolveFocusMethod(env)` is called with each fixture env, it SHALL return: `{ZELLIJ:'1'}` →
`zellij`; `{TMUX:'...'}` → `tmux`; `{TERM_PROGRAM:'Apple_Terminal'}` → `terminal`;
`{TERM_PROGRAM:'iTerm.app'}` → `iterm`; `{TERM_PROGRAM:'WarpTerminal'}` → `warp`; `{}` → `unknown`.
Order SHALL be multiplexer-first (ZELLIJ/TMUX win even if `TERM_PROGRAM` is also set). AND `runFocus`
with an injected `exec` stub SHALL invoke `exec` with the method's expected command shape (e.g.
`terminal` → `osascript` + the tty arg; `tmux` → `tmux select-window`/`select-pane -t $TMUX_PANE`;
`zellij` → `zellij --session <name> action go-to-tab-name`) WITHOUT running a real subprocess.

**IAC-9 — graceful hint when no method applies.**
WHEN `runFocus('warp', terminalId, env)` (or `'unknown'`, or `terminalId === null`) is called, it SHALL
NOT throw and SHALL return `{ ok: false, hint: <string naming the window/tty> }`; the panel SHALL set
`ui.lastHint` and repaint. The hint string SHALL contain the terminal identifier so the owner can find
the window by hand.

**IAC-10 — Claude desktop is app-activate only (honesty AC).**
WHEN `runFocus('claude', terminalId, env)` is called with an injected `exec` stub, it SHALL invoke only
`open -b com.anthropic.claudefordesktop` (or the equivalent activate) and return `{ ok: false, hint:
... }` — it SHALL NOT attempt any tab switch (no Accessibility-UI scripting). This encodes the research
honesty boundary as a test.

### Verification commands
```bash
# hook: terminal-identity helper + existing transitions
node hooks/session-state.mjs --self-test            # exit 0, resolveTerminalId cases present

# renderer: purity + selection + drill-down + mouse parse
node scripts/dashboard/tui-render.mjs --self-test    # exit 0, purity grep green

# entry: alt-screen + mouse enable/disable + repaint
node scripts/tui-top.mjs --self-test                 # exit 0, mouse teardown asserted

# non-TTY flat path still ANSI-free (no regression)
node scripts/tui-top.mjs | cat | grep -q $'\x1b' && echo FAIL || echo PASS

# full harness: 18 existing ACs + new IAC-* all green
node scripts/tui-top-acceptance.mjs                  # exit 0

# jidoka install copy synced (BOTH places rule)
diff hooks/session-state.mjs ~/.claude/jidoka/hooks/session-state.mjs && echo SYNCED
```

---

## 11. Backward compatibility (hard invariants)

1. **All 18 existing ACs stay green** — AC-1..AC-4 (run-state), AC-5..AC-9 (render), AC-L1..AC-L5
   (live), AC-10/AC-12/AC-13/AC-11+14 (entry). `renderFrame`'s 4th `ui` param defaults to `{}` (inert),
   so every existing call site and fixture is untouched.
2. **`renderFlat` / non-TTY byte-identical (AC-10).** Selection is a TTY-only concept; `runFlat` /
   `renderFlat` are NOT given `ui` and never enable mouse mode. The only flat-output change permitted is
   plain-text `terminal=...` on a SESSION line (no ANSI — keeps the flat self-test `:241-245` true).
3. **Hook stays exit-0-always and stdout-silent.** The terminal capture lives inside the existing
   never-throw try/catch; `ps` failure is swallowed; nothing is printed to stdout (the OSC title still
   goes only to `/dev/tty`).
4. **Renderer stays pure.** Enforced by its own source-grep self-test; the new functions are pure.
5. **Mouse mode is torn down on every exit path** (q, signals, crash, normal exit) so the terminal is
   never left in a broken state — this is itself an AC (IAC-5).

---

## 12. NOT doing (restated for the implementer — do not drift)
- No launch / advance / stop of waves from the panel.
- No transcript scrolling / conversation view.
- No multi-select / batch focus.
- No Claude-desktop internal tab switching beyond `open -b com.anthropic.claudefordesktop` + hint
  (research: no session deep-link exists; Accessibility-UI clicking is rejected as fragile).
- No raising the OS window for tmux/zellij beyond the host-terminal focus step; when only the
  in-multiplexer move succeeds, say so honestly in the footer.
- No new npm dependency, no Go toolchain — Node built-ins + `osascript`/`tmux`/`zellij` subprocesses
  only (preserves the base-wave zero-dep ADR).

---

## TL;DR
- We make `jidoka top` interactive: arrow/Tab/Enter/Esc keys + mouse, a single cursor over
  ЗАВИСЛО → СЕССИИ → ДОСКА.
- Enter on a session jumps your terminal to that window (Terminal.app/iTerm2/tmux/zellij per a tested
  decision table); when it can't (Warp, Claude tab, SSH), it says so honestly and names the window.
- Enter on a wave opens an inline detail block (phases + last events + note).
- The session hook now records which terminal each session lives in (one cheap `ps` per session),
  synced into the jidoka install too.
- The renderer stays pure (selection is passed in, a `{lines, rows}` map comes out for the mouse); the
  entry file owns all the impure plumbing and may grow to 260 LOC, justified, after shedding its pure
  helpers.
- Metric we move: steps from "saw the problem" to "I'm in that session" → 1. Logged to the existing
  launch jsonl as `{action:'focus', method, ok}`.
- All 18 existing acceptance tests stay green; new tests are `IAC-1..IAC-10`.
