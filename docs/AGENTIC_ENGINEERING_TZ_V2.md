# ТЗ — Agentic Engineering V2 (this project + the backend)

> ⚠️ **ПРИМЕР из боевого проекта, не часть переносимого ядра.** Содержит specifics backend конкретного продукта (BaseAgent / AgentThought / эндпоинты / роли). Референс применения, не переносимое ядро. При переносе — замените своим. Для оценки фреймворка смотрите `docs/ENGINEERING_SYSTEM_ASSESSMENT.md`.

**Дата:** 2026-05-05
**Owner:** Yura (BE) + Frontend lead
**Источники:**
- Karpathy «From Vibe Coding to Agentic Engineering» (YouTube, 2026-05)
- Внутренний аудит the backend (BaseAgent / AgentThought / AgentAction / AgentEvaluation уже есть)
- `docs/AGENTIC_ENGINEERING_TZ.md` (V1, моя версия) + 5-layer план Юры

**Цель документа:** единая точка входа для Юры. Закрывает 5 слоёв инфраструктуры, на которых строится верификация и контроль качества AI workforce.

---

## 0. TL;DR

| | До | После |
|---|---|---|
| Reasoning visible | timeline лог что было | trace со scored candidates, tool calls, KB chunks, costs |
| Quality measure | A/B conversion rate | + agreement rate (shadow) + eval pass rate |
| Iteration safety | merge без проверки | regression CI блокирует мерж при -2pp pass rate |
| Production risk | агент шлёт сразу | shadow mode по флагу: предлагает → диспетчер approve/edit/reject |
| Owner role | observer | judge (👍/👎/🤷 на каждый trace) |

**Срок:** 3 недели (15 рабочих дней) для всех 5 слоёв на BE. Frontend инфра уже готова на mock-данных — переключение на real BE одной строкой когда endpoints поднимутся.

---

## 1. Что УЖЕ хорошо в the backend

Аудит показал — Юра двинулся в правильную сторону:

- **`BaseAgent`** правильный: REASON → EXECUTE → EVALUATE → REMEMBER цикл
- **Дата-классы** `AgentThought`, `AgentAction`, `AgentEvaluation` — всё что нужно для trace структурно есть
- **`ToolRegistry`** — структурированные tool calls
- **`FrontlineAgent`, `DispatcherAgent`** — скелеты на месте
- **`learning_notes.json`** — намёк на episodic memory

Это не «vibe code», это близко к agentic engineering. Осталось добавить **persistence + verification + shadow mode**.

---

## 2. 5 слоёв инфраструктуры (приоритет → срок)

### Слой 1: Trace Persistence — фундамент (2 дня)

**Зачем.** Сейчас `AgentThought`/`Action`/`Evaluation` живут в памяти и пропадают. Невозможно:
- Дебажить «вчера в 14:32 агент написал хамство — почему?»
- Ловить регрессии при изменении промпта
- Считать стоимость per-conversation
- Делать replay
- Считать agreement rate в shadow

**Schema (PostgreSQL).**

```sql
CREATE TABLE agent_traces (
    -- Identity
    trace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id BIGINT NOT NULL REFERENCES companies(id),
    agent_type TEXT NOT NULL,              -- frontline | dispatcher | closer | ...
    deal_id TEXT,                           -- nullable: not all traces tied to a deal
    conversation_id TEXT,                   -- nullable: chat / call session

    -- Provenance
    model_used TEXT NOT NULL,               -- claude-opus-4-7, gpt-4o-mini, ...
    prompt_version TEXT NOT NULL,           -- semver "1.4.2" or git-sha "a3f8b1c"
    mode TEXT NOT NULL                      -- production | shadow | eval
        CHECK (mode IN ('production','shadow','eval')),

    -- The cycle (raw)
    input_context JSONB NOT NULL,           -- what was fed in: messages, KB chunks, tools available
    thought JSONB NOT NULL,                  -- AgentThought serialized
    actions JSONB NOT NULL,                  -- list of AgentAction with results
    evaluation JSONB NOT NULL,               -- AgentEvaluation serialized
    final_output JSONB NOT NULL,             -- what really got sent / written

    -- Human-in-the-loop
    human_override JSONB,                    -- {edited_text, rejected, editor_user_id, edited_at}
    judge_verdict TEXT,                       -- good | bad | neutral | NULL
    judge_comment TEXT,
    judged_at TIMESTAMP,
    judged_by_user_id BIGINT REFERENCES users(id),

    -- Cost / perf
    latency_ms INT NOT NULL,
    tokens_in INT NOT NULL,
    tokens_out INT NOT NULL,
    cost_usd NUMERIC(10,6) NOT NULL,

    -- Audit
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_traces_deal ON agent_traces(deal_id, created_at DESC);
CREATE INDEX idx_traces_agent_company ON agent_traces(company_id, agent_type, created_at DESC);
CREATE INDEX idx_traces_judge ON agent_traces(company_id, judge_verdict) WHERE judge_verdict IS NOT NULL;
CREATE INDEX idx_traces_mode ON agent_traces(company_id, mode, created_at DESC) WHERE mode != 'production';
```

**API endpoints (читать → писать).**

```
GET    /api/v1/agent-traces?deal_id=&agent_type=&mode=&limit=50
GET    /api/v1/agent-traces/{trace_id}
POST   /api/v1/agent-traces/{trace_id}/judge       {verdict, comment}
POST   /api/v1/agent-traces/{trace_id}/override    {edited_text}
POST   /api/v1/agent-traces/{trace_id}/reject
GET    /api/v1/agent-traces/stats?agent_type=&days=7   -- agreement, judge dist, cost
```

**Хук в `BaseAgent.run()`.** В конце каждого цикла:

```python
# app/agents/tracing.py
async def persist_trace(
    company_id: int,
    agent_type: str,
    cycle: AgentCycleResult,
    mode: AgentMode,
    deal_id: str | None = None,
) -> UUID:
    """Single-insert trace at the end of REASON → EXECUTE → EVALUATE."""
    ...
```

Один insert. ~150 LOC включая модель. Без этого слоя всё остальное бессмысленно.

---

### Слой 2: Eval Harness (3-4 дня)

**Зачем.** A/B variants даёт business metric (conversion). Eval даёт quality metric. Без eval — каждое изменение промпта это roll-the-dice.

**Формат датасета (JSONL).** Файлы `evals/{agent}_v{N}.jsonl`. Каждая строка:

