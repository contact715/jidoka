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
children: []
breaking_change_in_v: null
created: 2026-05-27
last_validated_against_parents: 2026-05-27
last_updated: 2026-05-27
---

# Proactive Surfacing Protocol

**Status**: Active
**Wave**: wave-155
**Level**: L1 — Core Architecture (dev environment governance)
**Script**: `scripts/surface-concerns.mjs`
**Reactive counterpart**: `docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md`

---

## Why this exists

Every meta-process agent in the system before wave-155 reacted: Reflexion Critic fired post-commit, Self-Improvement Reviewer fired post-5-waves only when triggered, Holistic Analysis triggered on user phrase. No agent spontaneously surfaced concerns that AI had internally observed but not shared.

The result was documented across 4 separate exchanges: the user had to ask "what's missing?" before AI revealed it. This protocol is the fix — a scheduled, session-start, and L-wave-triggered concern queue that makes surfacing impossible to skip by construction.

---

## Reactive vs Proactive

| Dimension | `docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md` (reactive) | This document (proactive) |
|---|---|---|
| **Trigger** | User writes a holistic-quality phrase | Schedule (wave % 5), L-effort commit, session start |
| **Who initiates** | User (involuntarily triggers AI) | AI (independently, before user speaks) |
| **Scope** | Single session, specific concern surfaced by user phrasing | Cross-session, concern queue persists |
| **Output** | AI pauses, runs 6-step protocol, then proposes | `docs/surfacing-concerns-current.md` queued for reading |
| **Anti-pattern addressed** | `reactive-incremental-thinking` | `partial-closure-via-documentation`, `over-documentation`, `optimistic-completion-bias` |
| **First shown** | wave-117 retro | wave-155 |

The two mechanisms are complementary. The reactive trigger catches in-session lapses. The proactive protocol catches concerns that accumulate between sessions and across waves.

---

## Architecture

```
scripts/surface-concerns.mjs          (entry point: cron / manual / post-wave hook)
  reads docs/retros/ (last 10, by mtime)
  reads docs/ANTI_PATTERNS_CATALOG.md (7 slugs)
  reads docs/memory-anti-patterns.md  (9 MCP entity snapshot)
  reads "Out-of-scope follow-ups" sections in retros
  reads docs/specs/agent-layer/_INDEX.md (escalated proposals)
  writes docs/surfacing-concerns-current.md (replace each run)
    appends diff entry to docs/audit-reports/surfaced-concerns-log.md

.githooks/post-commit
  if wave-NN % 5 == 0  → node scripts/surface-concerns.mjs &
  if "L effort" in subject  → node scripts/surface-concerns.mjs &

CLAUDE.md session-start (step 4)
  npm run surface:concerns
  read docs/surfacing-concerns-current.md
  if 1+ open concerns → prepend "Pre-session brief" to first response
```

---

## Concern entry format

Each concern in `docs/surfacing-concerns-current.md` uses this format:

```markdown
## <concern-title>

- severity: BLOCKING | IMPORTANT | NICE
- observed_in: wave-NN or retro reference
- industry_misalignment: <which industry pattern this violates>
- reason_not_surfaced: <root cause of the gap>
- proposed_wave: wave-NNN (or TBD)
- cost_of_silence: <consequence of 5 more waves of inaction>
- status: open
```

Sorted in output: BLOCKING concerns first, then IMPORTANT, then NICE.

---

## Trigger conditions

| Condition | Trigger | Mechanism |
|---|---|---|
| Wave number divisible by 5 | Post-commit | `.githooks/post-commit` runs `node scripts/surface-concerns.mjs &` |
| L-effort commit | Post-commit (subject contains "L effort") | `.githooks/post-commit` runs `node scripts/surface-concerns.mjs &` |
| Session start | AI reads CLAUDE.md step 4 | `npm run surface:concerns` |
| Manual | Developer runs directly | `npm run surface:concerns` or `node scripts/surface-concerns.mjs` |

---

## Four response types

When a user acknowledges a surfaced concern, they log the response via:

```bash
node scripts/surface-concerns.mjs --respond "<concern-title>" <response-type> [reason]
```

| Response type | When to use |
|---|---|
| `addressed` | Concern was resolved — enforcement shipped, root cause fixed, or AC verified |
| `deferred` | Concern is valid but deliberately deferred to a named future wave |
| `declined` | Team has decided not to act — concern acknowledged, action rejected |
| `disputed` | Concern is factually wrong or context is incorrect — re-investigation required |

All four response types are logged to `docs/audit-reports/surfaced-concerns-log.md` (append-only, never overwritten).

