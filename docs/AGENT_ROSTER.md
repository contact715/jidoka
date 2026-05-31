# Agent Roster (canonical reference)

This file mirrors the agents that live in `.claude/agents/` (which is gitignored). Treat this as the canonical record of which agents exist and what they do. If `.claude/agents/` is wiped on a fresh machine, rehydrate from this file.

For full role definitions and dispatch protocols see `.claude/AGENT_PLAYBOOK.md` (also gitignored, also mirrored when meaningful changes land — see retros for changes).

---

## IIA Line Definitions

Every agent in this roster carries a `Line:` annotation classifying it per the IIA Three Lines Model (2020). This is the authoritative taxonomy for this project agent governance.

**Reference**: IIA (2020), "The IIA's Three Lines Model" (updated from the prior 2013 framework). Institute of Internal Auditors. This file uses the 2020 naming ("Three Lines Model") throughout — the 2013 framing is superseded and not used here.

### Four-line taxonomy

| Line | Name | this project definition |
|---|---|---|
| **First** | Operations | Agents that own delivery: write code, run tests, execute tasks, or operate product pipelines. These agents hold write-tooling grants and are directly responsible for the output of each wave. |
| **Second** | Risk-Compliance | Agents that challenge, audit, or gate First Line output. They do not execute implementation but they can block or flag it. They propose, they do not auto-dispatch. Write-tooling grants are restricted or absent. |
| **Third** | Independent Audit | Agents that render verdicts on whether the combined First + Second Line activity is sound. Independence is structural: Third Line agents share no tooling grants with First or Second Line, and are dispatched after both complete. Their verdicts are binding within the pipeline. |
| **Pre-wave / Support** | Planning + post-wave instrumentation | Agents that produce inputs to, or records of, the wave lifecycle. They do not own delivery risk in the IIA sense and are not independent auditors. This is this project-specific extension of the IIA framework — IIA 2020 explicitly acknowledges that governing-body and support functions exist outside the three lines. |

### Governance note

`line:` annotations are platform-internal metadata. They are not surfaced to end-user roles (dispatcher, tech, office manager, lead-tech, owner). ROLE_PERMISSION_MATRIX and VOICE_GUIDE remain the governing documents for end-user scope. No amendment to those documents is required by this taxonomy.

### Cross-line dispatch enforcement

Cross-line dispatch is governed by `scripts/check-cross-line-dispatch.mjs` (wave-154). When a First Line agent dispatches a Second Line agent (or vice versa), the script exits 1 (BLOCK) in hard-block mode and emits a WARN in soft-trial mode. Every verdict is written as an append-only record to `docs/audits/cross-line-verdicts.jsonl` (EU AI Act Article 14 audit artifact). To approve a cross-line dispatch, the dispatch descriptor must carry `crossLineOverride: { "approver": "<name>", "reason": "<justification>" }` with non-empty fields. Anonymous bypasses (empty approver) are rejected at exit 1. The `.sdd-config.json` `crossLineBlock.hardBlockEnabled` flag controls hard vs soft mode.

### 44-agent line-assignment table

Wave-lifecycle accountability assignments are in `docs/governance/raci.md` (generated) and `docs/governance/raci.json` (source of truth).