```json
{
  "id": "flow_001",
  "name": "Emergency leak — must dispatch in 30min",
  "tags": ["follow_up", "english", "emergency"],
  "input": {
    "incoming_message": "Hi, water leaking from kitchen wall",
    "customer_persona": {"location": "LA", "tier": "residential"},
    "deal_state": {"stage": "new", "value": null},
    "conversation_history": [...]
  },
  "assertions": {
    "must_contain": ["30 min", "tech"],
    "must_not_contain": ["$", "estimate"],
    "must_match_regex": [],
    "must_call_tool": ["check_dispatcher_availability"],
    "must_not_call_tool": ["send_invoice"],
    "max_tokens_out": 80,
    "max_cost_usd": 0.02
  },
  "judge_prompt": "Is the response polite and addresses the urgency?",
  "severity": "block_promotion"
}
```

**Runner.**

```bash
python -m app.eval.run --agent frontline --dataset evals/frontline_v1.jsonl --model claude-opus-4-7 --variant-id v_abc123
```

**Выход:**
- pass/fail per case в stdout + JSON-отчёт в `eval-runs/{run_id}.json`
- Регрессия vs последний прогон по тому же датасету
- Latency p50/p95, total cost
- LLM-as-judge: для нечёткого текста (полит ли тон) — Haiku судит. Дёшево.
- Запись результата в таблицу `eval_runs`:

```sql
CREATE TABLE eval_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id BIGINT NOT NULL,
    agent_type TEXT NOT NULL,
    variant_id UUID,                        -- which A/B variant tested
    prompt_version TEXT,
    dataset_version TEXT,                    -- evals/frontline_v1.jsonl hash
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    cases_total INT,
    cases_passed INT,
    cases_failed INT,
    failures JSONB,                          -- [{case_id, expected, actual, judge_reason}]
    pass_rate NUMERIC(5,2),
    p50_latency_ms INT,
    p95_latency_ms INT,
    total_cost_usd NUMERIC(10,4),
    blocked_promotion BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**Seed pack.** 50-100 кейсов на каждого из 8 агентов, собранных из реальных диалогов. Юра + product owner — за 5 дней.

**API.**
```
POST   /api/v1/eval-runs                {agent_type, dataset_version, variant_id?}
GET    /api/v1/eval-runs/{run_id}
GET    /api/v1/eval-runs?agent_type=&limit=10
```

---

### Слой 3: Shadow Mode — самый ценный (3 дня)

**Зачем.** Eval даёт качество на синтетике. A/B даёт бизнес-сигнал. **Shadow** даёт **true ground truth**: «реальный диспетчер согласился без правок» — и это самый сильный signal качества.

**Реализация на BE.**

1. **Per-company флаг** `companies.agent_modes JSONB DEFAULT '{}'`. Структура:
   ```json
   {
     "frontline": "shadow",
     "dispatcher": "production",
     "closer": "production",
     ...
   }
   ```

2. **Новая `mode='shadow'` ветка в `BaseAgent.run()`.**
   - Полный REASON → EXECUTE цикл прогоняется
   - Но `write-tools` (`send_message`, `create_appointment`, `update_lead`, `send_invoice`) подменяются на dry-run версии в `app/agents/tracing.py`:
     ```python
     class ShadowToolWrapper:
         def __init__(self, real_tool, trace_buffer):
             self.real_tool = real_tool
             self.trace_buffer = trace_buffer

         async def __call__(self, **args):
             # Don't execute — just record what WOULD happen
             self.trace_buffer.append({"name": self.real_tool.name, "args": args, "dry_run": True})
             return {"shadow_mode": True, "would_execute": True}
     ```
   - В trace пишется `mode='shadow'`, `final_output` — proposed_action
   - В Telegram бот / в WebSocket бэка — уведомление диспетчеру:
     > **Frontline предлагает отправить:**
     > «I can dispatch a tech in 30 min, what's your address?»
     > [✓ Send] [✏️ Edit] [✗ Reject]

3. **Endpoint для решения диспетчера.** Уже описан в Слое 1: `POST /api/v1/agent-traces/{trace_id}/override` или `/reject`. После override — реальный tool вызывается с правленным текстом.

4. **Метрика `agreement_rate` per agent_type per company.**
   ```sql
   -- Materialized view, refresh hourly
   CREATE MATERIALIZED VIEW shadow_agreement_stats AS
   SELECT
       company_id,
       agent_type,
       DATE_TRUNC('day', created_at) AS day,
       COUNT(*) FILTER (WHERE human_override IS NULL AND mode = 'shadow')                          AS accepted,
       COUNT(*) FILTER (WHERE human_override->>'edited_text' IS NOT NULL)                          AS edited,
       COUNT(*) FILTER (WHERE (human_override->>'rejected')::bool IS TRUE)                         AS rejected,
       COUNT(*) FILTER (WHERE mode = 'shadow')                                                      AS total
   FROM agent_traces
   WHERE mode = 'shadow'
   GROUP BY company_id, agent_type, day;
   ```

5. **Promotion path: shadow → production.** Когда agreement_rate > 90% за 7 дней + eval pass rate > 95% — UI показывает «Ready to promote» → owner one-click переключает.

**API.**
```
GET    /api/v1/companies/{id}/agent-modes
PATCH  /api/v1/companies/{id}/agent-modes        {agent_type, mode}
GET    /api/v1/companies/{id}/agent-stats?mode=shadow&days=7
```

---

### Слой 4: Regression CI (1 день)

**GitHub Action на PR.**
```yaml
# .github/workflows/agent-regression.yml
on:
  pull_request:
    paths: ['app/agents/**', 'prompts/**']
jobs:
  regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install -r requirements.txt
      - run: python -m app.eval.ci --baseline main --against HEAD
      - uses: actions/github-script@v7
        with:
          script: |
            const report = require('./eval-reports/diff.json');
            const body = `## Eval regression report\n\nWas: **${report.baseline_pass}%** → Now: **${report.head_pass}%**\nDelta: **${report.delta}pp**\n\n${report.failed_cases_table}`;
            github.rest.issues.createComment({...});
            if (report.delta < -2) core.setFailed('Pass rate dropped > 2pp');
