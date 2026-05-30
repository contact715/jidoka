# Definition of Done (DOD)

> Formal anchor for wave closure gates. Operational implementation: `.claude/skills/completion-audit.md` (gitignored body, mirrored at `docs/skills/completion-audit.md`).
> PFCA reads these fields when `--phase dod` is passed to `scripts/run-checklist.mjs`.

---

## DOD Fields (mapped to completion-audit.md)

The following 5 fields must be filled before any "done", "shipped", "complete", or "closed" claim is made.
Each field maps to its corresponding field in `.claude/skills/completion-audit.md`.

| DOD Field | Maps to completion-audit.md field | Description |
|---|---|---|
| **Goal** | `Goal` | Original ask in 1 line, copied from spec or task description. |
| **Gaps remaining** | `Gaps remaining` | Enumerate with file:line references, or write exactly "0 — all gaps addressed". Never leave blank. |
| **Enforcement type** | `Enforcement type` | One of: `documentation`, `active hook`, `hard block`, `external audit`. Closure level cannot be 100% if "documentation" alone. |
| **Closure level** | `Closure level` | Percentage. 100% only when all gaps are zero AND enforcement is not "documentation only". |
| **If < 100%** | `If < 100%` | Explicit list of deferred items + why deferred + wave-NN when addressed (not "later" or "eventually"). |

---

## DOD Checklist Template

```
## Completion audit (mandatory before "done" claims)
- **Goal:** <original ask, 1-line>
- **Gaps remaining:** <enumerate with file:line OR "0 — all gaps addressed">
- **Enforcement type:** documentation | active hook | hard block | external audit
- **Closure level:** N% (100% only if all gaps explicitly addressed AND enforcement is not "documentation only")
- **If < 100%:** explicit list of deferred items + why deferred + wave-NN when addressed
```

---

## DOD Enforcement Rules

1. The block is mandatory. "Obviously done" is not an exemption.
2. Deferring without a wave number is not acceptable. Use "wave-NN" or "next session".
3. Closure level is 100% ONLY when all gaps are explicitly enumerated as zero AND enforcement type is not "documentation" alone.
4. All gaps are gaps. Do not use "minor" to minimize them.

---

## References

- Operational implementation: `.claude/skills/completion-audit.md` (gitignored) / `docs/skills/completion-audit.md` (git-tracked)
- Checklist runner: `scripts/run-checklist.mjs --phase dod --wave wave-NNN`
- Checklist definitions: `docs/checklists/phase-dod.md`
- CODING_STANDARDS.md §11 requires this block before every "done" claim
- Anti-pattern catalog entries 2 and 3: `partial-closure-via-documentation`, `optimistic-completion-bias`

---

Wave-159 introduced this document as the formal anchor for the DOD convention that was previously enforced only by `completion-audit.md` convention without a canonical reference document.