| Agent | L-tier | Line: |
|---|---|---|
| Orchestrator | L0 | Line: First — Operations |
| Chief Product Officer | L0.5 | Line: First — Operations |
| Competitive Intelligence Officer | L0.5 | Line: First — Operations |
| Micro Architect | L0.7 | Line: Pre-wave / Support |
| Macro Architect | L0.7 | Line: Pre-wave / Support |
| Surface Cartographer | L0.7 | Line: Pre-wave / Support |
| Design System Architect | L0.7 | Line: Pre-wave / Support |
| Chief Architect | L0.75 | Line: Pre-wave / Support |
| frontend-agent | L1 | Line: First — Operations |
| Self-Improvement Reviewer | L0.9 | Line: Second — Risk-Compliance |
| Reflexion Critic | L0.95 | Line: Second — Risk-Compliance |
| Visual QA | L0.95 | Line: Second — Risk-Compliance |
| test-engineer | L0.96 | Line: First — Operations |
| test-runner | L0.96 | Line: First — Operations |
| coverage-auditor | L0.96 | Line: Second — Risk-Compliance |
| integration-tester | L0.96 | Line: First — Operations |
| perf-profiler | L0.96 | Line: Second — Risk-Compliance |
| a11y-auditor | L0.96 | Line: Second — Risk-Compliance |
| security-scanner | L0.96 | Line: Second — Risk-Compliance |
| debug-agent | L0.96 | Line: First — Operations |
| constitutional-reviewer | L0.96 | Line: Second — Risk-Compliance |
| error-recovery-stub | L0.96 | Line: First — Operations |
| debate-prosecutor | L0.97 | Line: Second — Risk-Compliance |
| debate-defender | L0.97 | Line: Second — Risk-Compliance |
| debate-judge | L0.97 | Line: Third — Independent Audit |
| best-of-N-judge | L0.97 | Line: Third — Independent Audit |
| meta-process-auditor | L0.98 | Line: Third — Independent Audit |
| Proactive Surfacing Agent | L0.99-1 | Line: Third — Independent Audit |
| Skill Extractor | Post-wave | Line: Pre-wave / Support |
| Metrics Aggregator | Post-wave | Line: Pre-wave / Support |
| pfca-agent | L0.99 | Line: Second — Risk-Compliance |
| product-strategist | L0.7 | Line: Pre-wave / Support |
| user-researcher | L0.7 | Line: Pre-wave / Support |
| business-process-architect | L0.7 | Line: Pre-wave / Support |
| kaizen-officer | L0.9 | Line: Second — Risk-Compliance |
| engineering-lead | L1 | Line: First — Operations |
| backend-agent | L1 | Line: First — Operations |
| data-engineer | L1 | Line: First — Operations |
| ux-designer | L0.7 | Line: Pre-wave / Support |
| ux-writer | L0.7 | Line: Pre-wave / Support |
| data-lead | L0.9 | Line: First — Operations |
| data-analyst | L0.7 | Line: First — Operations |
| devops-lead | L0.9 | Line: First — Operations |
| release-engineer | L0.96 | Line: First — Operations |

### Product-studio teams (wave-189 — full lifecycle coverage)

The roster now covers the full product lifecycle, not just verification. Teams and their leads:

- **Product & Business** — lead `chief-product-officer`: product-strategist, user-researcher, business-process-architect, kaizen-officer. Owns WHY + the daily-improvement loop; kaizen-officer feeds reusable patterns back into jidoka.
- **Architecture** — lead `chief-architect`: micro / macro / surface-cartographer / design-system-architect. Owns the spec.
- **Implementation** — lead `engineering-lead`: backend-agent, frontend-agent, data-engineer. Builds to the spec.
- **Design** — lead `design-system-architect`: ux-designer (flows/states), ux-writer (interface copy).
- **Data** — lead `data-lead`: data-analyst. Governs metrics; closes the Kaizen loop with real numbers.
- **Delivery** — lead `devops-lead`: release-engineer. Ships with a tested rollback; feeds DORA.
- **Quality / Audit** — reflexion, debate×3, best-of-N, coverage/a11y/perf/security, test×3, visual-qa, pfca, meta-process, self-improvement. Verifies everything above.

When adding a new agent entry to this roster: the entry MUST include a `Line:` annotation (wave-153 staleness prevention rule).

---

## L0 — Orchestrator

**Line: First — Operations**

Claude in the main session. Decomposes user requests, dispatches teams, integrates output, verifies. All tools available.

---

## Five cadences of self-maintenance (wave-41 architecture, promoted wave-55e)

Each cadence closes a class of drift the next-finer one misses. Don't add a 6th — pick the right cadence for what you're catching.

| Cadence | Trigger | What runs | Output |
|---|---|---|---|
| **Per-commit (size-gated)** | `.githooks/post-commit` when diff > 100 TS LOC + > 3 files | Reflexion Critic queued for adversarial review | `.claude/reflexion-queue/<sha>.md` |
| **Per-commit (selective)** | `.githooks/commit-msg` when subject contains `wave-NN` | Wave-artifact validator | inline error if metrics row / retro missing |
| **Per-5-waves** | `.githooks/post-commit` when wave-NN % 5 == 0 | Self-Improvement Reviewer queued | `.claude/self-improvement-queue/wave-NN.md` |
| **Weekly** | OS cron (opt-in) or `npm run routine:weekly` | Skills aging + design drift + audit backlog + outcomes | `docs/audit-reports/routine-weekly-YYYY-WNN.md` |
| **Monthly** | OS cron (opt-in) or `npm run routine:monthly` | Security patterns + dependency drift + bundle size + deep-audits queue | `docs/audit-reports/routine-monthly-YYYY-MM.md` |