```

Pre-commit hook локально дёргает то же самое:
```bash
# .git/hooks/pre-commit
python -m app.eval.run --quick --agent $(detect_changed_agent) || {
  echo "Eval failed — fix or use --no-verify"
  exit 1
}
```

---

### Слой 5: Quality Dashboard (вторая итерация)

**На BE — endpoint для агрегатов.**
```
GET    /api/v1/admin/quality-overview?company_id=&days=7
```
Возвращает per-agent:
- agreement_rate (shadow)
- judge distribution (good/bad/neutral counts)
- escalation_rate
- p95 latency
- avg cost / conversation
- eval pass rate (last run)

**На FE — `app/(dashboard)/admin/quality/page.tsx`** (Phase 5 фронт).

UI:
- 8 карточек агентов, каждая показывает agreement / judge / cost
- Кнопка «View traces» → список 50 последних с фильтром «human_override IS NOT NULL» — где агент косячит чаще всего
- Click на trace → TraceDrawer (уже готов на фронте)

---

## 3. Frontend инфраструктура — статус

**Уже сделано параллельно с написанием этого ТЗ** (на mock данных, переключение на real BE одной строкой):

| Компонент | Файл | Статус |
|---|---|---|
| Types | `lib/types/agent-trace.ts` | ✅ Готов |
| Mock generator | `lib/mocks/agent-traces.ts` | ✅ Готов |
| Store | `lib/store/agentTracesStore.ts` | ✅ Готов |
| API shell | `lib/api/client.ts` `agentTraces` section | ✅ Reject Promise — fallback в mock |
| `<TraceDrawer>` | `components/agents/trace/TraceDrawer.tsx` | ✅ Готов |
| `<JudgeButtons>` | `components/agents/trace/JudgeButtons.tsx` | ✅ Готов |
| `<TraceTrigger>` | `components/agents/trace/TraceTrigger.tsx` | ✅ Готов |
| `<TraceListItem>` | `components/agents/trace/TraceListItem.tsx` | ✅ Готов |
| `<ShadowProposalCard>` | `components/agents/shadow/ShadowProposalCard.tsx` | ✅ Готов |
| `<ShadowModeBanner>` | `components/agents/shadow/ShadowModeBanner.tsx` | ✅ Готов |
| `<ShadowAgreementCard>` | `components/agents/shadow/ShadowAgreementCard.tsx` | ✅ Готов |
| Shadow mode store | `lib/store/shadowModeStore.ts` | ✅ Готов с persist |
| Demo page | `/_demo/shadow` | ✅ Для теста UI |

**Что Юре нужно сделать на BE чтобы фронт переключился на real:**
1. Реализовать 6 endpoints из Слоя 1 → frontend `apiClient.agentTraces.*` начинает возвращать реальные данные
2. Добавить `companies.agent_modes` JSONB → frontend `shadowModeStore` синкается с BE через новый endpoint

После этого фронт работает без изменений.

---

## 4. Roadmap (3 недели)

| Неделя | Юра (BE) | Я (FE интеграция) |
|---|---|---|
| **1** | Слой 1 (Trace Persistence) — schema + endpoints + хук в BaseAgent | Подключить TraceTrigger в существующий timeline (LeadDetailsPanel timeline + ChatPanel) |
| **2** | Слой 2 (Eval Harness) — runner + 50 кейсов на 2 агентов (frontline, dispatcher) | Создать `/admin/quality` страницу с реальными данными (после endpoints) |
| **3** | Слой 3 (Shadow Mode) — флаг + ShadowToolWrapper + Telegram уведомления | Подключить ShadowProposalCard в Inbox + ShadowModeBanner в cockpit'ы |
| Buffer | Слой 4 (CI) + Слой 5 (dashboard endpoints) | Polish, dark/light verify, accessibility |

---

## 5. Что я могу сделать сегодня (актуально)

**Уже сделано:**
1. ✅ Вся frontend инфра (12 файлов, ~1500 LOC)
2. ✅ Этот документ — единая точка входа для Юры
3. ✅ Demo page `/_demo/shadow` для verify UI работает

**На столе у Юры:**
1. Alembic migration для `agent_traces`
2. SQLAlchemy модель `AgentTrace`
3. Helper `app/agents/tracing.py` с `persist_trace()` и `ShadowToolWrapper`
4. Хук в `BaseAgent.run()` — один insert в конце цикла
5. Простой роутер `/api/v1/agent-traces/*` (read + judge + override + reject)
6. Расширить `companies` table: `agent_modes JSONB DEFAULT '{}'`

Это ~300-400 строк Python. День работы аккуратно.

---

## 6. Метрики успеха (как поймём что работает)

| Метрика | Цель к Q4 2026 |
|---|---|
| Trace coverage | 100% (каждый агентский цикл записан) |
| Owner judge participation | 25% traces с verdict за 7 дней |
| Eval cases per agent | 30+ |
| Eval pass rate per release | 95%+ |
| Mean replay-to-fix time | < 1 час |
| Auto-promoted variants | 70% (gate eval+significance) |
| Shadow → production graduations | минимум 1 per agent в неделю |
| Memory conflicts resolved | < 24 часа |

---

## 7. Anti-scope (не делаем)

1. ❌ Свой LLM
2. ❌ General-purpose agent framework (LangGraph есть)
3. ❌ RLHF training pipeline
4. ❌ Свой MCP server
5. ❌ Multi-tenant eval marketplace
6. ❌ Auto-promote shadow → production без owner click (опасно)
7. ❌ Storage trace-blob > 100KB (тяжёлые конверсации обрезаются с marker «truncated»)

---

## 8. Связь с существующими документами

- **Дополняет** `BACKEND_TZ_YURA_AI_FUNNEL_OS.md` — добавляет инфраструктурный слой под F2 (Playbooks), F9 (Memory Handoff), F10 (Closed-Loop)
- **Заменяет** `AGENTIC_ENGINEERING_TZ.md` (V1) — этот документ её улучшенная версия с реальной shadow mode и без «придуманных endpoint`ов» вместо актуальной BaseAgent архитектуры
- **Не пересекается** с `BACKEND_TZ_YURA_LEAD_PROFILER.md` — тот про конкретного агента

---

## Frontend Hardening (May 2026)

**Источник:** this project light-theme dashboard audit, run `2026-05-06-2107-light-dashboard` — 4 audit roles в параллель, 83 finding, branch `dev` HEAD `c23c37c`. 19 macro-уровневых items требуют design-tier ревью до того как код ляжет (остальные 64 уже разобраны: 17 high+micro закрываются в текущей сессии, 30 medium+micro в pre-deploy polish, 17 low в backlog).

**Один-line вердикт аудита:** скелет правильный, исполнение рыхлое. Patterns documented, enforcement absent. До operator-grade (Linear / Vercel / Stripe) — 2 недели работы по 7 cross-cutting темам ниже.

**Документ:** `docs/agents/runs/2026-05-06-2107-light-dashboard/report.md` (полный отчёт, 230 строк) + `findings.jsonl` (raw 83 находки).

---

### Тема 1 — Token system enforcement (3 items)

Дизайн-система описана, но lint её не защищает. Drift накапливается каждый PR.

#### 1.1 Bulk fix `-300` shades через extension to `globals.css` (`vis-003`, severity high)

**Сейчас.** `text-emerald-300` / `text-rose-300` / `text-amber-300` на белой карточке = contrast 1.6-1.7:1, fails WCAG AA. Используется в 8 sibling страницах `app/(dashboard)/agents/*/variants/page.tsx` для KPI numerics ("CLOSED 105", "OVERALL CONV. 27.3%") и per-variant percentages. Override block в `globals.css:539-545` покрывает `-400 / -500 / -600` оттенки, но **не `-300`** — это и объясняет systemic miss.

**Целевой state.** Either bulk replace `text-emerald-300 → text-emerald-600` / `text-rose-300 → text-rose-700` / `text-amber-300 → text-amber-700` в 20 файлах, либо расширить `globals.css:539-545` ещё одним блоком на `-300` shades. Stripe Dashboard и Linear используют `-700+` для текста на светлых поверхностях во всех KPI карточках.

**Acceptance criteria.**
- На `/agents/{closer,frontline,dispatcher,cfo-biller,service-advisor,customer-success,growth,lead-profiler}/variants` все цифры читаются (≥4.5:1 contrast)
- `globals.css` либо содержит block `text-emerald-300 / text-rose-300 / text-amber-300 / text-blue-300 → -700` в light, либо все 20 страниц переведены на `-600/-700`
- Проверка инструментом: `npx playwright test contrast.spec.ts` зелёный

**Scope:** 1 день (если расширить override — 1 час; если bulk replace — полдня + smoke test всех 8 cockpit'ов).

#### 1.2 Audit `globals.css:474-486` forced-white override (`vis-010`, severity medium)

**Сейчас.** Глобальный rule в `globals.css:474-486` форсит `color: #fff !important` на каждый элемент с `bg-emerald-500 / bg-amber-500 / bg-blue-500 / bg-rose-500 / bg-violet-500`. Это silent override любого explicit `text-black` в коде. Кнопка "Apply & A/B test" на `/insights` имеет class `bg-emerald-500 text-black`, но computed `color: rgb(255,255,255)` — contrast 1.85:1.

