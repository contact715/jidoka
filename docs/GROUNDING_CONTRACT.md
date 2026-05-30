---
doc_type: contract
wave: wave-163
status: active
created: 2026-05-28
---

# Grounding Contract — Source Citation Requirements

This document is the single source of truth for how this project agent outputs are validated
against declared source citations. It defines:

1. Claim taxonomy — what types of agent assertions require citations
2. Citation schema options — the supported structured output formats
3. Soft vs hard fail policy — what happens when citations are missing or unresolved
4. sampleRate semantics — how the sampling gate works
5. v1 scope limitations — known gaps and the wave-164 upgrade path

Referenced by:
- `scripts/check-source-grounding.mjs` — detection script
- `.claude/agents/_TEMPLATE.md` — agent definition template (source_grounding stanza)
- `docs/checklists/phase-dor.md` K6 — DOR gate for new agents
- `docs/compliance/eu-ai-act/hrais-classification.md` — Art 15 Para 3 declarable metric

---

## 1. Claim taxonomy

Every agent output that reaches a human approval card may contain one or more
of the following claim types. Only types marked **citation-required** trigger the
grounding check.

| Claim type | Description | Citation required |
|---|---|---|
| `agent_assertion` | A factual statement about the world, a customer, or a business rule (e.g. "the customer's last appointment was March 4"). | YES |
| `decision_rationale` | The stated reason an agent recommends or rejects an action (e.g. "flagging this lead because credit score is below threshold"). | YES |
| `ac_verdict` | A PASS/FAIL/BLOCK verdict on an acceptance criterion, including the evidence used to reach it. | YES |
| `procedural_output` | Scheduling confirmations, template fills, routing instructions. No original factual claim. | NO |
| `tool_echo` | Verbatim repeat of a tool return value (API response, DB query result). The tool result is itself the source. | NO |

Voice agents (e.g. Frontliner) produce real-time audio responses that are not structured
JSON. They declare `citation_schema: 'none'` to opt out of citation extraction entirely.
A `grounding_pass` event with `citation_count: 0` is emitted for each call — the opt-out
is auditable, not invisible.

---

## 2. Citation schema options

Agents must declare one of three citation schemas in their agent definition
(`source_grounding.citation_schema`). The schema determines how
`check-source-grounding.mjs` extracts citations from agent output.

### 2a. `anthropic_citations`

Used when the agent calls the Anthropic Citations API
(`citations: true` in the API request). The API response embeds a `citations[]`
array at the top level.

Expected output shape:

```json
{
  "content": "The last service was on March 4 per the work order.",
  "citations": [
    {
      "chunk_id": "kb-chunk-00127",
      "document_id": "work-orders-2024",
      "start_char": 42,
      "end_char": 89
    }
  ]
}
```

Resolution check: `chunk_id` must appear in the known source registry
(a `.jsonl` or `.json` file listing valid chunk identifiers for the deployment).

### 2b. `structured_output`

Used when the agent produces a structured JSON response and populates
`citations[]` manually. The array shape must match `anthropic_citations` exactly.

```json
{
  "verdict": "PASS",
  "rationale": "Checklist K1 confirmed: spec file exists at docs/specs/wave-163_MASTER_SPEC.md",
  "citations": [
    {
      "chunk_id": "spec-wave-163-section-1",
      "document_id": "wave-163_MASTER_SPEC",
      "start_char": 0,
      "end_char": 0
    }
  ]
}
```

### 2c. `none`

The agent does not produce structured citations. All voice agents and any
agent whose output is not parseable JSON must declare `citation_schema: 'none'`.

No citation extraction is attempted. The check emits a `grounding_pass` event
with `citation_count: 0` and `unresolved_count: 0` to record the opt-out.

---

## 3. Soft vs hard fail policy

| Condition | Soft fail (`hardBlockEnabled: false`) | Hard fail (`hardBlockEnabled: true`) |
|---|---|---|
| `citations[]` field absent AND `citation_schema != 'none'` | Emit `hallucination_detected`, exit 0 | Emit `hallucination_detected`, exit 42 |
| One or more `chunk_id` values unresolvable | Emit `hallucination_detected` with `unresolved_count`, exit 0 | Emit `hallucination_detected`, exit 42 |
| All `chunk_id` values resolve successfully | Emit `grounding_pass`, exit 0 | Emit `grounding_pass`, exit 0 |
| `citation_schema: 'none'` | Emit `grounding_pass` (opt-out audited), exit 0 | Emit `grounding_pass` (opt-out audited), exit 0 |
| `hallucination.enabled: false` in `.sdd-config.json` | Exit 0, write nothing | Exit 0, write nothing |

**Default**: soft fail. `hardBlockEnabled: false` in `.sdd-config.json`.

Hard fail (`hardBlockEnabled: true`) blocks the calling process. It is intended for
production environments where ungrounded claims reaching a human approval card are
a compliance risk. Operators set this explicitly — it is not auto-promoted by
`auto-strengthen.mjs` in v1.

---

## 4. sampleRate semantics

`hallucination.sampleRate` in `.sdd-config.json` controls what fraction of
`check-source-grounding.mjs` invocations produce a telemetry write.

| Value | Behavior |
|---|---|
| `1.0` (default) | Every call is checked and emits a record. Use in development and CI. |
| `0.05` | 5% of calls are checked. Recommended for production with high-volume agents. |
| `0.0` | No calls are checked. Equivalent to `enabled: false` but preserves the sampling config. |
| Any value in (0, 1) | Stochastic: `Math.random() > sampleRate` → skip this call, exit 0 without writing. |

The draw is random per call (not deterministic across calls). For deterministic
test fixtures, use `--dry-run` which always evaluates but never writes regardless
of sampleRate.

---

## 5. v1 scope and wave-164 upgrade path

### What v1 does

v1 checks citation **existence**: is the declared `chunk_id` present in the
source registry? If yes, the citation resolves. If not, it is flagged.

### Known limitation — STRIDE Spoofing vector

v1 does NOT check whether the cited content actually supports the claim.
An agent could declare a valid `chunk_id` that points to unrelated content
and pass the existence check.

This is documented in the wave-163 spec §12 STRIDE table as a Spoofing risk.
The mitigation is deferred to wave-164 which will add content-hash verification
(comparing the hash of the cited chunk against the hash stored in the registry at
ingestion time).

### wave-164 upgrade items

- HHEM-2.1 faithfulness scoring — per-claim groundedness score (0–1) using a
  dedicated hallucination evaluation model. Requires a golden dataset for calibration.
- LLM-as-judge faithfulness scoring — secondary verification path for claims
  where HHEM confidence is low.
- Content-hash verification on `chunk_id` resolution — closes STRIDE §12 Spoofing gap.
- Per-claim groundedness badge in the approval card UI — visual surface for human
  reviewers, requires monitoring data from wave-163 for calibration.

---

## 6. Payload field restrictions (STRIDE §12 Information Disclosure)

The `payload` field in a `GroundingEvent` must not contain:

- Raw agent output text (sentences, paragraphs, transcripts)
- Customer names, phone numbers, addresses, or any PII
- Full citation document content

Allowed in `payload`:

- `citation_schema` value
- `chunk_id` array (opaque identifiers only)
- Agent name and wave identifier
- `unresolved_chunk_ids` array (opaque identifiers only)

This restriction is enforced by convention in v1. A linting rule may be added
in wave-164 to enforce it statically.
