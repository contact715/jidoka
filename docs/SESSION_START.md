# Session Start Checklist

Source of truth for mandatory session-start checks. CLAUDE.md references this file.
Edit this file, not CLAUDE.md, to add or modify checks.

Run all six checks in order before dispatching any wave. Skipping any one of them
is how stale state or unreviewed regressions reach production (wave-45b SI Reviewer
finding, wave-150 enforcement).

---

## Check 1 — Memory staging

```bash
npm run memory:status
```

If the output reports unmerged staging files in `.claude/memory-staging/`, merge them
into the memory MCP graph BEFORE dispatching any wave. Merge protocol: read each
staging JSON, call `mcp__memory__read_graph()`, create entities/observations/relations
that do not already exist. See `docs/MEMORY_MERGE_PROTOCOL.md`.

---

## Check 1b — Superseded facts (wave-memory-validity)

```bash
npm run memory:supersede
```

Lists facts where a newer observation contradicts an older one about the same entity
(same subject, different value). For each candidate, confirm whether the old fact is
truly superseded; if so, mark it per `docs/MEMORY_MERGE_PROTOCOL.md` step 7 before dispatching.
Advisory (exit 0). Use `--strict` in CI to fail on unmarked contradictions.

---

## Check 2 — Reflexion queue

Inspect `.claude/reflexion-queue/`. If non-empty, the wave-33 auto-Reflexion hook has
flagged a previous commit that deserves an adversarial review pass before new work
starts.

---

## Check 3 — Audit backlog

```bash
npm run audit:backlog
```

Surfaces every wave-NN proposal in `docs/audit-reports/` plus retros' out-of-scope
follow-ups and cross-references them against git log to show which actually shipped.
If the banner reports ESCALATED proposals (age >= 5 waves), action one BEFORE starting
new wave work. Closes the wave-45b SI Reviewer finding "0 of 5 prior proposals
actioned" by making the backlog visible at session start.

---

## Check 4 — Meta-process audit (wave-150)

```bash
npm run audit:meta-process
```

Scans the last 5 retro files for recurrence of catalog anti-patterns. Three possible
verdicts:

- PASS — no recurrence detected, proceed.
- REGRESSION_DETECTED — one or more catalog anti-patterns appear in 2+ retros.
  Do NOT dispatch the next wave until a human reviews the finding and runs:
  ```bash
  node scripts/andon-resume.mjs --wave <wave> --approver <name> --reason <text> --root-cause <annotation>
  ```
- CATALOG_UPDATE_NEEDED — an uncataloged recurring pattern was detected.
  Add a new entry to `docs/ANTI_PATTERNS_CATALOG.md` before the next wave dispatch.

This check fires automatically on every commit via the post-commit hook
(`.githooks/post-commit`). Running it manually here surfaces any regression before
the session begins, not after the first commit.

---

## Check 5 — Proactive surfacing (wave-155)

```bash
npm run surface:concerns
```

Reads `docs/surfacing-concerns-current.md`. If the file contains one or more concerns
with `status: open`, prepend a `Pre-session brief — N pending concerns` section to
the first user response in this session. Concerns with no entry in
`docs/audit-reports/surfaced-concerns-log.md` are open by default.

Do not skip this step — skipping it is the `partial-closure-via-documentation`
anti-pattern applied at session level. Respond to surfaced concerns via:

```bash
node scripts/surface-concerns.mjs --respond "<title>" <addressed|deferred|declined|disputed> [reason]
```

---

## Check 6 — Consolidated memory digest (frontier M6)

```bash
npm run memory:consolidate
```

Rebuilds `~/.claude/jidoka/memory-consolidated.md` from the cross-project mistake ledger:
raw incidents (episodic) → per-class lessons ranked by recency-weighted frequency (semantic).
Read the digest before dispatching. The 🔴 **Active** lessons are the mistakes most likely to
recur right now; any lesson marked **ungated — still a live risk** is a class with no mechanism
holding it yet — prefer building that gate over re-learning the lesson the hard way. Decayed
lessons are folded to the bottom so old one-offs do not crowd out live patterns.
