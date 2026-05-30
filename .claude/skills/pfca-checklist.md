# Skill: PFCA Checklist — Pre-Flight Checklist Agent gate

> Wave: wave-159  |  Status: experimental  |  Tags: [meta, process, pre-dispatch, quality-gate, pfca]

---

## When to use

This skill fires before any of 3 dispatch gates:
- Chief-architect receives a wave brief and is about to synthesize a master spec
- Implementation agent is dispatched with an approved spec
- A "done" claim is about to be made (closure gate)

Use this skill to ask: "Is this spec complete enough to implement correctly?" before any work begins.

Specifically, fire this skill when:
- A new wave brief arrives and you are about to dispatch chief-architect
- A master spec has been synthesized and you are about to dispatch frontend-agent or another impl agent
- An impl agent is about to write "done", "shipped", or "complete" and no completion-audit block exists

Do NOT fire this skill for mid-execution tool calls or individual file edits within an approved task.

---

## Implementation guide

### Step 1 — Determine the phase

```
--phase dor          ← dispatching chief-architect or impl agent (pre-dispatch)
--phase spec-review  ← SR-23 reviewing a synthesized spec
--phase task-decomp  ← TASKS.md completeness check
--phase dod          ← closure / "done" claim
--phase closure      ← retro gate
```

### Step 2 — Run the checker

```bash
node scripts/run-checklist.mjs --phase <phase> --wave wave-NNN
# With tier additions (optional):
node scripts/run-checklist.mjs --phase dor --wave wave-NNN --tier L4
# Dry-run (no log append):
node scripts/run-checklist.mjs --phase dor --wave wave-NNN --dry-run
```

### Step 3 — Interpret the verdict

| Exit code | Verdict | Action |
|---|---|---|
| 0 + "PASS" stdout | All items yes/n/a | Proceed |
| 0 + "WARN" stderr | Some items no, soft mode | Log the gap, proceed with caution |
| 42 | BLOCK, hard mode | Do not proceed. Human must run `node scripts/andon-resume.mjs` |

### Step 4 — If WARN in soft mode

Note the failing items in the wave retro. Do not treat WARN as PASS. WARN means a gap was detected
and accepted, not that the gap is resolved.

### Step 5 — If BLOCK in hard mode

```bash
node scripts/andon-resume.mjs --wave wave-NNN --approver <name> --reason <text> --root-cause <annotation>
```

The resume command clears the halt state and allows dispatch to proceed with an audit trail.

---

## Config reference

```json
{
  "pfca": {
    "enabled": false,
    "hardBlockEnabled": false
  }
}
```

- `enabled: false` — PFCA skips all evaluation, prints "[pfca] disabled", exits 0. No log written.
- `enabled: true, hardBlockEnabled: false` — WARN mode. Evaluates all items. WARN on any `no`. Exits 0.
- `enabled: true, hardBlockEnabled: true` — BLOCK mode. On any `no` killer item, calls `writeHaltState()`, exits 42.

---

## The 5 universal killer items

See `docs/DOR.md` for descriptions. In brief:
- **K1**: Spec file exists with `status: Draft`
- **K2**: Each AC has a binary-testable verification command
- **K3**: Wave ships at least one enforcement mechanism (not docs only)
- **K4**: §7 has explicit Scope IN and Scope OUT lists
- **K5**: No unattributed authority overlap with existing agents

---

## Anti-patterns this skill catches

| Anti-pattern | Killer item |
|---|---|
| `partial-closure-via-documentation` | K3 |
| `optimistic-completion-bias` | K2 |
| `scope-creep-mid-wave` | K4 |
| `dispatch-brief-vs-master-spec-drift` | K4 + K2 |
| `wave-spec-drift` | K1 |
| `cross-line-authority-contamination` | K5 |

---

## Wave history

First defined in wave-159. Triggered by three documented pain instances (wave-117, wave-153, wave-158)
where gaps were detectable before dispatch but no mechanism existed to catch them.
