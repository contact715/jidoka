# Skill: EARS acceptance criteria — machine-parseable AC syntax

> Wave: 58  |  Status: experimental  |  Tags: [spec, ac, sdd, machine-parseable]

---

## When to use

Every time you write acceptance criteria in a spec (`docs/specs/{wave}_MASTER_SPEC.md` section "Acceptance criteria"). EARS replaces bullet ACs with a small set of fixed patterns. Result: ACs become testable, agent-parseable, and have unambiguous semantics.

EARS (Easy Approach to Requirements Syntax) was canonical in aerospace requirements engineering and is now the dominant SDD convention — used by Spec Kit, OpenSpec, GSD, Kiro. We're closing a wave-57 gap by adopting it.

---

## The five patterns

| Pattern | Template | When to use |
|---|---|---|
| **Ubiquitous** | "The \<system\> shall \<action\>." | Always-true invariants |
| **Event-driven** | "When \<trigger\>, the \<system\> shall \<action\>." | User action / event response |
| **State-driven** | "While \<state\>, the \<system\> shall \<action\>." | Behaviour bound to a mode/state |
| **Optional / feature** | "Where \<feature flag\>, the \<system\> shall \<action\>." | Feature-gated behaviour |
| **Unwanted / guard** | "If \<unwanted condition\>, then the \<system\> shall \<action\>." | Error / guard / rollback |

Combinations are allowed: "While editing mode, when the user presses Escape, the system shall discard changes."

---

## Comparison — bullet AC vs EARS

### Bullet (our pre-wave-58 style)

> AC #5: Stripe height remains h-1 (1px). `rg "h-[2-9]" components/pipeline/PipelineColumn.tsx` returns zero matches on the stripe element.

Problems:
- "Stripe height remains h-1" — what triggers the check? Always? On commit? On render?
- The `rg` line is a verification command, not a criterion. Mixes WHAT with HOW.
- An agent reading this has to GUESS the semantic boundary.

### EARS rewrite

> AC #5 (ubiquitous): The PipelineColumn stripe element shall have class `h-1` and only `h-1`.
> AC #5-verify (test): If `rg "h-[2-9]" components/pipeline/PipelineColumn.tsx` returns any match on a stripe line, then the system shall fail the visual regression test.

Now the criterion is a property; the verification is a separate test. Each is unambiguous.

### Bullet vs EARS on event-driven example

Bullet:
> AC #1: Clicking the stripe on a non-system stage opens ColorPicker popover.

EARS:
> AC #1 (event-driven): When the user clicks the stripe `<button>` element on a non-system stage, the system shall mount `<ColorPickerPanel>` directly below the stripe.

EARS forces explicit naming of the trigger, the actor (system), and the action. No ambiguity about what's being tested.

---

## Anti-patterns

- **Mixing WHAT and HOW**. "AC: button uses `h-cta`" is a HOW. The WHAT is "primary CTA buttons are 36px tall". EARS: "The system shall render primary CTA buttons at 36px height." Verification: "If any `<button class*='h-{N}'>` with N != cta appears in JSX, the system shall fail lint."
- **Compound criteria**. Don't write "When X happens, the system shall do A AND B AND C." Split into 3 ACs. EARS lets each verb be testable separately.
- **Implicit subjects**. "Stripe is interactive" is implicit subject + verb. EARS: "The stripe `<button>` element shall accept `click` events." Explicit subject required.
- **Future tense / aspirational**. "Will eventually support keyboard nav" is not an AC. If it's in this wave, write the EARS now. If not, move to §8 Open questions.
- **AC as essay**. Each AC is one sentence. If it doesn't fit, you have 2 ACs.

---

## How to convert existing bullet ACs

For a wave that already shipped:
1. Don't retroactively edit shipped specs. Cost > benefit.
2. For the NEXT wave's spec, write all ACs in EARS from the start.

For a wave in progress (e.g. wave-58 itself):
1. Read each existing AC bullet.
2. Identify its pattern (ubiquitous / event-driven / state-driven / etc.).
3. Rewrite using the template.
4. Split compound criteria into multiple atoms.
5. Move verification commands (`rg`, `npx tsc`, etc.) to a separate "Verification" subsection — they're not part of the criterion itself.

---

## Mandatory for: Chief Architect spec output

Wave-58 update: Chief Architect charter now requires ACs in EARS from spec-format §7.

| Old format | New EARS format |
|---|---|
| `7. ACs: [list of bullets]` | `7. Acceptance criteria (EARS): [list of patterned ACs] / Verification: [list of commands]` |

The Spec Reviewer SR-24 (added wave-58) flags any AC that's not in EARS form. Existing specs grandfathered; new specs gate.

---

## Concrete examples from our system

Conversion of three real ACs from wave-36 (stage-picker):

**Bullet (original)**:
> AC #1: Clicking the stripe on a non-system stage opens ColorPicker popover.

**EARS**:
> When the user clicks the stripe `<button>` on a non-locked PipelineColumn, the system shall render `<ColorPickerPanel>` anchored below the stripe.

**Bullet**:
> AC #4: System stages render the stripe as `<div>`, not `<button>`. No popover opens on click.

**EARS** (event-driven + ubiquitous combined):
> If `stage.id` is in `SYSTEM_STAGE_IDS`, then the system shall render the stripe as a non-interactive `<div>`.
> When the user clicks a system-stage stripe, the system shall not change state.

**Bullet**:
> AC #10: Stripe button has `aria-label="Change stage colour"` on every non-locked column.

**EARS** (ubiquitous):
> The stripe `<button>` element on every non-locked PipelineColumn shall carry the attribute `aria-label="Change stage colour"`.

---

## When NOT to use EARS

- Open questions section (§8) — questions aren't criteria.
- Risk callouts — they're risks, not assertions.
- Architecture diagrams / data flow — descriptions, not behaviour.
- Out-of-scope statements — negations of intent, often awkward in EARS form.

EARS is for ACs only. Don't force the rest of the spec into the template.

---

## Quick reference card

```
[U]biquitous     The <subj> shall <verb>.
[E]vent-driven   When <trigger>, the <subj> shall <verb>.
[S]tate-driven   While <state>, the <subj> shall <verb>.
[O]ptional       Where <feature>, the <subj> shall <verb>.
[U]nwanted       If <bad>, then the <subj> shall <verb>.
```

If you can't pick a pattern, your AC is probably compound or implicit-subject. Split it or name the subject.

---

## Out of scope

- **Auto-EARS converter** — a script that converts bullet ACs to EARS. Not built. The discipline is in the writing; automation adds latency.
- **EARS validator beyond SR-24** — could add an ESLint-style check on spec markdown for non-EARS sentences. Skipped; SR-24 in the Spec Reviewer catches it at dispatch time.
