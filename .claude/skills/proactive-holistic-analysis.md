# Skill: Proactive holistic systems analysis — invoke BEFORE any incremental dispatch

> Wave: wave-103/108/117 retrospective  |  Status: experimental  |  Tags: [meta, systems-thinking, anti-tunnel-vision, architecture, pre-dispatch]

---

## When this skill MUST fire (trigger phrases)

When the user uses ANY of these phrases or semantic equivalents:

- "максимально передовое" / "state of the art" / "industry-leading" / "best in industry"
- "качественно" / "professionally" / "world-class"
- "правильная архитектура" / "proper architecture" / "sound architecture"
- "что не хватает" / "what's missing" / "gaps in our system"
- "доработай / improve / enhance" applied к whole system, не one component
- "продумай / think through" applied к architecture, not specific feature
- "от и до" / "end-to-end" / "comprehensive"
- "не иди по пути наименьшего сопротивления" / "don't take shortcuts"

If ANY of these triggers — STOP. Do NOT proceed к dispatch. Run this skill first.

---

## Anti-pattern this skill prevents

**Reactive incremental thinking when holistic restructure is required.**

Example failure pattern (wave-95 → wave-102 → wave-103 sequence):
- User asks "make dev environment state of the art"
- AI interprets narrowly: add more agents, better tests, multi-level verification
- AI dispatches incremental waves adding agents/checks
- AI misses fundamental architectural layer (e.g., 5-level spec hierarchy)
- User surfaces missing pattern: "иерархия структура"
- AI immediately recognizes industry pattern (MDA/DDD/GitOps) — should have surfaced upfront

Root cause: AI focuses on **execution (action)** instead of **paused systems analysis (thinking)** when high-leverage holistic prompts arrive.

---

## Protocol — 6 mandatory steps before any incremental dispatch

### Step 1 — Pause and acknowledge

When trigger fires, **DO NOT** immediately dispatch chief-architect или write code. Write 1-line acknowledgement:

> "Принято. Запускаю holistic systems analysis перед dispatch."

### Step 2 — Industry pattern research

Research current industry state-of-the-art for the domain:

- **Software architecture domain:** OMG MDA, DDD bounded contexts, hexagonal architecture, Spotify squad model, GitOps, schema-first composition (OpenAPI, GraphQL federation), TLA+ formal specs, Karpathy Software 2.0
- **AI agent domain:** Anthropic Constitutional AI, Multi-Agent Debate (Liang 2023 MIT), Self-Consistency (Wang 2022), Process Reward Models (OpenAI), Best-of-N (AlphaCode), CrewAI, AutoGen, LangGraph, Spec-Driven Development (Karpathy)
- **Testing domain:** TDD, BDD (Gherkin), property-based testing (QuickCheck/Hypothesis/fast-check), mutation testing (Stryker), chaos engineering (Netflix), formal verification (TLA+, Alloy)
- **DevOps domain:** GitOps (ArgoCD/Flux), continuous delivery, blue-green deploys, canary releases, self-healing pipelines, observability (OpenTelemetry, Datadog APM)
- **Documentation domain:** ADRs (Michael Nygard), living docs (Cucumber, Pivotal), C4 model (Simon Brown), Structurizr, OpenAPI generators

If unsure about cutting-edge state, **invoke WebSearch** for recent industry articles (2024-2026 vintage).

### Step 3 — Map existing pieces to industry patterns

List what we already have in this domain. Then map к industry-equivalent patterns:

| What we have | Industry pattern this implements (partial?) |
|---|---|
| Constitutional docs | L0 in MDA hierarchy / DDD aggregate root |
| Wave specs | L4 delta / commit-level spec |
| ADRs (`docs/decisions/`) | Architecture Decision Records (already correct pattern) |
| Quad-Lens architects | Multi-Agent Debate pre-implementation (already correct pattern) |
| Reflexion Critic | Constitutional AI critique loop (partial — needs revise loop) |

Identify which layers/patterns are **implicit but not formalized**.

### Step 4 — Gap analysis vs industry state-of-the-art

For each industry pattern relevant to the domain, ask:

1. Do we have this pattern? (✅/❌/⚠ partial)
2. If ❌ or ⚠: why missing — accidental или intentional?
3. If accidental: this is a **gap to surface to user**
4. If intentional: document the trade-off в open questions

Build comprehensive list of gaps. Aim for **15-25 items** if the prompt is "make X state of the art" — fewer means likely missed something.

### Step 5 — Propose foundational restructure BEFORE incremental additions

