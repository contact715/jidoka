# Agentic Engineering Framework для Claude Code — оценка системы

Это оценка **фреймворка разработки, который мы построили поверх Claude Code**. Не продукта, а самой среды: набора агентов, навыков, скриптов, конституции и гейтов, которые заставляют Claude Code писать код дисциплинированно, как команда senior-инженеров с code review, а не как одиночный ассистент.

Документ описывает, что реально работает, как это соотносится с практиками топовых AI-лабораторий (Anthropic, OpenAI, Google DeepMind), и где честные границы. Принцип: только проверяемое в коде. Цифры можно проверить командами в конце.

---

## Что это вообще такое

Claude Code из коробки — это один агент, который пишет код по запросу. Мы превратили его в **многоагентный инженерный конвейер**: над каждой нетривиальной задачей работают архитекторы (пишут спеку), параллельные реализаторы (N вариантов), судья (выбирает лучший по качеству), прокурор и защитник (состязательная проверка), восемь качественных гейтов и человек в кресле одобрения. После коммита система учится на результате и улучшает сама себя.

Механически это собрано из родных возможностей Claude Code (subagents, skills, hooks, slash-команды, settings) плюс слой скриптов-движка и корпус документов-правил.

---

## Карта: наш механизм → исследовательский паттерн → кто это применяет

| Что реализовано | Файл во фреймворке | Industry-паттерн | Источник |
|---|---|---|---|
| Конституция + Constitutional Reviewer (блокирует диспатч при нарушении) | `docs/CONSTITUTION.md`, `.claude/agents/constitutional-reviewer.md` | **Constitutional AI** | Anthropic (Bai et al., 2022) |
| Дебаты prosecutor / defender / judge, 3 раунда | `.claude/agents/debate-*.md` | **Multi-Agent Debate** | Du et al., 2023; Irving et al., OpenAI 2018 |
| Best-of-N Judge — выбор лучшего из N реализаций | `.claude/agents/best-of-N-judge.md` | **Best-of-N sampling** | AlphaCode, DeepMind (Li et al., 2022) |
| Reflexion Critic — adversarial review каждого коммита | `.claude/agents/reflexion-critic.md` | **Reflexion (verbal RL)** | Shinn et al., 2023 (NeurIPS) |
| 8 гейтов L0.95–L0.99 (security, coverage, a11y, perf, constitutional) | `.claude/agents/*-auditor.md` | **Process supervision / PRM** | OpenAI, Lightman et al., 2023 |
| Andon-halt, верифицированный в TLA+ | `docs/formal/AndonHalt.tla`, `scripts/run-tla.mjs` | **Formal verification** | Lamport TLA+; AWS, Azure |
| Skill Extractor — накопление навыков из ретро | `.claude/agents/skill-extractor.md`, `.claude/skills/` | **Skill library** | Voyager, NVIDIA (Wang et al., 2023) |
| Self-Improvement Reviewer — кросс-волновые паттерны | `.claude/agents/self-improvement-reviewer.md` | **Meta-learning / self-improvement** | — |
| 5-уровневая иерархия спеков (L0→L4) | `docs/HIERARCHICAL_SPEC_SYSTEM.md` | **Spec-driven development / MDA** | Karpathy; OMG MDA |
| EARS acceptance criteria | `.claude/skills/ears-acceptance-criteria.md` | **Requirements engineering** | EARS (Mavin et al.) |
| DORA-метрики | `scripts/compute-dora.mjs` | **DORA / DevOps Research** | Google DORA; "Accelerate" |
| SLO + error budgets | `scripts/compute-slos.mjs` | **SRE** | Google SRE |
| Chaos / fuzz / differential testing | `scripts/chaos-inject.mjs`, `run-fuzz.mjs` | **Chaos engineering** | Netflix |
| Prompt-injection detection | `scripts/detect-injection.mjs` | **LLM security** | OWASP LLM Top 10 |
| Quality-first выбор (Jidoka) + Kaizen-петли | `docs/TOYOTA_WAY.md` | **Toyota Production System** | Ohno; Liker |

---

## По слоям: что реализовано и как работает

### 1. Конституционное управление (Constitutional AI)

`docs/CONSTITUTION.md` — исполняемый контракт, не декларация. Есть формальный процесс поправок, и `constitutional-reviewer` проверяет каждую задачу против 5 вопросов Mission Compass. Нарушение блокирует на P0. Прямой аналог Constitutional AI: поведение направляется явным сводом принципов, против которого идёт критика, а не дообучением.

### 2. Многоагентная верификация (Debate + Best-of-N + Reflexion)

Три независимых механизма из работ топ-лабораторий:
- **Дебаты** — prosecutor строит довод «здесь баг/нарушение», defender защищает, judge выносит PASS/REVISE/BLOCK/DEADLOCK.
- **Best-of-N** — N параллельных реализаций одной спеки, judge выбирает лучшую по **качеству решения** (архитектурная когерентность, maintainability, устойчивость к краевым случаям, долговечность), а не по «прошло и покороче».
- **Reflexion** — после коммита критик читает diff против спеки, прогоняет 3 гейта, выдаёт вердикт с итерацией.

Все три работают: при создании Toyota-слоя Spec Reviewer поймал дефект в формуле выбора, reflexion-critic нашёл латентную двусмысленность в инварианте — оба до коммита.

### 3. Качественные гейты (Process Supervision)

Восемь гейтов L0.95–L0.99: security-scanner (npm audit + semgrep + trufflehog), coverage-auditor, a11y-auditor (axe-core), perf-profiler (бандл-бюджет), constitutional-reviewer, pfca-agent (pre-flight checklist), meta-process-auditor (рецидив анти-паттернов), integration-tester / visual-qa. Это инженерный аналог Process Reward Models: контроль каждого шага, а не только финала.

