---
status: Active
version: 1.0.0
level: L1
type: core-arch
owner_role: platform
parents:
  - path: docs/NORTH_STAR.md
    version: 1.0.0
    relationship: implements
children: []
breaking_change_in_v: null
---

# Kaizen Engine — the autonomous weekly self-improvement system

An L1 architecture doc (under NORTH_STAR) for the machinery that turns the weekly
jidoka-weekly-enrichment task from a prompt ("look at GitHub, suggest things") into a real,
self-measuring, autonomous process: a development environment for the development environment.
Built 2026-07-04.

## Why this exists

The weekly task researched and proposed, but it had no memory of its own past proposals, no
measure of whether they landed, and no self-critique. So it could not compound — every week
started from a blank page. The Kaizen Engine adds the missing control-system parts: sensors,
state, a pipeline, quality gates, analytics, and a feedback loop. The process becomes accountable
for its own hit-rate and gets better over time, not just its output.

Honest tension (recorded, not hidden): the engine's own `meta-trend` currently reads REGRESSING
("strengthen leaking gates before adding new mechanisms"). The Kaizen Engine is itself partly a
*strengthening* move — it makes the weekly loop accountable and measured — but it is also new
code. It is built deliberately small (pure, zero-dep, self-tested leaf scripts) and each piece is
wired to a live caller (the weekly SKILL), so it does not become dead scaffolding.

## The 6-phase pipeline (runs weekly, autonomously)

1. **SENSE** — three independent signal sources: GitHub research (8 domains, the existing
   `jidoka-enrichment.js` workflow), a review of the last ~10 dev sessions, and the engine's own
   records (`meta-trend` / `meta-audit` / `memory-consolidate` / the mistake ledger). Plus the
   prior week's plan and its recorded outcomes.
2. **AUDIT** — close the loop: for each prior recommendation determine, deterministically against
   the live repo, whether it shipped / is still open / was rejected / regressed. Update the
   outcome ledger. (kaizen-audit.mjs + kaizen-ledger.mjs)
3. **SYNTHESIZE** — the AI-war (prosecutor/defender/judge debates) over research candidates,
   de-duplicated against the cross-week rejection memory, then ROI-ranked. (kaizen-rank.mjs)
4. **CRITIQUE** — a completeness gate over the process's OWN output: empty research domains,
   recommendations with no source or no point-of-integration, session-review gaps, plan-vs-
   meta-trend misalignment. Gaps are closed or listed honestly. (kaizen-critique.mjs)
5. **PLAN** — render the report: scorecard + progress first, then the ranked plan, session
   review, killer features, quick wins, big bets, rejected, delta. (kaizen-scorecard.mjs →
   `kaizen-engine.mjs --dashboard`)
6. **PERSIST + LEARN** — the report and the two registries are committed; this week's outcomes
   become next week's AUDIT input. The loop closes.

## Data contracts (persisted in the clone, under `docs/research/weekly/`)

### Outcome ledger — one JSON object per line

```
{
  "id": "2026-W27-R5",          // week + rank/kind key, stable across weeks
  "week": "2026-W27",           // ISO week first proposed
  "title": "DAG task planner",
  "kind": "recommendation",     // recommendation | killer-feature | session-fix
  "target": "jidoka",           // jidoka | global (~/.claude) | product
  "pointOfIntegration": "scripts/dag-schedule.mjs",  // a script path / gate name / file — the
                                                     // auditor checks THIS to decide "shipped"
  "priority": "P2",
  "effort": "medium",           // low | medium | high
  "impact": 4,                  // 1..5
  "status": "proposed",         // proposed | shipped | open | rejected | regressed
  "shippedWeek": null,          // ISO week it was first detected shipped
  "evidence": ""                // what the auditor saw
}
```

### Rejection memory — one JSON object per line

```
{ "id": "langgraph-swarm", "week": "2026-W27", "reason": "REJECT-as-dependency: heavy Python runtime" }
```

### Scorecard — computed, not stored (rendered into the dashboard)

```
{ "week", "recs", "adoptionRate", "meanTimeToImplementWeeks", "regressionRate",
  "openCount", "shippedCount", "trend": { "adoptionRate": "+0.12", ... } }
```

## The machinery (all pure, zero-dep, self-tested leaf scripts)

| script | phase | job |
| --- | --- | --- |
| kaizen-ledger.mjs   | AUDIT/PLAN | upsert + read the outcome ledger (JSON-lines) |
| kaizen-audit.mjs    | AUDIT      | deterministic shipped/open/regressed detection vs the live repo |
| kaizen-scorecard.mjs| PLAN       | analytics with week-over-week trend, pulls class-closure from `meta-trend` |
| kaizen-critique.mjs | CRITIQUE   | completeness gate over a synthesized plan |
| kaizen-rank.mjs     | SYNTHESIZE | ROI ranking; REGRESSING `meta-trend` forces gate-strengthening to the top |
| kaizen-engine.mjs   | all        | orchestrator; `--dashboard` renders `_DASHBOARD.md`; anti-ghost self-test |

Each ships an inline `--self-test` and is run in CI (like the 2026-W27 mechanisms), so none is
dead. The weekly SKILL (`~/.claude/scheduled-tasks/jidoka-weekly-enrichment/SKILL.md`) calls them
deterministically instead of doing the bookkeeping in prose.

## Autonomy + self-measurement

The scorecard's adoption-rate IS the process's own KPI: the fraction of its recommendations that
reach implementation. A weekly process that tracks and raises its own hit-rate is the point — it
is not automation that ships once, it is a loop that improves how the whole engine (and every
project on it) gets better, every week.

## Boundary (unchanged)

The weekly task stays PROPOSE-only for code: it writes only to the clone (the report + the two
registries) and never edits jidoka/products/`~/.claude` itself. Implementation of any P0 item is
a separate owner-approved step. The Kaizen Engine scripts themselves live in the jidoka repo and
are built under the normal gates.