**Целевой state.** Override либо убран (компоненты сами выбирают цвет текста через token), либо scoped через `:where()` так чтобы explicit `text-*` siblings побеждали. Linear делает обратно: `bg-emerald-600` (тёмнее, безопасно для белого текста), `bg-emerald-100` для текста-цвета-эмеральд на светлом фоне. У нас должна быть та же дисциплина: `-500` shade для CTA не используется, только `-600/-700`.

**Acceptance criteria.**
- Кнопка "Apply & A/B test" имеет computed `color: black` ИЛИ перекрашена на `bg-emerald-700`
- Никаких `bg-X-500` solid CTAs в кодовой базе (grep + lint rule)
- Документировано в `docs/DESIGN_SYSTEM.md`: solid CTA = `-600/-700`, tinted surface = `-100`

**Scope:** 1 день.

#### 1.3 ESLint plugin: `no-raw-hex-color`, `no-tinted-surface-bg`, `no-inline-z-index` (база enforcement)

**Сейчас.** 30+ brand-vendor hex (Google `#4285F4`, Facebook `#1877F2`, Yelp `#D32323`, Stripe `#635BFF`, Monday `#FF3D57`) дублируются по компонентам без `--brand-*` токенов (`code-015`). 19 inline `z-[N]` игнорируют `--z-*` scale (`code-005`). `bg-amber-500/10` tinted surfaces появлялись на toast'ах.

**Целевой state.** Custom ESLint plugin в `tools/eslint-plugin-app/` с правилами:
- `no-raw-hex-color` — запрещает `#xxxxxx` literals в `.tsx` файлах за пределами `tailwind.config.ts` и `globals.css`. Authorized whitelist: `--brand-*` tokens.
- `no-tinted-surface-bg` — запрещает `bg-X-{shade}/N` (transparent tinted bg) на surfaces. Toasts, banners, cards = solid + colored left bar (canonical pattern из mid-run fix).
- `no-inline-z-index` — запрещает `z-[N]` literals, требует token из `--z-*` scale.

**Acceptance criteria.**
- `npx eslint app/ components/` без warnings по этим правилам
- Plugin задокументирован в `docs/CODING_STANDARDS.md`
- CI запускает lint на каждый PR; pre-commit hook ловит локально

**Scope:** 3 дня (плагин + миграция всех call-sites + интеграция в CI).

---

### Тема 2 — Decompose 6 monoliths (1 item, ~12,720 LOC)

Refactor Surgeon role в orchestra существует. Декомпозиция должна происходить по одной находке за раз с smoke-test на каждом шаге.

#### 2.1 Шесть файлов нарушают 400-LOC rule в 3-9 раз (`code-010`, severity medium)

**Сейчас.**

| File | LOC | Что внутри |
|---|---:|---|
| `app/(dashboard)/settings/page.tsx` | 3444 | Hardcoded colors, 17-branch tab dispatcher (`decomp-001`) |
| `app/(dashboard)/voice-ai/page.tsx` | 2638 | 5 inline tab functions (`decomp-002`) |
| `components/sales/SalesBattleHud.tsx` | 2258 | 28 inline sub-components (`decomp-003`) |
| `components/conversations/LeadDetailsPanel.tsx` | 1758 | 32 useState, 10 useEffect (`decomp-004`, `code-018`) |
| `components/layout/Sidebar.tsx` | 1342 | Decorative SVGs inline (`decomp-005`) |
| `components/command-center/AgentFleetDashboard.tsx` | 1282 | 4 inline shells (`decomp-006`) |

**Целевой state.** Каждый файл декомпозирован по правилу из `~/.claude/rules/decompose-react-components.md`:
- `settings/page.tsx` → `_panels/{tab}.tsx` (по 1 файлу на tab, ~10 файлов по 200-300 LOC)
- `voice-ai/page.tsx` → `components/voice-ai/tabs/{tab}.tsx` (5 файлов)
- `SalesBattleHud.tsx` → `battle-hud/parts/` + 1 entry orchestrator
- `LeadDetailsPanel.tsx` → `lead-details/parts/` + custom hook на 32 useState
- `Sidebar.tsx` → `sidebar/decorations/`, `sidebar/SubscriptionTrialCard.tsx`, `sidebar/SidebarSearchRow.tsx` (см. Тема 7)
- `AgentFleetDashboard.tsx` → `fleet/parts/{Header,KPI,List,Footer}.tsx`

Linear & Stripe держат page файлы под 200 LOC: только composition + 1-2 hooks на params/searchParams. Всё остальное в `components/`.

**Acceptance criteria.**
- Каждый из 6 файлов под 400 LOC (page-уровневые под 200)
- `npx tsc --noEmit` зелёный
- Smoke-test каждой страницы: визуально идентично pre-refactor screenshot
- Никакая логика не потеряна (diff на behaviour = 0)
- Все custom hooks в `hooks/use*.ts` файлах рядом

