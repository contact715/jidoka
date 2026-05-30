# Project Rules — <YOUR PROJECT>

> Example project-instructions file for Claude Code (the file Claude Code reads first in a repo).
> Replace the product specifics with your own. The agentic-framework rules below are portable.

## Agentic Engineering Framework

This project runs on the agentic engineering framework. Start with `docs/ENGINEERING_SYSTEM_ASSESSMENT.md` for the full picture.

Core rules:
- **Spec-first** — no non-trivial task goes to code without an approved spec. `chief-architect` synthesizes a master spec after the parallel architect briefs (`micro` / `macro` / `surface-cartographer` / `design-system`). See `docs/HIERARCHICAL_SPEC_SYSTEM.md`.
- **Quality-first** — in every technical phase, choose the highest-quality solution. Quality outranks speed and token cost. See `docs/CONSTITUTION.md` §8 and `docs/TOYOTA_WAY.md`.
- **Verification pipeline** — every change passes the gates (`docs/MULTI_LEVEL_VERIFICATION.md`) and `reflexion-critic` before merge.
- **Human in the approval seat** — agents select and propose; a human triggers the merge.
- **Holistic trigger** — for whole-system / "make it state of the art" requests, run `.claude/skills/proactive-holistic-analysis.md` before dispatching.

## Session start

Run the session-start checks in `docs/SESSION_START.md` (memory status, reflexion queue, audit backlog, proactive surfacing).

## Conventions (adapt to your stack)

- API calls through one client, never raw fetch
- Typed state, no `as any`
- Tests for validation logic, transformers, and store actions
- Components decomposed per the limits in `.claude/rules` (file ≤400 LOC, function ≤80 LOC)

## Documentation Protocol

| Task involves... | Read first |
|---|---|
| Any product decision | `docs/MISSION.md` |
| Architecture / spec | `docs/HIERARCHICAL_SPEC_SYSTEM.md` + `docs/MODULE_SPEC_SYSTEM.md` |
| Quality / philosophy | `docs/CONSTITUTION.md` + `docs/TOYOTA_WAY.md` |
| Code style | `docs/CODING_STANDARDS.md` |
| Tests | `docs/TESTING.md` |
| Security | `docs/SECURITY.md` |
| Debugging | `docs/DEBUGGING.md` |

## Branch

- Work on a feature branch. Do not push to main without explicit permission.
