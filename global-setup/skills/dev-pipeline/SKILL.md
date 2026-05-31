---
name: dev-pipeline
description: |
  Full senior-engineering pipeline with the agent team. Use at the START of ANY
  request for a new feature, project, endpoint, auth flow, integration, data model,
  or significant change — in ANY repository. These are ALWAYS non-trivial; do not
  classify them as "simple" to skip the flow. Triggers (broad — match loosely):
  "хочу фичу", "хочу такую фичу", "хочу добавить", "добавь фичу", "добавить",
  "нужна фича", "сделай фичу", "разработай", "построй", "реализуй", "новый проект",
  "build a feature", "add a feature", "start a project", "implement", "develop",
  "I want a feature". Runs the flow business-questions → master spec → tests → code
  → gates → debug → memory, orchestrating the agent team (architects, frontend,
  reviewers, debate, security) instead of writing code immediately.
---

# Dev Pipeline — веди команду агентов как senior tech lead

When the user starts non-trivial development in ANY project, do NOT jump to code.
Act as the ORCHESTRATOR of a team. Agent roles live in `~/.claude/agents/`; the full
team structure is `~/.claude/jidoka/docs/AGENT_ROSTER.md`, the flow is `AUTONOMOUS_PIPELINE.md`,
the spec system is `HIERARCHICAL_SPEC_SYSTEM.md`, the mission/constitution are alongside.

## Поток (для каждой нетривиальной задачи)

> **Композиция графа под задачу:** `node ~/.claude/jidoka/scripts/orchestration-planner.mjs --task
> '{"risk":"...","surfaces":[...]}'` подбирает, какие из шагов ниже реально нужны (trivial → пропустить
> архитекторов; critical backend → + дебаты + security; нет frontend → без a11y/visual-qa). Не гоняй
> полный поток на тривиальной правке — пусть планировщик соберёт минимальный граф.

0. **North Star — общая цель и философия продукта (САМЫМ ПЕРВЫМ).** До бизнес-вопросов конкретной
   фичи проверь: есть ли у продукта `docs/NORTH_STAR.md`? Нет → CPO заполняет его из
   `docs/NORTH_STAR_TEMPLATE.md` (или глобального `~/.claude/jidoka/NORTH_STAR_TEMPLATE.md`), задавая вопросы о бизнес-цели (зачем продукт существует, цель на
   1-3 года, принципы, инварианты, что НЕ делаем) — не выдумывай, спрашивай. Есть → сверяйся. Затем
   прогони фичу через gate: служит ли она North Star — помогает / нейтрально / противоречит.
   Противоречит → andon, стоп и решаем (фича меняется ИЛИ North Star меняется осознанно и
   логируется, никогда молча). Бизнес-процессы в шагах ниже ВЫВОДЯТСЯ из инвариантов North Star, а
   не берутся как данность. `node ~/.claude/jidoka/scripts/northstar-check.mjs --doc <проект>/docs/NORTH_STAR.md`
   проверяет, что документ есть и заполнен.

0.5. **Федерация — говори со СТРАЖЕМ проекта, не лезь в файлы напрямую.** Если работаешь ВНУТРИ
   проекта (Mosco, Castells, любой — не в самом фреймворке): найди `project-steward` проекта и
   прочитай его `docs/PROJECT_CHARTER.md` (+ North Star). Прежде чем что-то менять, предъяви ПЛАН
   стражу. Он прогоняет Defense Process: helps/neutral → ок (маршрутизирует к агентам проекта);
   **conflicts → расследование** (intent → breach → reject / adapt / evolve-philosophy), НИКОГДА
   молча. Нет charter → страж создаёт из `PROJECT_CHARTER_TEMPLATE.md`. Проверка:
   `node <проект>/.jidoka/scripts/charter-check.mjs --doc <проект>/docs/PROJECT_CHARTER.md --plan <план>`
   (контракт есть + план привязан). Двусторонне: страж может и сам прислать задачу фреймворку. Не
   переписывай продукт, противореча его дереву (North Star → Charter → фичи) — это защита целостности.

1. **Бизнес-вопросы по фиче (+ Kaizen-вопрос).** Пойми ЧТО и ЗАЧЕМ до того как КАК. Через
   AskUserQuestion уточни бизнес-логику, пользователей, ограничения, критерии успеха. И
   ОБЯЗАТЕЛЬНО задай Kaizen-вопрос: какую бизнес-метрику эта фича/продукт двигает
   (конверсия / скорость / выручка / удержание), КАК мы её измерим, и КАК продукт учится на
   реальном использовании и улучшается дальше (метрика с трендом + петля обратной связи).
   Продукт, который выкатили и забыли — это автоматизация; продукт, который улучшается
   каждый день — цель. На этом же шаге user-researcher проверяет JTBD и риск-предположения
   (есть ли реальный пользователь и боль, или это догадка). НЕ начинай код без ясности. Это самый важный шаг.

