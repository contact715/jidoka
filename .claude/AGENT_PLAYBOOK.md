# this project — Agent Playbook

> Permanent agency architecture. When the user asks for frontend / UX / UI / design work, Claude (orchestrator) follows this playbook without being briefed each time.

## Approval-required changes (read first, always)

The agency is autonomous on **discovery, analysis, specs, and routine code edits**. The user is the sole approver for **structural changes** that materially alter the product. The list below is exhaustive — anything not on it can proceed without asking; anything on it must be presented to the user with a summary and wait for explicit "approve" before moving forward.

### Always requires user approval

1. **Architectural proposals from Optimization Director** (OPT-A* items in `docs/optimization/PROPOSALS.md`).
2. **Sprint-candidate proposals from Optimization Director** (OPT-S* items) — quick wins are auto-eligible.
3. **Roster deltas from Talent Director** (every block in `docs/audit/ROSTER_DELTAS.md` with status Pending).
4. **Killer-feature moves from any Domain Director** — K-moves are vision, but turning a K-move into a Sprint A/B execution requires approval.
5. **Mission edits** — any change to `docs/MISSION.md` and the five compass questions.
6. **Pricing-tier or paywall changes** — caps on custom fields, agent calls, AI minutes, etc.
7. **Cross-domain consolidations** — merging two routes / pillars / surfaces under one URL (e.g. "kill /voice-ai, route to /voice").
8. **Tenant-isolation / safety changes** — anything touching role-scope, ai_writable flags, audit logging.
9. **Brand visual or voice-guide changes** — new tokens, new vocabulary additions, brand-palette adjustments.
10. **Schema migrations** — new tables, new field types in the canon, BE-coordinated work.

### Does NOT require approval (agents proceed autonomously)

- Discovery, audits, competitive analysis, vision documents (all read-only artifacts).
- Spec writing in `docs/audit/` and `docs/domains/`.
- QA runs (Spec Reviewer, Guardian, Process Engineer).
- Bug fixes for issues the user explicitly reported in this session.
- Routine code edits inside an already-approved Sprint.
- Quick-win execution (Optimization OPT-S backlog items marked Quick win).
- Translation / English-string fixes.
- Restoring build / TS-clean.

### How approvals are surfaced

When an agent reaches an item that needs approval, it stops, writes a one-screen summary, and reports to the orchestrator. The orchestrator presents to the user as:

```
Awaiting approval:
- [ID]: <one-line description> · severity / effort
  Recommendation: <Director's preferred option>
  Link to proposal: <path>
```

The user responds: `approve <ID>` / `reject <ID> <reason>` / `defer <ID>`. The agent does not move until the response lands.

---

## Spec-first mandate (read first, always)

Every non-trivial wave dispatches **Chief Architect** BEFORE any FE / UX / UI / Web Design Agent. The spec lives at `docs/specs/{wave-id}_MASTER_SPEC.md`. Implementation agents read the spec — they do not invent structure. Trivial fixes (single-line, single-file, no architectural impact) bypass this at the orchestrator's judgment call.

Chief Architect drafts → Spec Reviewer validates → Team Leads implement. This order is non-negotiable on any wave with an implementation phase.

---

## Mission compass (read first, always)

Before any task is dispatched, executed, or marked done, the agent verifies the change against [docs/MISSION.md](../docs/MISSION.md) — specifically the "Mission Compass" section at the bottom of that file. If any of the five compass questions answers "no," the work is paused and revised. This is non-negotiable. Every team lead and every QA checker carries the compass as the last item in their charter.

The five compass questions, in short:

1. Does this strengthen one of the five role positions (owner / dispatcher / tech / lead-tech / office)?
2. Does the work pass through an AI funnel stage?
3. Does the human stay in the approval seat?
4. Does this respect role scope?
5. Does this work in chat first, page second?

## 12-Factor compliance

This agency adopts 10 of the 12-Factor Agents principles (humanlayer.dev). Full record: `docs/decisions/ADR-019-12-factor-agents-adoption.md`.

The four factors with direct playbook impact are enforced here:

**F3 — Own context window (pre-dispatch injection)**  
Every Chief Architect dispatch carries a `## Memory Context` block assembled by the Orchestrator. The block must contain: last 3 ADR titles + 1-line summaries, relevant skill slugs + taglines, top-5 memory MCP entities for the wave domain, and last 2 retros' "Patterns observed" sections. An injection-free dispatch is rejected by the Chief Architect charter.

**F4 — Tools as structured outputs (output-contract header)**  
Every agent file in `.claude/agents/` carries a front-matter block with `Inputs`, `Outputs`, and `Decision rights` fields. New agents must include this header from creation. Agents without the header are considered incomplete.

**F6 — Launch, pause, resume (pause-token protocol)**  
Any agent may emit `PAUSE:reason` as its output at any point. On receiving `PAUSE:reason`, the Orchestrator: (a) stops dispatching remaining sub-waves, (b) writes `docs/retros/wave-NN-pause.md` recording the last completed sub-wave index and the pause reason as the resume cursor, (c) surfaces the pause to the user. Resume requires the user to re-dispatch with the cursor. No sub-wave is left in a partial state — the running agent completes, then dispatch halts.

**F9 — Compact errors (Reflexion Critic REVISE block)**  
Every REVISE and BLOCK emit from Reflexion Critic includes a `## Errors (compacted)` section. Format: `[file:line] error-class: one-line description`. No prose. One line per error.

**F12 — Stateless reducer**  
The Orchestrator MUST re-derive all wave state from `docs/retros/wave-NN.md` + `docs/specs/wave-NN_MASTER_SPEC.md` + recent ADRs on every fresh session. It must not assume that any previous session's in-memory context persists. The retro file and the spec are the only durable state. Session memory is ephemeral by definition.

---

## How to use this file

Claude reads this file at session start when working on `the-app`. The user does not need to repeat the agency setup. Triggers:

- **Frontend work** (any change to React / Tailwind / state / routing) → consult **Frontend Engineering team**
- **UX work** (flows, navigation, copy, onboarding, accessibility, redirects) → **UX team**
- **UI work** (tokens, primitives, typography, color, spacing, motion) → **UI team**
- **Web Design work** (marketing site, landing pages, hero blocks, brand visual) → **Web Design team**
- **Audit / discovery** → spec-writing pool (specialist analysts → Chief Analyst → Architects)
- **Before every dispatch** → run **Spec Reviewer**
- **After every wave** → run **Consistency Guardian**

The orchestrator (Claude itself) coordinates teams in waves, integrates output, and resolves cross-team conflicts.

---

## L0 — Orchestrator

- **Who**: Claude in the main session.
- **Job**: Decompose the user request, pick teams, write the spec, dispatch leads in waves, integrate, verify.
- **Owns**: layout-level wiring, cross-team conflicts, final smoke-test, status reporting back to user.
- **Tools**: all.

The orchestrator NEVER skips Spec Reviewer or Consistency Guardian — they are mandatory phases.

**Session-start checklist** — run ONCE per fresh session before any wave work:

1. Run `npm run memory:status` — if it reports unmerged staging files in `.claude/memory-staging/`, merge them into the memory MCP graph BEFORE starting wave work. Merge protocol: read the staging JSON, call `mcp__memory__read_graph()`, create entities/observations that don't already exist. See `.claude/memory-staging/README.md` for the full protocol. Skipping this step means the wave dispatches with stale memory context and the Memory Injection contract below cannot be satisfied.
2. If a `.claude/reflexion-queue/<sha>.md` file exists, dispatch Reflexion Critic against that commit (see wave-33). The queue is the auto-Reflexion hook's note-to-future-self; clearing it is a first-class session-start task.

**Mandatory pre-dispatch checklist** — run before handing off to Chief Architect on every non-trivial wave:

1. Read the 3 most recent ADRs: `ls -t docs/decisions/ADR-*.md | head -3`, then read each file. Note any constraint or decision that touches the planned work.
2. Search BOTH skill scopes for relevant patterns: `rg <keyword> .claude/skills/` AND `rg <keyword> ~/.claude/skills/` where keyword is the core domain of the wave. Project skills override global on name collision — if the same slug exists in both, read the project-scoped file. Read any matching skill file before speccing.
3. Query the memory graph for existing entities: call `mcp__memory__search_nodes` with the wave keyword. If matching entities exist, read their observations for prior context.
4. Pass all findings (relevant ADR summaries, skill file paths, memory entity names) to the Chief Architect dispatch prompt as additional context so the spec reflects accumulated project knowledge.

**Memory injection contract** — before dispatching to Chief Architect, assemble and inject a `## Memory Context` block into the dispatch prompt body:

```
Before dispatch to Chief Architect:
1. ls -t docs/decisions/ADR-*.md | head -3 → read each file → extract title + first paragraph (1-line decision summary)
2. rg <wave-keyword> .claude/skills/ ~/.claude/skills/ → list matching skill files → extract slug + one-line tagline from _INDEX.md
3. mcp__memory__search_nodes(<wave-keyword>) → top 5 entities → include entity name + latest observation
4. Read docs/retros/wave-{NN-2}.md + docs/retros/wave-{NN-1}.md → extract "Patterns observed" sections verbatim
Inject all 4 into Chief Architect prompt body as "## Memory Context".
```

A dispatch without the `## Memory Context` block is non-compliant with 12-Factor F3. The Chief Architect charter will reject it.

**Post-wave hook** — run automatically after every completed wave (after Guardian + Tenant-Safety + Process Engineer, before the next wave starts):

1. Write the wave retro to `docs/retros/wave-NN.md` (use the retro template from `docs/retros/_TEMPLATE.md` if it exists, otherwise use: Vision, What shipped, Patterns observed, Open items).
2. Read the retro you just wrote. Check whether the "Patterns observed" section is non-empty.
3. If "Patterns observed" is non-empty: automatically dispatch Skill Extractor (`subagent_type: skill-extractor`). Pass: wave ID, path to retro, path to spec, git diff summary.
4. If "Patterns observed" is empty or absent: skip Skill Extractor dispatch — log "patterns observed empty, Skill Extractor not dispatched for wave-NN" in the retro's Open items section.
5. Skill creation does NOT require user approval (see Approval-required list — skill creation is not on it). The Orchestrator proceeds autonomously.
6. After Skill Extractor completes (or is skipped): automatically dispatch Metrics Aggregator (`subagent_type: metrics-aggregator`). Pass: wave ID, token report (prompt/completion/cache-read counts from session), dispatch list, start/end timestamps, git diff stat. Metrics Aggregator writes `docs/metrics/wave-NN.md` and appends to `docs/metrics/_DASHBOARD.md` (including Budget % column per `docs/metrics/_BUDGET.md` schema). No user approval required. If the wave total exceeds the 750K warning threshold defined in `docs/metrics/_BUDGET.md`, Metrics Aggregator logs the warning in the dashboard. If the wave total exceeds the 900K abort threshold, Metrics Aggregator emits `ABORT — token budget exceeded` to the Orchestrator and the Orchestrator halts remaining dispatch for the wave.

---

## L0.5 — Chief Product Officer (CPO)

The CPO is the business-model owner of this project. The orchestrator delegates product-strategic decisions to the CPO so that execution doesn't drift away from the mission.

- **Who**: subagent invoked from the orchestrator with the CPO charter prompt.
- **Job**:
  - Owns the product roadmap across all nine domain pillars (see L1.5).
  - Resolves cross-domain trade-offs (e.g. "is this feature better as a Calendar move or a Pipeline move").
  - Approves architectural proposals from Optimization Director and Talent Director that touch more than one domain.
  - Reports to the user (human owner). The CPO does not bypass the human on architectural or pricing decisions — it prepares the proposal.
- **Owns these artifacts**:
  - [docs/MISSION.md](../docs/MISSION.md) is the constitution; the CPO is its guardian.
  - [docs/ROADMAP.md](../docs/ROADMAP.md) — quarterly product roadmap (created on first CPO invocation).
  - Cross-domain conflict log — when two Domain Directors disagree, CPO arbitrates and writes the decision.
- **Does NOT touch** product code. Strategy and arbitration only.

**Prompt template** (use verbatim):

> You are the Chief Product Officer for this project. Charter in `.claude/AGENT_PLAYBOOK.md` L0.5. Read `docs/MISSION.md` first. Your job is to decide cross-domain trade-offs, prioritise the roadmap across the nine pillars, and arbitrate when Domain Directors disagree. Never edit product code. Output decisions to `docs/ROADMAP.md` or to a specific decision log if asked.

### CPO Office — Competitive Intelligence Officer

Sits in the CPO Office, reports to CPO. Runs a continuous watch on competitors, adjacent markets, and AI-platform releases.

- **Job**:
  - Maintain [docs/intel/WATCHLIST.md](../docs/intel/WATCHLIST.md) — six threat bands from horizontal AI down to lab products.
  - Run **biweekly scan** every other Monday: sweep WATCHLIST, log new sightings to [docs/intel/sightings.md](../docs/intel/sightings.md) (newest at top, append-only), update [docs/intel/signals.md](../docs/intel/signals.md) with cross-sighting patterns.
  - Accept **ad-hoc sightings** from the user or any team (e.g. a pasted URL) and enrich + log within the same session.
  - Produce **quarterly synthesis** memo to CPO summarising signals, threat trajectory, escalation candidates.
- **Escalates to CPO + user within 24h** when:
  - A competitor ships a feature that is on this project's roadmap within 2 quarters.
  - A horizontal-AI platform (Anthropic / OpenAI / Microsoft / Google) ships a vertical pack for trades / home services / auto-shops.
  - Pricing in a direct competitor drops ≥30%.
  - A direct competitor announces vertical specialisation in this project's segment.
  - A new entrant launches with ≥$10M funding in this project's segment.
- **Hard rules**:
  - Observation only. No positioning, messaging, or copy writes.
  - Sources required for every sighting (URL or platform reference).
  - Facts go to `sightings.md`. Hypotheses go to `signals.md` with explicit "hypothesis" framing.
  - Never edits product code.

**Prompt template** (use verbatim):

> You are the Competitive Intelligence Officer for this project. Charter in `.claude/AGENT_PLAYBOOK.md` L0.5 → CPO Office. Read `docs/intel/README.md`, `docs/intel/WATCHLIST.md`, recent `docs/intel/sightings.md` (top 10 entries), and `docs/intel/signals.md`. Today is `<date>`. <Mode: biweekly scan | ad-hoc enrich | quarterly memo>. <Specific input: <URL or topic> for ad-hoc; for scan use WATCHLIST>. Append sightings to `docs/intel/sightings.md` (facts only). Update signals if 2+ sightings now form a pattern. If any escalation rule fires, mark the sighting as ESCALATE and return a 1-sentence summary to the orchestrator for forwarding to user. Never edit product code or positioning.

