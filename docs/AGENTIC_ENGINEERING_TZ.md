# ТЗ — Agentic Engineering для this project

> ⚠️ **ПРИМЕР из боевого проекта, не часть переносимого ядра.** Этот ТЗ содержит specifics конкретного продукта (backend, роли, эндпоинты, имена). Он включён как референс применения фреймворка. При переносе — замените своим. Структура переносима, specifics — нет. Для оценки самого фреймворка смотрите `docs/ENGINEERING_SYSTEM_ASSESSMENT.md`.

**Дата:** 2026-05-05
**Owner:** Yura (BE) + Frontend lead
**Источник идей:** Karpathy «From Vibe Coding to Agentic Engineering» (YouTube, 2026-05)
**Цель:** перейти от «this project показывает что AI делает» → «this project инженерно подтверждает что AI делает правильно». Вторая фаза — без неё продукт уязвим к одному плохому кейсу клиента.

---

## 0. TL;DR — что Карпати говорит и что это значит для нас

| Карпати | Применительно к this project |
|---|---|
| **Vibe coding → Agentic engineering.** Мало писать промпт — нужны автономные циклы test→fix. | У нас 8 cockpit'ов + A/B варианты. Это уже не vibe. Но автономного цикла «попробуй→оцени→исправь» нет: variants — ручные, evaluation мок. |
| **LLM = ghosts.** Нет continuous state, только в момент генерации. | Мы относимся к агентам как к «всегда-онлайн сервисам». На самом деле каждый ответ — новый «вызов призрака» с reconstructed context. Если context фрагментарен, ответ деградирует — а мы это не ловим. |
| **Software 3.0.** Человек = «дирижёр со вкусом». | У нас `DealOwnersRow`, `AttentionsQueue`, approvals — шаги в эту сторону. Но владельцу не показано **почему** агент сделал именно так — он не может судить, только видеть результат. |
| **Verification — главный bottleneck.** | У нас **нет eval suite** ни для одного агента. A/B variants показывают conversion delta, но это product-metric, не quality-metric. Frontline-вариант может конвертить 22% потому что грубит и закрывает быстро — мы этого не увидим. |
| **«Делегируйте выполнение, но не понимание».** | Сейчас owner делегирует и то и другое: видит «agent done», но не reasoning chain. Когда агент начинает себя странно вести — owner не может его контролировать, только выключить. |

**Главный вывод.** this project продаёт «AI workforce». На рынке за такие позиционирования спрашивают — «а где доказательства что workforce работает не хуже человека и не хуже месяц назад?». У нас сейчас нет ни регрессионных тестов, ни replay, ни trace, ни evals. Это окно закроется через 2-3 квартала, когда конкуренты (Forethought, Decagon, Ada) начнут раздавать «Agent Quality Reports» из коробки.

---

## 1. Где this project сейчас по шкале Agentic Engineering

Аудит по 6 размерностям. Шкала 0-5 (0 = нет, 5 = production-ready).

| Размерность | Скор | Что есть | Что слабо |
|---|---|---|---|
| **A. Specialised agents** | 4/5 | 8 agents + cockpitMeta + COCKPIT_META + custom-agents-builder | Нет capability контракта. Нельзя сказать «закрой все агенты с capability X для tier Y». |
| **B. Workflow / handoff** | 3/5 | F1 (agent-per-stage), F9 (handoff packs), `lib/agents/workflows.ts`, `WorkflowsView` | Workflows — read-only registry, не runtime граф. Handoff packs — assembled, но не consumed агентом-получателем. |
| **C. Memory** | 2/5 | `episodicStore`, attentions queue, handoff packs | Нет episodic-vs-semantic split, нет TTL, нет «forget», нет conflict resolution когда два эпизода противоречат. |
| **D. A/B + iteration** | 3/5 | 8 A/B variant модулей с promote winner, traffic split, mock significance | Significance считается на фронте через mock. Backend не пишет outcomes. Auto-promote не реализован. Нет multi-armed bandit. |
| **E. Verification / eval** | 1/5 | Approval queue + outcome simulation knob | Ноль автоматических evals. Ноль regression tests. Ноль gold-set replies. Ноль PII-checks на агентских ответах. |
| **F. Observability / trace** | 1/5 | Timeline entries + LiveActivityStream | Timeline = что произошло. Reasoning trace («что агент видел в context, какие tools вызвал, какой score у альтернатив») — отсутствует. |

