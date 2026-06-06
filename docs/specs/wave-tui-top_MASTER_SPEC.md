# wave-tui-top Master Spec — Terminal Pipeline Dashboard (`jidoka top`)

**Status**: Draft
**Chief Architect**: drafted
**Spec Reviewer**: pending
**Date**: 2026-06-06

---

## ADR-inline-01 — Raw ANSI over Bubbletea (Go)

**Decision**: implement the TUI entirely in Node.js with raw ANSI escape sequences and Node built-ins (`node:readline`, `node:fs`, `node:os`). No external npm dependencies, no Go toolchain.

**Why**: the Macro-brief recommends Bubbletea for diff-rendering and flicker-free repaints. The Micro-brief and Surfaces-brief both enforce zero-dependency policy for the `scripts/` layer — every existing script uses only Node built-ins. Introducing a Go binary or a charmbracelet npm wrapper would break the install contract ("copy scripts/ and run") and add a build step that does not exist anywhere else in the framework.

**Patterns adopted from Macro**: alternate screen buffer (`\x1b[?1049h` / `\x1b[?1049l`), cursor-home repaint (`\x1b[H`) instead of `clear` (eliminates flicker), `q` = quit, `r` = refresh, responsive breakpoints at 100 and 120 columns (tuiboard model), TTY detection with ANSI-stripped flat output when piped.

**Patterns rejected**: Bubbletea `setSyncedUpdates` / `cursedRenderer` internals — we replicate the technique in pure Node, not the library. Mouse events, scroll widgets — excluded per scope.

---

## 1. Vision

A developer running a jidoka pipeline should be able to see — at a glance, without leaving the terminal — which waves are in flight, which are stuck, and which terminal owns each wave. Today that requires manually calling `--resume` or reading `state.json` files; the average time to notice a stuck wave is undefined (depends on context-switching). The target is under 5 seconds from opening the panel to seeing the problem.

**Kaizen metric**: time-to-detect a stuck wave. Baseline: manual scan. Target: ≤ 5 s. Measurement: append-only log at `docs/audits/tui-panel-launches.jsonl` — each entry records `{ ts, project, wavesInFlight, stuckCount }`. The next wave can correlate panel-open timestamps with the first `--advance` call that follows a stuck wave. Secondary metric: panel-open frequency per day (shows whether developers actually use it).

**Role served**: framework operator (developer running jidoka locally). Not a product-surface role.

---

## 2. Current state

- `scripts/dashboard/collectors.mjs:42` — `discoverProjects(home, frameworkRoot)` — REUSE as-is
- `scripts/dashboard/collectors.mjs:172` — `summarizeActivity(traces)` — REUSE as-is
- `scripts/dashboard/collectors.mjs:155` — `summarizeHealth(baseline, halt, gateTrips)` — REUSE as-is
- `scripts/dashboard/collectors.mjs:112` — `summarizeBoard(waves)` — REUSE as-is
- `scripts/dashboard/collectors.mjs:195` — `collectProject(projectPath)` — REUSE as-is
- `scripts/statusline-jidoka.mjs:20` — ANSI color conventions (`\x1b[32m`, `\x1b[31m`, `\x1b[33m`) — EXTEND (adopt same codes)
- `scripts/run-state.mjs:41` — `initState(wave, task, now)` — EXTEND: add optional `terminalId` field
- `scripts/run-state.mjs:91` — `saveState(root, state)` — no change needed; field rides on the state object
- `scripts/dashboard/serve.mjs:14` — import pattern for collectors — reference only, no change
- `docs/specs/` directory — does not exist; create for this spec

---

## 3. Architecture

```
scripts/
  tui-top.mjs                  ← entry: args, raw-mode, poll loop, alt-screen lifecycle
  dashboard/
    collectors.mjs             ← REUSE unchanged
    tui-render.mjs             ← NEW: pure renderer — receives snapshot, returns string array
```

**Data flow**

```
tui-top.mjs
  1. parse args (--project <name>, --interval <ms>)
  2. detect TTY → if not TTY: flat snapshot mode (no ANSI, no loop, exit 0)
  3. write launch record → docs/audits/tui-panel-launches.jsonl
  4. enter alternate screen + hide cursor
  5. on SIGTERM / SIGINT / q: restore screen + cursor, exit 0
  6. loop (default 5 s, env JIDOKA_TOP_INTERVAL overrides):
       a. stamp collectedAt = new Date().toISOString()
       b. snapshot = collectProject(projectPath)   ← from collectors.mjs
       c. cols = process.stdout.columns ?? 80
       d. lines = renderFrame(snapshot, collectedAt, cols)  ← from tui-render.mjs
       e. process.stdout.write('\x1b[H' + lines.join('\n'))
```

**tui-render.mjs — pure functions only**

