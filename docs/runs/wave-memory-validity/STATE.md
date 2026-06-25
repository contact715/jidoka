# Run state — wave-memory-validity

> Forward run-journal written by `scripts/run-state.mjs` as the orchestrator advances.
> Source of truth is `state.json`; this file is rendered from it. Do not edit by hand.
> Updated: 2026-06-06T07:21:17.107Z

Task: `{"type":"feature","risk":"normal","surfaces":["backend"]}`

## Phases

- [x] discovery — done (Источник: GH-research Graphiti validity-window (бриф AGENT-PIPELINES.md п.1). Цель: MEMORY_MERGE_PROTOCOL §49 (конфликтующие факты сейчас хранятся дублями) + supersede-детектор wired в npm memory:status + дайджест перестаёт всплывать устаревшее. Зачем бизнесу: память не врёт про настоящее, хранит правду про прошлое)
- [x] spec — done (Мастер-спека wave-memory-validity_MASTER_SPEC.md: supersede-конвенция [superseded YYYY-MM-DD by:], детектор-скрипт, wiring в memory:status, дайджест прячет устаревшее в History, протокол 6→7 шагов)
- [x] tests — done (TDD red→green: supersede-check 24 assert, consolidate +3)
- [x] build — done (6 файлов: memory-supersede-check.mjs (new), memory-consolidate (History-секция), memory-staging-status (+pointer), package.json (memory:supersede), MEMORY_MERGE_PROTOCOL (7-step), SESSION_START (Check 1b))
- [x] gate — done (Адверсариал REVISE 2 пункта: (1) ЛОЖНЫЕ СРАБАТЫВАНИЯ — детектор флагал любые 2 пункта с общим префиксом (два урока/причины). ИСПРАВЛЕНО: SINGLE_VALUED_KEYS allowlist (status/version/color/port/...) + срабатывание только при ровно 2 вхождениях; формулировка 'изменилось значение ключа' вместо 'противоречие'. (2) битый staging ронял — try/catch+exit2. Доказано: репро ревизора (2 Lesson+2 Status) → 1 кандидат (только status), 24/0 тестов, битый JSON код 2)
- [x] debug — done (нечего)
- [x] memory — done (Урок: детектор/гейт, реагирующий на СТРУКТУРНОЕ совпадение (общий префикс) без СЕМАНТИКИ (одноместный ли это ключ), даёт ложные тревоги, маскируемые текущими данными — нужен allowlist того, что реально single-valued. Self-test, написанный автором детектора, закрепил сомнительный пример как истину; поймал только независимый adversarial. Класс over-eager-detector залогирован)

## Next step

wave wave-memory-validity complete — all 7 phases done

## Events

- 2026-06-06T06:57:47.362Z · discovery → done (Источник: GH-research Graphiti validity-window (бриф AGENT-PIPELINES.md п.1). Цель: MEMORY_MERGE_PROTOCOL §49 (конфликтующие факты сейчас хранятся дублями) + supersede-детектор wired в npm memory:status + дайджест перестаёт всплывать устаревшее. Зачем бизнесу: память не врёт про настоящее, хранит правду про прошлое)
- 2026-06-06T07:21:03.961Z · spec → done (Мастер-спека wave-memory-validity_MASTER_SPEC.md: supersede-конвенция [superseded YYYY-MM-DD by:], детектор-скрипт, wiring в memory:status, дайджест прячет устаревшее в History, протокол 6→7 шагов)
- 2026-06-06T07:21:03.991Z · tests → done (TDD red→green: supersede-check 24 assert, consolidate +3)
- 2026-06-06T07:21:04.019Z · build → done (6 файлов: memory-supersede-check.mjs (new), memory-consolidate (History-секция), memory-staging-status (+pointer), package.json (memory:supersede), MEMORY_MERGE_PROTOCOL (7-step), SESSION_START (Check 1b))
- 2026-06-06T07:21:04.048Z · gate → done (Адверсариал REVISE 2 пункта: (1) ЛОЖНЫЕ СРАБАТЫВАНИЯ — детектор флагал любые 2 пункта с общим префиксом (два урока/причины). ИСПРАВЛЕНО: SINGLE_VALUED_KEYS allowlist (status/version/color/port/...) + срабатывание только при ровно 2 вхождениях; формулировка 'изменилось значение ключа' вместо 'противоречие'. (2) битый staging ронял — try/catch+exit2. Доказано: репро ревизора (2 Lesson+2 Status) → 1 кандидат (только status), 24/0 тестов, битый JSON код 2)
- 2026-06-06T07:21:04.075Z · debug → done (нечего)
- 2026-06-06T07:21:17.107Z · memory → done (Урок: детектор/гейт, реагирующий на СТРУКТУРНОЕ совпадение (общий префикс) без СЕМАНТИКИ (одноместный ли это ключ), даёт ложные тревоги, маскируемые текущими данными — нужен allowlist того, что реально single-valued. Self-test, написанный автором детектора, закрепил сомнительный пример как истину; поймал только независимый adversarial. Класс over-eager-detector залогирован)