**Средний скор: 2.3/5.** Сильны в A/B и agent topology. Критически слабы в verification и trace. Это и есть прицел.

---

## 2. Gap Analysis — что строить и почему

### Gap 1 — Reasoning trace (приоритет 1)

**Проблема.** Owner видит «Frontline ответил клиенту: `Хорошо, перезвоним в 14:00`». Не видит:
- Какие 3 reply-кандидата агент рассматривал
- Какой tool-call вернул «slot 14:00 free» а не 15:00
- Какой score у каждого кандидата
- Какой кусок knowledge-base был подтянут в context
- Сколько токенов ушло, какая часть от лимита

**Почему критично.** Без trace владелец не judge — он observer. Это нарушает Software 3.0 принцип «человек судит по вкусу». А значит и не может корректно настраивать промпты, потому что не видит cause→effect.

**Что строить (BE).** Storage: `agent_traces` table. Схема:

```sql
CREATE TABLE agent_traces (
    id UUID PRIMARY KEY,
    agent_id TEXT NOT NULL,
    deal_id TEXT,
    invocation_at TIMESTAMP,
    -- reconstructed context snapshot
    system_prompt_hash TEXT,
    context_messages JSONB,        -- last N messages fed in
    knowledge_chunks JSONB,        -- which KB chunks retrieved
    -- decision
    candidates JSONB,              -- [{text, score, reasoning}]
    chosen_index INT,
    -- side effects
    tool_calls JSONB,              -- [{name, args, result}]
    tokens_in INT,
    tokens_out INT,
    cost_usd NUMERIC(10,5),
    -- outcome (filled later)
    customer_replied BOOLEAN,
    customer_reply_at TIMESTAMP,
    judge_verdict TEXT             -- "good" | "bad" | "neutral" | NULL
);
```

**Что строить (FE).** На каждой агентской реплике в timeline — иконка `< />` (trace). Клик открывает drawer:
1. Tab «Context» — что агент видел (system prompt + last 10 msgs + KB chunks)
2. Tab «Candidates» — все альтернативы с scores, hover показывает reasoning
3. Tab «Tools» — какие функции вызвал, что вернули
4. Tab «Cost» — токены/деньги/latency

### Gap 2 — Eval suite (приоритет 1)

**Проблема.** A/B variants показывают «Variant A конвертит 22%, B — 18%». Это бизнес-сигнал. Но если A конвертит 22% потому что соглашается на любую цену клиента — мы потеряем margin. Eval должен ловить такое до промоушена.

**Почему критично.** Карпати: «Главный bottleneck — verification». Без evals каждое изменение промпта — это roll-the-dice без safety net.

**Что строить (BE).** Новая сущность `eval_suite`:

```sql
CREATE TABLE eval_cases (
    id UUID PRIMARY KEY,
    agent_kind TEXT NOT NULL,
    name TEXT NOT NULL,
    -- input context the agent will see
    incoming_message TEXT,
    customer_persona JSONB,
    deal_state JSONB,
    -- assertion(s)
    must_contain TEXT[],           -- любая фраза должна содержаться
    must_not_contain TEXT[],       -- ни одна не должна
    must_match_regex TEXT[],
    must_call_tool TEXT[],         -- frontline должен вызвать book_appointment
    must_not_quote_price BOOLEAN,
    max_tokens INT,
    -- метаданные
    severity TEXT,                  -- "block_promotion" | "warn"
    created_by TEXT,
    created_at TIMESTAMP
);

CREATE TABLE eval_runs (
    id UUID PRIMARY KEY,
    suite_id UUID,
    variant_id UUID,
    run_at TIMESTAMP,
    cases_total INT,
    cases_passed INT,
    cases_failed INT,
    failures JSONB,                 -- [{case_id, expected, actual}]
    blocked_promotion BOOLEAN
);
```

API: `POST /api/v1/evals/{agent_kind}/run` с `variant_id` → возвращает eval_run. Используется при `promoteWinner` — нельзя промоутить вариант с failed `severity=block_promotion`.