- `renderFrame(snapshot, collectedAt, cols)` — returns `string[]`, one entry per output line
- `renderHaltBanner(halt)` — full-width box using `┌┐└┘─│` chars
- `renderStuckSection(waves)` — if any wave has status `stuck`
- `renderBoard(board, cols)` — Kanban columns at cols >= 100, linear list at cols < 100
- `renderTerminals(waves)` — only if at least one wave has `terminalId` set
- `renderActivity(activity)` — last 5 entries (not 8; cap at 5 for narrow-terminal safety)
- `renderFooter(cols)` — `q выход · r обновить · ← → проект`
- No `Date.now()` calls. No `process.stdout` writes. No `fs` reads. Receives pre-stamped data.

**ANSI color map** (matches statusline-jidoka.mjs exactly)

| State | Code |
|---|---|
| green / done | `\x1b[32m` |
| amber / running | `\x1b[33m` |
| red / stuck / halt | `\x1b[31m` |
| grey / pending | `\x1b[90m` |
| reset | `\x1b[0m` |

**run-state.mjs change** (one line at line 42)

```
// before
return { wave, task, phases, current, events, createdAt, updatedAt };

// after
const terminalId = process.env.TERM_SESSION_ID ?? process.env.ITERM_SESSION_ID ?? null;
return { wave, task, phases, current, events, createdAt, updatedAt, terminalId };
```

Old `state.json` files without `terminalId` remain valid — `loadState` uses `JSON.parse` with no schema validation (confirmed run-state.mjs:99).

---

## 4. Component inventory

| File | Action | Reason |
|---|---|---|
| `scripts/dashboard/collectors.mjs` | Reuse | All data collection already here — [collectors.mjs:42,112,155,172,195] |
| `scripts/statusline-jidoka.mjs` | Extend | ANSI color codes adopted verbatim — [statusline-jidoka.mjs:22-23] |
| `scripts/run-state.mjs` | Extend | Add `terminalId` to `initState` — [run-state.mjs:41-43] |
| `scripts/tui-top.mjs` | Create | Entry point — poll loop, raw mode, alt-screen, keyboard, launch log |
| `scripts/dashboard/tui-render.mjs` | Create | Pure renderer — fixture-tested, `--self-test` flag |
| `package.json` | Extend | Add `"jidoka:top": "node scripts/tui-top.mjs"` |

---

## 5. Implementation phasing

Wave is under 600 words, estimated diff < 150 LOC across 4 files, 7 ACs. Tasks file is not required by wave-59 threshold; phasing is inline.

- **wave-tui-top.1** — `scripts/run-state.mjs`: add `terminalId` line + new self-test case; verify existing 19 self-tests still pass
- **wave-tui-top.2** — `scripts/dashboard/tui-render.mjs`: all pure renderer functions + `--self-test` covering all 6 screen states with fixture data
- **wave-tui-top.3** — `scripts/tui-top.mjs`: entry point (poll loop, alt-screen, keyboard, launch log) + `package.json` script

LOC limits: `tui-top.mjs` <= 120 LOC, `tui-render.mjs` <= 400 LOC, each render function <= 80 LOC.

---

## 6. Acceptance criteria (EARS notation)

### run-state.mjs patch [carto + micro]

1. When `initState` is called and `TERM_SESSION_ID` is set in the environment, the returned state object shall include `terminalId` equal to that value. [micro]
2. When `initState` is called and neither `TERM_SESSION_ID` nor `ITERM_SESSION_ID` is set, the returned state object shall include `terminalId: null`. [micro]
3. When `loadState` reads an existing `state.json` that has no `terminalId` field, it shall return the state object without error and `terminalId` shall be `undefined`. [carto]
4. The `scripts/run-state.mjs --self-test` command shall exit 0 with all 19 prior test cases passing plus the new `terminalId` test case. [synthesis]

### tui-render.mjs — screen states [ux]

5. When `renderFrame` receives a snapshot with `health.halt === true`, the output lines shall include a full-width banner containing the string `СТОП` before any board content. [ux]
6. When `renderFrame` receives a snapshot with at least one wave whose status is `stuck`, the output shall include a `ЗАВИСЛО` section above the board section. [ux]
7. When `renderFrame` receives a snapshot with `waves.length === 0`, the output shall include the string `Нет активных волн` and a `НЕДАВНО ЗАВЕРШИЛИСЬ` section (empty if no recent waves). [ux]
8. When `renderFrame` is called with `cols < 100`, the board section shall render as a linear list (one wave per line with symbol, stage, and progress %) instead of Kanban columns. [ux + macro]
9. The `scripts/dashboard/tui-render.mjs --self-test` command shall exit 0 having exercised all six screen states (normal, halt, empty, multi-project header, narrow, non-TTY flat) with fixture data only (no `fs` reads). [micro]

### tui-top.mjs — entry and lifecycle [micro + macro]