Logic per cadence:
- **Per-commit (size-gated)**: catches one-commit-level mistakes (memo regression, focus-ring suppression, off-by-one) that need an external context to spot.
- **Per-commit (selective)**: catches process discipline drift (missed retro, missed metrics row).
- **Per-5-waves**: catches cross-wave patterns no single retro shows (rendered-verification skipped 4 times, "0/5 actioned" loop).
- **Weekly**: catches slow-moving drift (skill citations declining, drift counts creeping up, audit-backlog escalating).
- **Monthly**: catches deep drift (deps falling behind, philosophy promises diverging from code, bundle size silently growing).

See `docs/SELF_IMPROVEMENT_PROTOCOL.md` and `docs/ROUTINES.md` for protocols.

---

## L0.7 — Quad-Lens Architects (parallel)

**Line: Pre-wave / Support** (all four: Micro Architect, Macro Architect, Surface Cartographer, Design System Architect)

Four architects run in parallel BEFORE the Chief Architect on every non-trivial wave. Each reads a DIFFERENT source so the four lenses are non-overlapping.

| Agent | Lens | Reads | Output | Ceiling |
|---|---|---|---|---|
| **Micro Architect** | Internal / philosophy | `docs/MISSION.md`, `docs/PRODUCT_PHILOSOPHY.md`, `docs/VOICE_GUIDE.md`, `docs/ROLE_PERMISSION_MATRIX.md`, `docs/FUNNEL_REGISTRY.md`, adjacent code paths | `docs/specs/briefs/{wave}_MICRO.md` | 500 words |
| **Macro Architect** | External / market | WebSearch + WebFetch on direct + indirect competitors | `docs/specs/briefs/{wave}_MACRO.md` | 600 words |
| **Surface Cartographer** | Existing implementations | `Glob` + `Grep` over `app/` + `components/` + `lib/`, keyword + alias search, past spec / retro files | `docs/specs/briefs/{wave}_CARTO.md` | 500 words |
| **Design System Architect** | Token + primitive contract | `docs/DESIGN_SYSTEM.md`, `docs/UI_PATTERNS.md`, `tailwind.config.ts`, `app/globals.css`, `components/ui/`, `eslint-rules/`, visual baselines | `docs/specs/briefs/{wave}_DSA.md` | 400 words |

Evolution:
- Wave-28: paired-lens (Micro + Macro)
- Wave-39: triple-lens (added Surface Cartographer — "we built it three times" fix)
- Wave-43: quad-lens (added Design System Architect — "every page looks different" fix)

The DSA was added in wave-43 because tokens existed (h-cta, h-control, --surface-*, etc.) but lint did not enforce them, and the per-wave Spec Reviewer SR-8 only fired when specs explicitly listed visual elements. The DSA writes a design contract per dispatch: which tokens to use, which primitives to reuse, what dark/light parity requires, what's forbidden. Chief Architect synthesis honours the contract as a hard input.

### Cartographer verdicts

Each finding in the Cartographer brief carries one of:
- **REUSE** — a complete existing implementation. Spec must reference it as THE implementation, not create new code.
- **EXTEND** — a partial implementation (≥ 50% coverage). Spec must add to it, not create a parallel surface.
- **DUPLICATE-BLOCK** — the proposed feature is functionally identical to 2+ existing surfaces. Spec REJECTED unless redundancy is consolidated or explicitly justified.
- **UNRELATED** — keyword match without shape match. Not a finding.
- **NEW** — nothing comparable exists. Build new. Rare.

### Skip rules

Trivial waves (< 50 LOC, single file, no architectural impact) may waive all three briefs — Chief Architect notes the waiver. Polish waves (< 150 LOC) may use ONE brief. **Cartographer is the LAST lens to skip** — it's the cheapest of the three (~10K tokens) and prevents the most expensive bug class.

