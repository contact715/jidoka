# Quality Attribute Scenario Template (SEI 6-field format)

> Based on SEI CMU ATAM (Architecture Tradeoff Analysis Method) methodology.
> Reference: Bass, Clements, Kazman — "Software Architecture in Practice" (4th ed.), Chapter 4.

A Quality Attribute Scenario (QAS) is a concrete, measurable statement of a quality requirement.
It is NOT a use case or a functional requirement. It names a specific quality characteristic,
the trigger that activates it, the environment it applies in, what part of the system is affected,
what the system does, and how we measure success.

QAS IDs use the format `QAS-NNN` (zero-padded, globally unique across `docs/quality/`).

---

## Template

**ID**: QAS-NNN

**Characteristic**: [ISO 25010:2023 characteristic — Functional Suitability | Reliability | Performance Efficiency | Security | Safety | Maintainability]

**Source**: [The agent, user, external system, or environmental condition that generates the stimulus. May be left `—` when unknown. Used for automated risk-routing to specific agents.]

**Stimulus**: [The event, action, or condition that triggers the quality concern.]

**Environment**: [The operating mode in which the stimulus occurs — normal operation, overload, failure recovery, development-time, deploy-time, etc.]

**Artifact**: [The specific system component, service, module, or data store that receives the stimulus and must respond. May be left `—` when unknown. Used for routing QAS to the correct surface owner.]

**Response**: [What the system does in reaction to the stimulus. Must be observable and testable.]

**Measure**: [The quantitative or binary criterion that determines whether the response is acceptable. Must be falsifiable — e.g., "within 3 s in 95% of cases" not "responds quickly".]

---

## Worked example — Reliability scenario

**ID**: QAS-001

**Characteristic**: Reliability

**Source**: Dispatcher agent (scripts/run-checklist.mjs)

**Stimulus**: 50 concurrent wave dispatch requests arrive within a 10-second window.

**Environment**: Normal operation — dev server running, no active deployment.

**Artifact**: PFCA gate (`scripts/run-checklist.mjs` + `docs/checklists/phase-dor.md`)

**Response**: The PFCA gate evaluates each request independently. No request is silently dropped. Responses for all 50 arrive within 5 seconds of the last request.

**Measure**: p95 response time ≤ 3 s per request; 0 silent failures (exit code 0 or explicit BLOCK output for every invocation).

---

## Notes on Source and Artifact fields

These two fields enable automation:

- **Source** routes the scenario to the owning agent role. A QAS with Source = "dispatcher agent" is reviewed by the Chief Architect. A QAS with Source = "end user (mobile)" is reviewed by the UX team.
- **Artifact** routes the scenario to the surface owner. A QAS with Artifact = "PFCA gate" is the responsibility of the meta-process engineer. A QAS with Artifact = "billing API" is the responsibility of the billing domain owner.

When both are `—`, the QAS is unrouted and cannot be automatically enforced. Fill them as soon as ownership is known.

---

## QAS registry

QAS files live in `docs/quality/`. When filing a new scenario:

1. Assign the next `QAS-NNN` ID (check existing files for the highest number).
2. Reference the QAS ID in the relevant ADR under `## Related Quality Attribute Scenarios`.
3. Reference the QAS ID in the wave spec `§10 Quality Requirements` table.