**Что строить (FE).** Новая страница `/evals`. Список кейсов с CRUD. Большая кнопка `Run all evals` — показывает прогресс bar. Failed cases — с дифом expected vs actual side-by-side. На странице A/B variants — рядом с «Promote» чип «Eval status: 47/48 passed ✓» или «3 critical fails — promotion blocked ⛔».

### Gap 3 — Replay theater (приоритет 2)

**Проблема.** Клиент жалуется «Frontline вчера в 14:32 хамил мне». Сейчас owner может посмотреть transcript. Но не может **переиграть** этот вызов — увидеть что агент видел в context, попробовать другой промпт против того же входа, посмотреть что выдала бы новая версия.

**Что строить (BE).** Endpoint `POST /api/v1/agents/{id}/replay` с `{ trace_id, override_prompt?, override_kb_version? }`. Возвращает новый trace, не записывает в timeline (это симуляция).

**Что строить (FE).** В trace drawer — кнопка `Replay with new prompt`. Открывает split: слева оригинал, справа editable system prompt + Run кнопка. После запуска — diff candidates side-by-side.

### Gap 4 — Memory hygiene (приоритет 2)

**Проблема.** `episodicStore` хранит всё. Старые эпизоды попадают в context даже когда устарели. Нет TTL. Нет «forget» (если клиент сказал «у меня нет жены», а через год он женился — старая запись засорит context). Нет conflict detection.

**Что строить (BE).** Добавить в episodic events: `valid_until?: TIMESTAMP`, `superseded_by?: UUID`, `confidence: NUMERIC`. Background job еженедельно сравнивает episodes на одну entity и помечает противоречия (`flag = "conflict"`). Endpoint `POST /api/v1/memory/conflicts/{id}/resolve` (keep_a / keep_b / merge).

**Что строить (FE).** В `AgentMemoryCard` — секция «Conflicts to resolve (3)». Каждый конфликт — UI «Customer says X (claimed 2026-01) vs says Y (claimed 2026-04). Which is true?»

### Gap 5 — Real significance + auto-promote (приоритет 3)

**Проблема.** Сейчас `metrics.significance` в variant store — мок. Нельзя реально понять «вариант B статистически лучше или это шум на 30 сделках».

**Что строить (BE).** Endpoint `GET /api/v1/variants/{group_id}/significance` — считает реальный chi-square / Bayesian posterior на стороне сервера (n_a, conv_a, n_b, conv_b). Auto-promote: cron-job каждые 6 часов проходит по active groups, если significance > threshold AND eval gate passed — автоматом promote winner + emit ecosystem event `variant_promoted`.

### Gap 6 — Capability contract (приоритет 3)

**Проблема.** Сейчас агенты — string union. Нельзя сказать «найди мне агента с capability `book_appointment` который умеет испанский». Custom agents builder выдаёт freeform — не проверяется.

**Что строить (BE).** Новая таблица `agent_capabilities`: `agent_id, capability_name, schema_json` (JSON Schema контракта input/output). API `GET /api/v1/agents?capability=book_appointment&lang=es`.

---

## 3. Backend ТЗ для Юры — приоритезированно

### Phase 1 — Trace & Replay (2 недели)

| # | Что | Endpoint | Estimate |
|---|---|---|---|
| 1 | Schema `agent_traces` + write-path в каждом агентском вызове | (internal) | 3 дня |
| 2 | `GET /api/v1/agent-traces?deal_id=&agent_id=&limit=` | read | 1 день |
| 3 | `GET /api/v1/agent-traces/{id}` | read full trace | 1 день |
| 4 | `POST /api/v1/agent-traces/{id}/judge` `{verdict, comment}` | owner judging | 1 день |
| 5 | `POST /api/v1/agents/{kind}/replay {trace_id, override_prompt}` | re-execute deterministically | 4 дня |

**Контракт TraceSummary (для FE):**

```ts
interface TraceSummary {
    id: string;
    agentId: AgentId;
    invocationAt: string;
    chosenReply: string;
    candidatesCount: number;
    toolCallsCount: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    judgeVerdict?: "good" | "bad" | "neutral";
}
```

### Phase 2 — Eval suite (3 недели)