---

## L0.75 — Chief Architect

**Line: Pre-wave / Support**

Synthesises the three briefs into the master spec at `docs/specs/{wave}_MASTER_SPEC.md`. Ceiling: 1000 words.

Synthesis protocol (wave-39 update):
1. **Honour Cartographer verdict first.** DUPLICATE-BLOCK rejects the spec. REUSE / EXTEND mandate file:line reference, no new files for things that exist.
2. Cite three-way convergence (spine of spec).
3. Resolve divergence with explicit reasoning per axis.
4. Adopt or reject killer differentiation from Macro (no silent drops).
5. Tag every AC with `[micro]` / `[macro]` / `[carto]` / `[synthesis]` provenance.

---

## L1 — Execution

**Line: First — Operations**

| Agent | Line | Role |
|---|---|---|
| **frontend-agent** | First — Operations | Frontend implementation per spec. Reads spec, writes code, runs tests. Defined in `.claude/agents/frontend-agent.md`. |

---

## L0.9 — Cross-wave self-improvement

**Line: Second — Risk-Compliance**

| Agent | Line | Role | Trigger |
|---|---|---|---|
| **Self-Improvement Reviewer** | Second — Risk-Compliance | Reads window of N recent retros (default 5), surfaces RECURRING patterns single-retro readers can't see. Proposes new skills, skill retirements, anti-pattern catalog updates, architectural changes. Proposals are Second Line only — they require Orchestrator or CPO approval before dispatch. No auto-dispatch of SIR proposals. (proposal-only, no auto-dispatch) | Auto-queued by post-commit hook when wave-NN % 5 == 0. Manual via `npm run agents:improve`. |

See `docs/SELF_IMPROVEMENT_PROTOCOL.md` for the 6-step protocol + cadence.

---

## L0.95 — Post-implementation review

**Line: Second — Risk-Compliance** (both agents)

| Agent | Line | Role | Trigger |
|---|---|---|---|
| **Reflexion Critic** | Second — Risk-Compliance | Adversarial critique on separate context. Reads diff + spec, returns BLOCKERS / CONCERNS / NITS. Three gates: Gate 1 — correctness (logic, edge cases, regressions). Gate 2 — implementation quality (patterns, decomposition, a11y). Gate 3 — Spec compliance: Are all ACs from the master spec covered by the diff? Are any ACs silently dropped or partially implemented? Does not re-adjudicate mission alignment — that gate belongs to constitutional-reviewer (L0.96). | Auto-queued by wave-33 post-commit hook when diff > 100 TS LOC AND > 3 files. Manual dispatch otherwise. |
| **Visual QA** | Second — Risk-Compliance | Screenshots vs baseline + Playwright visual regression. | Wave-22+ standard. Manual dispatch after Reflexion. |

---

## L0.96 — Quality Gates (wave-102)

**Line: mixed** — see per-agent Line column below. First Line agents execute; Second Line agents gate or audit.

Runs between L1 (frontend-agent commits) and L0.95 (Reflexion Critic). Test agents run first, gate agents run in parallel, constitutional reviewer runs last before Reflexion Critic.

| Agent | Line | Role | Trigger | Block condition |
|---|---|---|---|---|
| **test-engineer** | First — Operations | Writes test stubs before impl | chief-architect dispatch with testable ACs | — |
| **test-runner** | First — Operations | Executes vitest + playwright, routes results | post-commit | any FAIL routes to debug-agent |
| **coverage-auditor** | Second — Risk-Compliance | Istanbul/c8 delta vs baseline | post-test-runner (all pass) | > 5% drop on any file |
| **integration-tester** | First — Operations | Runs existing E2E + generates new specs | post-test-runner for UI waves | any E2E failure |
| **perf-profiler** | Second — Risk-Compliance | Bundle delta per route | post-commit > 100 LOC in app/components | > 50 KB growth per route |
| **a11y-auditor** | Second — Risk-Compliance | axe-core WCAG 2.1 AA scan | post-commit touching components/ | any "serious"/"critical" violation |
| **security-scanner** | Second — Risk-Compliance | npm audit + semgrep + trufflehog | post-commit + pre-merge | any "high"/"critical" finding |
| **debug-agent** | First — Operations | Root cause analysis + auto-fix | any gate FAIL | — (escalates) |
| **constitutional-reviewer** | Second — Risk-Compliance | 5-question Mission Compass check | post-gate, pre-reflexion | any Q FAIL |
| **error-recovery-stub** | First — Operations | Production error interface (P3 stub) | future: Sentry event | — (stub, not active) |

