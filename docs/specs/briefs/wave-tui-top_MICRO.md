# Wave-tui-top Micro-Brief

## 1. Mission alignment

- Compass question moved: **Genchi Genbutsu** (TOYOTA_WAY.md:85) — "go and see for yourself". The pipeline runs but is invisible in the terminal; the TUI makes it visible at a glance without leaving the shell.
- Philosophy principle reinforced: **Jidoka — built-in quality, stop the line** (TOYOTA_WAY.md:52-58). The Andon halt and per-wave health are surfaced live; a developer sees a halted wave the moment it happens, not after a context reset.
- Dev-System Kaizen metric this touches: time-to-detect a stuck wave. Baseline: requires manual `--resume` scan. Target: under 5 seconds at a glance. Measurement: log of panel launch timestamps vs. first `--advance` after a stuck wave.
- Funnel stage touched: none (framework tooling, not product funnel).

## 2. What already exists

- `scripts/dashboard/collectors.mjs:42` — `discoverProjects(home, frameworkRoot)` discovers all `.jidoka` projects. REUSE as-is.
- `scripts/dashboard/collectors.mjs:195` — `collectProject(projectPath)` returns `{ board, waves, activity, health, tasks, pipeline }`. REUSE: all data the TUI needs is already gathered here.
- `scripts/dashboard/collectors.mjs:112` — `summarizeBoard(waves)` produces column-per-phase layout with wave cards. REUSE directly as the Kanban column renderer.
- `scripts/dashboard/collectors.mjs:172` — `summarizeActivity(traces)` returns the 8 most recent agent actions, newest-first. REUSE for the activity tape.
- `scripts/dashboard/collectors.mjs:155` — `summarizeHealth(baseline, halt, gateTrips)` returns `{ level: 'green'|'amber'|'red', evalPct, recentFails, halt }`. REUSE for the health/andon row.
- `scripts/statusline-jidoka.mjs:20` — `render({ jidoka, evalPct, halt, branch, model })` shows existing ANSI color conventions: `\x1b[32m` green, `\x1b[31m` red. EXTEND: adopt the same escape-code style for the TUI; no new color library.
- `scripts/run-state.mjs:41-43` — `initState(wave, task, now)` returns the shape that `state.json` stores: `{ wave, task, phases, current, events, createdAt, updatedAt }`. Terminal id goes in as an optional top-level field `terminalId`.
- `scripts/run-state.mjs:91-96` — `saveState(root, state)` writes `state.json`. The session-id patch is two lines: read `process.env.TERM_SESSION_ID || process.env.ITERM_SESSION_ID || null` in `initState` and include it in the returned object. No existing consumers read the top-level shape structurally — they read named fields only, so adding a new optional field is non-breaking.
- `scripts/dashboard/serve.mjs:14` — already imports `discoverProjects` and `collectProject`; the TUI duplicates the same import pattern, not the logic.

## 3. What we add vs what we change

| Action | Item | Reason |
|---|---|---|
| Create | `scripts/tui-top.mjs` | New entry point; no equivalent exists |
| Create | `scripts/dashboard/tui-render.mjs` | Terminal ANSI renderer (pure functions, self-tested); keeps tui-top.mjs under 80 LOC |
| Modify | `scripts/run-state.mjs:41` | Add optional `terminalId` to `initState` — read from env, one line |
| Touch | `package.json` | Add `"jidoka:top": "node scripts/tui-top.mjs"` to scripts |

No new npm dependencies. The repo has `framer-motion`, `zustand`, etc. in `package.json:153` but those are for the Next.js product layer. The `scripts/` layer is zero-dependency Node.js (all existing scripts use only `node:fs`, `node:path`, `node:os`, `node:child_process`). TUI must follow the same rule: raw ANSI only.

## 4. Permissions + voice

- Roles that see this: anyone running the framework locally (developer / framework operator). No product role gate needed — this is a dev-system tool, not a product surface.
- Copy register: engineer-to-operator (CONSTITUTION.md:76-91). Labels are short, concrete, named-outcome: "HALTED", "gate FAIL", "build running". No marketing words. Phase names match PHASE_LABEL in collectors.mjs:61.
- Approval seat: view-only panel; no mutations. No approval required to render.

## 5. Smallest shippable slice

- Board view: Kanban columns (discovery→spec→tests→build→gate→debug→memory→Shipped) with wave cards showing progress % and risk. Data from `summarizeBoard`.
- Health row: green/amber/red with halt banner. Data from `summarizeHealth`.
- Activity tape: last 8 agent actions. Data from `summarizeActivity`.
- Auto-refresh loop: `setInterval` polling `collectProject`, clear screen + redraw, interval 3 s (configurable via `JIDOKA_TOP_INTERVAL` env).
- `--self-test` flag: pure renderer tests with fixture data (no fs reads), exits 0 on pass.

Everything else (TERMINALS section showing wave→tty mapping, per-wave drill-down, multi-project switcher) is post-MVP.

## 6. What will break

- **Terminal size assumptions** — ANSI rendering assumes a minimum width of 80 columns. Mitigation: read `process.stdout.columns` at render time; fall back to 80 if undefined (non-TTY pipe or CI). Emit a one-line fallback string if the terminal is too narrow.
- **`initState` shape change** — existing `state.json` files on disk lack `terminalId`. Mitigation: field is optional; all readers (`collectProject`, `loadState`) spread or read named keys only, so absent field reads as `undefined`, not an error. Confirmed: `run-state.mjs:99` uses `JSON.parse` with no schema validation.
- **`Date.now()` in render loop** — the `collectProject` comment at line 254 bans `Date.now()` in pure-render context. The TUI loop is impure (a poll loop), so `Date.now()` is valid there. The pure renderer in `tui-render.mjs` must not call `Date.now()` — it receives a pre-stamped snapshot. Mitigation: stamp `collectedAt` in the poll loop before passing to the renderer.

## 7. Open questions for Chief Architect

- Session id source: `TERM_SESSION_ID` (iTerm2) vs. `ITERM_SESSION_ID` vs. a jidoka-generated uuid written at `--init` time. Should the id be stable across restarts of the same terminal session, or is a wave-scoped uuid sufficient?
- Multi-project: MVP targets a single project (cwd-detected). Should the TUI accept a `--project <name>` flag from day one, or defer to post-MVP?
- Refresh interval: 3 s default feels right for developer use. Any constraint from the `fs.watch` budget already used by `serve.mjs` (serve.mjs:83-100 opens watchers per-project)? The TUI polls, not watches, so no conflict — but worth confirming the Chief Architect agrees with polling over inotify for a terminal context.