| # | Что | Endpoint | Estimate |
|---|---|---|---|
| 1 | Schema `eval_cases` + `eval_runs` + CRUD endpoints | `/api/v1/eval-cases/*` | 3 дня |
| 2 | Eval runner — берёт case + variant_id, реально вызывает агента, проверяет assertions | `POST /api/v1/eval-runs` | 5 дней |
| 3 | Promotion gate — `promoteWinner` теперь дёргает eval-runner, блокирует на `block_promotion` failures | (modify existing) | 2 дня |
| 4 | Seed pack — 20 базовых кейсов на каждого из 8 агентов = 160 cases. Yura пишет вместе с product owner | data | 5 дней |

### Phase 3 — Memory hygiene (2 недели)

| # | Что | Endpoint | Estimate |
|---|---|---|---|
| 1 | Migrate `episodicStore` events → backend with `valid_until`, `superseded_by`, `confidence` | `/api/v1/memory/*` | 5 дней |
| 2 | Conflict detector — background job + endpoint to fetch unresolved | `GET /api/v1/memory/conflicts` | 3 дня |
| 3 | Resolution endpoint | `POST .../resolve` | 1 день |

### Phase 4 — Real A/B significance (1 неделя)

| # | Что | Endpoint | Estimate |
|---|---|---|---|
| 1 | Significance computer (chi-square + Bayesian) | `GET /api/v1/variants/{group}/significance` | 3 дня |
| 2 | Auto-promote cron + ecosystem event | (cron) | 2 дня |

### Phase 5 — Capability contract (1 неделя)

| # | Что | Endpoint | Estimate |
|---|---|---|---|
| 1 | Schema `agent_capabilities` + JSON-schema validator | `/api/v1/agent-capabilities/*` | 5 дней |

**Итого backend:** ~9 недель работы Юры, разбито на 5 phases. Каждая phase закрывается работающим UX-куском.

---

## 4. Frontend ТЗ — синхронно с backend phases

### Phase 1 (Trace & Replay) — фронт-эстимейт 1.5 недели

1. **TraceDrawer** компонент. Открывается из любой агентской реплики в timeline (иконка `</>`). Tabs: Context / Candidates / Tools / Cost.
2. **JudgeButtons** на агентских репликах — `👍 Good / 👎 Bad / 🤷 Neutral` + поле комментария. Дёргает `/judge`.
3. **ReplayModal** — split с диффом старого / нового ответа после прогона replay.

### Phase 2 (Eval suite) — 1.5 недели

1. **`/evals` страница**. Список cases per agent + CRUD. Tabs: All / Passing / Failing.
2. **EvalCaseEditor** — форма создания/редактирования. Includes assertion builder.
3. **EvalRunButton + RunDrawer** на странице A/B variants — показывает live прогресс прогона + результаты.
4. **PromotionGate UI** — `Promote` кнопка disabled с tooltip «3 critical evals failing».

### Phase 3 (Memory hygiene) — 1 неделя

1. **AgentMemoryCard** расширить: секция «Conflicts (3)».
2. **ConflictResolverModal** с UI keep_a / keep_b / merge.
3. TTL индикаторы на старых episodes («expires in 14d»).

### Phase 4 (Real significance) — 0.5 недели

1. На каждой A/B-кнопке заменить mock significance на реальный fetch.
2. Toast «Auto-promoted variant X» когда cron сработал.

### Phase 5 (Capability) — 0.5 недели

1. В custom-agents builder — picker capabilities с автокомплитом.
2. На агентских cockpit'ах — chip «Capabilities: book_appointment, send_quote, ...».

**Итого фронт:** ~5 недель.

---

## 5. Принципы Software 3.0 для this project — рекомендации команде

1. **Каждое агентское действие должно быть judgeable за 1-2 секунды.** Если owner не может за пару секунд понять «хорошо/плохо» — UX недоработан. Trace + judge кнопки решают.
2. **Verifier-first.** Прежде чем добавить новый промпт/функцию агенту — пишем eval case. Иначе не мерджим.
3. **Determinism islands.** Hot-paths (booking slot, sending invoice, applying discount) должны быть детерминированными pure-functions с unit tests. LLM зовётся только для текста, не для бизнес-логики.
4. **Context window — артефакт первого класса.** Везде где собираем context для агента — это явная функция `assembleContext(deal, agent_kind, recent_n)` с тестами. Не разбросанные `messages.append(...)`.
5. **Понимание делегируется человеку.** Каждое решение агента имеет «Why?» button, который раскрывает reasoning. Если нечего раскрыть — значит promo и не было решения.