Pipeline order within the layer:
```
test-engineer (pre-impl)
  └── frontend-agent (impl)
        └── test-runner (post-commit)
              ├── [parallel: coverage-auditor | a11y-auditor | security-scanner]
              ├── perf-profiler (post-build)
              └── constitutional-reviewer (post-gate, pre-reflexion)
                    └── debug-agent (triggered on any FAIL)
```

Escalation to human required when: spec ambiguity, Mission VIOLATION, security HIGH+, iteration cap reached (5 rounds), debug-agent confidence < 80% on fix > 20 LOC.

### L0.96 Skills (canonical mirror)

`.claude/skills/` is gitignored — these 5 skills shipped in wave-102 are mirrored here for in-repo discoverability:

| Skill | Used by | Purpose |
|---|---|---|
| **tdd-flow** | test-engineer, debug-agent | Red-green-refactor pattern per AC: write failing test stub → run → impl until green → refactor while staying green |
| **test-failure-triage** | debug-agent | Classify failure as test-bug / impl-bug / flaky / environmental → propose targeted fix or escalate with confidence score |
| **coverage-improvement** | coverage-auditor | Identify uncovered branches via lcov.info → suggest missing test cases per file → estimate effort |
| **a11y-fix** | a11y-auditor, debug-agent | Common WCAG 2.1 AA violation patterns (color contrast, missing labels, keyboard traps, ARIA misuse) with concrete fix examples |
| **bundle-optimization** | perf-profiler, debug-agent | First-load JS reduction patterns: dynamic import, route-level code-split, tree-shake audit, dependency replacement |
| **constitutional-revision** (wave-103) | constitutional-reviewer, debug-agent, chief-architect (escalation target) | Anthropic CAI critique-revise-verify loop when constitutional-reviewer emits VIOLATION; iteration cap 3, then escalate |
| **proactive-holistic-analysis** (wave-117-retro) | L0 Orchestrator | MANDATORY pre-dispatch when user triggers "state of the art / максимально передовое / what's missing" — 6-step protocol: pause → industry research → map existing → gap analysis (15-25 items) → propose foundational restructure → wait for explicit approval BEFORE any wave dispatch |
| **completion-audit** (wave-145) | AI before any "done" claim | 5-field structured closure audit block (Goal, Gaps remaining, Enforcement type, Closure level, If-less-than-100% deferred items); prevents optimistic-completion-bias and partial-closure-via-documentation anti-patterns |

---

## L0.97 — Adversarial Verification (wave-103)

**Line: Second — Risk-Compliance** (prosecutor, defender) and **Third — Independent Audit** (judge, best-of-N-judge)

Runs after L0.96 Quality Gates when Tier 3 is triggered. Debate agents operate on post-commit diffs and produce written transcripts. Best-of-N judge operates on parallel branch sets.

| Agent | Line | Role | Trigger | Verdict/Output |
|---|---|---|---|---|
| **debate-prosecutor** | Second — Risk-Compliance | Constructs strongest-case argument that the change has bugs, security issues, spec violations, or Mission misalignment. Never modifies files. | Dispatched by `debate-engine.mjs` at Round 1, 2, and 3 | `[ROUND N PROSECUTION] <structured argument with evidence citations>` |
| **debate-defender** | Second — Risk-Compliance | Constructs strongest-case argument that the change is correct and addresses each prosecution concern with specific code evidence. Concedes valid prosecution claims. Never modifies files. | Dispatched by `debate-engine.mjs` after each prosecution round | `[ROUND N DEFENSE] <structured response with file:line citations>` |
| **debate-judge** | Third — Independent Audit | Reads all 3 rounds from both sides, emits exactly one VERDICT. Uses different model family from implementation agent when possible (self-preference bias guard). Never modifies files. | Dispatched by `debate-engine.mjs` after Round 3 completes | `PASS`, `REVISE`, `BLOCK`, or `DEADLOCK` |
| **best-of-N-judge** | Third — Independent Audit | Compares N parallel implementation attempts on 5 metrics, produces ranked table, selects winner, writes rationale to `docs/debates/wave-NN-bestofN.md`. | Dispatched by `dispatch-parallel-implementations.mjs --collect` | Winner branch name + `docs/debates/wave-NN-bestofN.md` |