**Scope:** 1 неделя на все 6 (по дню на файл с smoke-test). Refactor Surgeon делает serial, не parallel — каждый файл отдельная PR.

---

### Тема 3 — Extract 5 missing primitives (6 sub-items)

Decomposition Architect нашёл 25+ дубликатов 5 primitives. Single sweep даёт ~600 LOC удалённой duplication и единое accessible behaviour на каждый primitive.

#### 3.1 `components/ui/Toggle.tsx` — Toggle primitive (`decomp-007`, severity high)

**Сейчас.** `ToggleSwitch` определена 4 раза (`AgentConfigPanel.tsx:36`, `SettingsTab.tsx:79`, `AdvancedSettings.tsx:95`, `site-chat/page.tsx:36`). `ToggleRow` определена 6 раз (`SalesSettingsTab.tsx:762`, `AgentConfigPanel.tsx:54`, `VoiceTab.tsx:324`, `AdvancedSettings.tsx:121`, `settings/page.tsx:2443`, `automations/page.tsx:356`). Все используют `button[role=switch]` + animated thumb с одинаковой a11y семантикой.

**Целевой state.** `components/ui/Toggle.tsx` экспортирует:
- `ToggleSwitch` (atomic, props: `on, onChange, accent?`)
- `ToggleRow` (label + description + `ToggleSwitch`, props: `label, description?, on, onChange, accent?`)

Все 10 call-sites переключены на import из `@/components/ui/Toggle`.

**Acceptance criteria.**
- Файл создан с типизацией и aria-атрибутами (`role="switch"`, `aria-checked`, `aria-labelledby`)
- Grep `function ToggleSwitch` и `function ToggleRow` в `components/` и `app/` возвращает 0
- Storybook story (если используется) или demo на `/_demo/ui-primitives`
- ~150 LOC duplication удалено

**Scope:** 1 день.

#### 3.2 `components/ui/Section.tsx` — Section / CollapsibleSection primitive (`decomp-008`, severity high)

**Сейчас.** `function Section` определена 9 раз (`SalesSettingsTab.tsx:21`, `AgentConfigPanel.tsx:168`, `CustomAgentWorkspace.tsx:385`, `ApplicationsQueue.tsx:331`, `AgentConsolePanel.tsx:229`, `DeepDivePanel.tsx:180`, `BrandingTab.tsx:216`, `VariantEditor.tsx:267`, плюс две в site-chat). `CollapsibleSection` ×2. `CollapsiblePanelSection` в `LeadDetailsPanel.tsx:1090`. Две визуальные вариации — always-open и collapsible — обе с identicial title+icon+body shape.

**Целевой state.** `components/ui/Section.tsx` экспортирует `Section` с props `{ title, icon?, children, defaultOpen?, collapsible?, action? }`. Default = open + non-collapsible. При `collapsible=true` — chevron + animated reveal. Pattern matches existing `components/ui/Card.tsx` + `components/ui/Accordion.tsx` (Accordion для глубоких иерархий, Section для 1-уровневых).

Notion и Linear используют ровно такой компонент для всех настроек, FAQ, sidebar groups. Один primitive — один behaviour.

**Acceptance criteria.**
- 11 call-sites переключены, grep `function Section` в `components/` возвращает 0
- A11y: collapsible вариант управляется keyboard (`Enter` / `Space`), `aria-expanded` корректный
- ~250 LOC duplication удалено

**Scope:** 1 день.

#### 3.3 `components/ui/StatCard.tsx` — Metric / KPI / Stat primitive (`decomp-009`, severity medium)

**Сейчас.** Семь различных имён, одна форма: `MetricCard` (`DashboardWidget.tsx:80`, `AnalyticsTab.tsx:41`), `KPICard` (`AgentWorkspaceHeaderV2.tsx:186` — самая развитая сигнатура с sparkline), `MetricTile` (`DealScorePanel.tsx:86`), `StatCard` (`command-center/page.tsx:219`, `team-training/page.tsx:307`, `voice/page.tsx:234`), inline `FleetKPI` в `AgentFleetDashboard.tsx:359`. `macro-009` отдельно просит sparklines на FleetKPI — perfect момент консолидировать.

**Целевой state.** `components/ui/StatCard.tsx` props: `icon?, label, value, delta?, deltaLabel?, sublabel?, sparkline?, trend?`. Сигнатура матчит `KPICard` из `AgentWorkspaceHeaderV2` (она уже самая полная). Stripe Dashboard и Vercel используют единый StatCard на всех overview страницах — одна форма, один behaviour, optional sparkline и delta-vs-prior.

**Acceptance criteria.**
- 7+ call-sites consolidated
- FleetKPI получает sparkline (закрывает `macro-009`)
- ~300 LOC duplication удалено
- Storybook / demo показывает все 4 состояния (с sparkline / без, positive / negative delta)

**Scope:** 2 дня (extraction + sweep + sparkline integration).

#### 3.4 Удалить inline `Sparkline` дубликаты (`decomp-010`, severity medium)

**Сейчас.** Canonical `components/ui/Sparkline.tsx` уже существует. Но inline reimplementations в `AnalyticsTab.tsx:101` (function Sparkline + SparklineProps), `RichArtifactCards.tsx:580` (function Sparkline), `PerformanceTrendsCard.tsx:99` (function SparklineCell + l.145 function Sparkline). Вычисляют тот же SVG path — pure code-smell.

**Целевой state.** В каждом дубликате: удалить локальную `function Sparkline` + `SparklineProps` interface, заменить на `import { Sparkline } from '@/components/ui/Sparkline'`. Если duplicate имеет prop, которого нет в canonical — расширить canonical, не оставлять fork. `PerformanceTrendsCard`'s `SparklineCell` остаётся как thin wrapper на `<Sparkline />`.

**Acceptance criteria.**
- `grep -r "function Sparkline" components/` возвращает только `components/ui/Sparkline.tsx`
- Все 3 страницы рендерят идентично pre-fix screenshots
- Пропсы canonical расширены если нужно (документировано в comment header)

**Scope:** 0.5 дня.

#### 3.5 `components/ui/Field.tsx` — Field primitive (`decomp-013`, severity medium)

**Сейчас.** `function Field` определена 11 раз: `CreateContestModal.tsx:501`, `SalesSettingsTab.tsx:750`, `VariantEditor.tsx:279`, `CommissionAdjustments.tsx:181`, `ApplicationsQueue.tsx:340`, `ActionBuilder.tsx:373`, `SnapshotPublishModal.tsx:305`, `BrandingTab.tsx:228`, `CampaignComposer.tsx:403`, `OnboardingWizard.tsx:429`, `phone-numbers/page.tsx:335`. Две distinct shapes: (1) wrapper с children (8 call-sites), (2) form input с label/value/onChange (3 call-sites).

