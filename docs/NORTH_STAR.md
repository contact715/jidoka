---
status: Active
version: 1.0.0
level: L0
type: north-star
owner_role: owner
parents: []
children: []
breaking_change_in_v: null
created: 2026-06-05
last_validated_against_parents: 2026-06-05
last_updated: 2026-06-05
---

# North Star — Jidoka Framework

> The framework's own L0. Every framework feature, agent, gate, script, and process is derived from this document and checked against it: **helps / neutral / conflicts**. A conflict is never resolved by a silent edit.

## What this is

Jidoka is an agentic engineering framework for Claude Code. It turns a single assistant into a disciplined multi-agent engineering line: spec-first development, quality gates, adversarial verification, stop-the-line (andon), and self-improvement loops.

The name is the Toyota principle **Jidoka** (自働化) — built-in quality. A defect is never passed to the next station. When quality drops below the line, the line stops.

## The single outcome it optimizes

**Ship software at the quality bar of a senior engineering team, autonomously, and get measurably better at it every wave.**

Not speed. Not token cost. Quality first; the other two are subordinate (Constitution §8).

## Who it serves

- **The owner-engineer** — one person running multiple products (client sites, SaaS, automation) who needs a team's discipline without a team.
- **The products built on it** — every project with `.jidoka/` installed inherits the line: gates, agents, spec tree, memory, retros.
- **The framework itself** — jidoka eats its own dogfood. Its own docs form the same five-level spec tree it installs into products; its own changes pass its own gates.

## The two pillars (from `TOYOTA_WAY.md`)

1. **Jidoka** — built-in quality. Improves the *product*: gates at the station, andon halts, the best-of-N judge picks the highest-quality candidate, never the cheapest passing one.
2. **Kaizen** — continuous improvement. Improves the *process*: retros feed the meta-engine, mistakes become catalog entries and golden cases, skills are extracted, prompts evolve.

Neither is optional. Jidoka without Kaizen freezes; Kaizen without Jidoka drifts.

## Framework Compass

Every framework change (new agent, gate, script, doc, process), before it lands, must answer **yes** to all five:

1. **Q1 — Quality line.** Does this raise the quality of what the line ships, or the reliability of the line itself? (Not: does it add surface.)
2. **Q2 — Executable proof.** Is every claim it makes backed by something executable — a test, a gate, a script whose output can be shown? No "done" without proof.
3. **Q3 — Stop-the-line.** Can a defect it guards against halt the pipeline where it appears, with a human in the approval seat for consequential actions?
4. **Q4 — Right home, no duplication.** Does it land in the right system (framework vs product vs global), and does it reuse or extend what exists instead of adding a second copy? Addition is not free; necessity and reachability must be proven against the target's reality.
5. **Q5 — The system learns.** Does the system get smarter from it — a retro, a meta-engine entry, a skill, a golden case? A change the system cannot learn from is a one-time patch, not an improvement.

This compass governs the **framework's own** changes. Products instantiate their own product-level Mission Compass from the `docs/MISSION.md` template; the two do not overlap.

## Non-goals

- **Not a product.** Jidoka ships no end-user features. Product features live in product repos.
- **Not a library of everything.** A mechanism nobody calls is dead weight; reachability is part of the definition of done.
- **Not speed-first automation.** "Generated and committed" is the failure mode this framework exists to prevent.

## Derivation rule

When a proposed change conflicts with this document, there are exactly three non-silent outcomes: **reject** the change, **adapt** it until it helps, or **evolve this philosophy** explicitly (MAJOR version bump, owner sign-off, amendment recorded in `CONSTITUTION.md`). Silent drift is the one forbidden outcome.
