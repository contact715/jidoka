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

1. **Сначала бизнес-вопросы (+ Kaizen-вопрос).** Пойми ЧТО и ЗАЧЕМ до того как КАК. Через
   AskUserQuestion уточни бизнес-логику, пользователей, ограничения, критерии успеха. И
   ОБЯЗАТЕЛЬНО задай Kaizen-вопрос: какую бизнес-метрику эта фича/продукт двигает
   (конверсия / скорость / выручка / удержание), КАК мы её измерим, и КАК продукт учится на
   реальном использовании и улучшается дальше (метрика с трендом + петля обратной связи).
   Продукт, который выкатили и забыли — это автоматизация; продукт, который улучшается
   каждый день — цель. НЕ начинай код без ясности. Это самый важный шаг.

2. **Мастер-спека — ДВЕ команды параллельно.** Дispatch ПАРАЛЛЕЛЬНО (Task tool) обе:
   • **Архитекторы (КАК строить):** micro-architect (взгляд изнутри), macro-architect
     (конкуренты/рынок), surface-cartographer («это уже где-то есть?»), design-system-architect.
     → chief-architect (тимлид) синтезирует архитектурную мастер-спеку.
   • **Продуктовая команда (ЗАЧЕМ и как улучшается):** product-strategist (стратегия/позиционирование),
     business-process-architect (бизнес-процесс клиента → стабильнее/лучше), kaizen-officer (петля
     улучшения продукта + что заложить обратно в jidoka). → chief-product-officer (CPO) синтезирует
     продуктовый бриф.
   chief-architect складывает продуктовый бриф в мастер-спеку: каждая фича привязана к бизнес-метрике
   и петле постоянного улучшения. Дальше — модульные спеки по необходимости.

3. **Тесты до кода.** test-engineer пишет тест-стабы из acceptance criteria спеки.

4. **Код.** Реализатор пишет строго по утверждённой спеке (frontend-agent для UI и т.д.).

5. **Гейты (параллельно).** reflexion-critic (соответствие спеке), constitutional-reviewer
   (миссия), security-scanner. На критичных изменениях — дебаты: debate-prosecutor →
   debate-defender → debate-judge. best-of-N-judge если было несколько попыток.

6. **Дебаг.** debug-agent на провалах тестов (авто-фикс если уверен и мелко, иначе эскалация).

7. **Память.** После волны: skill-extractor извлекает урок; durable-факты в knowledge graph
   (инструменты mcp__memory). Между сессиями ничего не забывается — это и есть память команды.

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
