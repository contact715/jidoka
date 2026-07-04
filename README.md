# Jidoka

**Agentic engineering framework для Claude Code.** Превращает Claude Code из одиночного ассистента в многоагентный инженерный конвейер: code review, качественные гейты, формальная верификация, самоулучшение.

Имя — от принципа Toyota **Jidoka** (自働化), «встроенное качество»: дефект не передаётся дальше по линии, а при проблеме линия останавливается (andon). Фреймворк делает то же с кодом — заставляет Claude Code писать дисциплинированно, как команда senior-инженеров, а не «сгенерировал и закоммитил».

## С чего начать читать

**Хочешь сразу собрать что-то (English):** [`QUICKSTART.md`](QUICKSTART.md) — первая сборка за минуты через команды `/jidoka-*`, философию отложи на потом.

Глубже (RU):
1. **`FRAMEWORK_DEEP_DIVE.md`** — подробный разбор: что это, как работает поток задачи от запроса до merge, что даёт, почему уровень топовых лабораторий. **Начни отсюда.**
2. **`docs/ENGINEERING_SYSTEM_ASSESSMENT.md`** — структурированная оценка с маппингом каждого механизма на работы Anthropic / OpenAI / DeepMind.
3. **`docs/CONSTITUTION.md`** — конституция среды (включая §8 Quality-First).
4. **`docs/TOYOTA_WAY.md`** — две философии Toyota (Jidoka + Kaizen), заложенные в процесс.
5. **`.claude/agents/best-of-N-judge.md`** — как из N реализаций выбирается лучшая по качеству, а не по «прошло и покороче».
6. **`docs/AUTONOMOUS_PIPELINE.md`** + **`docs/MULTI_LEVEL_VERIFICATION.md`** — как устроен конвейер и гейты.

## Структура

```
.claude/
  agents/            47 агентов-ролей + _TEMPLATE (вкл. project-steward, spec-custodian, prompt-evolver, red-team — непрерывная самоатака) (полная продуктовая студия: продукт/архитектура/build/дизайн/данные/запуск/качество) (chief-architect, reflexion-critic,
                     best-of-N-judge, debate-*, security-scanner, ...)
  skills/            32 навыка + _INDEX/_TEMPLATE (переиспользуемые паттерны)
  AGENT_PLAYBOOK.md  главный плейбук агентства
  settings.local.json

scripts/             211 скриптов-движка (195 .mjs + 16 .sh в корне; плюс ~22 в подпапках):
                     andon-halt (stop-the-line), run-tla (формальная проверка),
                     compute-dora/slos/cost/carbon (observability),
                     detect-injection/drift/hallucinations (защита),
                     chaos-inject, run-fuzz (тестирование)

docs/
  CONSTITUTION.md            конституция + процесс поправок
  TOYOTA_WAY.md              философия качества
  AUTONOMOUS_PIPELINE.md     конвейер
  MULTI_LEVEL_VERIFICATION.md гейты L0.95–L0.99
  HIERARCHICAL_SPEC_SYSTEM.md 5 уровней спеков
  SELF_IMPROVEMENT_PROTOCOL.md петли самоулучшения
  archive/imported-product/   архив доков продукта-прародителя (read-only)
  CODING_STANDARDS / TESTING / SECURITY / DEBUGGING / DEVOPS
  formal/AndonHalt.tla       TLA+ верификация andon-механизма
  decisions/_TEMPLATE.md     формат ADR
  retros/_TEMPLATE.md        формат ретроспективы
  metrics/_TEMPLATE.md       формат метрик волны

package.json         100 npm-команд автоматизации
CLAUDE.md            пример project-instructions (generic-шаблон)
```

## Как применить у себя

1. Скопируй `.claude/agents/` + `.claude/skills/` + `.claude/AGENT_PLAYBOOK.md` в свой проект — роли и навыки универсальны.
2. Возьми `scripts/` — движок (andon, гейты, метрики, детекторы). Часть скриптов требует своих baseline-файлов, они генерируются на первом прогоне.
3. `docs/CONSTITUTION.md` + `docs/MISSION.md` — замени контент на свой продукт, структуру (Mission Compass, разделы) оставь.
4. Процессные доки (`AUTONOMOUS_PIPELINE`, `MULTI_LEVEL_VERIFICATION`, `HIERARCHICAL_SPEC_SYSTEM`, `SELF_IMPROVEMENT_PROTOCOL`, `TOYOTA_WAY`) переносятся как есть.
5. Из `package.json` возьми нужные команды из секции scripts.

## Что НЕ включено (специально)

- Продуктовый код (`app/`, `lib/`, `components/`) — это не фреймворк.
- Продуктовые доки (миссия продукта, воронки, бэкенд-ТЗ, питч) — кроме `MISSION.md`, оставленного как образец Mission Compass.
- Реальные спеки и ретро конкретного проекта — оставлены только `_TEMPLATE` форматы. Цифры по накопленному корпусу (146 спеков, 101 ретро) приведены в ASSESSMENT как доказательство, что фреймворк обкатан на боевом проекте.
- Тестовые fixtures и сгенерированные baseline.

## Важно

`CLAUDE.md` и часть агентов/доков содержат примеры из нашего продукта (на котором фреймворк обкатан). При переносе они заменяются своими — это образцы формата, не жёсткая привязка.

Снимок на 2026-05-29.