Present к user в this order:

1. **Holistic gap list** (15-25 items) — show breadth
2. **Foundational restructure proposal** — what fundamental change underlies all incremental additions
3. **Wave decomposition** — sequenced from foundation → incremental
4. **Ask explicit approval** for the restructure direction BEFORE dispatching any wave

Format:

```markdown
# <Domain> Analysis — what's missing vs industry state of the art

## ✅ What we have (X items)
[table — current state mapped к industry patterns]

## ❌ What's missing (Y items — sorted by foundational vs incremental)
[table — gap items с industry reference + impact]

## 🏗 Foundational restructure proposed
[1-3 paragraph describing the architectural shift]

## 🗺 Wave decomposition
[sequenced list — foundation waves first, incremental after]

## ❓ Open questions blocking direction
[2-5 questions requiring user decision]
```

### Step 6 — Wait for explicit approval

DO NOT dispatch any waves until user explicitly approves direction. Acceptable approval signals:
- "approve" / "go" / "yes" / "делай"
- "make it so" / "ship it"
- "вперёд" / "поехали"

If user пытается shortcut ("just start" / "просто начни") — push back ONCE:

> "Готов начать. Но перед dispatch — confirm: foundational restructure (option A) или incremental only (option B)? Это влияет на 80% downstream работы."

---

## Examples — when to invoke

**INVOKE — example 1:**
> User: "сделай нашу dev environment максимально передовой"
> ↳ Trigger phrase: "максимально передовой"
> ↳ Run all 6 steps. Do NOT dispatch wave directly.

**INVOKE — example 2:**
> User: "что не хватает для 100% попадания задач?"
> ↳ Trigger phrase: "что не хватает" + holistic scope ("100% попадания")
> ↳ Run gap analysis. Surface 15+ items.

**SKIP — example 3:**
> User: "добавь edit rate panel"
> ↳ Specific incremental request, no trigger phrases. Standard chief-architect dispatch.

**SKIP — example 4:**
> User: "fix the bug в Sidebar.tsx"
> ↳ Specific bug fix. Standard frontend-agent dispatch.

**INVOKE — example 5:**
> User: "наша среда разработки должна быть качественной"
> ↳ Trigger phrase: "качественной" + holistic scope ("наша среда разработки")
> ↳ Run holistic analysis.

---

## What this skill does NOT do

- Does not replace chief-architect (chief-architect runs AFTER this skill approves direction)
- Does not skip Quad-Lens briefs (those still run для each wave dispatched)
- Does not block S-effort polish waves (only foundational restructure decisions)
- Does not require WebSearch on every invocation (only if unsure about cutting-edge state)

---

## Anti-patterns this skill catches

| Anti-pattern | Fix |
|---|---|
| Jumping к chief-architect dispatch on "make X state of the art" prompts | Run all 6 steps first |
| Listing 3-5 incremental additions when user expects holistic restructure | Aim for 15-25 gap items |
| Anchoring on existing structure ("what to add nearby") | Ask "what fundamental restructure?" |
| Cognitive blindspot on industry frameworks (MDA, DDD, etc.) | Step 2 industry research is non-negotiable |
| Execution bias (dispatching агентов immediately) | Step 6 wait for explicit approval |
| Closing one axis and assuming others closed | Step 4 multi-dimensional gap analysis |

---

## Memory integration

After invocation, record findings к memory MCP:

```yaml
Entity: "<domain>-state-of-art-analysis-<date>"
EntityType: HolisticAnalysis
Observations:
  - "15 gaps surfaced"
  - "Foundational restructure: <one-line>"
  - "Industry patterns invoked: MDA, DDD, GitOps"
  - "User direction: <decision>"
Relations:
  - INFORMS → wave-NN (foundational wave from analysis)
  - INFORMS → wave-MM (incremental wave from analysis)
```

This builds a track record. Self-Improvement Reviewer reads these entries cross-window к catch recurring blindspots.

---

## Source

- wave-103 / wave-108 / wave-117 retro: AI initially missed 5-level spec hierarchy when user asked "максимально передовая dev environment". User had to surface pattern explicitly ("основная спека → cascade"). This skill prevents recurrence.
- Industry references: OMG MDA spec, Eric Evans DDD (2003), Michael Nygard ADRs (2011), Anthropic CAI (2022), Multi-Agent Debate (Liang et al. 2023 MIT).
- Aligned с existing skills: `surface-audit-before-touch` (UI level analog), `root-cause-over-patch` (debugging level analog).