10. When `tui-top.mjs` is run and `process.stdout.isTTY` is false, it shall emit a plain-text snapshot (no ANSI codes, no box-drawing chars) and exit 0. [macro]
11. When `tui-top.mjs` enters the poll loop, it shall write `\x1b[?1049h` (alternate screen) before the first frame and `\x1b[?1049l` (restore screen) on exit via `q`, SIGTERM, or SIGINT. [macro]
12. When the user presses `q`, the terminal shall be restored to its prior state (no orphaned alternate screen, cursor visible) and the process shall exit 0 within 200 ms. [macro + ux]
13. When `tui-top.mjs` starts, it shall append one record `{ ts, project, wavesInFlight, stuckCount }` to `docs/audits/tui-panel-launches.jsonl` (append-only, creates file if absent). [synthesis — Kaizen metric]
14. When a wave in the displayed board has a non-null `terminalId`, the ТЕРМИНАЛЫ section shall render that wave's name alongside its terminal identifier string. [micro + ux]

### Verification commands

```bash
# run-state patch
node scripts/run-state.mjs --self-test
# exit 0, grep for "terminalId" test passing

# tui-render pure self-test
node scripts/dashboard/tui-render.mjs --self-test
# exit 0, no fs reads, all 6 fixture states covered

# TTY detection (non-TTY path must emit no ANSI)
node scripts/tui-top.mjs | cat | grep -P '\x1b' && echo "FAIL: ANSI in pipe" || echo "PASS"

# Alt-screen lifecycle: run for 1 tick then send q
echo q | node scripts/tui-top.mjs
# check exit code 0

# Kaizen log created
node scripts/tui-top.mjs &; sleep 1; kill %1
cat docs/audits/tui-panel-launches.jsonl | tail -1 | node -e "const l=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(l.ts && l.project ? 0 : 1)"
```

---

## 7. Mission Compass cross-check

This is a framework dev-system tool, not a product surface. The Mission template (`docs/MISSION.md`) is a placeholder. Answers use the jidoka dev-system compass instead.

1. **Strengthens a role position?** Yes — developer / framework operator. The panel surfaces pipeline state that was previously invisible, directly strengthening the operator's ability to see and respond.
2. **Work passes through a value path?** N/A — this is dev-system tooling (framework meta), not a product funnel stage. Confirmed in discovery note and MICRO brief.
3. **Human stays in approval seat?** Yes — view-only panel. No mutations. No agent is dispatched from this surface.
4. **Respects role scope?** Yes — reads `docs/runs/`, `docs/audits/`, `docs/evals/` in the target project only. No cross-project writes.
5. **Primary interaction pattern?** N/A — this is a CLI tool, not a chat-first or API-first product surface. Rationale: dev-system infrastructure.

---

## 8. Open questions and risks

- **[RESOLVED — ADR-inline-01]** MACRO recommended Bubbletea (Go). Decision: raw ANSI / Node built-ins. Patterns adopted, framework dependency rejected.
- **[RESOLVED]** Session id source: use `TERM_SESSION_ID` (standard tmux/screen/iTerm2) OR `ITERM_SESSION_ID` as fallback, then `null`. A jidoka-generated UUID at `--init` time is deferred to post-MVP (Micro question 1). The `null` case is valid and handled in AC-2 and AC-3.
- **[RESOLVED]** Multi-project: MVP targets cwd-detected single project. `--project <name>` flag is deferred to post-MVP (Micro question 2), but the ← → key binding in the footer is rendered as a static label (non-functional at MVP).
- **[OPEN]** `docs/audits/tui-panel-launches.jsonl` — does the `docs/audits/` directory exist in the framework root? If not, `tui-top.mjs` must create it (`mkdirSync` with `recursive: true`) before the append. Implementer: check at launch time.
- **[OPEN]** Surfaces-brief (`wave-tui-top_SURFACES.md`) was not present at spec time (file not found). The Cartographer verdict was therefore reconstructed from Micro+Macro+code grepping. Implementer: if the Surfaces brief is published before build starts, verify no new DUPLICATE-BLOCK verdicts exist.
- **[RISK]** `process.stdout.columns` may change if the user resizes the terminal mid-session. The render loop already reads it fresh on every tick (step 5c in §3), so resize is handled automatically — but a resize mid-write can produce a torn frame. Mitigation: listen to `process.stdout` `'resize'` event and trigger an immediate repaint.

---

## TL;DR

- We are building `jidoka top`: a live terminal dashboard that shows which pipeline waves are running, which are stuck, and which terminal is running each wave.
- The developer types `npm run jidoka:top` and sees the full pipeline state refresh every 5 seconds, with stuck waves shown first.
- Each wave will also record which terminal window it started in, so the panel can show "wave-auth is running in tmux window 3".
- Nothing can be launched or changed from this panel — it is read-only.
- We reuse the data collection code that already exists in `collectors.mjs`; the new code is only the terminal drawing logic and the one-line session-id addition to `run-state.mjs`.