### L0.97 Tier 3 activation criteria

Tier 3 debate activates when ANY of the following is true:
- Wave effort is `L` (large)
- Diff touches security-critical paths (flagged by security-scanner)
- Diff touches billing or payment files (`/billing`, `/payment`, `/stripe`)
- constitutional-reviewer emits `VIOLATION`

Tier 3 does NOT activate for `S`-effort waves unless security or billing paths are touched.

### L0.97 DEADLOCK protocol

When debate-judge emits `DEADLOCK`, `debate-engine.mjs` sets `deadlock: true` in its return value. The pipeline orchestrator (`run-verification-pipeline.mjs`) triggers Tier 4 automatically without requiring additional human input. The `.githooks/pre-merge-commit` hook blocks merge if a DEADLOCK verdict exists in `docs/debates/wave-NN-debate.md`.

### L0.97 Skills (canonical mirror)

| Skill | Used by | Purpose |
|---|---|---|
| **constitutional-revision** | constitutional-reviewer, frontend-agent | Critique-revise-verify loop per Anthropic Constitutional AI methodology (Bai et al. 2022). Invoke when constitutional-reviewer emits VIOLATION and rewrite is possible without architectural change. |

---

## L0.98 — Meta-Process Auditor (wave-145)

**Line: Third — Independent Audit**

Runs after any "done" declaration, every 10 waves, or via `npm run audit:meta-process`. Reads completion-audit blocks, retros, and MCP anti-pattern entities. Blocks new wave dispatch on REGRESSION_DETECTED until human resolves.

| Agent | Line | Role | Trigger | Verdict/Output |
|---|---|---|---|---|
| **meta-process-auditor** | Third — Independent Audit | Detects recurrence of documented anti-patterns across waves. Reads completion-audit blocks, last 5 retros, and memory MCP anti-pattern entities. Cross-checks that enforcement artifacts cited in retros actually exist on disk. | Post "done"/"shipped"/"complete" declaration; every 10 waves; `npm run audit:meta-process` | `PASS` / `REGRESSION_DETECTED` / `CATALOG_UPDATE_NEEDED` |

### L0.98 Verdict consequences

| Verdict | Consequence |
|---|---|
| `PASS` | Pipeline proceeds normally. No human action required. |
| `REGRESSION_DETECTED` | New wave dispatch BLOCKED until human reviews and either ships missing enforcement or explicitly accepts deferred enforcement with documentation. |
| `CATALOG_UPDATE_NEEDED` | New entry must be added to `docs/ANTI_PATTERNS_CATALOG.md` and MCP entity created before next wave starts. |

### L0.98 Skills

| Skill | Used by | Purpose |
|---|---|---|
| **completion-audit** (wave-145) | AI before any "done" claim | 5-field structured closure audit; prevents optimistic-completion-bias and partial-closure-via-documentation |

Script: `scripts/audit-meta-process.mjs`
Agent definition: `.claude/agents/meta-process-auditor.md` (gitignored)
Catalog: `docs/ANTI_PATTERNS_CATALOG.md`

---

## L0.99-1 — Proactive Surfacing Agent (wave-155)

**Line: Third — Independent Audit**

Fires before the user speaks (session-start), after every L-effort wave, and on the per-5-waves cadence. Reads retros, anti-pattern catalog, memory MCP snapshot, and escalated spec proposals. Writes a prioritized concern queue. Never auto-resolves — surfaces only.

