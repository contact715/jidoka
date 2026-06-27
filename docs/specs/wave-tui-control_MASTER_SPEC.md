---
status: Approved
version: 1.0.0
level: L4
type: wave
wave: wave-tui-control
owner_role: platform
parents:
  - path: docs/specs/domains/observability.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# wave-tui-control Master Spec — `jidoka top` becomes a control panel

**Status**: Approved
**Risk**: normal · **Surfaces**: engine (TUI)
**Parent surface**: wave-tui-top (read-only panel) — this wave adds the HANDS.

## Goal

`jidoka top` today is a monitor: it shows waves, stuck states, the HALT banner — but the
operator still has to leave the panel and type commands to act. This wave turns it into a
control panel: select a wave with arrows, act with single keys. Every action reuses an
EXISTING mechanism (andon-resume.mjs, run-state.mjs --advance, Terminal.app) — the panel
adds zero new state machinery, only an operator surface over what's already there.

**Kaizen metric**: operator round-trip from "I see the problem in the panel" to "the fix
command is running" — baseline: leave panel, recall command syntax, type it (~minutes);
target: ≤ 10 seconds (select + key + confirm). Measurement: `docs/audits/tui-actions.jsonl`
append-only log `{ts, action, wave, ok}` written by the action layer; panel-launch log
already exists.

## Architecture (REUSE-first)

| Piece | File | Status |
|---|---|---|
| Key state machine + overlays (PURE) | `scripts/dashboard/tui-control.mjs` | NEW |
| Action executor + command builders | `scripts/dashboard/tui-actions.mjs` | NEW |
| Per-wave duration + token cost | `scripts/dashboard/wave-cost.mjs` | NEW |
| Renderer: selection, cost column, footer | `scripts/dashboard/tui-render.mjs` | EXTEND |
| Shell: stdin wiring, effect dispatch | `scripts/tui-top.mjs` | EXTEND |
| Halt resume mechanism | `scripts/andon-resume.mjs` | REUSE as-is |
| Phase advance mechanism | `scripts/run-state.mjs --advance` | REUSE as-is |
| Snapshot collection | `scripts/dashboard/collectors.mjs` | REUSE as-is |

Purity contract preserved: `tui-render.mjs` and the reducer in `tui-control.mjs` stay pure
(no fs / Date.now / stdout). All side effects live in `tui-actions.mjs` and the shell.

## Key map (shown in footer, Russian)

- `↑/↓` — выбор волны на доске
- `Enter` — продолжить выбранную волну: открыть вкладку Terminal с `claude "/jidoka-resume <wave>"`
- `n` — новая волна: ввести задачу → вкладка Terminal с `claude "/jidoka-plan <task>"`
- `s` — снять СТОП: ввести причину → `andon-resume.mjs --wave --approver operator-tui --reason --root-cause`
- `g` — перезапустить упавший этап выбранной волны: confirm → `run-state --advance --status pending --note "re-run by operator (tui)"`
- `p` — пропустить текущий этап: confirm → `run-state --advance --status done --note "skipped by operator (tui)"`
- `l` — лог: хвост последнего транскрипта проекта (последние реплики агента)
- `$` — деньги/время: окно с per-wave длительностью, токенами и ≈стоимостью
- `r` — обновить · `q` — выход (unchanged)
- Confirm mode: `y/Enter` да, `n/Esc` нет. Input mode: текст, Backspace, `Enter` ок, `Esc` отмена.

## Acceptance Criteria

- AC-1 reducer: ↑/↓ move selection within waves bounds; selection survives redraw.
- AC-2 reducer: `s` enters input mode; submitted reason yields a `resumeHalt` effect with that reason; Esc cancels with no effect.
- AC-3 reducer: `g` on a wave with a failed phase yields confirm→`advance{status:pending}` targeting THAT phase; on a wave with no failed phase it targets the current phase.
- AC-4 reducer: `p` yields confirm→`advance{status:done, note contains "skip"}` for the current phase; declined confirm yields no effect.
- AC-5 reducer: `n` enters input mode; submitted text yields `openTerminal` effect whose command contains `/jidoka-plan` and the text; Enter on a selected wave yields `openTerminal` with `/jidoka-resume <wave>`.
- AC-6 builders: AppleScript command builder escapes `"` and `\` so arbitrary task text cannot break out of the osascript string (injection-safe).
- AC-7 actions: every executed action appends `{ts, action, wave, ok}` to `docs/audits/tui-actions.jsonl`.
- AC-8 cost: pure cost math prices opus/sonnet/haiku usage blocks (input, output, cache read/write) and is covered by self-test; panel labels values as ≈ estimates.
- AC-9 render: board marks the selected wave; footer lists the new keys; overlay boxes (confirm/input/log/cost) render as the LAST lines of the frame.
- AC-10 purity: renderer + reducer contain no fs/Date.now/process.stdout (existing purity self-test pattern extended).
- AC-11 degraded: non-TTY flat mode unchanged; all new keys are no-ops when the data they need is absent (no crash on empty board).

## Non-goals

- Web UI / remote access (explicitly deferred by owner, 2026-06-05).
- Pausing a live Claude session from the panel (no such control plane exists).
- Automatic wave execution without a terminal — launching opens a Terminal tab the
  operator confirms with Enter; the panel never silently spends tokens.

## Honest boundaries

- "Re-run phase" marks the phase `pending` in the journal — the actual re-execution
  happens when an orchestrator session resumes the wave (Enter does exactly that).
- Cost is an ESTIMATE from transcript usage blocks within the wave's time window;
  transcripts are per-project, so parallel sessions in one project window inflate it.
  Labeled ≈ in the UI.
