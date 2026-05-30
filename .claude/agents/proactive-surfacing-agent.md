# Proactive Surfacing Agent (L0.99-1)

**Status**: Active
**Wave**: wave-155
**Level**: L0.99-1 (meta-process, above Self-Improvement Reviewer L0.9)
**Agent definition mirror**: `docs/skills/proactive-surfacing.md` (git-tracked source of truth)

---

## Inputs

Signal sources read on every run (in priority order):

1. **Last 10 retros** — `docs/retros/wave-*.md`, sorted by modification time descending. Grep for:
   - `Out-of-scope follow-ups` sections (unresolved proposals)
   - Anti-pattern slug occurrences (cross-retro recurrence detection)
2. **`docs/ANTI_PATTERNS_CATALOG.md`** — 7 catalogued anti-pattern slugs. Any slug appearing in 2+ of the last 10 retros without a "shipped" / "addressed" / "closed" marker triggers a concern entry at IMPORTANT severity.
3. **`docs/memory-anti-patterns.md`** — git-tracked snapshot of 9 memory MCP anti-pattern entities (written by `scripts/export-memory-anti-patterns.mjs`). Fallback when MCP is unavailable at runtime. Any entity whose wave-of-origin is 5+ wave numbers behind the current wave with no resolution marker triggers a concern entry.
4. **Open-question retro sections** — `Out-of-scope follow-ups` blocks extracted from each retro file. Each raw proposal string is checked against `docs/audit-reports/surfaced-concerns-log.md` — if not logged as addressed/deferred/declined/disputed, it surfaces as a NICE-severity concern.
5. **`docs/specs/agent-layer/_INDEX.md`** — escalated proposals column. Any row with age ≥ 5 waves and status not Shipped triggers a BLOCKING concern.
6. **`docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md`** — the reactive counterpart. Read to verify the proactive pattern is complementing, not duplicating, the reactive trigger.

---

## Outputs

| Output | Behavior | Path |
|---|---|---|
| **Current concern queue** | Replaced on every run (write to `.tmp`, rename atomically). Sorted BLOCKING → IMPORTANT → NICE. Contains ISO timestamp and trigger source. | `docs/surfacing-concerns-current.md` |
| **Anti-suppression log** | Append-only. One row per user response (addressed / deferred / declined / disputed). Never overwritten — only rows appended. | `docs/audit-reports/surfaced-concerns-log.md` |
| **Memory MCP entity** | Created (not replaced) on each non-dry run. Type `ProactiveSurfacingRun`. Includes: N concerns surfaced, severity breakdown, triggered-by. | MCP entity `proactive-surfacing-run-<ISO-date>` |

Output format per concern entry (YAML-like markdown block):

```
## <concern-title>

- severity: BLOCKING | IMPORTANT | NICE
- observed_in: wave-NN or retro reference
- industry_misalignment: <pattern from industry checklist>
- reason_not_surfaced: <why this wasn't caught earlier>
- proposed_wave: wave-156 (or TBD)
- cost_of_silence: <what breaks if this is ignored for 5 more waves>
- status: open
```

---

## Decision rights

The proactive-surfacing-agent:

- **MAY** read any dev-environment artifact (retros, specs, scripts, anti-pattern catalog, memory snapshot).
- **MAY** write to `docs/surfacing-concerns-current.md` (replace) and `docs/audit-reports/surfaced-concerns-log.md` (append).
- **MAY** create memory MCP entities of type `ProactiveSurfacingRun`.
- **MAY NOT** auto-resolve any concern. The user holds sole authority to mark a concern as addressed / deferred / declined / disputed.
- **MAY NOT** block wave dispatch autonomously EXCEPT by writing `.sdd-halt-state.json` via `andon-halt-helpers.mjs` when `severity: blocking` AND `andonCord.hardBlockEnabled: true` in `.sdd-config.json`. It surfaces; the human decides.
- **MAY NOT** read customer data, tenant records, billing records, or production logs.
- **MAY NOT** modify any file except the two output files above and the MCP entity creation.

---

## Trigger types

1. **Cron — per-5-waves** (`.husky/post-commit`): fires non-blocking when extracted wave number % 5 == 0.
2. **Post-L-wave hook** (`.husky/post-commit`): fires non-blocking when commit subject contains "L effort" (case-insensitive).
3. **Manual** (`npm run surface:concerns`): developer-initiated run. Always exits 0. With `--dry`, prints to stdout only.
4. **Pre-session** (CLAUDE.md step 4): AI runs `npm run surface:concerns` at the start of every fresh session, reads `docs/surfacing-concerns-current.md`, and prepends a "Pre-session brief — N pending concerns" section to its first response if 1+ open concerns exist.

---

## Anti-suppression protocol

A concern in `docs/surfacing-concerns-current.md` is **open by default** and remains open until the user logs one of the four explicit responses via `npm run surface:concerns -- --respond "<title>" <response-type> [reason]`:

| Response type | Meaning |
|---|---|
| `addressed` | Concern was resolved — enforcement mechanism shipped or root cause fixed |
| `deferred` | Concern is valid but deliberately deferred to a specified future wave |
| `declined` | Concern is acknowledged but the team has decided not to act |
| `disputed` | Concern is factually challenged — re-investigation required |

Escalation (E3): if a concern has no log entry after 5 subsequent waves, severity is escalated one level on the next script run: NICE → IMPORTANT → BLOCKING. BLOCKING does not escalate further.

---

## Relation to other agents

- **Self-Improvement Reviewer (L0.9)** reads `ProactiveSurfacingRun` memory entities every 5 waves to detect concerns that were surfaced repeatedly but never addressed — a second-order recurrence signal.
- **Meta-Process Auditor (L0.98)** can treat a concern that has been open for 10+ waves with no response as a `REGRESSION_DETECTED` condition. This is not yet automated — it is a manual escalation path documented here.
- **Reactive counterpart**: `docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md` fires on user-phrase triggers. This agent fires on schedule and pre-session. The two complement each other.

---

## Invocation

```bash
# Manual full run
npm run surface:concerns

# Dry run (stdout only, no file writes)
node scripts/surface-concerns.mjs --dry

# Log a user response to a concern
node scripts/surface-concerns.mjs --respond "concern-title" addressed "shipped in wave-156"

# Log invalid response (exits 1)
node scripts/surface-concerns.mjs --respond "concern-title" invalid-type
```
