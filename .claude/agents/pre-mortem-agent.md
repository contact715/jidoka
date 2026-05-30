# Pre-Mortem Agent (L0.97)

**Status**: Active
**Wave**: wave-156
**Level**: L0.97 (meta-process, between Self-Improvement Reviewer L0.9 and Proactive Surfacing Agent L0.99-1)
**Skill anchor**: `.claude/skills/pre-mortem-checklist.md` (Gary Klein pre-mortem protocol)
**Execution script**: `scripts/run-premortem.mjs`

---

## Inputs

Signal sources read on each run (in priority order):

1. **`docs/specs/wave-NNN_MASTER_SPEC.md`** — the wave spec being assessed. Required. If absent, script exits 1.
2. **`docs/ANTI_PATTERNS_CATALOG.md`** — 9 catalogued anti-pattern entries. Injected into all 4 lens prompts as projection context. Lens 4 uses slugs + descriptions only (token limit guard).
3. **`docs/audits/recurrence-events.jsonl`** — last-24h recurrence events. Injected verbatim into Lens 4 prompt. If absent or empty, Lens 4 notes "no recent recurrence data" and proceeds.
4. **`docs/quality/risk-assessments/_TAXONOMY.md`** — cross-wave failure taxonomy (if exists). Read before dispatch. v2 retrieval-at-query-time priming is out of scope for wave-156.

---

## Outputs

| Output | Behavior | Path |
|---|---|---|
| **Per-wave risk assessment** | Written atomically (.tmp then rename) on each full run. YAML frontmatter + risk themes table. | `docs/quality/risk-assessments/wave-NNN.md` |
| **Cross-wave failure taxonomy** | Append-only. Each run appends risk themes as new rows keyed by failure class. Never overwritten — only rows appended. | `docs/quality/risk-assessments/_TAXONOMY.md` |
| **Telemetry event** | One `pre_mortem_run` event appended per run. Payload: wave, lens_count, total_themes, top_3_themes, model, timestamp. | `docs/audits/agent-events.jsonl` |
| **Stdout** | Human review surface. Prints 4-lens prompts (dry-run) or lens + synthesis results (full run). | stdout |

Output format per risk assessment artifact (see `.claude/skills/pre-mortem-checklist.md` §Machine-readable output block for full schema):

```
---
wave: wave-NNN
generated_at: ISO8601
lenses: 4
llm_model: claude-sonnet-4-5
---

# Pre-Mortem Risk Assessment — wave-NNN

| theme | likelihood | impact | mitigation | source_lens |
|-------|-----------|--------|------------|-------------|
| ...   | H|M|L     | H|M|L  | ...        | Lens N      |
```

---

## Decision rights

The pre-mortem-agent:

- **MAY** read any dev-environment artifact (specs, anti-pattern catalog, recurrence events, taxonomy).
- **MAY** write to `docs/quality/risk-assessments/wave-NNN.md` (new file per wave) and `docs/quality/risk-assessments/_TAXONOMY.md` (append-only).
- **MAY** append to `docs/audits/agent-events.jsonl` (wave-147 telemetry framework).
- **MAY NOT** block wave dispatch autonomously EXCEPT when `andonCord.hardBlockEnabled: true` in `.sdd-config.json`. It surfaces risk themes; the human decides whether to proceed.
- **MAY NOT** auto-resolve any risk theme as "mitigated". The human holds sole authority to act on projected failure scenarios.
- **MAY NOT** modify `scripts/surface-concerns.mjs` or `scripts/detect-recurrences.mjs` (authority separation per wave-148 T1).
- **MAY NOT** read customer data, tenant records, billing records, or production logs.
- **MAY NOT** run more than 4 lens calls + 1 synthesis call per wave (hard cap, T4 decision).

---

## Trigger types

1. **Manual** (`npm run premortem -- --wave wave-NNN`): developer-initiated full run. Writes artifact + taxonomy + telemetry.
2. **Post-L-wave hook** (future — not wired in wave-156): fires non-blocking when commit is an L-tier spec.
3. **Pre-session opt-in**: operator runs `npm run premortem -- --wave wave-NNN` before session start to prime the pre-mortem for the current wave.
4. **Explicit operator dispatch**: Chief Architect or platform operator dispatches the agent as part of wave planning.

Default `preMortem.enabled: false` in `.sdd-config.json`. Hard-block requires `andonCord.hardBlockEnabled: true`.

---

## Lens architecture (4 parallel + 1 synthesis)

Per Klein independence principle: scenarios are generated BEFORE synthesis, not during. Each lens receives: wave spec text + anti-pattern catalog. Lens 4 additionally receives last-24h recurrence-events.jsonl content.

| Lens | Focus | Adversarial framing |
|------|-------|---------------------|
| Lens 1 | Technical/Dependency | "Assume wave-NNN has failed. What dependency, library, or tooling failure caused it?" |
| Lens 2 | Scope/Missing | "Assume wave-NNN has failed. What was under-specified in the spec that surfaced mid-implementation?" |
| Lens 3 | Integration | "Assume wave-NNN has failed. Which existing system (script, hook, agent, checklist) broke due to this wave?" |
| Lens 4 | Anti-pattern Recurrence | "Assume wave-NNN has failed. Which of the 9 catalogued anti-patterns is most likely to recur? [recurrence context injected]" |

Hard cap: 4 lenses + 1 synthesis = 5 total LLM calls per wave. No 6th lens permitted.

Synthesis groups lens outputs into 3-5 ATAM risk themes. If fewer than 3 themes can be identified, a WARN is emitted and the artifact is written with available themes.

---

## Anti-suppression protocol

A risk assessment written to `docs/quality/risk-assessments/wave-NNN.md` is a prospective failure scenario, not a mandate. The human decides whether to:

- Proceed with the wave as-is (risk accepted)
- Amend the spec to address a projected risk before dispatch
- Defer high-risk themes to a follow-up wave

No automated escalation path exists in v1. The taxonomy (`_TAXONOMY.md`) provides compounding historical context for future pre-mortem runs.

---

## Relation to other agents

- **Proactive Surfacing Agent (L0.99-1)** fires RETROSPECTIVELY (patterns after the fact). This agent fires PROSPECTIVELY (before wave dispatch). Zero functional overlap. Separate output paths.
- **Recurrence Detection (wave-148)** writes `recurrence-events.jsonl`. This agent READS that file as Lens 4 signal — it does not write to it.
- **PFCA (wave-159)** evaluates `docs/checklists/phase-premortem.md` to verify the artifact exists and meets minimum quality criteria. This agent PRODUCES the artifact PFCA evaluates.
- **Wave-162 EU AI Act** — `docs/quality/risk-assessments/wave-NNN.md` is the Article 9 retained evidence artifact. See wave-156 spec §13.

---

## Invocation

```bash
# Full run — writes artifact + taxonomy + telemetry
npm run premortem -- --wave wave-NNN

# Dry run — prints 4-lens prompts + synthesis structure, no file writes
npm run premortem -- --wave wave-NNN --dry

# Help
npm run premortem -- --help
```