**Целевой state.** `components/ui/Field.tsx` экспортирует `Field` (props: `label, icon?, helper?, children`) — wrapper variant. Для form-input variant — расширить `components/ui/Input.tsx` чтобы принимал `label` prop. Это устраняет необходимость дублирования wrapper'а вокруг `<Input>`.

**Acceptance criteria.**
- 11 call-sites consolidated
- `<label>` / `htmlFor` правильно связаны (закрывает часть `code-007`)
- ~200 LOC duplication удалено
- Helper text consistently rendered (text-muted, font-size 13px)

**Scope:** 1 день.

#### 3.6 Name canonical paths для 3 missing primitives (`decomp-015`, severity medium)

**Сейчас.** `macro-001` хочет sidebar search pill, `macro-008` — Breadcrumbs, `macro-010` — SegmentedTabs. Все три просят новый primitive, но если каждый fix создаст файл с своим именем — будет третья волна fragmentation.

**Целевой state.** Создать три файла-плейсхолдера до того как fixes лягут:
- `components/ui/Breadcrumbs.tsx` (props: `items: { label, href? }[], separator?`)
- `components/ui/SegmentedTabs.tsx` (props: `items: { key, label, icon? }[], activeKey, onChange`) — компактный вариант существующего `Tabs.tsx`
- `components/layout/sidebar/parts/SidebarSearchRow.tsx` (per `decomp-005`)

Sibling justification: `components/ui/` уже имеет `Tabs.tsx` (более широкий variant), `Badge.tsx`, `KbdBadge.tsx`. Breadcrumbs и SegmentedTabs ложатся на тот же composable-navigation level.

**Acceptance criteria.**
- 3 файла созданы с минимальной работающей реализацией
- TypeScript типы экспортированы
- Документировано в `docs/DESIGN_SYSTEM.md` под "UI primitives"

**Scope:** 0.5 дня.

---

### Тема 4 — A11y baseline (1 item, 103+ inputs)

#### 4.1 Form inputs без `<label htmlFor>` или `aria-label` (`code-007`, severity high)

**Сейчас.** 103+ `<input type="text|number|email|tel">` по dashboard'у без `id`, без `aria-label`, без `<label htmlFor>`. Sample call-sites: `settings/layout.tsx:170`, `settings/page.tsx:695, 2865, 2896, 3007, 3018, 3175, 3213, 3331`, `settings/portal/page.tsx:254, 281, 483, 495`, `settings/audit-log/page.tsx:198`, `settings/webchat-handoff/page.tsx:159, 261`, `settings/members/page.tsx:124`, `settings/automations/page.tsx:393`, `settings/company/page.tsx:337`. Плюс 10+ icon-only `<button>` без `aria-label` (`code-006`). Плюс `<div onClick>` backdrop overlays, не keyboard-accessible (`code-019`). Плюс cockpit tabs без `aria-selected` (`ux-008`).

Это systemic fail WCAG 1.3.1 (Info and Relationships) + 4.1.2 (Name, Role, Value) + 2.1.1 (Keyboard). Largest single quality breach в кодовой базе.

**Целевой state.** Каждый text input имеет либо `<label htmlFor>` либо `aria-label`. Pattern:

```tsx
<Field label="Company name" helper="Visible to customers">
  <Input id="company-name" value={...} onChange={...} />
</Field>
```

Или для standalone inputs:

```tsx
<Input id="search" aria-label="Search leads" placeholder="..." />
```

Cockpit tabs получают `role="tab"` + `aria-selected={isActive}`. Icon-only buttons получают `aria-label`. `<div onClick>` backdrops становятся `<button>` или получают `role="button"` + `tabIndex={0}` + `onKeyDown`.

Stripe Dashboard и Linear дисциплинированы здесь — каждый input в settings есть либо visible label, либо `aria-label`. Это base, не extra.

**Acceptance criteria.**
- `npx playwright test a11y.spec.ts` (с `@axe-core/playwright`) на dashboard surfaces проходит без critical / serious violations
- Все 103+ inputs имеют либо label либо aria-label (verified grep)
- Cockpit tabs корректно объявлены через ARIA
- Lint rule `no-input-without-label-or-aria` enabled (см. Тема 1)

**Scope:** 3 дня (1 день миграция через `Field` primitive, 1 день оставшихся standalone inputs, 1 день aria audit + axe-core test setup).

---

### Тема 5 — Resolve IA forks (4 items)

Каждый fork = "мы построили дважды и забыли убрать одну". Решение каждого: pick one, document, kill the other.

#### 5.1 `HeroBanner` theme на 63 страницах (`macro-002`, severity high)

**Сейчас.** `components/ui/HeroBanner.tsx:75` устанавливает `backgroundColor: '#1a1f1c'` inline, lines 84-94 layer dark linear-gradients, line 119 hardcodes `color: #fff` на title. В light mode это сваливает чёрный billboard на cream/white dashboard — dominant visual element ignores theme. Используется на 63 страницах.

**Целевой state.** `HeroBanner` gated через `.dark` class. В light mode: surface-tertiary background, foreground text token, soft gold/green tint overlay matching `--site-trust-bar-bg`. Stripe Dashboard, Linear, Notion все theme'ят hero / empty-state surfaces под active theme.

**Acceptance criteria.**
- 63 страницы рендерят hero в light theme как coherent surface
- `<HeroBanner>` принимает `variant?: "dark" | "light" | "auto"` (default "auto" = follow theme)
- Dark mode visual unchanged
- Light mode passes WCAG AA contrast на title/subtitle

**Scope:** 1 день.

#### 5.2 `AgentFleetDashboard` tab switcher tokens (`macro-003`, severity high)

**Сейчас.** `components/command-center/AgentFleetDashboard.tsx:115` active=`bg-white text-black shadow-elev-1 hover:bg-white/90`, line 116 inactive=`text-white/70 hover:text-[color:var(--text-primary)] hover:bg-[color:var(--surface-secondary)]`. На light theme (cream surface) inactive `text-white/70` invisible — pattern leak от former dark-only design. Lines 129, 136, 140 (Create agent, Compare buttons, helper text) тот же dark-only palette.

**Целевой state.** Bare colors заменены на `var(--surface)` / `var(--text-primary)` для active, `var(--text-muted)` для inactive. Stripe и Linear проводят theme switcher через token'ы, чтобы один компонент читался корректно на обоих themes.