2. **Мастер-спека — ДВЕ команды параллельно.** Дispatch ПАРАЛЛЕЛЬНО (Task tool) обе:
   • **Архитекторы (КАК строить):** micro-architect (взгляд изнутри), macro-architect
     (конкуренты/рынок), surface-cartographer («это уже где-то есть?»), design-system-architect.
     → chief-architect (тимлид) синтезирует архитектурную мастер-спеку.
   • **Продуктовая команда (ЗАЧЕМ и как улучшается):** user-researcher (JTBD/валидация),
     product-strategist (стратегия/позиционирование), business-process-architect (as-is процесс
     клиента → целевой ИЗ инвариантов North Star → разрыв и путь перехода), kaizen-officer (петля улучшения + что заложить обратно в jidoka),
     data-lead (как измерим метрику). → chief-product-officer (CPO) синтезирует продуктовый бриф.
   • **Дизайн (как это ощущается):** ux-designer (потоки + ВСЕ состояния экранов), ux-writer
     (интерфейсный копирайтинг), под design-system-architect (токены/контракт). → UX-бриф.
   chief-architect складывает продуктовый и UX-бриф в мастер-спеку: каждая фича привязана к
   бизнес-метрике и петле постоянного улучшения. Дальше — модульные спеки по необходимости.

3. **Тесты до кода.** test-engineer пишет тест-стабы из acceptance criteria спеки.

4. **Код — команда реализации под engineering-lead.** engineering-lead декомпозирует спеку на
   задачи и распределяет: backend-agent (API / БД / серверная логика), frontend-agent (UI по
   дизайн-контракту + UX-потоку), data-engineer (инструментирует метрику + пайплайны). Порядок:
   контракт и модель данных первыми → бэкенд → фронт против РЕАЛЬНОГО контракта, не угаданного.
   **Параллельная запись:** перед одновременным dispatch build-агентов прогони
   `node <проект>/.jidoka/scripts/parallel-guard.mjs --agents '[{slug,write_scope}...]'` — если
   write_scope пересекаются, запусти конфликтующих в git worktree (Agent `isolation:"worktree"`) или
   серийно; непересекающиеся идут параллельно безопасно.

5. **Гейты (параллельно).** reflexion-critic (соответствие спеке), constitutional-reviewer
   (миссия), security-scanner, coverage / a11y / perf. + **execution proof**:
   `node <проект>/.jidoka/scripts/execution-gate.mjs --dir <проект> --run` — РЕАЛЬНО запусти
   тесты/команду проекта и наблюдай, что фича работает (статика tsc/lint = «выглядит верно»,
   прогон = «работает»). Нет теста → REVISE (добавь тест); прогон упал → BLOCK. Недоверенный или
   сгенерированный код исполняй ИЗОЛИРОВАННО:
   `node <проект>/.jidoka/scripts/sandbox-run.mjs --scope <build-dir> --cmd "<test/команда>"` —
   kernel-sandbox (macOS sandbox-exec): запись только в scope, сеть запрещена, побег невозможен на
   уровне ядра. На критичных — дебаты: prosecutor →
   defender → judge. best-of-N-judge если было несколько попыток.

6. **Дебаг.** debug-agent на провалах тестов (авто-фикс если уверен и мелко, иначе эскалация).

7. **Запуск (если есть прод-цель).** devops-lead (окружения, путь ОТКАТА до выката, что мониторим)
   → release-engineer (CI зелёный → версия + changelog → миграции с откатом → выкат + наблюдение,
   откат при регрессии метрики). Нет прод-цели — готовим пайплайн и честно помечаем «готово-к-запуску».

8. **Память + замыкание Kaizen.** skill-extractor извлекает урок; durable-факты в knowledge graph
   (mcp__memory). После запуска data-analyst читает РЕАЛЬНУЮ метрику (двигается ли, почему, что
   дальше) → kaizen-officer замыкает петлю и закладывает переиспользуемый паттерн обратно в jidoka.
   Между сессиями ничего не забывается — это память команды.

## Человек в кресле одобрения

Агенты предлагают — merge триггерит человек. Эскалация на: неоднозначность спеки,
нарушение миссии, high security finding, неуверенный крупный фикс.

## Механические гейты

Если в проекте есть `.jidoka/` или скрипты движка — используй их (meta-audit,
pre-publish-guard, check:structural) и не обходи. Если нет, а нужен enforcement —
предложи установить: `node ~/claude-code-dev-framework/scripts/install-into.mjs <проект>`.

## Масштаб под задачу

Тривиальная правка → сразу код. Нетривиальная → полный поток. «Сделай state of the art» /
вся система → сначала холистический анализ, потом поток.