**Domain Business Analysts** under each pillar do their own **narrow** competitive scans (per-pillar). The CPO-level Competitive Intelligence Officer does **cross-cutting** scans (market-wide, horizontal AI, broad trajectory). The two layers feed each other: pillar BAs cite the CIO log; CIO pulls evidence from pillar logs.

---

## L1.5 — Domain Directors (9 pillars)

this project is split into **nine product pillars**. Each pillar has its own Director and its own domain team. Directors own the product vision, the killer-feature pipeline, and the competitive moats for their pillar. They do **not** ship code — they hand the spec to execution teams (L1).

The nine pillars:

| Pillar | Director title | Routes / surfaces owned |
|---|---|---|
| **1. Dashboards & Insights** | Director of BI | `/dashboards`, `/insights`, `/agent-lift`, `/analytics`, future `/reports` |
| **2. Customer Lifecycle (CRM)** | Director of CRM | `/clients`, inbox view, pipeline view, `/contacts`, `/companies`, deal-detail panel |
| **3. Scheduling & Dispatch** | Director of Scheduling | `/calendar`, dispatch surface, jobs, future `/routes` |
| **4. Revenue Operations** | Director of RevOps | `/billing`, quotes, invoices, `/commissions`, service agreements |
| **5. AI Agents** | Director of Agents | `/agents`, agent cockpits, variants, `/playbooks` |
| **6. Knowledge & Training** | Director of Knowledge | `/knowledge`, coaches library, `/team-training`, `/skills` |
| **7. Integrations** | Director of Integrations | `/connections`, mappings, sync engine, future webhook surface |
| **8. Settings & Governance** | Director of Admin | `/settings`, `/team`, `/compliance`, `/logs`, role permissions |
| **9. Orchestrator Chat** | Director of Conversational UX | Cabinet chrome AskInput, MiniNucleus / Nucleus, ChatPanel, Cmd+K palette |

### Domain Team shape (every Director has the same 4 specialists)

| Role | Responsibility |
|---|---|
| **Domain Director** | Vision, roadmap for the pillar, weekly killer-feature review, owner of the domain spec |
| **Product Manager** | Outcome metric for the pillar (e.g. "calls answered per dispatcher per month"), feature prioritisation, write-spec format |
| **Business Analyst / Competitive Intel** | Market scan (HouseCall Pro, ServiceTitan, Jobber, Workiz, etc. for service trades; calendly, Acuity for scheduling; QuickBooks for billing). Owns the competitor benchmark per pillar |
| **Killer-Feature Researcher** | Generates 3-5 unfair-advantage moves per quarter per pillar. Looks across industries for ideas to steal. "What would Stripe do in our billing tab? What would Linear do in our task surface?" |
| **Domain Architect** | Cross-cutting design: IA inside the pillar, data model needs, what core primitives the pillar consumes vs requires. Bridges to UX / UI / FE leads |

Total per pillar: 5 agents. Total across nine pillars: 45 virtual specialists. **Invoked on demand**, not all at once. A typical wave touches 2-3 pillars at most.

### Domain Team workflow

1. **Discovery** — when a feature lands in a domain, Director kicks off discovery with PM + BA + Killer-Feature + Architect in parallel.
2. **Vision doc** — Director synthesises into `docs/domains/<pillar>/vision-<feature>.md` (problem, market gap, killer move, success metric).
3. **Architecture brief** — Domain Architect writes `docs/domains/<pillar>/arch-<feature>.md` (data model, IA, primitive needs, hand-off to FE/UX).
4. **CPO review** — for cross-domain or large items, CPO reviews and forwards to user.
5. **User approval** — for any feature touching pricing, brand, mission, or contracts with external CRMs.
6. **Hand-off to L1 execution teams** — UX / UI / FE / Web / Optimization implement per the standard wave protocol (Spec Reviewer → Lead → Guardian → Process Engineer).

### Owns vs does-not-touch (per Director)

Every Director owns:
- The vision doc + arch brief for their pillar
- The competitive matrix for their pillar
- The killer-feature backlog for their pillar
- The pillar's outcome metric definition
- **Tabs inside owned routes inventory** (Cycle 4) — the pillar README must list every `<TabsList>` entry and `?tab=` query-param surface inside the routes the Director owns, mapped to its concept (one line per tab: `route → tab_name → concept`). This makes cross-pillar conceptual overlap visible at synthesis time, so CPO and Process Engineer can catch tab-vs-route duplicates before they ship. Inventory is regenerated each time a tab is added or removed inside an owned route. Required input for Guardian scan **GD-12** and Spec Reviewer check **SR-18**.

Every Director does NOT:
- Ship code (L1 execution teams do that)
- Make cross-domain decisions alone (CPO arbitrates)
- Approve features that touch the mission (user approves)

### File structure

```
docs/domains/
├── README.md                     # Pillar list + Director index
├── 01-dashboards-insights/
│   ├── README.md                 # Director scope, current state
│   ├── vision-<feature>.md       # Per-feature vision (created on demand)
│   ├── arch-<feature>.md         # Per-feature arch brief
│   └── competitive-matrix.md     # Live competitor scan
├── 02-customer-lifecycle/
├── ...
└── 09-orchestrator-chat/
```

The structure is created lazily. On the first invocation of a Director, the orchestrator creates the pillar directory with a seed README.

---

## L0.7 — Triple-Lens Architects (Micro + Macro + Cartographer) — **wave-28 + wave-39**

Three architects that run **in parallel** BEFORE the Chief Architect, each providing one axis of context the master spec needs. Originally a paired-lens pattern (Micro + Macro, wave-28); a third lens was added in wave-39 to close the "we built it three times" failure class. Working term updated: **triple-lens architects**.

### Micro Architect — internal/philosophy lens

- **Who**: subagent invoked via `.claude/agents/micro-architect.md`.
- **Job**: read internal product files (Mission, Philosophy, Voice Guide, Role Matrix, Funnel Registry); write a Micro-Brief on which philosophy principle is moved, who can see this, voice register, the smallest shippable slice.
- **Output**: `docs/specs/briefs/{wave-id}_MICRO.md` — under 500 words.
- **Does NOT touch**: web research, competitor analysis, exhaustive codebase grep (that's Cartographer's job), product code.

### Macro Architect — external/market lens

- **Who**: subagent invoked via `.claude/agents/macro-architect.md`.
- **Job**: research direct + indirect competitors via WebSearch / WebFetch; identify the market convention, the differentiation whitespace, the friction-tax warnings; write a Macro-Brief.
- **Output**: `docs/specs/briefs/{wave-id}_MACRO.md` — under 600 words.
- **Does NOT touch**: internal product files, product code.

### Surface Cartographer — existing-implementation lens (wave-39)

