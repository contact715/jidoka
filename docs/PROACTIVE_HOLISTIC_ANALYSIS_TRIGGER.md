---
status: Active
version: 1.0.0
level: L1
type: core-arch
owner_role: platform
parents:
  - path: docs/MISSION.md
    version: 1.0.0
    relationship: implements
  - path: docs/PRODUCT_PHILOSOPHY.md
    version: 1.0.0
    relationship: refines
children: []
breaking_change_in_v: null
created: 2026-05-27
last_validated_against_parents: 2026-05-27
last_updated: 2026-05-27
---

# Mandatory: Proactive Holistic Analysis Trigger

**Status:** Active dev-workflow rule (wave-117 retro)
**Level:** L1 — Core Architecture (dev environment governance)
**Enforcement:** Every Claude session reads this. Skill at `.claude/skills/proactive-holistic-analysis.md`.

---

## Why this rule exists

After wave-95 (SDD infra) → wave-102 (Quality Agency) → wave-103 (Multi-Level Verification) shipped, user surfaced а major architectural pattern AI missed: 5-level hierarchical spec system (L0 Constitution → L1 Core → L2 Domains → L3 Modules → L4 Waves). Three full waves of incremental work happened before AI recognized что user wanted holistic restructure, не more incremental additions.

Root cause: **reactive incremental thinking** when user asked "максимально передовое". AI interpreted narrowly (add more agents, better tests) instead of asking "what fundamental architecture is missing?".

This document encodes the fix permanently — git-tracked, every session reads, no recurrence.

---

## Trigger phrases — STOP and run holistic analysis

When user uses ANY of these phrases или semantic equivalents, DO NOT proceed к chief-architect dispatch. Run `.claude/skills/proactive-holistic-analysis.md` first.

### English triggers
- "state of the art"
- "industry-leading"
- "best in industry"
- "world-class"
- "what's missing"
- "gaps in our system"
- "proper architecture" / "sound architecture"
- "comprehensive"
- "end-to-end"
- "don't take shortcuts"

### Russian triggers
- "максимально передовое"
- "качественно"
- "что не хватает"
- "правильная архитектура"
- "от и до"
- "не иди по пути наименьшего сопротивления"
- "доработай" (applied к whole system)
- "продумай" (applied к architecture)

### Semantic equivalents

Any phrase that implies:
- Holistic system-wide quality improvement (not specific feature)
- Comparative framing к industry/competitors
- Open-ended scope ("what's missing", "что доработать")
- Foundational keywords (architecture, structure, foundation, infrastructure)

---

## The 6-step protocol (mandatory)

When trigger fires:

### Step 1 — Pause and acknowledge

Write 1-line acknowledgement. Do NOT immediately dispatch chief-architect или frontend-agent.

> "Принято. Запускаю holistic systems analysis перед dispatch."

### Step 2 — Industry pattern research

Research current state-of-the-art for the domain. Reference frameworks:

| Domain | Industry references |
|---|---|
| Software architecture | OMG MDA, DDD bounded contexts, hexagonal architecture, GitOps, schema-first composition, TLA+ formal specs, Karpathy Software 2.0 |
| AI agent systems | Anthropic Constitutional AI (Bai 2022), Multi-Agent Debate (Liang 2023 MIT), Self-Consistency (Wang 2022), Process Reward Models (OpenAI), Best-of-N (AlphaCode), CrewAI, AutoGen, LangGraph, Anthropic Skills |
| Testing | TDD, BDD (Gherkin), property-based (QuickCheck/Hypothesis/fast-check), mutation (Stryker), chaos engineering (Netflix), formal verification (TLA+, Alloy) |
| DevOps | GitOps (ArgoCD/Flux), continuous delivery, blue-green, canary, self-healing pipelines, observability (OpenTelemetry, Datadog APM) |
| Documentation | ADRs (Michael Nygard 2011), living docs (Cucumber, Pivotal), C4 model (Simon Brown), Structurizr, OpenAPI generators |

If unsure про cutting-edge state, invoke WebSearch для recent 2024-2026 articles.

### Step 3 — Map existing к industry patterns

Build table:

| What we have | Industry pattern this implements (full / partial / missing) |
|---|---|
| Constitutional docs | L0 в MDA hierarchy / DDD aggregate root |
| Wave specs | L4 delta / commit-level spec |
| ADRs (`docs/decisions/`) | Architecture Decision Records (correct) |
| Quad-Lens architects | Multi-Agent Debate pre-impl (correct) |
| Reflexion Critic | Constitutional AI critique loop (partial — needs revise loop) |

### Step 4 — Gap analysis vs industry state-of-the-art

For each relevant industry pattern, ask:
1. Do we have this pattern? ✅ / ❌ / ⚠ partial
2. If ❌ или ⚠: accidental или intentional?
3. If accidental: surface to user as gap

**Aim for 15-25 gap items** if prompt is "make X state of the art". Fewer means likely missed something.

### Step 5 — Propose foundational restructure BEFORE incremental

Present к user в this order:

```markdown
# <Domain> Analysis — what's missing vs industry state of the art

## ✅ What we have (X items)
[table — current state mapped к industry patterns]

## ❌ What's missing (Y items)
[table — gap items с industry reference + impact + effort estimate]

## 🏗 Foundational restructure proposed
[1-3 paragraphs describing architectural shift]

## 🗺 Wave decomposition (sequenced foundation → incremental)
[ordered list]

## ❓ Open questions blocking direction
[2-5 questions]
```