### 4. Формальная верификация (TLA+)

`docs/formal/AndonHalt.tla` — машина состояний andon-механизма, проверенная модель-чекером TLA+. Формальные методы редко применяют в агентских пайплайнах вообще — это уровень distributed-systems инженерии. Критичный примитив остановки конвейера доказан, а не просто оттестирован.

### 5. Самоулучшение на трёх уровнях

- **Per-commit** — reflexion-critic ловит дефекты сразу.
- **Per-wave** — skill-extractor пишет навык, если паттерн повторился (так накоплен 31 навык; аналог skill-library из Voyager).
- **Per-5-waves** — self-improvement-reviewer читает окно из 5 ретро и ловит паттерны под разными именами, которые per-wave-ридер не увидит.

### 6. Observability как в SRE

`compute-dora` (4 DORA-метрики), `compute-slos` (error budgets), `compute-cost` + `compute-carbon` (стоимость и углеродный след волны), `emit-telemetry` + schema-registry (OpenTelemetry-стиль), детекторы дрейфа, prompt-инъекций и галлюцинаций.

### 7. Дисциплина решений (ADR + spec-first)

Architecture Decision Records (`docs/decisions/`) фиксируют каждое решение с контекстом и последствиями (паттерн Nygard). Ни одна нетривиальная задача не идёт в код без одобренной спеки: 4 архитектора работают параллельно (micro / macro / surface-cartographer / design-system), chief-architect синтезирует master-spec.

---

## Что фреймворк энфорсит в коде

Фреймворк не только организует процесс, но и держит стандарты механически:
- Декомпозиция: файл ≤400 LOC, функция ≤80 LOC, ≤6 useState/useEffect на компонент. Ловит `check:structural` с baseline-ratchet (метрика не может ухудшаться).
- Design-drift аудит (`check:design-drift`): сырые hex, инлайн-стили, хардкод — с ratchet.
- Тесты как гейт: Vitest (unit) + Playwright (e2e, включая визуальную регрессию по теме и брейкпоинтам).

100 npm-команд автоматизируют весь цикл — от `wave:status` до `compute:dora` и `detect:injection`.

---

## Доказательство, что это работает на реальном проекте

Фреймворк прогнан не на демо, а на боевом продукте: **187 волн разработки, 1080 коммитов, 146 спеков, 101 ретроспектива, 35 ADR, 186 unit-тестов, 9 e2e-сценариев**. Сам корпус ретро — это топливо, на котором работают петли самоулучшения.

> ⚠️ Эти числа — из боевого проекта, на котором фреймворк обкатан, **не из этого репозитория** (здесь короткая git-история и `_TEMPLATE`-заглушки вместо корпуса спеков/ретро). Они приведены как свидетельство продакшн-применения, но проверить их командами в этом репо нельзя — verify-блок ниже проверяет только то, что реально лежит здесь (агенты, скиллы, скрипты, TLA+, конституция).

---

## Осознанные решения и roadmap

То, что легко принять за «недоделки», в основном — осознанные архитектурные решения:

- **Человек в кресле одобрения.** Агенты выбирают и предлагают, merge триггерит человек (Mission Compass Q3). Принцип «agents propose, humans approve», не отсутствие автономности.
- **Оркестрация, не training.** Фреймворк работает поверх готового Claude Code; мы не обучаем модели. Сила в дисциплине процесса вокруг SOTA-модели.
- **Поэтапное включение гейтов.** Гейты (включая quality-andon) идут soft → hard: наблюдательный период с накоплением данных, затем жёсткий блок вручную или авто-промоцией (`autoStrengthen` после 3 чистых срабатываний за 7 дней). Toyota-подход: andon включают, когда ложных стопов нет. Andon сейчас в активном soft-trial.
- **Переносимость.** Часть агентов и стандартов содержит примеры из проекта, на котором фреймворк обкатан, — при переносе заменяются своими. Это норма, не привязка.

Roadmap (что расширяется):
- `error-recovery` — pipeline-tier активен (реагирует на halt-states и post-merge сбои без внешних зависимостей). Production-tier (runtime error tracker вроде Sentry) подключается вебхуком, когда нужен мониторинг прод-ошибок.

---

## Как применить у себя

Фреймворк переносим. Минимальный путь:
1. `.claude/agents/` + `.claude/skills/` + `.claude/AGENT_PLAYBOOK.md` — копируются в свой проект; роли и навыки универсальны.
2. `scripts/` — движок (andon, гейты, метрики, детекторы). Часть требует своих baseline.
3. `docs/CONSTITUTION.md` + `docs/MISSION.md` — заменяешь контент на свой продукт, структуру (Mission Compass, разделы) оставляешь.
4. Процессные доки (`AUTONOMOUS_PIPELINE`, `MULTI_LEVEL_VERIFICATION`, `HIERARCHICAL_SPEC_SYSTEM`, `SELF_IMPROVEMENT_PROTOCOL`, `TOYOTA_WAY`) — переносятся как есть.
5. `package.json` scripts-секция — копируешь нужные команды.

---

## Что можно проверить самому

```bash
ls .claude/agents/*.md | wc -l        # агенты
ls .claude/skills/*.md | wc -l        # навыки
ls scripts/*.mjs scripts/*.sh | wc -l # движок
cat docs/formal/AndonHalt.tla         # формальная верификация
cat docs/CONSTITUTION.md              # конституция
cat docs/TOYOTA_WAY.md                # философия качества
cat .claude/agents/best-of-N-judge.md # как выбирается лучшее решение
```

Снимок на 2026-05-29.