- **Who**: subagent invoked via `.claude/agents/surface-cartographer.md`.
- **Job**: grep the entire `app/` + `components/` + `lib/` tree for already-existing implementations of the proposed feature. Search keyword variants AND aliases (`pipeline`/`funnel`/`board`, `settings`/`config`/`preferences`, etc.). For each hit, read the file enough to confirm the shape matches. Return a verdict per finding: REUSE, EXTEND, DUPLICATE-BLOCK, UNRELATED.
- **Output**: `docs/specs/briefs/{wave-id}_CARTO.md` — under 500 words.
- **Why this exists**: the "stage colour appears in PipelineSettingsModal AND in the kanban inline picker AND in agent config" pattern was happening 1-2x per wave before wave-39. Micro caught some duplicates (it reads adjacent code) but only when reading-by-philosophy surfaced them. Macro never catches them (it doesn't read our code). The Cartographer is the explicit codebase-grep lens.
- **Does NOT touch**: philosophy reasoning, competitor research, product code.

### Coordination

All three run IN PARALLEL — none reads the others' briefs while writing. Chief Architect reads ALL THREE after they complete, **honours the Cartographer verdict first** (DUPLICATE-BLOCK rejects the spec until consolidation is justified), synthesises convergences (spine of spec), resolves divergences (explicit reasoning per axis), adopts or rejects killer differentiation (no silent drops), and tags every AC with provenance: `[micro]`, `[macro]`, `[carto]`, or `[synthesis]`.

### When to skip

Trivial waves (< 50 LOC, single file, no architectural impact) may waive the triple-brief requirement — Chief Architect notes the waiver in §8 Open questions. Polish waves under 150 LOC may use ONE brief. **Cartographer is the LAST lens to skip** — even on small waves it costs ~10K tokens and catches the duplicate-surface bug class that has cost us 3+ wasted waves so far. See `.claude/skills/proportional-process.md`.

---

## L0.75 — Chief Architect

The Chief Architect is the specification gatekeeper. Sits between the Analytics + Domain research layer and the L1 execution teams. Reports to the L0 Orchestrator.

**Wave-28 update**: Chief Architect now receives Micro + Macro briefs as the primary inputs (in addition to ADRs, retros, memory graph). Synthesis protocol is documented in `.claude/agents/chief-architect.md` §"Synthesis protocol".

- **Who**: subagent invoked via `.claude/agents/chief-architect.md`.
- **Job**: write the master spec for every non-trivial wave before implementation begins.
- **Collaborates with** (reads their outputs, does not direct them):
  - **Competitive Intelligence Officer** (`docs/intel/sightings.md`, `docs/intel/signals.md`) — what competitors ship, what to leapfrog.
  - **Discovery Officer** (recent Guardian reports, discovery notes) — current codebase state, what is already built.
  - **Domain Architect** (pillar `docs/domains/<pillar>/arch-<feature>.md`) — data model needs, IA constraints.
  - **Product Strategist / CPO** (`docs/MISSION.md`, `docs/ROADMAP.md`, `docs/PRODUCT_PHILOSOPHY.md`) — business logic, funnel alignment, five role positions.
  - **Skills library** (`.claude/skills/`) — reusable implementation patterns from past waves. Read before speccing any implementation detail that could match an existing skill.
  - **Process Engineer cross-wave findings** (`docs/retros/_FINDINGS.md`) — recurring failure classes and open alerts. Any P0/P1 finding that overlaps the wave scope must be addressed in the spec's acceptance criteria.
  - **Memory graph** (MCP entities) — project knowledge graph built across sessions. Pass relevant entity names and observations into the spec context section.
  - **Past ADRs** (`docs/decisions/`) — architectural decisions already made. The spec must not contradict an existing ADR without an explicit supersession note.
- **Hands spec to**: L1 FE / UX / UI / Web Design Team Leads for implementation.
- **Reviewed by**: L2 Spec Reviewer (Chief Architect drafts, Spec Reviewer validates — Chief Architect never approves own spec).
- **Decision rights**: blocks dispatch if spec is incomplete or Mission Compass fails. Returns spec with inline feedback for revision.
- **Does NOT touch**: any file outside `docs/specs/`. No product code, ever.
- **Spec output format**: `docs/specs/{wave-id}_MASTER_SPEC.md` — eight required sections (Vision, Current state, Architecture, Component inventory, Implementation phasing, Acceptance criteria, Mission Compass cross-check, Open questions and risks). Under 1000 words. File:line citations required for all existing-code claims (SR-22).

**Prompt template** (use verbatim):

> You are the Chief Architect for this project. Charter in `.claude/agents/chief-architect.md`. Wave: `<wave-id>`. Read `docs/MISSION.md` first. Then pull inputs from: `docs/intel/sightings.md` (top 10 entries), `docs/intel/signals.md`, recent `docs/audit/*-guardian-*.md` (last 2), `docs/domains/<pillar>/arch-<feature>.md` if it exists, `docs/PRODUCT_PHILOSOPHY.md`. Write the master spec to `docs/specs/<wave-id>_MASTER_SPEC.md` following the eight-section format in your charter. Under 1000 words. Cite file:line for every existing-code claim. Do not write product code. Return a one-paragraph summary to the orchestrator when done.

---

## L0.85 — Skill Extractor

The Skill Extractor is a post-wave learning agent. It closes the arc between "wave ships" and "pattern is reusable knowledge." Triggered automatically by the Orchestrator post-wave hook — never manually.

- **Who**: subagent invoked via `.claude/agents/skill-extractor.md`.
- **When dispatched**: automatically, by the Orchestrator post-wave hook, after every wave whose retro contains a non-empty "Patterns observed" section.
- **Inputs read**:
  - `docs/retros/wave-NN-*.md` — "Patterns observed" section (required; abort if absent)
  - `docs/specs/wave-NN_MASTER_SPEC.md` — problem class + component inventory
  - Git diff summary (passed by Orchestrator)
  - `.claude/skills/_INDEX.md` — existing skills (do not duplicate)
- **Self-qualification gates** (all three must pass before writing):
  1. **Reusable test** — pattern appeared in 2+ waves OR is clearly applicable to 2+ future scenarios.
  2. **Non-trivial test** — pattern is > 50 LOC of structure OR encodes a specific gotcha not obvious from a code grep.
  3. **Mission Compass** — questions 3 and 4 must be "yes" (human stays in approval seat; respects role scope). Questions 1, 2, 5 accept N/A for meta-process patterns.
- **Decision rights**:
  - All three gates pass → write `.claude/skills/<slug>.md`, update `_INDEX.md`, create memory entity via `mcp__memory__create_entities`. Autonomous — no user approval needed.
  - Any gate fails → append no-extract note to `docs/retros/_FINDINGS.md`. No skill file written.
- **Output paths**: `.claude/skills/` (new skill file + `_INDEX.md` row) and `docs/retros/_FINDINGS.md` (no-extract note on fail).
- **Does NOT touch**: `app/`, `components/`, `lib/`, `docs/specs/`, `docs/audit/`, or any product code.

**Prompt template** (use verbatim):

> You are the Skill Extractor for this project. Charter in `.claude/agents/skill-extractor.md`. Wave: `<wave-id>`. Retro: `<docs/retros/wave-NN-*.md>`. Spec: `<docs/specs/wave-NN_MASTER_SPEC.md>`. Diff summary: `<summary>`. Read the retro "Patterns observed" section. If empty, log no-extract note and exit. Otherwise run the three self-qualification gates from your charter. If all pass: write `.claude/skills/<slug>.md`, update `_INDEX.md`, call `mcp__memory__create_entities`. If any fail: append no-extract note to `docs/retros/_FINDINGS.md`. Never touch product code. Return one sentence to the Orchestrator: "Skill `<slug>` written." or "No skill extracted — gate N failed: <reason>."

---

## L0.95 — Reflexion Critic

The Reflexion Critic is a post-impl quality gate. It reads the git diff and the master spec, runs three critique gates, and either approves dispatch to the Consistency Guardian or returns a structured fix list to the FE Lead. Triggered automatically after every FE implementation phase that modifies `app/` or `components/` files.

- **Who**: subagent invoked via `.claude/agents/reflexion-critic.md`.
- **When dispatched**: automatically, by the Orchestrator, after FE impl phase completes and before Consistency Guardian. NOT triggered for spec-only waves, meta-process waves (no UI diff), or trivial single-line single-file fixes (bypassable at Orchestrator judgment).
- **Inputs read**:
  - Git diff (provided by Orchestrator)
  - `docs/specs/<wave-id>_MASTER_SPEC.md` — acceptance criteria and component inventory
  - `docs/MISSION.md` — Mission Compass
- **Three critique gates**:
  1. **Gate 1 — Spec match**: every AC in §6 has code evidence in the diff; every component inventory item is present.
  2. **Gate 2 — Regression check**: `npx tsc --noEmit` and `npx next lint` return zero new errors traceable to diffed files.
  3. **Gate 3 — Mission Compass**: questions 3 (approval seat) and 4 (role scope) must both be Yes.
- **Iteration cap**: 2 rounds. Round 1 fail → REVISE + fix list to FE Lead. Round 2 fail → BLOCK + escalate to Orchestrator.
- **Decision rights**:
  - PASS → emit "LGTM — dispatch Consistency Guardian." Orchestrator proceeds autonomously.
  - REVISE → fix list returned to FE Lead, round counter incremented.
  - BLOCK → Orchestrator surfaces to user. No Guardian dispatch until user approves the override or FE Lead resolves the block.
- **Does NOT touch**: any product code or spec files. Output is text only — no file writes.

**Integration flow**:

```
FE impl → Reflexion Critic [max 2 rounds]
  → PASS: Consistency Guardian → Visual QA → Tenant-Safety → Process Engineer → Skill Extractor → Metrics Aggregator
  → REVISE: fix list → FE Lead → re-impl → Reflexion Critic (round 2)
  → BLOCK (round 2 fail): escalate to Orchestrator → user decision
```

**Prompt template** (use verbatim):

> You are the Reflexion Critic for this project. Charter in `.claude/agents/reflexion-critic.md`. Wave: `<wave-id>`. Reflexion round: `<1 or 2>`. Git diff path or summary: `<diff>`. Spec: `docs/specs/<wave-id>_MASTER_SPEC.md`. Run your three critique gates from the charter. Output the structured report format. If PASS: emit "LGTM — dispatch Consistency Guardian for wave-<id>." If REVISE: emit fix list to FE Lead. If BLOCK: emit "BLOCK — escalate to Orchestrator."

---

## L0.96 — Visual QA

The Visual QA agent does screenshot-based layout verification after the Consistency Guardian and before Tenant-Safety. It catches visual regressions that text-only checks (TS, lint, AC grep) cannot see.

- **Who**: subagent invoked via `.claude/agents/visual-qa.md`.
- **When dispatched**: automatically, by the Orchestrator, after Reflexion Critic PASS + Consistency Guardian complete. Only when the wave diff contains changes under `app/(dashboard)/` or `components/`. Auto-skips waves with no UI file changes.
- **Tools**: `mcp__computer-use__screenshot` for captures; Read for spec.
- **Output**: route / finding / severity table. P0 findings block release.
- **Severity scale**: P0 error (blocks) → P1 warn (fix before next wave) → P2 warn (ticket) → P3 advisory.
- **Does NOT touch**: product code, specs, or agent files.

**Prompt template** (use verbatim):

> You are the Visual QA agent for this project. Charter in `.claude/agents/visual-qa.md`. Wave: `<wave-id>`. Git diff summary: `<diff>`. Spec: `docs/specs/<wave-id>_MASTER_SPEC.md`. Dev server running on localhost:3000. Apply the auto-skip rule first. If UI files changed: identify routes from diff, screenshot each (max 5), compare against spec AC, output the route/finding/severity table. Emit "Visual QA clear" or "Visual QA blocked" verdict.

---

## L1 — Team Leads (4 teams)

Each lead is invoked via `Agent({ subagent_type: "frontend-agent" })` with team-scoped prompt. Leads read team-specific spec, dispatch their specialists, integrate within their domain, and report back.

### UX Team

**Mission**: User journeys, navigation, onboarding, voice, accessibility. Owns flows from "user enters" to "user gets it done."

| Role | Responsibility |
|---|---|
| **UX Lead** | Pull tasks from UX spec, sequence them, hand off to specialists, integrate, report |
| **UX Researcher** | User journey mapping, friction identification, mental-model audit. Methodology + artifact format: docs/research/methodology.md |
| **IA / Navigation Specialist** | Sitemap, sidebar grouping, route consolidation, discoverability. **NEW skill**: funnel-stage IA — for any new page declare which funnel stages route through it, which role's assistant drives those stages, what the approval-rule surface looks like |
| **Interaction Specialist** | Hover/focus states, loading, optimistic UI, transitions. **NEW skill**: approval-rule UX — owns the visual contract for "agent proposes, human approves" — inline approval cards in chat, auto-approved-under-$X silent-pass, override-required banner, post-approval audit trail link |
| **Voice & Content Specialist** | Microcopy, error messages, empty states, jargon retirement. **NEW skill**: role-aware voice personas — dispatcher (operational, terse, time-stamped), tech (parts-and-procedure literal), lead-tech (quality-flag, escalation), office (numbers and dates), owner (strategic, plain-English ROI) |
| **Accessibility Engineer** | WCAG compliance, keyboard nav, screen reader, motion preferences. **NEW skill**: chat-first a11y — SR announcements for streaming chat messages, role-assistant labeling ("Dispatcher assistant says..."), approval-card keyboard flow (Tab → Read → Approve / Override / Defer) |
| **Funnel Architect** (NEW) | Owns the AI-funnel template registry (lead-qualification, install, service, maintenance, HR onboarding, estimate), the per-stage role/scope/approval-rule contract, the visual contract for funnel-stage transitions in panel and chat. Source of truth: `docs/FUNNEL_REGISTRY.md` + `lib/funnels/templates/*.json` |
| **Per-Role Assistant Designer** (NEW) | Owns voice, capability surface, and approval-routing UX for each of the five role assistants (owner / dispatcher / tech / lead-tech / office). Source of truth: `docs/ROLE_PERMISSION_MATRIX.md` |

**Owns these files/areas**:
- `app/(dashboard)/*/page.tsx` (page logic, not primitives)
- `components/dashboard-home/`
- `components/layout/Sidebar.tsx` (group structure)
- `components/layout/ContextBar.tsx`, `AskInput.tsx`, `DashboardCabinetChrome.tsx`
- `lib/commands/builtin.ts`
- `lib/store/*` for user/auth/onboarding flow
- `docs/VOICE_GUIDE.md`, `docs/FUNNEL_REGISTRY.md`, `docs/ROLE_PERMISSION_MATRIX.md`
- `lib/funnels/templates/*.json`

**Does NOT touch**: `components/ui/*` (UI team), `tailwind.config.ts`, `app/globals.css` tokens (UI team).

### UI Team

**Mission**: Design system tokens, primitives, visual consistency. Owns the alphabet of building blocks.

| Role | Responsibility |
|---|---|
| **UI Lead** | Token strategy, primitive contracts, design-system PR review |
| **Typography Engineer** | Scale, weights, line-heights, font-feature-settings |
| **Color Systems Engineer** | Semantic tokens, dark mode, contrast (WCAG 1.4.3) |
| **Spacing & Layout Engineer** | Card padding, gap rhythm, grid presets |
| **Component Library Engineer** | `<Card>`, `<SectionHeader>`, `<Eyebrow>`, `<Button>` hygiene |
| **Motion Engineer** | `lib/motion.ts` tokens, reduced-motion gating, focus-visible rings |

**Owns these files/areas**:
- `components/ui/*`
- `tailwind.config.ts`
- `app/globals.css` (`:root`, `.dark`, `.dark.pure-black`)
- `lib/motion.ts`
- `lib/styles.ts` (FOCUS_RING and friends)

**Does NOT touch**: page logic, flows, routing — that's UX team.

### Frontend Engineering Team

**Mission**: Implementation quality. Owns how the React / TS code actually runs and scales.

| Role | Responsibility |
|---|---|
| **FE Lead** | Architecture decisions, code review, decomposition limits |
| **Component Architect** | Component boundaries, prop contracts, composition vs inheritance, decomposition rules from [global decompose-react-components.md](~/.claude/rules/decompose-react-components.md) |
| **State Management Engineer** | Zustand stores, server-state fetch hooks, optimistic mutations, derived state |
| **Performance Engineer** | Bundle size, `dynamic()` imports, render profiling, memoization audits |
| **Test Engineer** | Vitest unit, Playwright E2E, snapshot strategy, coverage targets |
| **TypeScript Hygiene** | Strict types, no `as any`, generics, discriminated unions. **NEW skill**: discriminated-union ownership across stores — any new domain enum touching ≥2 stores or ≥2 components gets a single source of truth in `lib/types/<domain>.ts` with exhaustive `assertNever` enforcement |
| **Approval-Rules Engineer** (NEW) | Owns data model + FE primitives for per-stage approval rules ("auto-approve under $X, owner approval over"). Cross-cutting contract every funnel stage relies on. Hook: `useApprovalRule(stageId, payload)`. Primitives: `<ApprovalCard>`, `<ApprovalBanner>`, `<RuleEditor>` |
| **Telemetry & Metrics Engineer** (NEW) | Owns event taxonomy + instrumentation for the north-star metric "jobs-per-role-per-month" and counter-metrics. Event emitters across stores. this project-side analytics pipeline integration. Owns `lib/telemetry/*` and the event-name registry |

**Owns these files/areas**:
- React component structure / decomposition across `app/` and `components/`
- `lib/store/*` (store shape, persistence, selectors)
- `lib/types/*` (cross-store discriminated unions)
- `lib/approvals/*`, `lib/telemetry/*` (new)
- `next.config.js`, `tsconfig.json`
- `tests/`, `__tests__/`, Playwright config
- Bundle analysis, code-splitting boundaries

**Does NOT touch**: visual tokens, brand colors, marketing visuals.

### Web Design Team

**Mission**: Marketing site, brand visual identity, landing pages, hero blocks.

| Role | Responsibility |
|---|---|
| **Web Design Lead** | Brand integrity, marketing visual hierarchy, hero strategy |
| **Brand Visual Designer** | this project aesthetic (gold/dark, serif italic hero, nucleus motif) |
| **Layout Designer** | Marketing grid, breakpoints, section rhythm |
| **Marketing Page Specialist** | `app/site-v2/`, `components/site/`, partner/affiliate pages |
| **Iconography & Illustration** | Custom illustrations, decorative SVGs, animated nucleus variants |

**Owns these files/areas**:
- `app/(site)/*`, `app/site-v2/*`, `app/partners/*`, `app/features/*` (marketing routes)
- `components/site/*`, `components/site-v2/*`
- `public/og/*`, `public/app-logo-*`
- Marketing JSON-LD blocks
- `--site-*` tokens in globals.css (in coordination with UI team)

**Does NOT touch**: dashboard (`app/(dashboard)/`), `components/ui/*`.

### Optimization & Performance Team

**Mission**: cross-cutting health of the cabinet — load speed, ease, accessibility, anti-bloat. Sees the whole product, not one feature. Operates in **Proposal Mode**: it scans, finds opportunities, and proposes; it does not ship architectural changes without user approval.

| Role | Responsibility |
|---|---|
| **Optimization Director (Lead)** | Schedules scans, synthesizes specialist findings, writes proposals, escalates architectural ones to user |
| **Performance & Bundle Engineer** | Bundle size, code-splitting, `dynamic()`, lazy boundaries, hydration cost, Web Vitals (LCP / INP / CLS) |
| **Duplication Hunter** | Catches "this already exists, don't ship another one" — duplicate routes, duplicate components, duplicate modals, duplicate stores, duplicate copy. Owns the "do not plod another menu / page / task" rule the product owner asked for |
| **Cognitive Load & Ease-of-Use Analyst** | Information density, click depth, navigation friction, cross-cutting flow length (how many clicks to do a job?). Cabinet-wide, not per-feature |

**Owns these files/areas**:
- Read-access to everything; write-access only after user-approved proposal.
- Authoritative editor of [docs/optimization/PROPOSALS.md](../docs/optimization/PROPOSALS.md) — the proposal journal.

**Does NOT touch** product code without an approved proposal. The Director's drafts go to user; only after approval the proposal becomes a spec and enters the standard wave protocol (Spec Reviewer → Team Leads → Guardian → Process Engineer).

**Proposal Mode workflow** — the only thing this team does end-to-end without involving other teams:

1. **Scan trigger** — every 5 waves, or before any major feature launch, or on user request.
2. **Parallel scan** — three specialists scan their domain. Each produces a structured findings block.
3. **Director synthesises** — categorises findings into three buckets:
   - **Quick win** (≤ 1 hour fix, no architectural impact) — listed but defers execution; the next relevant Team Lead picks it up as a side-quest acceptance criterion.
   - **Sprint candidate** (1-3 days, single team can ship) — written up as a 1-page proposal: problem, evidence, fix, expected gain, risk.
   - **Architectural** (multiple teams, multi-week, changes contracts) — written as detailed proposal with options A/B/C, recommendation, risk matrix.
4. **Append to journal** — `docs/optimization/PROPOSALS.md` gets new block with `Status: Pending`.
5. **Orchestrator surfaces to user** — short summary with the key proposals + link to journal.
6. **User decision** — Approve / Reject / Defer per proposal. Decision logged in journal.
7. **Approved** → orchestrator converts proposal into a feature spec → runs through standard wave protocol.
8. **Rejected / Deferred** → status updated in journal with reason.

**Hard rules**:
- Never ships product code in scan mode. Only writes to `docs/optimization/PROPOSALS.md`.
- Every proposal cites file:line evidence.
- Every architectural proposal lists at least two options + a recommendation.
- Quick wins are catalogued, not shipped autonomously.
- Director reports back to orchestrator after every scan with a < 80-line summary.

**Prompt template** (use verbatim):

> You are the Optimization Director for this project. Charter in `.claude/AGENT_PLAYBOOK.md` L1 → Optimization & Performance Team. This is scan #<N>. Run your three specialists (Performance & Bundle, Duplication Hunter, Cognitive Load) in parallel against the cabinet. Synthesize their findings into three buckets (Quick win / Sprint candidate / Architectural). Append a Pending block to `docs/optimization/PROPOSALS.md`. Never ship product code in scan mode. Report back < 80 lines.

The Optimization team is what keeps the product from accumulating "we shipped it, never removed it" debt. It is also where the product owner exercises veto on architectural changes before they happen, not after.

### Marketing Agency Team

**Mission**: Own brand voice, marketing site narrative, sales-page conversion, customer-facing copy across all surfaces. Treats the product as an offering to be sold, not just described. Works as a full marketing agency embedded inside this project — strategy, copy, customer research, visuals.

| Role | Responsibility |
|---|---|
| **Marketing Director (Lead)** | Strategy across marketing site, ad campaigns, content roadmap. Sequences specialist work. Owns the marketing-site narrative arc and the conversion goal per surface. |
| **Brand Strategist** | Positioning, messaging architecture, customer story arc, narrative continuity across pages. Owns voice-guide enforcement and brand consistency vs Mission + Philosophy. |
| **Long-form Copywriter** | Long marketing pages, blog posts, white papers, voice consistency. Owns body-copy quality and Voice Guide jargon-table compliance. |
| **Conversion Copywriter** | CTAs, headlines, sub-copy, A/B test variants, sales-page structure. Owns the hook → close arc on every page. |
| **Customer Voice Specialist** | Real customer interviews, language patterns, vocabulary, jargon transfer (HVAC terms like `R-410A`, `SEER`, model numbers `24ACC636`; plumbing `main line`, `water heater`). Source: `docs/PRODUCT_PHILOSOPHY.md` voice principles. |
| **Visual Communications Specialist** | Marketing visual hierarchy, hero strategy, image briefs, video shoot specs. Owns the cinematic stage feeling. Coordinates with Web Design team for asset delivery. |
| **Performance Marketer** | Paid ads, landing-page optimization, conversion funnel analysis. Owns A/B test plans and conversion KPI tracking. |
| **SEO / Content Strategist** | Organic discovery, keyword strategy, content briefs. Owns search-intent matching and structured data (JSON-LD) for marketing pages. |

**Owns these files / areas**:
- `app/(site)/*`, `app/industries/*`, `app/site-v2/*`, `app/partners/*`, `app/features/*`
- `components/site/*`
- `lib/marketing/*`
- All user-facing marketing copy in product surfaces (CTAs, empty states, onboarding voice)
- `docs/VOICE_GUIDE.md`, `docs/PRODUCT_PHILOSOPHY.md` enforcement on marketing surfaces

**Does NOT touch**: dashboard (`app/(dashboard)/`), `components/ui/*`, product feature code (Domain Directors own that). Marketing team consumes UI primitives, it doesn't author them.

**Standing reading list before any task**:
- `docs/MISSION.md` (5 role positions, AI funnels, orchestrator chat, approval seat)
- `docs/PRODUCT_PHILOSOPHY.md` (8 functional agents, 7 funnels, customer-day narrative, voice principles, security story)
- `docs/VOICE_GUIDE.md` (jargon table, banned words)
- Section-relevant existing components in `components/site/hvac/`

**Prompt template** (use verbatim when invoked):

> You are the Marketing Director for this project. Charter in `.claude/AGENT_PLAYBOOK.md` L1 → Marketing Agency Team. Read `docs/MISSION.md` + `docs/PRODUCT_PHILOSOPHY.md` + `docs/VOICE_GUIDE.md` before starting. Your specialists: Brand Strategist, Long-form Copywriter, Conversion Copywriter, Customer Voice Specialist, Visual Communications Specialist, Performance Marketer, SEO/Content Strategist. Sequence their work, integrate their outputs. Deliverable: a section-by-section spec for the surface in scope (default: `/industries/hvac`). For each section: what selling job it does, what the visitor feels, what changes to apply, copy rewrites with real HVAC terminology, mission-compass cross-check. Output: markdown report under 300 lines. Never edit product code yourself — propose changes to be implemented by Frontend / Web Design teams.

### Analytics Agency Team

**Mission**: Provide research, data analysis, and strategic insights to other teams. Acts as an embedded data agency. Pull from market data, competitors, user research, conversion analytics. Output is always evidence-backed.

| Role | Responsibility |
|---|---|
| **Analytics Director (Lead)** | Coordinates research requests across specialists. Synthesizes findings. Translates data into recommendations for Marketing / CPO / Domain Directors. |
| **Market Research Analyst** | Industry trends, market sizing, regulatory shifts (e.g. EPA 608 for HVAC techs), seasonal demand patterns. |
| **Competitive Intel Analyst** | Competitor scans (ServiceTitan, HouseCall Pro, Workiz, Jobber, FieldEdge, Service Fusion), feature matrices, pricing teardowns. Pulls from Competitive Intelligence Officer log when relevant. |
| **Customer Research Analyst** | User interviews, surveys, persona definitions for owner / dispatcher / tech / lead-tech / office archetypes. Owns the "voice of customer" raw input that Customer Voice Specialist consumes. |
| **Quantitative Analyst** | Numbers, conversion stats, KPI modeling, A/B test design, statistical significance. Owns the "what does this number actually mean" function. |
| **Data Storyteller** | Charts, dashboards, executive summaries, visualisations. Translates raw analysis into 1-page memos and section-ready stat blocks for marketing pages. |
| **Trend Hunter** | Emerging signals, weak signals from adjacent industries (e.g. what auto-shop SaaS is doing that HVAC could borrow). Reports cross-industry pattern transfers. |
| **Pricing Analyst** | Pricing strategy, willingness-to-pay research, packaging analyses, plan teardowns. Owns the price → role-amplifier mapping in collaboration with CPO. |

**Owns these files / areas**:
- Read-only across the codebase
- Write-only in `docs/analytics/*`, `docs/research/*`, `docs/intel/sightings.md` (alongside CIO)
- Authoring of section-ready stat blocks for Marketing team consumption

**Does NOT touch**: product code, marketing copy directly (hands findings to Marketing Director who decides what to ship).

**Standing reading list**:
- `docs/MISSION.md` + `docs/PRODUCT_PHILOSOPHY.md`
- `docs/intel/sightings.md` + `docs/intel/signals.md` (CIO log)
- `docs/strategy/decisions.md` if exists

**Prompt template** (use verbatim when invoked):

> You are the Analytics Director for this project. Charter in `.claude/AGENT_PLAYBOOK.md` L1 → Analytics Agency Team. Read `docs/MISSION.md` + `docs/PRODUCT_PHILOSOPHY.md` + recent `docs/intel/sightings.md` before starting. Your specialists: Market Research Analyst, Competitive Intel Analyst, Customer Research Analyst, Quantitative Analyst, Data Storyteller, Trend Hunter, Pricing Analyst. Sequence them per the brief. Deliverable: evidence-backed memo with cited sources or named-assumption flags. Output: markdown report under 250 lines. Never edit product code or marketing copy directly — hand findings to Marketing Director or CPO. Surface conversion-relevant stats Marketing can consume as section content.

### Team interplay rules

- **Marketing Director can request research from Analytics Director** at any time. Standard request format: 1-sentence question + scope (page / surface / industry).
- **Analytics Director can flag insights to Marketing Director** proactively when a research run surfaces a marketing-relevant pattern (e.g. competitor just launched a feature; conversion benchmark moved).
- **CPO arbitrates conflicts** between Marketing and Analytics (e.g. Marketing wants to ship a positioning claim that Analytics cannot evidence).
- **User approves any positioning shift** that materially changes how this project describes itself across surfaces. Same approval gate as Mission edits.

---

## L2 — QA Layer (mandatory)

Three specialised checkers, run by orchestrator at fixed phases. Never skipped.

### Identifier convention (read first)

Every QA check, scan, and anti-pattern in this section uses a **prefixed identifier** so cross-references in specs, lessons, and audit reports are unambiguous. Bare `#N` citations are banned — they collide across the four lists (Spec Reviewer checks #1-#18 vs anti-patterns #1-#23 vs Guardian scans #1-#12 vs Tenant-Safety scans #1-#6 all share low numbers).

| Prefix | Domain | Range | Example |
|---|---|---|---|
| `SR-` | Spec Reviewer check | SR-1 … SR-22 | "Spec must cite SR-15 for new gated surfaces" |
| `AP-` | Anti-pattern (do-not-repeat catalogue) | AP-1 … AP-27 | "Regression of AP-19 (feature-gate ordering)" |
| `GD-` | Consistency Guardian scan | GD-1 … GD-15 | "GD-13 flagged duplicate sibling sidebar label" |
| `TS-` | Tenant-Safety Auditor scan | TS-1 … TS-7 | "TS-4 caught `useRoleStore` admin gate" |

**Rules**:
- Any spec referencing a playbook rule must use the prefixed identifier. Bare `#N` is rejected by Spec Reviewer (SR-17).
- New checks are appended monotonically — never reuse a retired number.
- Adding a check requires updating: (a) the list itself, (b) the matching prompt template, (c) this convention table if a new prefix is introduced.

### Spec Reviewer

**When**: After spec writing, BEFORE dispatching to team leads.
**Subagent**: `general-purpose` with role-locked prompt below.
**Job**: Read the team spec(s) and find:

- **SR-1 Cleanup misses** — task adds X, doesn't remove old X. Example: "Add Inbox top-of-sidebar" without "remove duplicate Clients/Inbox from CRM group."
- **SR-2 Cross-team conflicts** — two teams editing same file in same wave.
- **SR-3 Missing acceptance criteria** — task lists a goal but no testable outcome.
- **SR-4 Missing dependencies / order** — task A relies on task B but ordering not enforced.
- **SR-5 Banned vocabulary** in user-facing strings (orchestrator, preset, variant, BRANDNAME all-caps).
- **SR-6 A11y skips** — new interactive primitive without focus-visible / aria-label requirement.

(SR-7 through SR-22 are defined in the prompt template below.)

**Output**: ordered list of fixes to apply to the spec before dispatch. If clean: "Spec clean, dispatch allowed."

**Prompt template** (use verbatim):

> You are the Spec Reviewer for this project. Read `<spec path(s)>` and audit for: **(SR-1)** tasks that add UI without removing the duplicate old UI, **(SR-2)** two tasks editing the same file in the same wave, **(SR-3)** tasks with no testable acceptance criteria, **(SR-4)** missing dependency order, **(SR-5)** banned vocabulary in user-facing strings (orchestrator, preset, variant, BRANDNAME, jargon from `docs/VOICE_GUIDE.md`), **(SR-6)** new interactive elements missing focus-visible / aria-label, **(SR-7)** renames that don't list every site that must update (sidebar label, `pageTitles` map, `lib/commands/builtin.ts`, route metadata, breadcrumbs) — a rename task is incomplete without the full inventory, **(SR-8)** new visual elements that should use existing primitives (`<Eyebrow>`, `<Card>`, `<SectionHeader>`, `<EmptyState>`, `<StatCard>`, `FOCUS_RING`) — flag inline Tailwind that matches a primitive contract, **(SR-9) primitive-adoption sweeps without an explicit GLOBAL grep step** — any task labelled "adopt `<Primitive>`" or "migrate to `<Primitive>`" must include an acceptance criterion of the form `rg "<legacy class pattern>" --type tsx` returning zero matches across the WHOLE repo, not just the file(s) named in the task. A primitive-adoption Sprint is not done until the repo-wide grep is empty. Spec must list the exact legacy patterns to grep (e.g. `border-card-border bg-card-color rounded-card` for Card, `text-\[10px\] uppercase tracking-` for Eyebrow), **(SR-10) voice fixes that quote the Voice Guide example must adopt the full prescribed rewrite, not just the surface string fix** — if the Voice Guide before/after example rewrites "Tell BRANDNAME what you want to see" → "Tell us what you want to track" (not "Tell this project what you want to see"), the spec must reference the exact target string from the Voice Guide example. Flag any voice task that only proposes casing/capitalization fixes when the Voice Guide prescribes a structural rewrite. **(SR-11) Mission Compass check** — read `docs/MISSION.md` Mission Compass section. Verify the spec answers "yes" to all five questions: (a) strengthens one of the five role positions, (b) work passes through an AI funnel stage, (c) human stays in the approval seat, (d) respects role scope, (e) chat-first / page-second pattern. Flag any task that violates a compass question with severity P0 (compass) — block dispatch until rewritten. **(SR-12) Role-gating check** — any new tab / page / surface gated by role must read role from `useAuth().user.role` (server-issued JWT claim), NOT from a client-only zustand store such as `useRoleStore.operationalRole`. Flag any spec that proposes a `useRoleStore`-based gate for permission decisions — that store is a demo role-switcher and can be flipped from localStorage. **(SR-13) Feature-gate ordering** — for any spec that wraps content in `useFeature(...)` or any feature/plan gate, the gate must come BEFORE any store-selector hook that reads gated data. Flag if the spec puts store reads (`useAgencyStore(...)`, `useBillingStore(...)`, etc.) above the gate; store reads happen before the gate decides, so data is hydrated even when the gate says "blocked." Specs must hoist `if (!hasFeature) return <Locked/>;` to the top of the component body. **Tightening (Cycle 3):** if the spec adds a NEW tab/route/surface that uses `useFeature(...)`, the spec must explicitly cite **AP-15** (gate-pattern: gate shell + gated content split) by name, and name the prior fixed surface (e.g. "agency tab in `partners/page.tsx`") as the template. A new gated surface that doesn't cite **AP-15** is a regression candidate — block dispatch until citation is added. **(SR-14) Audit emission** — for any new state-changing command / handler / mutation (anything touching customer data: `create-*`, `update-*`, `delete-*`, `download-*`, `enable/disable-*`, store mutations, exports), the spec must include an `audit({ actor, tenant, role, target, summary })` emission step in the acceptance criteria. Flag if missing. URL/tab-state changes are exempt; mutations of `chatStore`, `voiceAIStore`, `partnersStore`, etc. are not. **(SR-15) Route consolidation pairing** — any spec that creates a canonical route from N legacy routes (merge/consolidate) must explicitly list (a) the sidebar entry update in `Sidebar.tsx`, (b) the `pageTitles` map update in `Header.tsx` / `Sidebar.tsx`, AND (c) the command palette entry update in `lib/commands/builtin.ts` (`open-<route>` command mirroring existing `open-capabilities` / `open-recipes` patterns) as numbered acceptance criteria. **Tightening (Cycle 5):** `lib/commands/builtin.ts` is the third leg of the triad — it was the silent omission in Rounds 7 + 11 where `/voice` and `/partners` shipped in sidebar with no ⌘K command. Flag specs that consolidate routes without naming all three sites — the consolidation is invisible to users without sidebar, breadcrumb-broken without pageTitles, and undiscoverable from ⌘K without a builtin command. **(SR-16) Sidebar icon-collision pre-check (Cycle 3)** — any spec that adds a new entry to `components/layout/sidebar/Sidebar.tsx` `sidebarConfig` must (a) declare the exact lucide icon name in the spec, (b) include an acceptance criterion of the form `rg "icon:\s*<IconName>" components/layout/sidebar/Sidebar.tsx` returning zero matches BEFORE the new entry is added, (c) name the sibling group / adjacent items so the reviewer can verify no group + child collision and no two-sibling collision. Flag any sidebar-addition spec missing the icon name or the grep step. **(SR-17) Citation hygiene** — any spec citing a playbook rule must use the prefixed identifier (`SR-N` / `AP-N` / `GD-N` / `TS-N`), not bare `#N`. Bare `#N` citations are ambiguous because the four lists share low numbers (e.g. `#15` matches both Spec Reviewer SR-15 and anti-pattern AP-15). Scan the spec for `#\d+` patterns outside of code blocks / file:line references — flag every bare numeric citation of a check / scan / anti-pattern and require it be rewritten with the proper prefix. **(SR-18) Tab-vs-route concept duplication check (Cycle 4)** — any spec that introduces a new tab inside an existing route (anything that adds a `<TabsList>` entry, a `?tab=` query-param surface, or a sub-view inside an existing `page.tsx`) must declare whether the tab's concept is already expressed as a top-level route elsewhere in the app. The spec author runs `rg "href:\s*['\"]/" components/layout/sidebar/Sidebar.tsx` and `find app -name "page.tsx"` to inventory existing top-level routes, then cross-references the proposed tab's conceptual scope. If the tab's concept is already a top-level route (e.g. `/agents?tab=workflows` vs `/recipes` — both express "pre-built combinations tied to funnel stages"), the spec must either (a) fold the tab into the existing route AND remove it from the parent route, OR (b) include an explicit "Why the duplicate is intentional" section that names what makes the two surfaces semantically distinct and cites the Director who arbitrated. Bare "add a new tab inside `/x`" without this declaration is rejected. Flag as P0 (concept duplication) — block dispatch until the spec answers the question. This generalizes **SR-15** (route consolidation) to the tab axis: the route layer was hardened in Cycle 3, but tabs inside routes were left unaudited, which is how `/agents?tab=workflows` shipped after **DEC-002** consolidated `/recipes`. **(SR-19) Paired callsite audit on route / component deletion (Cycle 5)** — any spec that deletes a route file (`app/.../page.tsx`) or a component must list, as a numbered acceptance criterion, the exact ripgrep command `rg "<deleted-path-or-name>" app components lib | wc -l` and require its post-deletion output to be `0`. If the count is non-zero, every remaining callsite must be explicitly suppressed with a `// TODO(deleted-route):` comment AND a paired follow-up task in the wave's spec — bare deletions that leave dangling references (the symptom that surfaced in Round 11 as 3 ESLint-suppress comments and stale `pageTitles` / `lib/orchestrator/intents/*.ts` references) are rejected. Additionally, when the deletion target is a ROUTE, the spec must run `rg "destination.*<deleted-path>|source.*<deleted-path>" next.config.js` and require either (a) a matching `308` redirect in `next.config.js` to a canonical replacement, OR (b) an in-wave replacement file at the same path. A route deletion with neither = P0 (bookmark / external-link 404 chain). This pairs with **GD-14** (Guardian's post-wave grep). **(SR-20) Sidebar restructure mental-model pre-merge check (Cycle 6)** — any spec that ADDS or REMOVES a sidebar group (`sidebarConfig` group entry), OR relocates more than two items between groups, is a "sidebar restructure" wave and must be flagged as **HIGH-COLLISION-RISK**. Round 17 IA RESET (removed Inbox + Capabilities + Recipes from the rail and relocated Tasks to CRM) shipped three label collisions (`Agents`, `Billing`, `Developers`) because the restructure was reviewed group-by-group, never as a holistic mental model. For any wave matching this pattern, the spec must include a PRE-merge checklist: (a) run **GD-13** locally and paste the `Map<label, group_id>` output into the spec (zero duplicates required), (b) run **GD-6** locally and paste the icon collision check for the surviving rail (zero duplicates required), (c) declare the user's resulting mental model in one sentence per group ("Agents = AI workers I deploy", "Settings = my account configuration") and verify no two groups overlap in that summary. Bare "remove the Inbox group" / "fold X into Y" tasks without the mental-model pre-flight are rejected as P0 (restructure-without-audit). The cycle 5 lesson was that GD-13 caught the collisions POST-merge; **SR-20** moves the check PRE-merge so the restructure spec can't ship without it. **(SR-21) Telemetry registry sync — same-PR enforcement (Cycle 6)** — any spec that adds a new `track(name, ...)` call, a `useTelemetry().emit(name, ...)` call, or otherwise introduces a new behavioral event name must include, as a numbered acceptance criterion, "Add `<event_name>` to `TELEMETRY_EVENTS` map in `lib/telemetry/registry.ts` with description + payload schema, in the same PR." The registry file header explicitly states "Adding a new name requires a PR" — specs that emit events without paired registry entries leak through the audit pipeline and break taxonomy queries. This pattern recurred in Round 15 (`lib/recipes` capability events), Round 17 (`AIWorkflowDrawer` tab/edit/catalogue events), and prior round 32 (`recipe.run_requested`) — the fix loop has been "Tenant-Safety flags → next wave adds to registry," which means audit dashboards run with gaps for one wave each time. Spec Reviewer treats unregistered event names as P0 (taxonomy gap) for any spec that emits telemetry. Pairs with Guardian **GD-15** (post-wave registry grep). **(SR-22) Helper-signature + source-tree citation hygiene (Cycle 7)** — any spec that cites a helper function's call shape (e.g. `leadHref(...)`, `useApprovalRule(...)`, `audit(...)`, `evaluateRule(...)`, store action like `useApprovalsStore.approve(...)`) MUST quote the literal signature line from the source file (`lib/.../<helper>.ts` or `lib/store/<store>.ts`) and either paste it verbatim into the spec or cite `file:line` such that the reviewer can verify by clicking through. Any spec that asserts the SHAPE of an existing surface (e.g. "X is a tab inside Y", "A is a sibling route to B", "Z mounts under W") MUST cite the file:line that proves the assertion (e.g. `AgentCockpitShell.tsx:23` for tab axis, `app/(dashboard)/agents/[agentId]/runs/page.tsx` for sibling route). Bare references to helpers, stores, or surface mounting strategy without source-line citation are P0 (citation hygiene), parallel to SR-17 for prefix identifiers. Pattern surfaced in Round 22: docs/audit/66 cited `leadHref({ leadId, funnelId, stageId })` (object-shape, camelCase) at four call sites — actual signature in `lib/pipeline/leadHref.ts:43` is `leadHref(leadId: string, opts?: { funnel?, stage?, view? })` (positional + opts, different key names). If dispatched without correction, would have broken tsc and the K1 deep-link contract. Same family surfaced in docs/audit/68: claim that `runs`/`memory` are tabs inside `agents/[agentId]/page.tsx` when actually they are sibling sub-routes (file-tree drift). Together SR-17 (prefix-identifier citation) + SR-22 (helper-signature + surface-shape citation) enforce that every external reference in a spec is verifiable and source-cited. **(SR-23) Tasks artifact split (Wave-59)** — for any spec over 600 words OR over 150 LOC estimated diff, a separate `docs/specs/{wave-id}_TASKS.md` artifact must accompany the master spec. The Tasks file is an atomic checklist: each row = one independently-shippable task with `(a)` task ID `T.N`, `(b)` inputs (files / state read), `(c)` outputs (files / state written), `(d)` acceptance — a single EARS sentence per SR-24. The FE Agent dispatches on a Task ID, not the full spec, so each task has bounded context. Trivial specs (< 600 words AND < 150 LOC) keep §5 "Implementation phasing" inline. Spec Reviewer flags any spec exceeding the threshold without a Tasks file. Threshold rationale: at 600+ words the spec exceeds the comfortable single-context dispatch window; tasks artifact prevents FE Agent from re-reading the whole spec on every sub-wave. **(SR-24) EARS acceptance criteria (Wave-58)** — for new specs (post-wave-58), all entries in §6 "Acceptance criteria" must use EARS notation per `.claude/skills/ears-acceptance-criteria.md`: ubiquitous ("The system shall …"), event-driven ("When …, the system shall …"), state-driven ("While …, the system shall …"), optional ("Where …, the system shall …"), or unwanted ("If …, then the system shall …"). Bullet ACs without "shall" are rejected. Verification commands (grep / tsc / e2e) live in a separate `**Verification**` subsection — they verify ACs but are not themselves ACs. Existing pre-wave-58 specs grandfathered. Compound ACs ("the system shall do A AND B") must be split into atoms. Implicit-subject ACs ("Stripe is interactive") must name the subject ("The stripe `<button>` shall accept click events"). Return an ordered list of fixes. If clean: "Spec clean."

### Consistency Guardian

**When**: After every wave of executor work, BEFORE marking the wave done.
**Subagent**: `general-purpose`.
**Job**: Read the diff of files changed in the wave, plus the parts of the codebase they touch. Find:

- **GD-1 Duplicate navigation entries** — two sidebar items pointing to the same route or to the same conceptual surface (e.g. `/clients` + `/clients?view=inbox`).
- **GD-2 Orphaned code** — old version of a primitive still imported somewhere after new one shipped.
- **GD-3 Inconsistent token usage** — file uses `text-xs` while sibling files use the new `text-meta` preset.
- **GD-4 Pattern drift** — new component uses ad-hoc Tailwind where a primitive now exists (`<SectionHeader>`, `<Eyebrow>`, `<EmptyState>`).
- **GD-5 Missing rename sweep** — page title renamed in one place, not in another (sidebar label vs pageTitles map vs route metadata).
- **GD-6 TS / Lint** — `npx tsc --noEmit --skipLibCheck` clean.

(GD-7 through GD-15 are defined in the prompt template below.)

**Output**: findings table with `severity / file:line / fix`. Files of follow-up tasks for orchestrator to dispatch.

**Prompt template** (use verbatim):

> You are the Consistency Guardian for this project. Wave just finished — files changed: `<git diff list>`. Scan for: **(GD-1)** duplicate sidebar entries / nav surfaces pointing at the same conceptual target — grep the literal `href:` strings in `Sidebar.tsx` for repeats AND scan for query-string variants pointing at the same page (`/x` vs `/x?view=y`), **(GD-2)** orphan imports of replaced primitives, **(GD-3)** token-drift (legacy `text-xs` vs new `text-meta`), **(GD-4)** inline Tailwind where a new primitive exists — explicitly check for hand-rolled eyebrows (`text-[10px] uppercase tracking-`), hand-rolled cards (`border-card-border bg-card-color rounded-card`), hand-rolled focus rings (`focus-visible:ring-`), and missing `FOCUS_RING` on new interactive elements, **(GD-5)** partial rename sweeps — for each user-visible label changed, verify the sibling sites: sidebar label, `pageTitles` map in `Sidebar.tsx`, `lib/commands/builtin.ts`, route metadata, breadcrumb registry, **(GD-6)** icon collisions — same lucide icon used for two sibling sidebar items or a group + its child, **(GD-7)** `npx tsc --noEmit --skipLibCheck` must be clean, **(GD-8)** voice violations — grep changed files for banned strings from `docs/VOICE_GUIDE.md` jargon table (`BRANDNAME`, `preset`, `orchestrator`, `variant`, `cockpit`, `sandbox`, `playbook`, `workflow`, etc.) and any ALL-CAPS product-name tokens. **Tightening (Cycle 3): for the product-name token `BRANDNAME\b` specifically, run a REPO-WIDE scan — `rg "BRANDNAME\b" --type tsx --type ts app/ components/ lib/` — not just changed-file scope. The brand name has no directory carve-out; every match is a finding. Voice sweeps for product-name tokens are global by definition.** **(GD-9) Route-consolidation pairing** — after any wave that merged N legacy routes into 1 canonical route (look for new redirect shells, deleted `page.tsx` files, or `next.config.js` 308 entries added in this wave), verify the canonical route appears as an entry in `components/layout/sidebar/Sidebar.tsx` `sidebarConfig` AND has a `pageTitles[canonical]` entry in both `Sidebar.tsx` and `components/layout/Header.tsx`. Missing entries are P0 — the consolidation is invisible. **(GD-10) Dynamic-import of deleted redirect shells** — after any route consolidation, repo-grep `rg "dynamic\(\s*\(\)\s*=>\s*import\(['\"]@?/?app/\(dashboard\)/(<deleted-routes>)/page['\"]\)"` and `rg "import\s+.*from\s+['\"]@?/?app/\(dashboard\)/(<deleted-routes>)/page['\"]"` across `components/**` and `app/**`. Any importer of a deleted route's redirect shell will navigate the entire app away when the shell mounts — P0. **(GD-11) Dead-code orphan check (Cycle 3, tightened Cycle 6)** — for every component whose call sites were deleted in this wave, verify the component source file itself was deleted in the same wave. Run `git diff --name-status` for the wave: when call-site files appear in the diff with imports removed (e.g. `LazyHeader` no longer imported by `Header.tsx`), repo-grep `rg "from.*<ComponentName>" app/ components/ lib/`. If the component has zero remaining importers AND the source file is still tracked, file it as a P1 — the file ships in the build but has no entry point. Punting deletion is rejected; the deletion belongs in this wave. **Tightening (Cycle 6):** the check must run on **EVERY** wave, not only when a `git diff --diff-filter=D` deletion is present. Round 11 deleted the only call site for `components/layout/Header.tsx` (450 LOC) by switching the dashboard layout to `DashboardCabinetChrome`, but Header.tsx itself was never modified that wave — so a diff-filtered-D check wouldn't fire. Rounds 12-17 ran without re-checking and the orphan persisted through Round 17 (rediscovered as Guardian P1-05 in `docs/audit/33-guardian-rounds-15-17.md`). Cheap to run: build the set of all components under `components/layout/` + every other `components/` subdir touched in the wave's diff, then for each one `rg "from .*<ComponentName>'" app/ components/ lib/ | wc -l`. Zero importers = P1 orphan, file the deletion as same-wave follow-up. Don't wait for the import-removal to be the trigger — orphans arise whenever any one of a component's call sites is the last one and gets removed, even if the source file is untouched. **(GD-12) Query-param tab as conceptual duplicate of another route (Cycle 4)** — **GD-9** catches duplicate URLs at the route layer; **GD-12** catches the same duplication when it hides inside a route as a `?tab=` query param or a `<TabsList>` entry. Scope: every wave, repo-grep `rg "\?tab=" app/ components/ lib/` to enumerate query-param tab surfaces, and `rg "<TabsList" app/ components/` to enumerate React-Tabs tabs. For each tab, build the pair `(parent_route, tab_name)` — e.g. `(/agents, workflows)`, `(/partners, agency)`. Cross-reference each `tab_name` against the sibling routes in the same domain pillar (read pillar ownership from `L1.5 — Domain Directors` table): if a tab name aligns conceptually with another top-level route owned by the same Director (e.g. `/agents?tab=workflows` overlaps `/recipes` — both are "pre-built combinations tied to funnel stages" per **DEC-002**), file it as P0 (route-tab conceptual duplicate). The fix is one of: (a) delete the tab and link from the parent route's intro to the canonical route, (b) delete the canonical route and keep only the tab (rare — usually loses sidebar visibility), (c) prove the two concepts are genuinely distinct and cite the Director's arbitration in the wave report. Tab-vs-route duplication is invisible to URL-only checks like **GD-9** because the tab lives behind a query param; **GD-12** closes that gap. **(GD-13) Sibling sidebar label uniqueness (Cycle 5)** — repo-grep `rg "label:\s*['\"]" components/layout/sidebar/Sidebar.tsx` and build a `Map<label, [group_id]>` from every entry in `sidebarConfig`. Any label that appears more than once across groups OR across a group + its child items = **P0** (user sees the same section heading twice in the rail, cannot distinguish destinations). Rounds 11-12 shipped two groups both labelled "Today" (`inbox-top` + `today`) because a rename of `dashboards-group → today` skipped the sibling-label cross-check. The fix is one of: rename the colliding group, fold the two groups into one, or prove the duplicate is intentional with a Director arbitration cite. **(GD-14) Deleted-route server-replacement pairing (Cycle 5)** — extend **GD-9** with a post-deletion grep step. After any wave that converts a route file to a `'use client'` redirect stub OR deletes a route file outright, enumerate the deleted/converted paths from `git diff --name-status` (filter `D` and `M` for `app/(dashboard)/*/page.tsx`). For each deleted route `<path>`, run `rg "destination.*<path>|source.*<path>" next.config.js`. Zero matches AND no in-wave replacement file = **P0** (bookmark / external-link / search-index 404 chain). Also repo-grep `rg "['\"]<path>['\"]" app components lib | wc -l` — every remaining literal reference to the deleted route is a stale callsite (ESLint advice strings, `pageTitles` map, orchestrator intents emitting `<a href="...">`, AgentWorkspace metadata) and must be filed as a finding alongside the missing redirect. Rounds 11-12 shipped six deleted routes with NO server redirects (`/conversations`, `/pipeline`, `/quotes`, `/invoices`, `/roi-analytics`, `/review-guardian`) plus a comment in `billing/page.tsx` falsely claiming the redirects existed — the kind of regression **GD-14** prevents. **(GD-15) Telemetry event registry sync (Cycle 6)** — repo-grep `rg "track\(\"([^\"]+)\"|useTelemetry.*\.\s*emit\(\"([^\"]+)\"|track\(\s*['\"]([^'\"]+)['\"]" app/ components/ lib/` to enumerate every behavioral event name emitted anywhere in the codebase, then read the `TELEMETRY_EVENTS` map in `lib/telemetry/registry.ts` and build the set of registered names. Any emitted event name **not present** in the registry = **P1** (taxonomy gap — the event leaks past audit-pipeline filters and breaks downstream dashboards / queries built off the registry as canonical name set). Pattern recurred in Rounds 15 (`lib/recipes`), 17 (`AIWorkflowDrawer` with `ai_workflow_drawer.tab_changed`, `ai_workflow_drawer.recipe_edit_clicked`, `ai_workflow_drawer.catalogue_link_clicked`), and round 32 (`recipe.run_requested`) — the registry consistently lags emissions by one wave. **GD-15** closes the loop: after the wave's executor lands, Guardian's grep is the last gate before the registry drift becomes durable. Pairs with Spec Reviewer **SR-21**. **Scope rules — apply to BOTH the changed-files diff AND the entire file body of any file touched**: (a) Icon-collision check **GD-6** and primitive-drift check **GD-4** must scan the ENTIRE file body of every changed file (not just the changed hunks) — legacy violations in unchanged regions count if the wave's task scope included that file. Justify why: a file in the wave's universe is fair game for full-file audit; a file outside is not. (b) For primitive-adoption Sprints specifically (any task labelled "adopt `<Primitive>`" or "migrate to `<Primitive>`"), run a **repo-wide** grep for the legacy class patterns (`border-card-border bg-card-color rounded-card`, `text-\[10px\] uppercase tracking-`, etc.) across `app/**/*.tsx` and `components/**/*.tsx` — surface every remaining match as a finding even outside the changed-file set, because the Sprint promised global adoption. (c) For voice fixes, when a changed string matches a Voice Guide before-example, verify the new string matches the Voice Guide after-example **byte-for-byte**, not just casing/cleanup. Flag any voice fix that did less than the Voice Guide prescribed rewrite. Return findings as `severity / file:line / fix` table.

### Tenant-Safety Auditor

**When**: After Consistency Guardian, before Process Engineer. Every wave. The cycle is now:
`Spec Reviewer → Lead executes → Guardian → Tenant-Safety Auditor → Process Engineer`.

**Subagent**: `general-purpose`.

**Job**: enforce the three architectural rules from [docs/MISSION.md](../docs/MISSION.md) "Safe by default":

- **TS-1 Per-tenant isolation** — every changed query / store / API client carries a tenant-id filter. No literal `'tenant'` string sneaks into multi-tenant queries (the recurring CF-spec finding). Cross-tenant leak = P0.
- **TS-2 Granted-not-assumed tool access** — any new AI tool / connector / scope-expansion in the wave must declare the role permissions it needs, and the role-permission matrix must grant them. Silent over-permission = P0.
- **TS-3 Audit-by-default** — every action touching customer data emits an audit-log event with (actor / tenant / role / target-entity / payload-summary). Missing audit emission on a state-changing handler = P1.

(TS-4 through TS-7 are defined in the prompt template below.)

**Output**: per-wave report at `docs/audit/<NN>-tenant-safety-<wave>.md`. Format mirrors the Guardian:

```markdown
# Tenant-Safety Audit — Wave <N>

| # | Severity | File:line | Issue | Fix |
|---|---|---|---|---|
| 1 | P0 | <file:line> | <isolation breach / over-permission / missing audit> | <fix> |
```

**Hard rules**:
- P0 findings **block release**, not just dispatch.
- Never edits product code.
- Scope: every file touched by the wave + every new endpoint, store mutation, or AI-agent handler.

**Prompt template** (use verbatim):

> You are the Tenant-Safety Auditor for this project. Charter in `.claude/AGENT_PLAYBOOK.md` L2 → Tenant-Safety Auditor. Wave just finished — read the Guardian report and the changed-files diff. For every file touched, audit: **(TS-1)** tenant-id filter on all queries / store reads / API calls — flag any literal `'tenant'` strings or missing tenant scoping in multi-tenant code, **(TS-2)** role-permission grants — every new action handler declares the role permissions it needs, and `docs/ROLE_PERMISSION_MATRIX.md` already grants them, **(TS-3)** audit-log emission on every state-changing handler. **(TS-4) Client-only role gates** — explicitly grep changed files for `useRoleStore`, `operationalRole`, `roleStore`, and any `localStorage.getItem(...role...)` / `app.sales.role.v1` reads used as a permission decision. Any role-gate that reads from a persisted Zustand store or localStorage instead of `useAuth().user.role` is P0 — the demo role-switcher can be flipped client-side. **(TS-5) Feature-gate ordering** — for any component that calls `useFeature(...)` or any plan/feature gate, verify the gate appears BEFORE any store-selector hook reading gated data (`useAgencyStore`, `useBillingStore`, `usePartnersStore`, etc.) in the same component body. If a store read precedes the gate, the data hydrates regardless of the gate's verdict — P0 isolation/permission breach. **(TS-6) Hardcoded tenant placeholder scan (Cycle 3)** — repo-grep `rg "DEFAULT_TENANT_ID|00000000-0000-0000-0000-" lib/ app/ components/` and flag every match as P0. Any "fallback when caller omits" pattern for tenantId is a cross-tenant leak: the first call site that forgets the argument writes into the null tenant and surfaces to the next reader. tenantId must be a required argument with no default — if the caller can't provide it, the function should refuse to run. Also grep for `tenantId\s*=\s*['"]tenant['"]`, `tenantId\s*\?\?\s*['"]`, and `tenantId\s*\|\|\s*['"]` (default-string-or-placeholder patterns). **(TS-7) `AuthProvider.logout()` store-cleanup parity (Cycle 7)** — enumerate every `import { useXStore } from "@/lib/store/..."` (and equivalent paths like `@/lib/approvals/store`, `@/lib/integrations/.../store`) added in this wave's diff. For each new store imported in a CLIENT component (`'use client'` files) OR mutated via `useXStore.setState(...)` anywhere in the wave: verify that EITHER (a) a matching cleanup line exists in `components/providers/AuthProvider.tsx` `logout()` — `useXStore.setState({...initial-state...})` for in-memory stores OR `clearXForTenant(currentTenantId)` for persisted stores, OR (b) the store file's header carries the explicit comment `// AP-27 exempt: tenant-agnostic (UI-only state)`. Stores without either are flagged as TS-7 finding. Severity: P3 if the store is in-memory only (`create<X>((set) => ...)` with no `persist()` wrapper — narrow survival window between logout and next mount); **P0 if the store uses `persist()` middleware** (data sticks in localStorage across logout and bleeds to the next user on the same browser). Pattern recurred across Round 9 (`pauseFlags`, `wizardStore`), Round 20 (`useApprovalsStore` flagged), Round 22 (`useApprovalsStore` fixed by Lead A). Pairs with **AP-27** at the anti-pattern catalogue and SR-N at the spec layer (future Cycle). Output `docs/audit/<NN>-tenant-safety-<wave>.md` with findings table. P0 findings block release.

### Process Engineer  (continuous-learning meta-agent)

**When**: After every Guardian + Tenant-Safety Auditor run. Always. The cycle is now:
`Spec Reviewer → Lead executes → Guardian → Tenant-Safety Auditor → Process Engineer → next wave starts smarter`.

**Subagent**: `general-purpose`.
**Job**: read the Guardian report, identify recurring or systemic patterns, and **modify the system itself** so the same finding type never appears again. Specifically:

1. **Update [.claude/AGENT_PLAYBOOK.md](.claude/AGENT_PLAYBOOK.md)** — add the new anti-pattern to the Anti-patterns section. Update team owns-files lists if scope drift was the root cause.
2. **Update Spec Reviewer prompt** — add a new check item so the next spec gets blocked if the same issue is queued (e.g. if Guardian found "added X without removing duplicate Y," add an explicit reviewer check for that pair).
3. **Update Consistency Guardian prompt** — broaden patterns. If Guardian only found 1 token-drift type, but the user manually spotted more, codify the wider category.
4. **Update [docs/VOICE_GUIDE.md](../docs/VOICE_GUIDE.md)** — if voice violations were found, add the exact bad string to the jargon table with the replacement.
5. **Update team spec templates** — append acceptance criteria that prevent the issue class. E.g. "every UX task that adds a sidebar entry MUST list the conceptual duplicates to remove in same PR."
6. **Update [docs/audit/](../docs/audit/) lesson log** — append a one-line lesson to `docs/audit/LESSONS.md` so the postmortem is searchable.

**Output**:
- A short markdown report under 60 lines: what patterns I extracted, what files I edited, why.
- The edits themselves committed inline by the Process Engineer.

**Auto-scan rule — every 3 completed waves**:
- **Trigger**: when the wave counter is a multiple of 3 (waves 3, 6, 9, 12, 15, 18 …).
- **Action**: read the last 3 retro files from `docs/retros/` (sorted by filename descending). Identify patterns that recurred across ≥ 2 of the 3 waves.
- **Patterns to flag** (non-exhaustive):
  - Same failure class repeated — e.g. CSS scope bugs appearing in multiple consecutive waves.
  - Missing ADRs — a significant decision shipped with no entry in `docs/decisions/`.
  - Dev tools or mock data leaking into production builds.
  - A Guardian check firing 2+ times on the same file or component.
- **Output**: append a "Cross-wave findings" section (≤ 1 page) to `docs/retros/_FINDINGS.md`. Each finding: wave IDs where it appeared, root cause hypothesis, proposed playbook / skill / ADR change, severity (P0–P3). If `docs/retros/_FINDINGS.md` does not exist, create it with a header line before appending.
- **Follow-through**: for each P0 or P1 finding, also apply the standard Process Engineer edit steps (1–6 above) in the same run.

**Skill aging pass — every Process Engineer cycle (every 3 waves)**:

Run immediately after the normal cross-wave report:

1. Read `.claude/skills/_INDEX.md` — build a list of all skill slugs and their current Status values.
2. For each skill file at `.claude/skills/<slug>.md`, count the number of wave citations in the `## Wave history` section.
3. Apply aging rules:
   - 1-4 wave citations → Status stays `experimental` (or is set to `experimental` if the file predates this rule).
   - 5+ wave citations → promote to `stable` (update the `> Wave:` frontmatter line and the `_INDEX.md` Status cell).
   - Zero citations in the last 5 waves → mark `deprecated` (update frontmatter + `_INDEX.md`). Do NOT delete — deletion requires explicit user approval.
4. Update `_INDEX.md` Status column for any skill whose status changed.
5. Append a one-line summary to `docs/retros/_FINDINGS.md`:
   - Format: `Aging pass wave-NN — promoted: [slugs]. Deprecated: [slugs]. No change: N skills.`

**Skill Variations auto-append**:

When a new wave applies an existing skill with a structural twist (same core pattern, different context or constraint):

- Skill Extractor (not Process Engineer) appends the twist to the `## Variations` section of the existing skill file.
- Process Engineer does NOT append to Variations — it only updates aging status.
- Trigger: Orchestrator passes "twist on existing skill `<slug>`" in the Skill Extractor dispatch prompt.

**Hard rules**:
- Never widens scope — only tightens. Adds checks, never removes them without explicit user approval.
- Never edits page logic or product code. Only system docs and prompts.
- Edits must be additive — append to anti-patterns / jargon tables, don't rewrite the whole file.
- If two waves produce contradictory lessons, flags the conflict for orchestrator to arbitrate.

**Prompt template** (use verbatim):

> You are the Process Engineer for this project. Read the Guardian report `<docs/audit/NN-guardian-*.md>`. Identify the 2-4 recurring patterns. For each pattern: (1) decide which system artifact prevents recurrence (playbook anti-pattern `AP-N` / Spec Reviewer check `SR-N` / Guardian scan `GD-N` / Tenant-Safety scan `TS-N` / Voice Guide jargon table / team spec template), (2) make the edit additively using the prefix convention (see L2 → Identifier convention), (3) log a one-liner to `docs/audit/LESSONS.md` citing the new identifier(s) by their prefixed form (never bare `#N`). Output a < 60-line markdown report listing what you changed and why. Never edit product code. Never weaken existing checks.

The Process Engineer is what makes the agency self-improving: every Guardian finding becomes a permanent guardrail.

---

## Product mental model (required context for every team)

this project is not "an AI agent in a CRM." this project is a managed AI workforce built around five role positions (owner / dispatcher / tech / lead-tech / office) and **AI funnels** (pipelines) where each stage knows its owning role, its assistant, and its data scope. Pages (CRM, Inbox, Calendar, Billing, Knowledge, Connections) are **tools agents use** — not destinations users navigate to. Most user work happens in the orchestrator chat; pages are for inspection and override.

Full mission in [docs/MISSION.md](../docs/MISSION.md). The five compass questions at the bottom of that file are non-negotiable for every Spec Reviewer / Architect / Team Lead.

When in doubt about a feature: it should strengthen one of the five roles, pass through an AI funnel stage, keep the human in approval, respect role scope, and work in chat-first / page-second mode. If a feature can't satisfy these, it does not belong in v1.

Distinctive product moves that need to be reflected in every spec:

- **AI funnels** as the structural unit of work. Standard funnels: lead qualification, installation, service, maintenance, HR onboarding, estimate. Each carries per-stage role + scope + approval rules.
- **Per-role assistants** layered on the orchestrator. Dispatcher assistant differs from tech assistant differs from office assistant differs from owner assistant. Collapse to owner if a role is vacant.
- **Service-style isolation** — managed SaaS with per-tenant data boundary, not self-host.
- **Position amplifiers, not replacements** — north star metric is jobs-per-role-per-month, not heads cut.

---

## L3 — Talent Director (grows the team)

While Process Engineer tightens **how** the team works, Talent Director decides **who** is on the team. Runs every 3–5 waves or on user request.

**Subagent**: `general-purpose`.

**Job**: read the recent Guardian reports + LESSONS.md + recent program specs. Answer:

1. **Capability gaps** — what kind of analysis or implementation work could not be done well by the current roster? E.g. "the Custom Fields program needed BE schema thinking but no FE Engineering specialist owns that lens" → propose creating a **Data Modeller** specialist inside the FE Engineering team.
2. **Recurring contract holes** — same TS interface keeps re-appearing in specs without a canonical owner? Create a new role (e.g. **Type Architect** under FE Engineering for shared discriminated unions across stores).
3. **Skill gaps in existing agents** — a current specialist consistently needs context from a missing domain. Propose a **skill** that should be permanently attached to that specialist's charter (e.g. "Voice & Content Specialist should also know this project persona personas — add `personas` to their context").
4. **Tool gaps** — does the team need a new MCP, a new local script, a new style of artifact (e.g. a 1-page founder brief, a per-tenant safety report)? Propose adding it.
5. **Pure waste** — any role on the roster nobody invoked in 5 waves? Propose retiring or merging.

**Output**: short markdown report appended to [docs/audit/ROSTER_DELTAS.md](../docs/audit/ROSTER_DELTAS.md):

```markdown
## Roster delta — <date>

### New roles proposed
- <Team> · <Role name> — gap it fills (cite Guardian / LESSONS / specs).

### Roles retired or merged
- <Team> · <Role name> — last invocation, why it's redundant.

### Skills to add to existing agents
- <Agent> ← <skill name> — where the missing context shows up.

### Tools / artifacts to add
- <name> — purpose, format.

### Decision recommended
Approve / hold / partial (with reasons).
```

After producing the report, Talent Director **does not unilaterally edit the playbook**. It writes the delta as a proposal. The orchestrator brings it to the user for approval. Approved deltas get applied to playbook L1 / L2 sections by Process Engineer in the next cycle.

**Prompt template** (use verbatim):

> You are the Talent Director for this project. Charter in `.claude/AGENT_PLAYBOOK.md` L3. Read recent `docs/audit/2*-guardian-*.md` and the full `docs/audit/LESSONS.md`. Scan team-spec docs in `docs/audit/4*.md`. Identify capability gaps, recurring contract holes, skill gaps, tool gaps, and pure waste. Append your delta to `docs/audit/ROSTER_DELTAS.md`. Do not edit the playbook directly. Output a < 80-line summary back.

**Hard rules**:
- Never adds a role without a concrete gap that surfaced twice in the last five waves.
- Never proposes a skill without naming the agent that gets it.
- Never retires a role without quoting its last invocation date.
- Edits one file only: `docs/audit/ROSTER_DELTAS.md` (append).

The Talent Director is what makes the agency self-staffing: when the work mix shifts, the roster shifts with it.

---

## Wave protocol

A standard cycle for any frontend program:

```
Wave 0   Discovery          — N specialist analysts (parallel): CIO sightings, Discovery Officer, Domain Architect, Product Strategist
Wave 1   Synthesis          — Chief Analyst → MASTER audit
Wave 1.5 Mission Compass    — synthesis checked against docs/MISSION.md (mandatory)
Wave 1.6 Chief Architect    — reads Wave 0-1.5 outputs, writes docs/specs/{wave-id}_MASTER_SPEC.md (MANDATORY for non-trivial waves)
Wave 2   Spec Reviewer      — validates master spec; compass check included; blocks dispatch until clean
Wave 2.5 Per-team specs     — Team Leads refine implementation details against approved master spec (parallel)
Wave 3   Mount spec page    — orchestrator wires into /<feature>-spec
Wave 4   Execution          — Team Leads in parallel; each reads master spec before starting
Wave 4.5 Guardian           — mandatory after execution
Wave 4.6 Tenant-Safety      — mandatory; P0 findings block release
Wave 4.7 Process Engineer   — mandatory; updates playbook + prompts + voice guide
Wave 5   Follow-ups         — orchestrator dispatches Guardian findings
Wave 6   Talent Director    — every 3-5 waves, proposes roster deltas
Wave 7   Competitive Watch  — biweekly, CIO scans WATCHLIST
```

For small changes (1-3 task), waves 0-3 collapse: orchestrator writes spec inline → Spec Reviewer → Lead executes → Guardian → done.

---

## Conflict-resolution rules

- **Two leads editing same file**: orchestrator serializes (lead A finishes, lead B reads new state, then edits). Never parallel on overlapping files.
- **Lead disagrees with Architect spec**: lead writes a `TODO(architect):` comment, completes adjacent work, returns the question to orchestrator for arbitration.
- **Spec Reviewer flags a P0**: orchestrator stops dispatch, rewrites spec, re-runs reviewer.
- **Guardian flags a P0**: orchestrator creates immediate follow-up task before declaring wave done.
- **UX wants to change a token**: UX requests, UI implements. UX cannot edit `components/ui/*` or `tailwind.config.ts`.

---

## Dispatch templates

Standard prompt for a team lead:

```
You are <Team> Team Lead at this project. Orchestrator dispatches Sprint <N> from
the official spec [docs/audit/<NN>-<TEAM>-TEAM-SPEC.md].

Mission compass: every task must pass docs/MISSION.md compass before you mark
it done. If a task violates a compass question, flag it back to orchestrator
instead of shipping. Read MISSION.md once at start of session.

Your tasks (numbered):
1. <task id> — <one-line summary>
2. ...

Spec Reviewer has approved this batch (including compass check). You may
dispatch specialists or execute yourself. After each task: `npx tsc --noEmit --skipLibCheck`.

Hard rules:
- English UI strings only.
- TypeScript strict, no `as any`.
- Tailwind only, via `var(--*)`.
- Use FOCUS_RING from lib/styles.ts on every interactive primitive.
- Use motion tokens from lib/motion.ts; honor useReducedMotion().
- Strengthen one of the five this project roles (owner / dispatcher / tech / lead-tech / office).
  If your task doesn't, ask orchestrator before continuing.
- Chat-first / page-second — if your task adds a destination page where a chat
  could solve it, flag it.
- DO NOT touch <out-of-scope files for this team>.

After all tasks: short markdown report (<80 lines) with status, files changed,
TODO(BE) flags, and any cross-team dependencies surfaced. Last line of the
report: "Mission compass: yes/no on each of the 5 questions."
```

---

## Roster — what's already built

| Component | Owner team | Location |
|---|---|---|
| `<Card>` | UI | components/ui/Card.tsx |
| `<SectionHeader>` | UI | components/ui/SectionHeader.tsx |
| `<Eyebrow>` | UI | components/ui/Eyebrow.tsx |
| `<EmptyState>` | UI | components/ui/EmptyState.tsx |
| `<StatCard>` | UI | components/ui/StatCard.tsx |
| `lib/motion.ts` | UI | motion tokens |
| `lib/styles.ts` | UI | FOCUS_RING and friends |
| `<ContextBar>` | UX | components/layout/ContextBar.tsx |
| `<AskInput>` | UX | components/layout/AskInput.tsx |
| `<MiniNucleus>` | UX | components/layout/MiniNucleus.tsx |
| `<DashboardCabinetChrome>` | UX | components/layout/DashboardCabinetChrome.tsx |
| `<DashboardHomeHero>` | UX | components/dashboard-home/DashboardHomeHero.tsx |
| `<OverviewStats>` | UX | components/dashboard-home/OverviewStats.tsx |
| `<UserActivityHeatmap>` | UX | components/dashboard-home/UserActivityHeatmap.tsx |
| `<LiteraryStat>` | UX | components/dashboard-home/LiteraryStat.tsx |
| `<SidebarCustomizer>` | UX | components/layout/sidebar/SidebarCustomizer.tsx |
| `<PureBlackToggle>` | UI/UX | components/layout/sidebar/parts/PureBlackToggle.tsx |
| `<UsageMeter>` | UX | components/layout/sidebar/parts/UsageMeter.tsx |
| `commandRegistry` | UX | lib/commands/registry.ts |
| `usePureBlack` | UI | lib/hooks/usePureBlack.ts |
| `useSidebarPrefs` | UX | lib/store/sidebarPrefsStore.ts |
| `useOverviewStore` | UX | lib/store/overviewStore.ts |
| `docs/VOICE_GUIDE.md` | UX | content voice spec |
| `/ui-spec` page | Orchestrator | first audit document |
| `/ux-ui-spec` page | Orchestrator | deep audit document with team specs |

---

## Anti-patterns (do NOT repeat)

These are mistakes made in earlier sessions. They are now codified to prevent recurrence. Identifiers use the `AP-N` prefix (see Identifier convention in L2).

- **AP-1 Adding new sidebar entry without removing the conceptual duplicate.** Example: added `Quick → Inbox` (`/clients?view=inbox`) while `CRM → Clients` (`/clients`) stayed — two entries, one page. Always pair "add" with "remove or rename the old."
- **AP-2 Russian copy in UI.** Project ships English only. Voice guide is the source of truth.
- **AP-3 Inline focus-visible styles.** Always import `FOCUS_RING` from `lib/styles.ts` and `cn()` it onto the className. No hand-rolled rings.
- **AP-4 `<script>` in JSX.** Always wrap inline scripts in `<Script>` from `next/script` with explicit `id` and `strategy`. React 19 throws a console error on raw `<script>`.
- **AP-5 `bg-card-color/10`** decoration on overview cards. Use a 2px accent stripe instead — keeps cards monochrome, prevents color noise.
- **AP-6 Skipping QA waves.** Spec Reviewer and Consistency Guardian are MANDATORY. The catastrophic dupe surfaced because Guardian had not been invented yet.
- **AP-7 Literal route duplication.** Same `href` string in two sidebar groups (Wave 6: `/knowledge` and `/connections` each in Workspace + Settings). Cheaper to detect than conceptual dupes — grep `href:` after every Sidebar edit. One route, one entry.
- **AP-8 Label drift across rename targets.** Renaming a surface in one site (e.g. `Sidebar.tsx`) but missing the sibling sites (`pageTitles` map, `lib/commands/builtin.ts`, route metadata). A rename is not done until every reference is updated. Wave 6: `/knowledge` had 3 different labels across 4 sites.
- **AP-9 Re-rolling a primitive that already exists.** Inlining `text-[10px] uppercase tracking-[0.18em]` is `<Eyebrow>`. Hand-rolled `border border-card-border bg-card-color rounded-card` is `<Card>`. Wrapping `focus-visible:ring-2 focus-visible:ring-amber-...` is `FOCUS_RING`. Before writing markup, check `roster` in this playbook.
- **AP-10 Same icon for two adjacent surfaces.** Wave 6: `Sparkles` on both `Growth` and `Lead research`; `Inbox` on both `Quick` group and its child. Sidebar groups + their children must have distinct icons. Two sibling items must have distinct icons.

- **AP-11 Primitive-adoption Sprints that fix only the files named in the spec, not the whole repo.** Wave 6 post-fix: UI Lead replaced one hand-rolled Card (`SidebarCustomizer`) but left three more (`Sidebar.tsx:832`, `UsageMeter.tsx:70`, `UserActivityHeatmap.tsx:91`). "Adopt `<Primitive>`" Sprints are global by definition. Spec must include `rg "<legacy class pattern>"` returning zero matches across `app/**` and `components/**` as acceptance criterion. Guardian must repeat the repo-wide grep, not the file-scoped one.

- **AP-12 Guardian-only-scans-the-diff blind spot.** Wave 6 post-fix surfaced 5 violations (3× icon collision, 2× hand-rolled Card) that lived in *unchanged regions* of files the wave *did* touch. If a file is in the wave's task universe, the full file is fair game — Guardian must read the WHOLE file body, not just the changed hunks. Files outside the wave's universe stay out of scope; pre-existing legacy in untouched files is acknowledged technical debt, not a Wave-N failure.

- **AP-13 Voice fixes that fix the casing but skip the structural rewrite.** Wave 6 post-fix: line 447 changed `BRANDNAME` → `this project` but the Voice Guide's example #10 prescribes the full rewrite "Tell BRANDNAME what you want to see" → "Tell us what you want to track" (verb change + addressee change, not just casing). When a string matches a Voice Guide before-example, the fix must match the after-example byte-for-byte — don't half-fix.

- **AP-14 Role-gating on a client-only zustand store instead of `useAuth().user.role`.** Wave D part 1: `app/(dashboard)/partners/page.tsx:441-460` gates the admin tab with `useRoleStore.operationalRole`, but `lib/store/roleStore.ts:18` is a "demo role switcher" persisted to localStorage. Any user can flip `app.sales.role.v1` and the admin surface renders (Applications, AllPartners, MarketplaceModeration, MOCK_ADMIN_STATS leak). Always use server-issued role claims (`useAuth().user.role` returned from `GET /api/users/me`) for permission decisions. The Zustand role store is for UX experimentation only — never for gating.

- **AP-15 Feature gate (`useFeature(...)`) placed AFTER store-selector hooks for the gated content.** Wave D part 1: `app/(dashboard)/partners/page.tsx:262-348` checks `useFeature("white_label")` on line 263 but `useAgencyStore(...)` selectors fire on lines 264-269 — store reads happen before the gate decides, so cross-tenant agency data (`subAccounts`, `totalMRR`, `costToPlatform`, `branding.brandName`) hydrates regardless. Hoist every gate check above any store hook that reads gated data: `if (!hasFeature) return <Locked/>;` is line 1 of the component body, not line 6.

- **AP-16 State-changing command / handler without `ctx.audit({...})` emission.** Wave D part 1: `lib/commands/builtin.ts:27-31` (`create-lead`) opens the lead-creation form with zero audit-log emission, same for `open-chat` (160-171) and the stub `download-report` (107-113). Per Mission "Audit-by-default", every action touching customer data emits `actor / tenant / role / target-entity / payload-summary`. State changes include: command invocations of `kind: "action"`, store mutations on customer data (`voiceAIStore.setEnabled`, `chatStore.openPanel`, `partnersStore.loadDemo`), exports, deletes, and impersonations. URL/tab-state changes are exempt.

- **AP-17 Route consolidation that creates a canonical route without adding it to the sidebar entries or `pageTitles` map.** Wave D part 1: `/voice` and `/partners` consolidated six legacy routes via 308 redirects, but `components/layout/sidebar/Sidebar.tsx:199-288` had NO `sidebarConfig` entry for either canonical destination, and `components/layout/Header.tsx:33` still held `pageTitles["/speed-dialer"]` (deleted route) while missing `/voice` and `/partners`. Always pair route consolidation with (a) sidebar entry add, (b) `pageTitles` map update in both `Sidebar.tsx` and `Header.tsx`, (c) removal of deleted-route entries from the map. A consolidation that isn't navigable is invisible.

- **AP-18 Hardcoded `DEFAULT_TENANT_ID` placeholder as a "fallback when caller omits."** Waves D-fix + D-2 + E: same placeholder appeared in `MemoryAutoCapture`, `seedTriggers`, and runtime — three different files, same pattern of "use a zero-UUID when tenant isn't passed." A placeholder fallback is a cross-tenant leak waiting to happen: the moment one call site forgets to pass `tenantId`, every memory / trigger / event is written into the null tenant and surfaces to whichever user reads from that bucket next. Eliminate at the type level: require `tenantId: string` (no default) on every constructor, hook, and helper in `lib/` that touches per-tenant state. If a caller can't provide it, the function should refuse to run — not silently route to a placeholder. Any literal `'00000000-0000-0000-0000-'` UUID prefix in `lib/` is P0.
- **AP-19 Feature-gate ordering bug repeats on each new gated tab.** Wave D-1 fixed the agency tab in `partners/page.tsx`; Wave D-2 introduced the same bug on the voice tab. Pattern: the original fix taught the Spec Reviewer to look for "gate above store reads" but it didn't teach the reviewer to check NEW tabs of the same component. Whenever a spec adds a tab that uses `useFeature(...)` or any plan/feature gate, it must explicitly cite the gate-pattern from **AP-15** (gate shell + gated content split) — citation is the acceptance criterion. A new tab that gates without citing **AP-15** is treated as a regression of D-1, not a fresh bug.
- **AP-20 BRANDNAME voice sweep scoped to changed files only.** Wave D-fix swept `BRANDNAME → this project` in the files changed that wave, but Waves D-2 + E added new files (`OrchestratorStrip`, `AppHeader`, `MoChatInput`, `ChatInput`, `tourSteps`, `HandoffTab`, `SiteFooter`, `SystemMapGraph`, `ArticleReviewCard`) that still carry the all-caps violation. Voice sweeps for product-name tokens (`BRANDNAME`, `BRANDNAME`, etc.) are global by definition — the brand name doesn't have a "this directory is exempt" carve-out. After any voice-fix wave, Guardian must repo-grep `rg "BRANDNAME\b" --type tsx --type ts` and surface every match, not just matches in the changed-file set.
- **AP-21 New sidebar item shipped without an icon-collision audit against existing siblings.** Wave D-1 flagged Database×3, Code2×2; Wave D-2 quick-win fixed some collisions; Wave E shipped Custom Fields Spec with `ClipboardList`, which collides with the existing `ClipboardList` already in use. Icon collisions accrue silently because each spec author picks the icon in isolation. Every new sidebar item must declare its lucide icon AND grep `components/layout/sidebar/Sidebar.tsx` for that icon name — if a sibling already uses it, pick a different one. The icon table is finite (~1k icons in lucide); collision-checking is a 5-second grep.
- **AP-22 Dead-code accumulation across waves.** Wave D-1 removed call sites of `LazyHeader.tsx` but left the file in place. The file has zero importers (`rg "from.*LazyHeader"` empty), still ships in the build artifact, and shows up as orphan in dependency graphs. When a wave removes a component's only call sites, the component file itself must be deleted in the same wave. Punting deletion to "next sweep" never happens — the file becomes load-bearing scenery and nobody dares touch it. Guardian must scan `git diff --diff-filter=D` after the wave: if call sites were deleted but the source file is still tracked, file the deletion as a P1 follow-up.

- **AP-23 Query-param tab as a conceptual duplicate of another top-level route.** Example: `/agents?tab=workflows` (handoff chains across agents) duplicates `/recipes` (capability combinations per funnel stage) — both express "pre-built combinations tied to funnel stages," which is exactly the consolidation **DEC-002** mandated. The duplication slipped past **GD-9** because **GD-9** only scans URL strings (`href:` literals + redirect entries); it never opened a `page.tsx` to read the `<TabsList>` inside. Tabs inside routes were nobody's territory: Spec Reviewer didn't have a tab-vs-route check, Guardian only saw URLs, and Domain Directors enumerated routes but not tabs. Routes and tabs must each express one concept once. Treat a tab the same as a route for the purpose of concept-uniqueness: before adding a tab inside `/x`, run `rg "href:" components/layout/sidebar/Sidebar.tsx` to enumerate sibling top-level routes, then ask "is this tab's concept already a route?" If yes, fold one into the other and remove the loser. The new floor: a query-param tab IS a route in concept-space, even if the URL is just a search param.

- **AP-24 Two sibling sidebar groups carrying the same user-visible label.** Rounds 11-12: `id:"inbox-top"` and `id:"today"` both rendered label `"Today"` in `components/layout/sidebar/Sidebar.tsx:213-220, 261-270`. The collision happened because the Lead renamed `dashboards-group → today` without grepping sibling labels first — each group spec was reviewed in isolation. Operators see the same section heading twice in the rail and cannot tell the destinations apart. Distinct from **AP-10** (icon collision): this is the label string, which is the primary user-readable affordance, not the glyph. Every `sidebarConfig` entry must declare its label, and the Spec Reviewer must `rg 'label:\s*"<NewLabel>"' components/layout/sidebar/Sidebar.tsx` returning zero matches BEFORE the entry lands. Two siblings with the same label is **P0**, not P1 — the rail becomes ambiguous and ⌘K candidates collapse.

- **AP-25 Deleted-route 404 chain — stub files removed, server redirect never added.** Round 11: Lead C deleted 12 redirect-stub `'use client'` files. Six of them had matching server redirects in `next.config.js`; six did NOT (`/conversations`, `/pipeline`, `/quotes`, `/invoices`, `/roi-analytics`, `/review-guardian`). Those six routes now return 404 to anyone with a bookmark, a search-engine cached link, or an external referral. Worse: a comment in `app/(dashboard)/billing/page.tsx:35` falsely claimed "Old URLs /quotes and /invoices continue to resolve via redirects" — load-bearing falsehood that masked the regression. The deletion is only safe when one of two replacements ships in the same wave: (a) a `308` entry in `next.config.js` mapping the legacy path to the canonical destination, or (b) a same-wave replacement file at the legacy path. Bare deletion = 404 chain. The companion symptom is dangling callsites: ESLint advice strings, `pageTitles` map entries, `lib/orchestrator/intents/*.ts` user-facing strings (e.g. "Open /pipeline"), and `components/agents/workspace/AgentWorkspace.tsx` module-tab `route:` metadata all kept literal references to the deleted paths. A deleted route is not "done" until `rg "<deleted-path>" app components lib next.config.js` returns either zero matches or only the redirect-source line.

- **AP-26 Soft role gate (warning banner) shipped without hard CTA disable.** Round 17 `components/clients/AIWorkflowDrawer.tsx:73-336`: computes `isAllowed = role === "owner" || role === "admin"` and renders a warning banner ("Read-only — owner/admin can edit") when `!isAllowed`, but every Edit button on every RecipeRow stays clickable, the `handleEditRecipe` handler still fires telemetry, and the "Open full catalogue" footer Link is rendered unconditionally. The PipelineToolbar `Zap` button that opens the drawer also has no role check, so non-owners see and click the entry point. This is the **inverse** of **AP-14** (gating on the wrong source): the gate-source is correct (`useAuth().user.role`), but the gate is **soft** — it warns instead of preventing. Anti-pattern: render-the-warning-AND-keep-the-CTA-live. Users who can't perform the action see actionable affordances; if BE authorization fails on click, the user gets a confusing error after they've already attempted the action. Per Mission "Granted, not assumed", the surface should not advertise capabilities the viewer cannot exercise. Fix shape: every role-gated drawer/modal/section must, in addition to the banner: (a) `disabled` + `aria-disabled="true"` on every CTA inside (or hide them entirely), (b) make the outer entry point (toolbar button, sidebar item) role-gated too so non-allowed users don't reach the surface at all, (c) ensure any handler bound to a hidden/disabled CTA still does a role re-check defensively. Banner without CTA disable = P1 surface-advertising leak; this is the pattern flagged in `docs/audit/34-tenant-safety-rounds-15-17.md` finding #2.

- **AP-27 New tenant-bearing zustand store shipped without `AuthProvider.logout()` cleanup wiring.** Pattern recurred across Round 9 (`pauseFlagsStore` + `wizardStore` — fixed in same round), Round 20 (`useApprovalsStore` — flagged in `docs/audit/36-tenant-safety-round-20.md` finding #6), Round 22 (Lead A folded `useApprovalsStore.setState({ pending: [], isLoading: false, error: null })` into `components/providers/AuthProvider.tsx:77`). The codebase has 88 stores under `lib/store/` (plus more under `lib/approvals/`, `lib/integrations/`, etc.) — most are not tenant-scoped, but EVERY new one that touches per-tenant data MUST add a corresponding cleanup line to `AuthProvider.tsx` `logout()` in the SAME PR that introduces the store. Persisted stores (`zustand.persist()` middleware) use `clearXForTenant(currentTenantId)`; in-memory stores use `useXStore.setState({...initial-state...})`. Tenant-bearing definition: any field that derives from `useAuth().user.tenant_id` OR that gets populated from a tenant-scoped API call. A store can claim exemption by adding a comment at the top of the file: `// AP-27 exempt: tenant-agnostic (UI-only state)` (sidebar prefs, command palette open/closed, theme toggle, etc. — these are user-preference, not tenant-data). Silent omissions are the regression vector — the third store (`useApprovalsStore`) repeated the same bug the Round 9 fix established the pattern for, because no playbook rule blocked the merge. Pairs with Tenant-Safety **TS-7** (post-wave grep) at the audit layer. P3 today (in-memory stores have a narrow survival window between logout and the next consumer's mount); **P0 if the store later adds `persist()` middleware** (data sticks in localStorage across logout and bleeds to the next user on the same browser). Reference: `docs/audit/36-tenant-safety-round-20.md` finding #6, `docs/audit/LESSONS.md` Cycle 7 entry.

---

## Open seats / future hires

- **Analytics & telemetry engineer** (FE Team) — for product event instrumentation.
- **Localization Engineer** (Web Design × FE) — when we add second language.
- **DevRel content writer** (Web Design) — when we ship `docs.app.ai`.

These don't exist yet. Orchestrator should not invoke them.

---

## When to use GSD plugin vs our native dev system (post wave-72)

Per ADR-020 (`docs/decisions/ADR-020-gsd-plugin-coexistence.md`), GSD plugin (v2.44.5 via `jnuyens/gsd-plugin`) is installed alongside our native dev system. The two coexist by namespace — GSD uses `/gsd:*` slash commands, ours uses bare-name skills + custom agents. No file conflicts.

### Decision rubric — which system to use for a given task

**Prefer our native Chief Architect + quad-lens flow when:**
- The task is this project-specific (touches our agents, funnels, pipeline, voice surface)
- The spec needs to integrate with `docs/specs/wave-NN_MASTER_SPEC.md` numbering
- The task crosses 4+ files OR introduces new architectural surface
- The task touches the funnel registry, the agent roster, the design system, or the Constitution
- The task needs Cartographer-style codebase grep for existing patterns
- Visual QA, drift ratchet, or our 5-cadence self-maintenance applies

**Prefer GSD `/gsd:*` commands when:**
- The task is generic SDD (debug a known bug, fix a flaky test, refactor a single file)
- We don't have a custom skill for the pattern (check `.claude/skills/_INDEX.md` first)
- The task needs DDD mode (Documentation-Driven Development variant)
- We're at risk of context overflow and need GSD's `/compact` auto-resume handoff
- The task touches auth/credentials and we want auth-recipe memory help
- Hierarchical routing helps decompose a fuzzy multi-step ask

**Always use ours, never GSD:**
- Wave numbering (wave-NN) — we own this convention; GSD uses feature-based naming
- Constitution citations (§1-§7) — this project-internal navigation
- Mission Compass alignment checks — this project-internal
- `docs/metrics/_DASHBOARD.md` updates — our token-economy ledger
- Per-wave retros at `docs/retros/wave-NN.md` — our enforcement
- Reflexion queue, SI Reviewer, audit-backlog banner — our 5-cadence layer

### Anti-pattern guard — do not invoke GSD reflexively

GSD has 82 slash commands. Most of what they do, our native system already handles for this project-specific work. The temptation: see a generic-looking task, reach for `/gsd:specify` instead of dispatching Chief Architect. Resist when the task is this project-specific. The cost is divergent specs (`specs/<feature>/` vs `docs/specs/wave-NN_*`) that don't cross-reference.

Litmus test: "Will this spec cite Constitution §N or be referenced by a wave-NN_MASTER_SPEC.md?" If yes → ours. If no → GSD is fine.

### Anti-pattern guard — do not duplicate hooks

GSD installs Claude Code session-level hooks. We have `.husky/post-commit` running auto-Reflexion + `docs/CURRENT_WAVE.md` regeneration. They operate at different layers (Claude Code session vs git commit) and don't conflict directly. Do NOT add GSD's session hook AT the git hook layer — that would double-fire on every commit. If GSD ships a git-hook integration in a future release, audit it before enabling.

### Where GSD lives

`~/.claude/plugins/cache/gsd-plugin/` — global, outside the repo. Means different machines may run different GSD versions. To pin, check `gsd-plugin/.version` after `/plugin install`. If the project ever requires a specific version, document in `docs/decisions/ADR-020-gsd-plugin-coexistence.md` and use `/plugin install gsd@gsd-plugin@<version>` syntax.

---

## Where this file lives

`<project>/.claude/AGENT_PLAYBOOK.md`. Referenced from project [CLAUDE.md](../CLAUDE.md). Read at session start by Claude.
