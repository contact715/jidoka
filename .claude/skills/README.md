# .claude/skills — Skill Library

A skill is a distilled reuse recipe for a UI/UX pattern that has already been built and validated in this codebase. Each skill captures the "how", the file locations, and the known failure modes so the next FE agent does not re-research or re-invent the same solution.

---

## When to use a skill

Open the relevant skill before writing any new component that matches the pattern description. Read it fully, then follow the implementation guide. Do not deviate from the anti-patterns section without a documented reason.

---

## Browsing skills

Start with `_INDEX.md` — it has a one-line summary and tags for each skill. Use `rg` to search inside skills:

```bash
rg "sticky" .claude/skills/
```

---

## Skill lifecycle

1. A skill is created by extracting a proven pattern from merged wave work.
2. It is updated when the pattern evolves (add a "Revision" note at the top with wave reference).
3. It is retired by moving to `.claude/skills/archived/` with a reason comment.

Skills are not aspirational. They document patterns that exist in production code today.

---

## File format

Every skill follows `_TEMPLATE.md`. Required sections:

- **Skill name + tagline** — one sentence, concrete outcome
- **When to use** — trigger situations (not "always")
- **Implementation guide** — steps, code snippets, file refs with line numbers
- **Example references** — exact `file:line` pointers to working code
- **Anti-patterns / gotchas** — what breaks and why
- **Wave reference** — when first applied, whether revised

---

## Index

See `_INDEX.md`.
