# Honest System State — что реально работает, что каркас, где границы

> Снимок на 2026-05-31. Этот документ намеренно честный: он отделяет «доказуемо
> работает прямо сейчас» от «каркас готов, данных нет» и от «осознанная граница». Для
> технического оценщика честный self-assessment ценнее красивого демо — каждое
> утверждение ниже проверяется командой. Если запустить и получить иное, документ врёт,
> а не вы.

Принцип, на котором держится фреймворк: **механизмы, а не декларации**. Сам репозиторий
проверяет это правило на себе — `node scripts/instantiation-audit.mjs` падает, если хоть
один заявленный механизм указывает на несуществующий объект. Поэтому документ начинается
не с обещаний, а с того, что можно запустить.

---

## 1. Что реально работает — проверяется вживую

Каждая строка запускается на чистом клоне **без `npm install`** (движок на голых
node-builtins).

| Возможность | Команда проверки | Что увидите |
|---|---|---|
| Meta-Mistake Engine (closed-loop) | `node scripts/meta-audit.mjs` | классифицирует промахи: holding / regression / ungated; ловит рецидив *сквозь* gate |
| Тесты ядра движка (14, zero-dep) | `npm run test:engine` | 14 pass — чистые функции + интеграция closed-loop |
| Самопроверка целостности | `node scripts/instantiation-audit.mjs` | 0 ghosts: каждый заявленный механизм указывает на реальный объект |
| Честность входного сигнала | `node scripts/meta-honesty.mjs` | аудит ledger на self-confirming/booster-язык |
| Механический secret-гейт | `node scripts/pre-publish-guard.mjs` | сканирует дерево + **всю git-историю**, блокирует push на секреты/PII |
| CI на чистом клоне | см. `.github/workflows/ci.yml` | 7 шагов-гейтов, exit 0 без `npm install` |
| Декомпозиция (ratchet) | `npm run check:structural` | LOC/hook-лимиты, baseline не может ухудшиться |
| Тренд обучения | `node scripts/meta-trend.mjs` | покрытие gate / time-to-gate / regression-rate |
| Agent eval suite (детерминир.) | `node scripts/eval-suite.mjs` | 21/21 кейсов: каждый движковый механизм ведёт себя по спеке, регрессия валит CI |
| Измеримость LLM-судей | `node scripts/agent-eval-dashboard.mjs` | 3/3 агента с golden измерены: constitutional-reviewer 6/6, debate-judge 3/3, reflexion-critic 2/3 |
| Контракт конвейера (E2E) | `node scripts/pipeline-contract.mjs` | граф оркестратора well-formed: 37 узлов резолвятся в реальных агентов/скрипты, у каждой фазы артефакт |
| Real-time policy enforcement | `echo '{"tool_name":"Write","tool_input":{"file_path":"docs/CONSTITUTION.md"}}' \| node scripts/policy-enforce-hook.mjs` | блок записи в L0/security пути (exit 2), PreToolUse hook |
| North Star gate | `node scripts/northstar-check.mjs --self-test` | продукт без полного North Star не проходит pre-push |
| Product Kaizen loop | `node scripts/kaizen-loop.mjs --self-test` | тренд метрики vs цель North Star (логика live, данные продукта dormant) |

Плюс архитектура, проверяемая чтением: **28 агентов-ролей** (31 в roster c L0) в трёх
линиях защиты (`docs/governance/AGENT_TOPOLOGY.md`), debate / best-of-N / reflexion,
TLA+-спека andon (`docs/formal/AndonHalt.tla`), и таблица «механизм → файл → research-паттерн»
в `ENGINEERING_SYSTEM_ASSESSMENT.md` (8/8 гейтов резолвятся на диск).

---

## 2. Каркас, готовый к данным — засеяно, но не живёт

Скрипты и определения реальны; данных пайплайна пока нет. Активируется, когда поток данных
пойдёт — это не дыры, это незаполненные контейнеры.

- **Observability**: `compute-dora` / `compute-slos` работают, но на этом репо выдают 0 /
  «stream absent» — телеметрия не накоплена, а DORA-прокси ждёт коммиты вида
  `feat(scope): wave-NN` (здесь другой формат). Определения засеяны
  (`docs/quality/{dora,slo}-definitions.json`), стримы пусты. **`_DASHBOARD.md` показывает
  цифры боевого проекта, не этого репо** (помечено баннером).