### Step 6 — Wait for explicit approval

Do NOT dispatch any waves until user explicitly approves direction.

Acceptable signals: "approve" / "go" / "yes" / "делай" / "make it so" / "ship it" / "вперёд" / "поехали"

If user pushes к shortcut ("just start" / "просто начни"), respond ONCE:

> "Готов начать. Но перед dispatch — confirm: foundational restructure (option A) или incremental only (option B)? Это влияет на 80% downstream работы."

---

## Examples — when to invoke

| Prompt | Trigger? | Why |
|---|---|---|
| "сделай dev environment максимально передовой" | ✅ INVOKE | "максимально передовой" + holistic scope |
| "что не хватает для 100% попадания задач?" | ✅ INVOKE | "что не хватает" + holistic scope |
| "наша среда разработки должна быть качественной" | ✅ INVOKE | "качественной" + holistic scope |
| "добавь edit rate panel" | ❌ SKIP | Specific incremental request |
| "fix bug в Sidebar.tsx" | ❌ SKIP | Specific bug fix |
| "review этот PR" | ❌ SKIP | Specific review task |
| "продумай архитектуру верификации agents" | ✅ INVOKE | "продумай" + "архитектуру" |

---

## What this rule does NOT do

- Does not replace chief-architect (chief-architect runs AFTER this rule approves direction)
- Does not skip Quad-Lens briefs (they run per dispatched wave)
- Does not block S-effort polish waves (only foundational restructure decisions)
- Does not require WebSearch on every invocation (only if unsure about cutting-edge state)

---

## Anti-patterns prevented

| Anti-pattern | Fix |
|---|---|
| Jumping к chief-architect dispatch on "state of the art" prompts | Run all 6 steps first |
| Listing 3-5 incremental additions when user expects holistic restructure | Aim for 15-25 gap items |
| Anchoring на existing structure ("what to add nearby") | Ask "what fundamental restructure?" |
| Cognitive blindspot на industry frameworks | Step 2 industry research mandatory |
| Execution bias (dispatching agents immediately) | Step 6 wait for explicit approval |
| Closing one axis and assuming others closed | Step 4 multi-dimensional gap analysis |

---

## Memory integration

After invocation, record findings к memory MCP:

```yaml
Entity: "<domain>-state-of-art-analysis-<date>"
EntityType: HolisticAnalysis
Observations:
  - "X gaps surfaced"
  - "Foundational restructure: <one-line>"
  - "Industry patterns invoked: <list>"
  - "User direction: <decision>"
Relations:
  - INFORMS → wave-NN (foundational wave from analysis)
  - INFORMS → wave-MM (incremental wave from analysis)
```

Self-Improvement Reviewer reads these cross-window к catch recurring blindspots.

---

## Source

- Wave-103 / wave-108 / wave-117 retro: AI initially missed 5-level spec hierarchy when user asked "максимально передовая dev environment"
- Industry references: OMG MDA, Eric Evans DDD (2003), Michael Nygard ADRs (2011), Anthropic CAI (2022), Multi-Agent Debate (Liang et al. 2023 MIT)
- Aligned с existing skills: `surface-audit-before-touch` (UI level analog), `root-cause-over-patch` (debugging level analog)
- Memory MCP entities: `anti-pattern-reactive-incremental-thinking`, `skill-proactive-holistic-analysis`, `lesson-systems-thinking-before-execution`

---

## Related

- `.claude/skills/proactive-holistic-analysis.md` — implementation details (gitignored, mirror в `docs/AGENT_ROSTER.md`)
- `docs/AGENT_ROSTER.md` L0.96 Skills section — canonical skill mirror
- `docs/CODING_STANDARDS.md` — workflow standards
- `docs/specs/agent-layer/_INDEX.md` Advanced Industry Capabilities (waves 130-144) — 15-item gap from wave-117 retro applied to dev env

---

## Recurrence learning

Wave-145 finding: this rule was violated within the same session it was created (wave-117 retro). The fix was documented but not enforced. AI shipped 60-70% of the closure and declared done. This is the `partial-closure-via-documentation` anti-pattern (see `docs/ANTI_PATTERNS_CATALOG.md` entry 2).

Root cause: the wave-117 retro fix treated a behavioral rule as closable via documentation alone. No commit hook, no agent gate, no script check was added. The skill file existed; the enforcement layer did not.

Enforcement mechanisms added in wave-145:
- Completion-audit block (`.claude/skills/completion-audit.md`) — must precede any "done" claim
- Partial-fix detection hook (`.githooks/commit-msg`, wave-145 block) — warns on docs-only closure verbs
- Meta-process-auditor (`L0.98`, `scripts/audit-meta-process.mjs`) — detects recurrence across waves
- Anti-pattern catalog (`docs/ANTI_PATTERNS_CATALOG.md`) — 7 entries with enforcement escalation paths
- Git-tracked skill mirror (`docs/skills/`) — portability fix so skills survive fresh-machine provisioning

If this rule recurs after wave-145: the meta-process-auditor will emit `REGRESSION_DETECTED`, blocking new wave dispatch until the human resolves.

Memory MCP: entities `anti-pattern-partial-closure-via-documentation`, `anti-pattern-optimistic-completion-bias`, and `skill-completion-audit` document the relationship between this recurrence and the prevention mechanisms.