| Agent | Line | Role | Trigger |
|---|---|---|---|
| **Proactive Surfacing Agent** | Third — Independent Audit | Reads last 10 retros, `docs/ANTI_PATTERNS_CATALOG.md`, `docs/memory-anti-patterns.md`, and `docs/specs/agent-layer/_INDEX.md`. Produces a BLOCKING/IMPORTANT/NICE-sorted concern queue at `docs/surfacing-concerns-current.md`. Anti-suppression log at `docs/audit-reports/surfaced-concerns-log.md` ensures no concern silently drops. | (1) wave-NN % 5 == 0 post-commit hook; (2) L-effort commit post-commit hook; (3) manual `npm run surface:concerns`; (4) CLAUDE.md session-start step 4 |

### L0.99-1 Source signals

| Signal | Path | What it surfaces |
|---|---|---|
| Last 10 retros (mtime sort) | `docs/retros/wave-*.md` | Anti-pattern slug recurrences (2+ retros without "shipped"/"addressed") + open "Out-of-scope follow-ups" proposals |
| Anti-pattern catalog | `docs/ANTI_PATTERNS_CATALOG.md` | 7 canonical slugs — primary signal corpus |
| Memory MCP snapshot | `docs/memory-anti-patterns.md` | Entities with wave-origin 5+ waves old and no resolution observation |
| Escalated spec proposals | `docs/specs/agent-layer/_INDEX.md` | Rows with age ≥ 5 waves and status not Shipped |
| Industry checklist | `docs/PROACTIVE_SURFACING_PROTOCOL.md` | Patterns marked ❌ (not implemented) in the static industry framework checklist |
| Reactive counterpart | `docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md` | Read for cross-reference only; not modified |

### L0.99-1 Output format

Each concern entry in `docs/surfacing-concerns-current.md`:

```
severity: BLOCKING | IMPORTANT | NICE
title: string
observed_in: wave-NN or retro reference
industry_misalignment: string
reason_not_surfaced: string
proposed_wave: string
cost_of_silence: string
status: open
```

### L0.99-1 Relations to other agents

- **Self-Improvement Reviewer (L0.9)** reads `ProactiveSurfacingRun` memory entities every 5 waves to detect concerns repeatedly surfaced but never addressed — this is a second-order recurrence signal on top of L0.99-1's first-order surfacing.
- **Meta-Process Auditor (L0.98)** can treat a concern open 10+ waves as `REGRESSION_DETECTED` (manual escalation path, not yet automated).
- **E3 escalation**: concern with no log response after 5 subsequent waves is severity-escalated on next script run (NICE → IMPORTANT → BLOCKING). Wave counter sourced from `docs/CURRENT_WAVE.md` "Latest wave" line.

Script: `scripts/surface-concerns.mjs`
Agent definition: `.claude/agents/proactive-surfacing-agent.md` (gitignored)
Protocol: `docs/PROACTIVE_SURFACING_PROTOCOL.md`
Current queue: `docs/surfacing-concerns-current.md`
Log: `docs/audit-reports/surfaced-concerns-log.md`

---

## Post-wave hooks

**Line: Pre-wave / Support** (both agents)

| Agent | Line | Role |
|---|---|---|
| **Skill Extractor** | Pre-wave / Support | Reads wave retro "Patterns observed", runs 3 self-qualification gates, writes a skill if all pass. |
| **Metrics Aggregator** | Pre-wave / Support | Reads session token counts + diff stats, writes a row to `docs/metrics/_DASHBOARD.md`. |

---

## File locations

- Working agent definitions: `.claude/agents/*.md` (gitignored)
- Agent playbook: `.claude/AGENT_PLAYBOOK.md` (gitignored)
- This canonical roster: `docs/AGENT_ROSTER.md` (tracked)
- Briefs: `docs/specs/briefs/{wave}_{MICRO,MACRO,CARTO}.md` (tracked)
- Master specs: `docs/specs/{wave}_MASTER_SPEC.md` (tracked)
- Retros: `docs/retros/wave-NN.md` (tracked)
- Reflexion queue: `.claude/reflexion-queue/<sha>.md` (gitignored)
- Memory staging: `.claude/memory-staging/*.json` (gitignored)
- Public write-ups: `docs/blog/*.md` (tracked)

## When this file goes stale

Update it whenever a new L0.7 / L1 / L0.95 / hook agent is added or removed. Diff against `.claude/agents/` should be empty for the canonical list. Per-file role contents stay in `.claude/agents/` to keep the playbook updates atomic; this file just enumerates roster + responsibilities for git-tracked discoverability.