- **Реестры (засеяны реальными данными фреймворка)**: agent-access (0 grant-drift),
  RACI (accountable = human, EU AI Act Art 14), DR-каталог (реальные recovery-скрипты),
  lineage-граф (38 узлов), 3 eval-кейса для constitutional-reviewer.
- **Evals**: harness + golden-кейсы есть; **3 LLM-судьи ИЗМЕРЕНЫ реальным прогоном**
  (constitutional-reviewer 6/6, debate-judge 3/3, reflexion-critic 2/3 — см.
  `docs/evals/*/_RESULT.md` и `agent-eval-dashboard.mjs`). Остальные ~7 агентов имеют каркас,
  но не прогонялись (DORMANT). Прогон LLM недетерминирован → это снимок, не CI-гейт;
  детерминированный scorer (`llm-eval-score`) и записанные прогоны — в CI.
- **Kaizen-targets продуктов**: структура из North Star §3 засеяна для Mosco и WhatsApp-агента
  (`kaizen-targets.json`), но series пустые — числа подключает data-analyst в самом продукте.
- **GDPR / EU AI Act**: валидаторы реальны, но RoPA-инвентарь не заполнен (честный dormant).

---

## 3. Честные границы — чего тут нет (не обещать)

- **Нет продуктового кода** (`app/`, `components/`) и **нет тестов продукта**. Покрыто
  тестами только ядро движка (14 тестов). `npm test` (vitest) не запускается — указывает
  на отсутствующий `tests/`.
- **Нет `package-lock.json`** — сборка продуктового стека недетерминирована (движок от
  этого не зависит, он zero-dep).
- **semgrep / trufflehog / TLA+ (TLC)** требуют внешнего toolchain. Без него скрипты
  честно SKIP, а не фейк-зелёный. Реально срабатывает только самописный
  `pre-publish-guard` (grep-гейт на pre-push).
- **LLM-агенты-судьи** (constitutional-reviewer, reflexion-critic, debate-judge,
  security-scanner) — это промпты, не скрипт-гейты; в CI их нет. **3 из них теперь измерены**
  на golden-кейсах (снимок, не гейт); остальные dormant. Точность измеряется, а не предполагается
  — и где агент разошёлся с эталоном (reflexion-critic 2/3), это записано честно, эталон не
  подгонялся под агента.
- **Нет OS-/kernel-sandbox на агента.** `policy-sandbox` (policy-proxy) + `policy-enforce-hook`
  (real-time блок записи в L0/security пути через PreToolUse, exit 2) дают реальное enforcement на
  уровне путей и хука, но это НЕ изоляция процесса/файловой системы на каждого агента. Полный
  sandbox (контейнер/seccomp на субагента) — отдельный проект, осознанно вне scope.
- **Продуктовые метрики kaizen-loop dormant**: логика сверки метрика→North Star работает и
  само-тестится, но series пустые до подключения реальных данных в продукте.
- **Headline «187 волн / 1080 коммитов»** — метрики боевого проекта, на котором фреймворк
  обкатан, **не этого репозитория** (помечено в `ENGINEERING_SYSTEM_ASSESSMENT.md`).
  Проверить их командами здесь нельзя.

---

## 4. Проверить за 60 секунд

```bash
node scripts/instantiation-audit.mjs   # 0 ghosts — заявления = реальность
node scripts/eval-suite.mjs            # 21/21 — каждый механизм по спеке
node scripts/agent-eval-dashboard.mjs  # какие LLM-судьи измерены (3/3 с golden)
node scripts/pipeline-contract.mjs     # граф конвейера well-formed
npm run test:engine                    # 14 pass — ядро под тестами
node scripts/meta-audit.mjs            # closed-loop движок самообучения
node scripts/pre-publish-guard.mjs     # реальный secret/PII гейт
cat docs/formal/AndonHalt.tla          # формальная спека andon
```

---

## 5. Как это позиционировать

Это **не** готовый продукт с живыми дашбордами — метрики этого репо нулевые, тестов
продукта нет. Это **движок инженерной дисциплины** для агентной разработки: доказанное
ядро (meta-engine с closed-loop и тестами, самопроверка целостности, secret-гейт, CI на
чистом клоне) плюс честно-размеченный каркас под остальное.

Сильная сторона — не цифры, а **то, что система ловит собственную нечестность**:
instantiation-audit падает на призраках, meta-honesty ловит self-confirming записи,
валидаторы делают честный DORMANT вместо фейк-зелёного. Для технического оценщика это
убедительнее демо с нарисованным дашбордом, потому что проверяется за минуту и не врёт.
