---
name: dev-pipeline
description: |
  Senior-engineering flow for any non-trivial development in ANY repository: a new feature,
  project, endpoint, auth flow, integration, data model, or a change touching logic in more than
  one file. Triggers: "хочу фичу", "хочу добавить", "сделай фичу", "разработай", "реализуй",
  "построй", "новый проект", "build a feature", "add a feature", "implement", "start a project".
  Runs business questions → spec → tests → code → gates → debug → memory instead of jumping to code.
---

# Dev Pipeline

Ты оркестратор. Исполнители: `backend-agent`, `frontend-agent`, `reflexion-critic`,
`debate-prosecutor` / `debate-defender` / `debate-judge` и встроенный `general-purpose` для
разведки и черновиков. Остальное делают скрипты движка (`~/.claude/jidoka/scripts/`, в продукте
`<проект>/.jidoka/scripts/`). Роли архитекторов, CPO, UX, data, devops удалены 2026-10-10: за 30
дней их не вызвали ни разу, их работу делаешь ты сам с этими скриптами.

**Состав шагов под задачу:** `orchestration-planner.mjs --task '{"risk":"trivial|normal|critical","surfaces":["backend","frontend","data","deploy"]}'`.
Тривиальная правка: сразу код и гейт. Не гоняй полный поток на мелочи.

**Журнал прогона (переживает сброс контекста):** `run-state.mjs --init <wave-id> --task '{…}'`,
после каждой фазы `run-state.mjs --advance <wave-id> --phase <фаза> --status done|failed`, в начале
каждой сессии `run-state.mjs --resume`.

## Поток

0. **North Star.** Есть `docs/NORTH_STAR.md`? Нет: заполнить из шаблона вопросами владельцу, не
   выдумывать. Есть: фича помогает / нейтральна / противоречит. Противоречит: стоп и решение
   владельца. Проверка: `northstar-check.mjs --doc docs/NORTH_STAR.md`. Есть
   `docs/PROJECT_CHARTER.md`: сверить план `charter-check.mjs --doc … --plan …`.

1. **Бизнес-вопросы (самый важный шаг).** Через AskUserQuestion: кто пользуется, зачем,
   ограничения, критерии успеха, краевые случаи. Обязательно вопрос Kaizen: какую метрику фича
   двигает, как её мерить, как продукт учится на реальном использовании. Для визуальной фичи там же
   подтвердить форму (набросок вариантов) и стек. Ответы записывать в
   `clarify-engine.mjs --feature <wave-id> --answer <категория> "<текст>"` (`--plan` покажет, что
   ещё не выяснено). Спека пишется, когда покрытие COMPLETE.

2. **Мастер-спека.** Пишешь сам в `docs/specs/{wave-id}_MASTER_SPEC.md`: цепочка предков через
   `get-spec-context.mjs --feature <x>`; «это уже есть?» поиском по коду; при нужде параллельно два
   `general-purpose` агента: один смотрит продукт изнутри, второй рынок и конкурентов. Живой голос
   пользователя: `/last30days <тема>` в `docs/specs/briefs/{wave-id}_SIGNAL.md`. Каждое требование
   привязано к метрике. Критерии приёмки сразу как исполнимые проверки.

3. **Тесты до кода.** Скилл `test-driven-development`: тесты из критериев приёмки, красные до правки.

4. **Код.** Порядок: контракт и модель данных → `backend-agent` → `frontend-agent` против РЕАЛЬНОГО
   контракта. Данные и метрика: `general-purpose` с задачей в промпте. Перед параллельной записью
   `parallel-guard.mjs --agents '[…]'`, пересечения в worktree. Контекст исполнителю одним файлом:
   `shard-story-bundle.mjs --feature <wave-id> --wave <wave-id> --task build`. В задании агенту прямым
   текстом: «типы и сборку не запускай, их сделает координатор».

5. **Гейты.** `reflexion-critic` (соответствие спеке); `execution-gate.mjs --run` (реальный прогон,
   а не статика); недоверенный код через `sandbox-run.mjs --scope <dir> --cmd "<тест>"`;
   `coverage-gate.mjs`, `dependency-audit.mjs` для бэкенда; видимое смотреть в браузере. На критичном
   и на аналитических вопросах (`debate-trigger.mjs`): дебаты prosecutor → defender → judge через
   `debate-engine.mjs`. Приёмка независимой свежей сессией: `acceptance-verdict.mjs <wave-id>`, без
   зелёного `verdict.json` волна не закрывается.

6. **Дебаг.** Скилл `systematic-debugging`. Возврат гейт → дебаг → гейт:
   `gate-loopback.mjs --phase gate --verdict pass|fail --rounds <n>`, на 5-м провале стоп и владелец.

7. **Запуск** (если есть прод-цель): сначала путь отката, потом выкладка и наблюдение за метрикой.
   Нет прод-цели: честно «готово к запуску».

8. **Память и Kaizen.** `extract-retro-memory.mjs` извлекает урок, устойчивые факты в mcp__memory.
   После запуска прочитать реальную метрику и решить следующую итерацию.

## Границы

Агенты предлагают, merge решает человек. Эскалация: неясная спека, нарушение миссии, серьёзная
находка безопасности, неуверенный крупный фикс. Есть `.jidoka/` в проекте: пользоваться его
гейтами и не обходить их.