---

## 6. Метрики успеха — за чем будем следить

| Метрика | Как меряем | Цель к Q4 2026 |
|---|---|---|
| **Trace coverage** | % агентских реплик с записанным trace | 100% |
| **Judge participation** | % traces с verdict от owner за 7 дней | 25% |
| **Eval coverage per agent** | среднее кол-во eval cases на агента | 30+ |
| **Pass rate** | % eval cases passing на каждом релизе | 95%+ |
| **Mean replay-to-fix time** | от «owner репортит косяк» до «фикс задеплоен» | < 1 час |
| **Auto-promoted variants** | % promotions выполненных автоматически (без руки owner) | 70% |
| **Memory conflicts resolved** | время от появления конфликта до resolution | < 24 часа |
| **% deals with reasoning visible** | сколько закрытых сделок имеют полный trace+judge | 80% |

---

## 7. Что НЕ делаем (anti-scope)

1. **Не строим свой LLM.** Используем существующие (Claude/OpenAI) через API.
2. **Не строим general-purpose agent framework.** LangGraph/CrewAI существуют — мы строим **operating system для service businesses**, не platform для AI-инженеров.
3. **Не строим RLHF training pipeline.** Closed-loop learning (F10 в основном TZ) — это про prompt-tuning по результатам, не про fine-tuning модели.
4. **Не строим автономный MCP server.** Tool-calling остаётся per-agent definitions, как сейчас.
5. **Не строим multi-tenant eval marketplace.** Eval cases — per company.

---

## 8. Связь с существующими ТЗ

- **Дополняет** `BACKEND_TZ_YURA_AI_FUNNEL_OS.md` (10 фич) — добавляет инфраструктурный слой под F2/F9/F10
- **Не пересекается** с `BACKEND_TZ_YURA_LEAD_PROFILER.md` — тот про конкретного агента, этот про платформу
- **Связь** с F9 (Memory Handoff Pack): episodicStore миграция в backend = база для F9 v2
- **Связь** с F10 (Closed-Loop Learning): без trace + eval — F10 невозможен

---

## Приложение A — пример trace JSON

```json
{
    "id": "tr_4f8e...",
    "agent_id": "frontline",
    "deal_id": "deal-1778039568057",
    "invocation_at": "2026-05-05T18:42:11Z",
    "context_messages": [
        {"role": "user", "content": "Hi, water leaking from kitchen wall"},
        {"role": "assistant", "content": "I'm sorry to hear..."}
    ],
    "knowledge_chunks": [
        {"id": "kb-emerg-leak", "score": 0.91, "title": "Emergency leak protocol"}
    ],
    "candidates": [
        {"text": "Can you send a photo?", "score": 0.42, "reasoning": "needs more context"},
        {"text": "I can dispatch a tech in 30 min, address?", "score": 0.71, "reasoning": "high urgency, skip qualification"},
        {"text": "Booking next available slot at 14:00 today", "score": 0.65, "reasoning": "default booking flow"}
    ],
    "chosen_index": 1,
    "tool_calls": [
        {"name": "check_dispatcher_availability", "args": {"window": "30min"}, "result": {"available": true}}
    ],
    "tokens_in": 1842,
    "tokens_out": 47,
    "cost_usd": 0.0094,
    "judge_verdict": null
}
```

## Приложение B — пример eval case

```json
{
    "id": "ec_emerg_leak_001",
    "agent_kind": "frontline",
    "name": "Emergency leak — must dispatch in 30min, must not quote price",
    "incoming_message": "Hi, water leaking from kitchen wall",
    "customer_persona": {"location": "LA", "tier": "residential"},
    "deal_state": {"stage": "new", "value": null},
    "must_contain": ["30 min", "tech"],
    "must_not_contain": ["$", "price", "estimate"],
    "must_call_tool": ["check_dispatcher_availability"],
    "max_tokens": 80,
    "severity": "block_promotion"
}
```
