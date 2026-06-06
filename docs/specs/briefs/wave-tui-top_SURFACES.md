# Surfaces Brief — wave-tui-top (Cartographer)

> Восстановлено оркестратором из результата surface-cartographer (агент вернул бриф текстом,
> файл не записал). Содержимое — вердикт картографа дословно, сокращено.

## Вопрос: «это уже существует где-то в кодовой базе?»

## Найденные соседние реализации

| Файл | Строки | Что делает | Вердикт |
|---|---|---|---|
| `scripts/dashboard/collectors.mjs` | 42-58 | `discoverProjects(home, frameworkRoot)` | REUSE as-is |
| `scripts/dashboard/collectors.mjs` | 195-255 | `collectProject(projectPath)` — полный снимок `{ pipeline, board, waves, tasks, health, activity, lessons, timeline }` | REUSE as-is |
| `scripts/dashboard/collectors.mjs` | 71-106 | `summarizePipeline(...)` | REUSE as-is |
| `scripts/dashboard/collectors.mjs` | 112-127 | `summarizeBoard(waves)` | REUSE as-is |
| `scripts/dashboard/collectors.mjs` | 155-163 | `summarizeHealth(...)` → `{ level, evalPct, halt }` | REUSE as-is |
| `scripts/dashboard/collectors.mjs` | 172-179 | `summarizeActivity(traces)` | REUSE as-is |
| `scripts/dashboard/serve.mjs` | 1-141 | HTTP-дашборд + SSE — другой канал доставки | UNRELATED, не дублировать |
| `scripts/statusline-jidoka.mjs` | 20-28 | ANSI-конвенции (`\x1b[32m` зелёный, `\x1b[31m` красный, `\x1b[33m` жёлтый) | EXTEND (та же манера, без библиотек) |
| `scripts/run-state.mjs` | 41-43 | `initState` — нет `terminalId` | EXTEND (+1 опциональное поле) |
| `scripts/run-state.mjs` | 91-97 | `saveState` — смена формы non-breaking | EXTEND (поле едет само) |
| `scripts/current-wave-status.mjs` | 1-130 | статический Markdown-снимок волны | UNRELATED |

## Проверенные алиасы (всё пусто — дубля нет)

- `tui`, `tui-top`, `tui-render`, `jidoka top` — реализации нет
- `setInterval`, `--watch`, `--follow`, `--live`, polling — нет существующего цикла опроса
- `\x1b[2J`, `\x1b[H`, `clearLine`, `moveCursor` — нет полноэкранного ANSI-рендера
- `TERM_SESSION_ID`, `ITERM_SESSION_ID`, `CLAUDE_SESSION_ID`, `tty`, `ppid`, `terminalId` — session id нигде не хранится
- `blessed`, `ink`, `cli-table`, `ora`, `terminal-kit` — TUI-фреймворков в package.json нет
- `discoverProjects` — единственная каноническая реализация (collectors.mjs:42)

## Вердикт

**EXTEND** для слоя данных, **NEW** только для двух файлов: `scripts/tui-top.mjs` (entry)
и `scripts/dashboard/tui-render.mjs` (pure renderer). Расширение `run-state.mjs:41` — одно поле.
npm script: `"jidoka:top"` (двоеточная схема, как принято).

DUPLICATE-BLOCK вердиктов нет — мастер-спека wave-tui-top_MASTER_SPEC.md им не противоречит
(open-вопрос спеки «проверить Surfaces-бриф перед build» закрыт этим файлом).