**Acceptance criteria.**
- На light + dark theme tab switcher одинаково читаем
- Никаких hardcoded `text-white` / `bg-white` в файле
- `code-003` (active-tab pill duplicate в 11 страницах) использует тот же token-based pattern (см. далее)

**Scope:** 0.5 дня.

#### 5.3 Active-tab pill token-ize (`code-003`, severity medium)

**Сейчас.** Pattern `bg-white text-black shadow-[0_1px_2px_rgba(0,0,0,0.15)]` hardcoded в 11 страницах: `calendar/page.tsx:125, 136, 154, 165`, `commissions/page.tsx:150`, `command-center/page.tsx:912, 923, 984`, `complaints/page.tsx:243`, `voice/page.tsx:134`, `phone-numbers/page.tsx:179`, `campaigns/page.tsx:128`, `service-agreements/page.tsx:184`, `analytics/page.tsx:149`, `ads-overview/page.tsx:97`. На cream theme `bg-white` рядом с cream container = near-white pill, low contrast.

**Целевой state.** `components/ui/TabPill.tsx` (или интеграция в `SegmentedTabs.tsx` из 3.6), маппится на `var(--text-primary)` foreground / `var(--surface-elevated)` container в light, `bg-white text-black` в dark. Один primitive — все 11 call-sites переключаются.

**Acceptance criteria.**
- 11 page files используют `<SegmentedTabs>` или `<TabPill>` вместо raw classes
- Light theme contrast ≥4.5:1
- Dark theme идентичен pre-fix

**Scope:** 1 день.

#### 5.4 Резолв `PageHero` vs `HeroBanner` fork (`macro-007`, severity medium)

**Сейчас.** Two competing primary-page-header components. `grep -l '<PageHero' app/(dashboard) | wc -l` = 2 страницы. `grep -l '<HeroBanner' app/(dashboard) | wc -l` = 63 страницы. `PageHero` (text-only, sentence-case h1) и `HeroBanner` (image-backdrop, serif italic h2) пересекаются по роли. Dominant choice (`HeroBanner`) locked to dark.

**Целевой state.** `docs/HERO_USAGE.md` codifies rule:
- `PageHero` = always-present page identity (h1 + breadcrumb + optional actions). Stripe/Linear pattern.
- `HeroBanner` = dismissible onboarding hint only (закрывается через X, persisted в localStorage).

Migrate 2 `PageHero` страницы либо kill `PageHero` если решение пойти "everywhere HeroBanner". Stripe Dashboard и Linear имеют один canonical page-header pattern и держат его strictly.

**Acceptance criteria.**
- Документ `docs/HERO_USAGE.md` существует
- Codebase consistent: либо все 65 страниц через `PageHero` (HeroBanner становится hint surface), либо unified migration
- Один из двух компонентов deprecated (комментарий + lint warning при использовании в новом коде)

**Scope:** 2 дня (миграция + документация + cleanup).

---

### Тема 6 — Operator-grade affordances (5 items)

Различия между "demo with real mechanics" и "operator-grade product". Каждое — additive feature, не refactor.

#### 6.1 Visible global search / ⌘K pill в sidebar (`macro-001`, severity high)

**Сейчас.** `CommandPalette` mounted через `DashboardOverlays`, открывается только через ⌘K hotkey. Sidebar header (`components/layout/Sidebar.tsx:660-748`) показывает logo + this project name + voice mic, но никакого search input или kbd hint. Новые users не знающие ⌘K никогда не находят palette.

**Целевой state.** `components/layout/Sidebar.tsx:748` — добавить Linear/Vercel-style search row прямо под orchestrator nucleus. Clickable pill: Search icon + "Search…" label + `KbdBadge ⌘K`. Click вызывает `useCommandPaletteStore.getState().open()`. Reuse existing `KbdBadge` component.

Linear: всегда render search pill в topbar ("Find or run a command... ⌘K"). Vercel: то же самое в sidebar header. Это первый touchpoint для нового пользователя.

**Acceptance criteria.**
- Pill виден в sidebar на всех dashboard pages
- Click открывает CommandPalette
- ⌘K hotkey продолжает работать
- На narrow sidebar (collapsed) показывает только icon + tooltip

**Scope:** 0.5 дня.

#### 6.2 Sidebar group headers (`macro-004`, severity medium)

**Сейчас.** Sidebar group labels ('CRM', 'AGENTS', 'WORKSPACE', 'DASHBOARDS') рендерятся 10-11px UPPERCASE с letter-spacing 0.14em (`Sidebar.tsx:774, 910, 1086, 1262`). Linear, Stripe Dashboard и Vercel все используют sentence-case labels at 12-13px. Uppercase читается как "enterprise software from 2014" и снижает scannability. Конфиг (`mvpSidebarConfig`) уже имеет sentence-case ('Crm', 'Agents', 'Workspace', 'Dashboards') — только visual treatment форсит uppercase.

**Целевой state.** Drop `uppercase tracking-[0.14em]` на 4 location'ах. Bump font-size до `text-[11px]` или `text-[12px]`. Keep `font-semibold` + `text-muted` для secondary-grade hierarchy.

**Acceptance criteria.**
- Headers read как "Crm", "Agents", "Workspace", "Dashboards"
- Никаких uppercase headers в sidebar
- Visual cohesion с marketing site (где уже sentence-case)

**Scope:** 0.25 дня.

#### 6.3 Row-density toggle на pipeline list (`macro-005`, severity medium)

**Сейчас.** `components/pipeline/PipelineListView.tsx:158-243` имеет fixed `py-2` row padding, no toggle. `PipelineToolbar.tsx:70-110` имеет view buttons но не density control. С ~22px row height table показывает ~18 rows на 1080p screen. Stripe Dashboard в compact mode показывает ~30. Operator с 200+ leads нуждается видеть больше rows за раз.

**Целевой state.** `PipelineToolbar.tsx` получает density toggle (Compact / Comfortable / Default) right of view switcher. Persist в `uiStore`. CSS variable consumed by `.pipeline-table tr td` padding.

**Acceptance criteria.**
- Toggle visible в pipeline toolbar
- Compact = ~30 rows / 1080p, Default = текущий
- Setting persists across sessions через uiStore
- Stripe / Notion parity

**Scope:** 1 день.

#### 6.4 Inline-edit на kanban cards (`macro-006`, severity medium)

**Сейчас.** `components/pipeline/DealCard.tsx:71-195` — entire card один button вызывающий `onClick` (`selectDeal` opens detail panel). No double-click rename, no inline value edit, no popover stage picker. Compared to Asana/Monday/Notion это extra click для каждого micro-edit.

