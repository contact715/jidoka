---
doc_type: runbook
title: <runbook title>
version: X.Y.Z
created: YYYY-MM-DD
authority: <role that owns execution>
framework: <optional — regulatory/methodology reference>
trigger_halt_types:
  - <agent-slug from andon-halt-helpers.mjs halt-authority list>
last_tested: YYYY-MM-DD
---

# <Runbook Title>

> One-sentence summary of when to open this runbook and who owns it during execution.

---

## 1. Trigger / Symptoms [REQUIRED]

Describe the halt types, alert conditions, or observable symptoms that cause an operator
to open this runbook. For machine-readable halt routing, the `trigger_halt_types` frontmatter
field is the canonical anchor. This section provides human-readable context.

Examples:
- Andon halt fired by `<agent-slug>`
- CI failure in a specific pipeline stage
- Observable symptom such as service degradation, alert threshold crossed, or audit violation

---

## 2. Steps [REQUIRED]

Numbered procedure. Each step must be independently executable by the authority role.
No step executes runbook logic automatically — the operator reads and performs each step.

1. **Step one title** — description. Be specific about file paths, commands to check, or
   config toggles to inspect.
2. **Step two title** — description.
3. Continue for each discrete action required to resolve the situation.

> Human gate: before proceeding past this step, the authority role must confirm the change
> is within the blast radius described in step 1.

---

## 3. Rollback [REQUIRED]

Describe the rollback path if the steps above do not resolve the situation or cause a
regression. Reference `docs/runbooks/rollback-protocol.md` for the config-flag rollback
pattern. Describe any runbook-specific rollback steps here.

---

## 4. Verification [REQUIRED]

Checklist confirming the procedure completed correctly. The authority role signs off after
all items are confirmed.

- [ ] Primary symptom is no longer observed.
- [ ] CI pipeline passes on any commits made during remediation.
- [ ] No new alerts triggered within 15 minutes post-resolution.
- [ ] `docs/changes/` entry created documenting what was done.
- [ ] Andon halt (if applicable) resumed via `node scripts/andon-resume.mjs`.

---

## 5. Prerequisites [ADVISORY]

List access, credentials, or context the operator needs before starting. Mark items that
require a second person for the four-eyes principle.

---

## 6. Escalation [ADVISORY]

| Condition | Escalation path |
|---|---|
| Situation not resolved within <time> | Escalate to <role> |
| Regulatory or legal exposure confirmed | Escalate to legal counsel immediately |

---

## 7. Owner / Contact [ADVISORY]

| Role | Responsibility |
|---|---|
| <authority role> | Owns execution of this runbook |
| <secondary role> | Backup if primary unavailable |

---

## 8. Post-incident update [ADVISORY]

After resolution: update `last_tested` in this file's frontmatter to today's date and
commit via the normal wave workflow. This prevents the freshness warning from firing
(staleness threshold: 90 days).

---

## Notes on this template

- Sections marked `[REQUIRED]` will cause `node scripts/validate-runbooks.mjs` to exit 1
  if absent. Add them to every runbook.
- Sections marked `[ADVISORY]` produce a WARN (exit 0) if absent. Add them when relevant
  to the runbook's domain.
- The `trigger_halt_types` frontmatter field must contain slugs from the halt-authority
  agent list in `scripts/andon-halt-helpers.mjs:3-9`. Unknown slugs cause exit 1.
- The `last_tested` field must be a valid ISO date (YYYY-MM-DD). Values older than 90 days
  produce a WARN (exit 0).
- Run `node scripts/validate-runbooks.mjs` to validate all runbooks in `docs/runbooks/`.
- Run `npm run runbooks:validate` (equivalent) from the project root.