---

## Anti-suppression mechanism

A concern remains **open** until one of the four responses is logged. There is no auto-resolution.

**Severity escalation (E3)**: if a concern has no log entry after 5 subsequent waves (detected by comparing wave-of-origin from `docs/CURRENT_WAVE.md` against current wave), the script escalates severity one level on the next run:

```
NICE → IMPORTANT (after 5 waves with no response)
IMPORTANT → BLOCKING (after 5 more waves with no response)
BLOCKING → BLOCKING (ceiling — re-surfaced every run)
```

This ensures concerns cannot be silently ignored by inaction.

---

## Industry pattern alignment

| Pattern | Source | Status in this project system |
|---|---|---|
| **Gary Klein Pre-Mortem (2007)** | "Prospective hindsight" — imagine failure before it happens, document causes | ⚠ Partial: wave specs have risk sections, but no structured pre-mortem ritual fires before L-wave dispatch |
| **Google SRE Postmortem culture** | Blameless review cadences prevent drift across incidents; concern queues survive | ✅ Present: retros + Reflexion Critic + anti-pattern catalog cover post-mortem function |
| **NIST AI RMF Govern function** | Continual risk monitoring, not point-in-time; concern queue persists across sessions | ⚠ Partial: wave-155 adds the persistence layer; the monitoring cadence (per-5-waves) is in place but concerns were not tracked across sessions before this wave |
| **OKR proactive review ritual** | Concerns raised in weekly cadence, not when they escalate | ⚠ Partial: weekly routine exists (`npm run routine:weekly`) but surfacing protocol was not wired into it |
| **Constitutional AI (Bai et al. 2022)** | Critique-revise loop on AI outputs; AI self-monitors against declared principles | ✅ Present: constitutional-reviewer agent (L0.96), wave-103; proactive surfacing extends this to session-level |
| **Multi-Agent Debate (Irving et al. 2018)** | Adversarial agents reveal what cooperative agents miss | ✅ Present: debate-prosecutor / debate-defender / debate-judge (L0.97, wave-103) |
| **GitOps** | State declared in git; drift detected by comparison; no out-of-band changes | ✅ Present: `docs/surfacing-concerns-current.md` is git-tracked; wave-spec drift anti-pattern (#7) enforced |
| **Domain-Driven Design** | Bounded contexts, explicit anti-corruption layers, ubiquitous language | ⚠ Partial: hierarchical spec system (L0–L4) maps to DDD context levels; no anti-corruption layer between contexts |
| **TDD / BDD** | Tests written before implementation; spec drives code | ✅ Present: test-engineer agent writes stubs before frontend-agent implements; ACs in EARS notation |
| **Architecture Decision Records (ADRs)** | Every significant decision recorded with context, consequences, status | ✅ Present: `docs/decisions/ADR-*.md` convention in place since wave-95 |

**Checklist summary**: 5 fully present, 4 partial. The "partial" items are signal sources for wave-155 concern entries.

---

## Log file schema

`docs/audit-reports/surfaced-concerns-log.md` header row:

```
| timestamp | concern-title | response-type | user-reasoning | wave-at-response |
```

Example entry:
```
| 2026-05-28T12:00:00Z | partial-closure-via-documentation recurrence | addressed | shipped enforcement hook in wave-156 | wave-156 |
```

---

## Relation to other meta-process tools

| Tool | Role | Relation |
|---|---|---|
| `docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md` | Reactive surfacing on user phrase | Complementary — reactive vs proactive |
| `scripts/audit-meta-process.mjs` | Post-completion anti-pattern recurrence check | Proactive surfacing reads same ANTI_PATTERNS_CATALOG |
| `scripts/check-self-improvement-due.sh` | Queue-file for every-5-waves SI review | Queue-file pattern is the implementation model |
| `docs/ANTI_PATTERNS_CATALOG.md` | 7 canonical anti-patterns | Primary signal source for proactive surfacing |
| `docs/memory-anti-patterns.md` | MCP entity snapshot | Secondary signal source |
| `docs/CURRENT_WAVE.md` | Current wave number | Required for E3 escalation logic |

---

## Reference

- Agent definition: `.claude/agents/proactive-surfacing-agent.md` (gitignored)
- Skill mirror: `docs/skills/proactive-surfacing.md` (git-tracked, portability)
- Script: `scripts/surface-concerns.mjs`
- Current queue: `docs/surfacing-concerns-current.md`
- Log: `docs/audit-reports/surfaced-concerns-log.md`
- CLAUDE.md step 4: session-start integration