**Целевой state.** `DealCard.tsx:94` wrap `deal.title` в double-click-to-edit text input. Right-click context menu с 'Rename', 'Change stage', 'Edit value', 'Assign to'. Дешевле чем redesign DealDetailPanel и матчит expectations kanban operators.

**Acceptance criteria.**
- Double-click на title начинает inline edit
- Right-click открывает context menu с 4 actions
- ESC отменяет edit, Enter сохраняет
- Optimistic update в pipelineStore + revert on API fail
- Detail panel остаётся для глубокого редактирования

**Scope:** 3 дня.

#### 6.5 Breadcrumbs на cockpit pages (`macro-008`, severity medium)

**Сейчас.** Breadcrumb на agent workspace ad-hoc `Link + ChevronRight` только в `AgentWorkspaceHeaderV2.tsx:63-70`. `AgentDetailHeader.tsx:31` имеет другой implementation. Marketing site имеет `SiteBreadcrumbs.tsx` с JSON-LD, но dashboard не имеет shared `Breadcrumbs` primitive. Каждый workspace re-implements.

**Целевой state.** Создать `components/ui/Breadcrumbs.tsx` (per `decomp-015` 3.6). Mirror marketing-site pattern. Refactor `AgentWorkspaceHeaderV2.tsx:63-70` и `AgentDetailHeader.tsx:31` на использование. Wire через path-based map (`BREADCRUMB_MAP` pattern из Pioneer-Enterprise project).

Linear / Stripe / Vercel rendering breadcrumbs на каждой interior page (deal, agent, settings sub-page) consistently.

**Acceptance criteria.**
- `components/ui/Breadcrumbs.tsx` exists и используется в 2+ workspace headers
- `BREADCRUMB_MAP` covers все cockpit routes
- Click на breadcrumb navigates через Next router
- Mobile responsive (truncate с tooltip на narrow screens)

**Scope:** 1 день.

---

### Сводка scope (Frontend Hardening)

| Theme | Items | Est. scope |
|---|---:|---:|
| 1. Token enforcement | 3 | 5 days |
| 2. Decompose monoliths | 1 (6 files) | 5 days |
| 3. Extract primitives | 6 | 4 days |
| 4. A11y baseline | 1 | 3 days |
| 5. Resolve IA forks | 4 | 4.5 days |
| 6. Operator-grade affordances | 5 | 5.75 days |
| **Total** | **20 sub-tasks (19 audit findings)** | **~5 weeks** |

С двумя FE инженерами параллельно по non-conflicting файлам — **2.5 недели** до operator-grade baseline. Темы 1.3 (ESLint plugin) и 4 (A11y baseline) — наибольшая отдача: они блокируют regression в каждом будущем PR.

**Dispatch порядок:**
1. **Week 1.** Тема 1.1 + 1.2 (contrast fixes, 1 день), Тема 3 primitives 3.1-3.3 (4 дня parallel).
2. **Week 2.** Тема 4 (a11y migration через Field primitive из 3.5), Тема 5.1-5.2 (HeroBanner + tab switcher).
3. **Week 3.** Тема 2 (decomposition serial Refactor Surgeon).
4. **Week 4.** Тема 1.3 (ESLint plugin), Тема 6 (operator-grade additive).
5. **Week 5.** Тема 5.3-5.4 cleanup, polish, axe-core integration test.

**Не в scope** этой итерации (backlog 17 low + 30 medium+micro в pre-deploy polish): row sparklines на FleetKPI sit за `decomp-009`, остальные cosmetic.

---

## Приложение A — пример trace JSON (production mode)

```json
{
  "trace_id": "tr_4f8e1234...",
  "company_id": 42,
  "agent_type": "frontline",
  "deal_id": "deal-1778039568057",
  "model_used": "claude-opus-4-7",
  "prompt_version": "1.4.2",
  "mode": "production",
  "input_context": {
    "messages": [
      {"role": "user", "content": "Hi, water leaking from kitchen wall"}
    ],
    "kb_chunks": [
      {"id": "kb-emerg-leak", "title": "Emergency leak protocol", "score": 0.91}
    ]
  },
  "thought": {
    "intent_classification": "emergency_dispatch",
    "urgency": "high",
    "confidence": 0.87
  },
  "actions": [
    {"name": "check_dispatcher_availability", "args": {"window": "30min"}, "result": {"available": true}, "duration_ms": 142}
  ],
  "evaluation": {
    "candidates": [
      {"text": "Can you send a photo?", "score": 0.42, "reasoning": "needs context but loses urgency"},
      {"text": "I can dispatch a tech in 30 min, address?", "score": 0.71, "reasoning": "high urgency, skip qualification"},
      {"text": "Booking next slot at 14:00", "score": 0.65, "reasoning": "default flow, slow for emergency"}
    ],
    "chosen_index": 1,
    "rationale": "urgency outweighs qualification needs"
  },
  "final_output": {
    "channel": "whatsapp",
    "text": "I can dispatch a tech in 30 min, what's your address?"
  },
  "human_override": null,
  "judge_verdict": null,
  "tokens_in": 1842,
  "tokens_out": 47,
  "cost_usd": 0.009425,
  "latency_ms": 342,
  "created_at": "2026-05-05T18:42:11.094Z"
}
```

## Приложение B — пример shadow trace + override

```json
{
  "trace_id": "tr_8a3b7c01...",
  "agent_type": "frontline",
  "mode": "shadow",
  "actions": [
    {"name": "send_message", "args": {"channel": "whatsapp", "text": "..."}, "result": {"shadow_mode": true, "would_execute": true}, "duration_ms": 1}
  ],
  "final_output": {
    "channel": "whatsapp",
    "text": "I can dispatch a tech right away, sending booking link"
  },
  "human_override": {
    "edited_text": "Hi, sorry to hear that. Sending a tech in 30 min — can you confirm address?",
    "editor_user_id": 1003,
    "edited_at": "2026-05-05T18:43:02.119Z"
  },
  "judge_verdict": "neutral",
  "judge_comment": "Tone needed warming, response was too transactional"
}
```

## Приложение C — пример eval case

```json
{
  "id": "ec_emerg_leak_001",
  "name": "Emergency leak — must dispatch in 30min, must not quote price",
  "agent_kind": "frontline",
  "input": {
    "incoming_message": "Hi, water leaking from kitchen wall",
    "customer_persona": {"location": "LA", "tier": "residential"},
    "deal_state": {"stage": "new", "value": null}
  },
  "assertions": {
    "must_contain": ["30 min", "tech"],
    "must_not_contain": ["$", "price", "estimate"],
    "must_call_tool": ["check_dispatcher_availability"],
    "max_tokens_out": 80
  },
  "severity": "block_promotion"
}
```
