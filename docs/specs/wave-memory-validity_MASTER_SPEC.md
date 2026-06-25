---
status: Draft
version: 1.0.0
level: L3
type: master-spec
wave: wave-memory-validity
owner_role: chief-architect
parents:
  - path: docs/NORTH_STAR.md
    version: 1.0.0
    relationship: governs
  - path: docs/CONSTITUTION.md
    version: 2.0.0
    relationship: constraints
  - path: docs/MEMORY_MERGE_PROTOCOL.md
    version: 1.0.0
    relationship: extends
complexity: non-trivial
created: 2026-06-06
last_updated: 2026-06-06
---

# wave-memory-validity — Master Spec

## 1. Goal (business terms)

Дай памяти «окно действительности» (validity window — паттерн из Graphiti): когда появляется новый
факт, который противоречит старому, старый факт помечается как SUPERSEDED (с датой и преемником), а
не молча сосуществует с новым и не затирается им. Память не врёт про настоящее и хранит правду про
прошлое — old facts stay readable as history, but they stop being presented as if they are still true.

Today the merge protocol is purely additive (`MEMORY_MERGE_PROTOCOL.md:21,47,84` — "never deletes",
"no existing observation overwritten"). Two contradictory observations about the same entity simply
coexist forever, and the session digest surfaces both with equal weight. That is the gap.

**Business metric**: the number of *stale* (contradicted-but-unmarked) facts surfaced in the
session-start digest trends to **0**. Measured by the detector count over time — the new
`memory:supersede` check prints how many unmarked contradictions it finds; a green run = 0. The
metric is the detector's own output, run every session, so the improvement is visible session over
session (Product Kaizen: the memory makes the next session's reasoning measurably more correct).

Framework Compass (`docs/NORTH_STAR.md §Framework Compass` — all five "yes"):

1. Q1 — raises memory *correctness* (a quality line): the digest stops asserting facts that a newer
   fact already refuted.
2. Q2 — every AC is backed by an inline `--self-test` case in the new script and in
   `memory-consolidate.mjs`.
3. Q3 — CONSERVATIVE by design: the script never deletes; it flags candidates for a human/agent to
   confirm. The human (and the agent doing the MCP merge) stays in the seat.
4. Q4 — adds exactly one zero-dep script (`memory-supersede-check.mjs`); the digest/exclusion logic
   extends `memory-consolidate.mjs` in place (no second copy); the protocol gets one new step. We
   survey first (§2) and add only what is not already there (§3).
5. Q5 — the detector count is the Kaizen signal; the supersede markers feed back into the next
   snapshot export, closing the loop.

---

## 2. What already exists (cite precisely) — survey before scaffold

| Artifact | Relevant lines | Role in this wave |
|---|---|---|
| `scripts/memory-consolidate.mjs` | 43-66 `consolidate()` | Only one of the five memory scripts that is pure, deterministic, self-tested, and already groups per-subject (`groupByClass`) and already has tier-based hide/demote (`tierOf`). The digest-exclusion change lands here. |
| `scripts/memory-consolidate.mjs` | 36-40 `scoreCluster` / `tierOf` | Existing demote lever (DORMANT). We add a parallel SUPERSEDED handling, not a new score. |
| `scripts/memory-consolidate.mjs` | 86 `ICON`, 97-121 `render` | Where a `History` tail / superseded exclusion renders. |
| `scripts/memory-consolidate.mjs` | 123-158 `selfTest()` | The canonical self-test pattern (the only memory script with `--self-test`). Extend its `rows`/`T` table. |
| `scripts/meta-lib.mjs` | 50-54 `groupByClass` | Shared grouping primitive. Reused for grouping; NOT modified. |
| `docs/memory-anti-patterns.md` | 34-41 entity block | The exact `### \`name\` / **Type**: / **Wave**: / **Observations**:` contract the new script scans. 7 AntiPattern entities + a Relations table (`:100-114`). |
| `docs/memory-skills.md` | 29-37 | 1 Skill entity, same block format. |
| `docs/memory-lessons.md` | 29-36 | 1 Lesson entity, same block format. |
| `docs/memory-waves.md`, `docs/memory-specs.md` | `:19-29` each | EMPTY on disk ("0 total", `\| — \| — \| — \| — \|`, "*No entities…*"). Scanner must treat them as zero entities, not crash. |
| `.claude/memory-staging/2026-05-31-restored-6ca30bbc.json` | schema `memory-mcp-staging-v1` | The optional staging-file arg the scanner may also read (`entities[{name,entityType,observations[],wave?}]`). |
| `docs/MEMORY_MERGE_PROTOCOL.md` | 21 step 5; 49 "Conflicting observation strings / Future enhancement" | Step 5 is amended; line 49 note is replaced by the normative supersede rule. |
| `docs/SESSION_START.md` | 12-21 Check 1 | Where the `memory:supersede` invocation is wired in (a "Check 1b"). |
| `scripts/memory-staging-status.mjs` | 61-93 `print()` | The `memory:status` banner. We append a one-line supersede pointer to it so the check runs at session start. |
| `package.json` | 84 `"memory:status"` | Where `"memory:supersede"` is added, adjacent to the other `memory:*` scripts. |
| `hooks/session-start-digest.mjs` | 16 | The SessionStart hook runs ONLY `memory-consolidate.mjs` today. Adding the supersede call here is OPTIONAL hard-enforcement (see §4.5); the baseline wiring is the `memory:status` banner pointer. |
| `scripts/build-lineage-graph.mjs` | 101-282 `**Supersedes:**` parsing | Existing keyword precedent — but for ADR docs, a different subsystem. We borrow the WORD "supersede" for consistency; we do NOT touch this script. |
| `scripts/surface-concerns.mjs` | 411-423 `memory-entity stale` | Existing age-based nag on anti-pattern entities. Different mechanism (age, not contradiction); not modified. |

Confirmed by survey: there is **no** existing `invalid_at` / `valid_until` / `tombstone` /
supersede field in the memory schema, the staging format, or the merge protocol. The four staging
scripts (`extract`, `export-snapshot`, `restore`, `staging-status`) deal in append-only entity
blobs and are the WRONG place for this logic. The right surface is `memory-consolidate.mjs` + one
new advisory scanner.

---

## 3. What we add vs what we change

| Action | Item | Reason |
|---|---|---|
| Create | `scripts/memory-supersede-check.mjs` (zero-dep, `--self-test`) | The contradiction scanner + report. No equivalent exists. |
| Modify | `scripts/memory-consolidate.mjs` | Exclude observations carrying a `[superseded …]` marker from the Active section; render them in a `History` tail. Extend `--self-test`. |
| Modify | `package.json` | Add `"memory:supersede": "node scripts/memory-supersede-check.mjs"` near line 84. |
| Modify | `scripts/memory-staging-status.mjs` | Append a one-line "run `npm run memory:supersede`" pointer to the banner so it fires at session start. |
| Modify | `docs/SESSION_START.md` | Add Check 1b after Check 1 (line 23) invoking `memory:supersede`. |
| Modify | `docs/MEMORY_MERGE_PROTOCOL.md` | Replace the line-49 "Conflicting observation strings / Future enhancement" note with the normative supersede rule; add a 7th merge step "mark supersedes". |
| Optional | `hooks/session-start-digest.mjs` | If hard-enforcement is desired, add a guarded `memory-supersede-check.mjs --strict` call (advisory output only; never blocks). Default this wave: NOT added (banner pointer is the baseline). |

No memory observation is ever DELETED by any script in this wave. The scanner is advisory; the only
write to the actual MCP graph is a documented AGENT step in the protocol (scripts cannot call MCP).

---

## 4. Detailed design

### 4.1 The SUPERSEDE CONVENTION — the marker format

A superseded observation keeps its original text and gains a suffix marker, appended in-line:

```
<original observation text> [superseded YYYY-MM-DD by: <successor>]
```

- `YYYY-MM-DD` — the date the contradiction was confirmed (the successor's date / today).
- `<successor>` — EITHER the successor claim (a short phrase that is now true) OR a wave id
  (e.g. `wave-160`) OR a successor observation's text. Free text, but kept short (< ~80 chars).

Worked example (against the real block at `docs/memory-anti-patterns.md:39`):

```
- Prevention: run proactive-holistic-analysis 6-step protocol before any dispatch [superseded 2026-06-06 by: wave-160 replaced it with the proactive-analysis-v2 gate]
```

Properties of the marker:

- It is a SUFFIX on the existing observation line. The original text is preserved verbatim before
  the ` [superseded …]` token, so audit/lineage stays intact and string-exact dedupe (merge step 5)
  still sees the historical text.
- The marker is detected by the regex `/\s\[superseded \d{4}-\d{2}-\d{2} by: [^\]]+\]\s*$/`.
- Because the marker lives at the end of the observation string, the per-class snapshot export
  round-trips it (it is just text inside a `- ` bullet) and the restore parser reads it back.

### 4.2 What "contradicts" means — CONSERVATIVE definition

Two observations `A` (older) and `B` (newer) about the **same entity** are flagged as a candidate
contradiction when ALL of:

1. **Same subject prefix.** Each observation is split into `subject : predicate` on the FIRST colon
   (`:`). The subject is the text before the first colon, normalized (trim, collapse internal
   whitespace, lowercase). `A` and `B` must share the same normalized subject.
   - Example subjects from real data: `Prevention`, `Trigger`, `Wave origin` (anti-patterns file),
     `6-step protocol` (skills file).
   - Observations with NO colon have subject = the whole string; two no-colon observations only
     match if their full normalized text is equal (which cannot contradict — skip).
2. **Incompatible predicate.** The predicate (text after the first colon, normalized) of `A` differs
   from that of `B` — i.e. the same subject is now asserted to have a *different* value. Equal
   predicates are duplicates, not contradictions → skip. This is deliberately COARSE: any change of
   value under the same subject is a *candidate*, surfaced for confirmation, never auto-applied.
3. **`B` is not already a marker on `A`.** If `A` already carries `[superseded …]`, it is settled →
   skip. If `B` is itself a `[superseded …]` line, skip (markers don't supersede markers).

Conservatism rules (non-negotiable):

- The detector NEVER decides a contradiction is real. It prints CANDIDATES with a suggested marker.
  A human or the merge agent confirms before any marker is written.
- No fuzzy/NLP semantic matching. Same-subject + different-predicate is the entire rule. No synonym
  expansion, no embeddings, no antonym tables.
- Cross-entity comparison is OUT. Only observations under the SAME entity name are compared.

### 4.3 `scripts/memory-supersede-check.mjs` — the scanner

Zero external deps. Node built-ins only (`fs`, `path`, `url`). Pure functions + a thin CLI.

**Reads:**
- The five `docs/memory-*.md` snapshots (parses the `### \`name\`` … `**Observations**:` blocks with
  the SAME block grammar `restore-memory-from-snapshots.mjs` uses — reuse, don't reinvent).
- OPTIONALLY a staging file passed as a positional arg
  (`node scripts/memory-supersede-check.mjs .claude/memory-staging/<file>.json`): its
  `entities[].observations[]` are folded in as additional (newer) observations for the same entity
  name, so a brand-new staged fact can be detected as superseding a snapshot fact before merge.

**Writes:** nothing. Advisory only. (Consistent with `surface-concerns` / `memory:status` which
also never mutate the graph.)

**Core exported functions** (each < 40 LOC; total file ≤ ~220 LOC):

```
parseEntities(markdown) -> [{ name, type, wave, observations[] }]
  // same block grammar as restore-memory-from-snapshots.mjs:71; tolerant of empty files
  // (memory-waves.md / memory-specs.md → []).

splitSubjectPredicate(obs) -> { subject, predicate, hasColon }
  // split on first ':'; normalize(trim, collapse ws, lowercase) both sides.

isSuperseded(obs) -> boolean
  // regex /\s\[superseded \d{4}-\d{2}-\d{2} by: [^\]]+\]\s*$/.test(obs)

detectContradictions(entities, { today }) -> [
  { entity, oldObservation, newObservation, subject, suggestedMarker }
]
  // for each entity: order observations as given (snapshot order = oldest→newest; staged appended
  // last = newest). For each unordered pair (i<j) under the same entity, if same subject AND
  // different predicate AND neither already a marker → emit a candidate where oldObservation = the
  // EARLIER one (lower index), newObservation = the later one, suggestedMarker = oldObservation +
  // " [superseded <today> by: " + <successorHint> + "]" where successorHint = newObservation's
  // predicate (trimmed to ~60 chars) or its wave.

report(candidates, { strict }) -> { text, exitCode }
  // human-readable block per candidate: entity, old, new, suggestedMarker.
  // exitCode: ALWAYS 0 in default (advisory) mode. In --strict mode: 1 iff candidates.length > 0
  // (i.e. unmarked contradictions exist), else 0.
```

**CLI surface:**

```
node scripts/memory-supersede-check.mjs                       # advisory; always exit 0
node scripts/memory-supersede-check.mjs --strict              # exit 1 if unmarked contradictions
node scripts/memory-supersede-check.mjs <staging.json>        # also fold staged entities
node scripts/memory-supersede-check.mjs --json                # machine-readable candidates[]
node scripts/memory-supersede-check.mjs --self-test           # planted-fixture assertions
```

**Report shape (default mode):**

```
─────────────────────────────────────────────────────────
memory:supersede — N candidate contradiction(s) (advisory)
─────────────────────────────────────────────────────────

  entity: anti-pattern-reactive-incremental-thinking
    old: Prevention: run proactive-holistic-analysis 6-step protocol before any dispatch
    new: Prevention: run proactive-analysis-v2 gate before any dispatch
    suggest: Prevention: run proactive-holistic-analysis 6-step protocol before any dispatch [superseded 2026-06-06 by: run proactive-analysis-v2 gate before any dispatch]

0 = clean. To apply a marker: confirm, then edit the snapshot and/or mark via the MCP merge
(see docs/MEMORY_MERGE_PROTOCOL.md step 7). This script never edits memory.
```

When N = 0 it prints `✓ memory:supersede clean — 0 unmarked contradictions` and exits 0.

**`--self-test`** (canonical pattern, mirrors `memory-consolidate.mjs:123-158`): build a synthetic
`entities` array with (a) a planted same-subject/different-predicate pair → must be detected;
(b) a same-subject/same-predicate pair (duplicate) → must NOT be detected; (c) a pair already
carrying `[superseded …]` → must NOT be re-detected; (d) different-subject pair → must NOT be
detected; (e) a no-colon pair → must NOT be detected; (f) `--strict` with ≥1 candidate → exitCode 1,
clean → 0; (g) deterministic (same input → identical `JSON.stringify`). Print green/red ticks,
`process.exit(1)` on any fail.

### 4.4 `memory-consolidate.mjs` — exclude superseded from Active

The digest is built from the mistake LEDGER (episodic rows), not from graph observations — so its
rows do not naturally carry a `[superseded …]` marker. Two precise, backward-safe changes:

1. **Marker detection on the row's `real`/`claimed` text.** Add a pure helper
   `isSupersededText(s)` reusing the SAME regex as the scanner. A ledger row (or, when the digest is
   later extended to read observations, an observation) is "superseded" iff `isSupersededText(row.real)`
   (and/or `claimed`) is true. This keeps one definition of the marker across both scripts.

2. **Route superseded clusters out of Active into a History tail.** In `consolidate()`'s `.map`
   (L51-64), after computing `tier`, set `superseded = true` on the cluster when its NEWEST example
   carries the marker. In `render()`:
   - A `superseded` cluster is EXCLUDED from `## 🔴 Active`, `## 🟡 Watch`, AND `## 🟪 Decayed`.
   - It is rendered instead under a new tail section `## 🗂 History — superseded (kept for the
     record)` with icon `🗂` added to `ICON` (L86), via one extra `section('…','SUPERSEDED')`-style
     call in `render` (L116-118 region).
   - This is HIDE-from-active, KEEP-as-history — never deletion.

Self-test additions (extend the existing `rows`/`T` table, L125-152): plant one ledger row whose
`real` carries a `[superseded 2026-05-30 by: …]` marker and assert (i) it does NOT appear in the
Active/Watch/Decayed sections of the rendered output, (ii) it DOES appear under the History section,
(iii) all pre-existing assertions still pass unchanged (hot first, decay, gating, determinism).

### 4.5 Wiring — make it run at session start

Baseline (this wave): the check is surfaced at session start via the `memory:status` banner and
SESSION_START.md, mirroring how `memory:status` itself is an agent-followed instruction today.

- **`package.json`** (near line 84): add
  `"memory:supersede": "node scripts/memory-supersede-check.mjs",`
- **`scripts/memory-staging-status.mjs`** `print()` (the always-printed banner): append a final
  line so it fires every time `memory:status` runs at session start —
  `Also run: npm run memory:supersede  (flags facts a newer fact has contradicted).`
- **`docs/SESSION_START.md`** — insert directly after Check 1 (line 23):

  ```
  ## Check 1b — Superseded facts (wave-memory-validity)

  npm run memory:supersede

  Lists facts where a newer observation contradicts an older one about the same entity
  (same subject, different value). For each candidate, confirm whether the old fact is
  truly superseded; if so, mark it per MEMORY_MERGE_PROTOCOL.md step 7 before dispatching.
  Advisory (exit 0). Use --strict in CI to fail on unmarked contradictions.
  ```

Optional hard-enforcement (NOT shipped by default this wave, documented for a follow-up): add to
`hooks/session-start-digest.mjs` after line 16 a guarded
`execSync('node .../memory-supersede-check.mjs', {stdio:'ignore'})` whose advisory output is folded
into the session banner. It must NEVER block (the hook always exits 0).

### 4.6 `MEMORY_MERGE_PROTOCOL.md` — normative rule + 7th step

- **Amend step 5** (line 21) — after "add ONLY the observation strings not already present", append:
  "If a staged observation is marked `[superseded YYYY-MM-DD by: …]`, or the supersede check has
  flagged the live observation it supersedes, do NOT silently add both: perform step 7."
- **Replace the line-49 "Conflicting observation strings / Future enhancement" note** with the
  normative rule:

  > **Conflicting observation strings (validity window).** When a newer observation contradicts an
  > older one about the same entity (same subject prefix, different value — see
  > `memory:supersede`), the older observation is not deleted and the two do not silently coexist.
  > The older observation is MARKED superseded with a suffix
  > `[superseded YYYY-MM-DD by: <successor>]`, and the newer observation is added normally. Run
  > `npm run memory:supersede` to list candidates before merging.

- **Add step 7 — "Mark supersedes"** to the merge list:

  > 7. **Mark supersedes**: for each contradiction the supersede check flags (or each staged
  >    observation carrying a `[superseded …]` marker), the agent retires the old observation in the
  >    live graph by REPLACING it with its superseded-marked form — call
  >    `mcp__memory__delete_observations` for the bare old string, then `mcp__memory__add_observations`
  >    for the same string plus the `[superseded YYYY-MM-DD by: <successor>]` suffix, and add the
  >    new (successor) observation. This is the ONLY step allowed to remove an observation, it is
  >    agent-performed with user-reviewable output, and it removes ONLY to immediately re-add the
  >    marked form (no information is lost). Scripts never do this — MCP belongs to the agent
  >    context (see lines 12-13).

  Show the user the supersede summary (`+M marked superseded`) alongside the existing
  `+N entities, +M observations` summary before declaring done.

---

## 5. Acceptance criteria (EARS, executable)

| ID | Criterion (EARS) | Verification command |
|---|---|---|
| AC-1 | WHEN two observations under the same entity share a normalized subject but differ in predicate, THE scanner SHALL emit one candidate with `{entity, oldObservation, newObservation, suggestedMarker}`. | `node scripts/memory-supersede-check.mjs --self-test` |
| AC-2 | WHEN two observations under the same entity have identical subject AND predicate (duplicate), THE scanner SHALL NOT emit a candidate. | `node scripts/memory-supersede-check.mjs --self-test` |
| AC-3 | WHEN an observation already carries a `[superseded YYYY-MM-DD by: …]` marker, THE scanner SHALL NOT re-flag it. | `node scripts/memory-supersede-check.mjs --self-test` |
| AC-4 | WHEN two observations under the same entity have different subjects, THE scanner SHALL NOT emit a candidate. | `node scripts/memory-supersede-check.mjs --self-test` |
| AC-5 | The suggested marker SHALL equal `<oldObservation> [superseded <today> by: <successor>]` and match `/\s\[superseded \d{4}-\d{2}-\d{2} by: [^\]]+\]$/`. | `node scripts/memory-supersede-check.mjs --self-test` |
| AC-6 | In default mode THE scanner SHALL exit 0 regardless of candidate count. | `node scripts/memory-supersede-check.mjs; echo "exit=$?"` (expect `exit=0`) |
| AC-7 | In `--strict` mode THE scanner SHALL exit 1 IFF ≥1 unmarked contradiction exists, else 0. | `node scripts/memory-supersede-check.mjs --self-test` (asserts both) |
| AC-8 | WHEN a staging file path is passed, its `entities[].observations[]` SHALL be folded in as newer observations for matching entity names. | `node scripts/memory-supersede-check.mjs --self-test` (staged-fixture case) |
| AC-9 | THE scanner SHALL parse the real `docs/memory-*.md` blocks without crashing, treating empty files (`memory-waves.md`, `memory-specs.md`) as zero entities. | `node scripts/memory-supersede-check.mjs --json` (runs over real snapshots; valid JSON, no throw) |
| AC-10 | THE scanner output SHALL be deterministic (same input → byte-identical output). | `node scripts/memory-supersede-check.mjs --self-test` (asserts `JSON.stringify` equality) |
| AC-11 | A ledger cluster whose newest example carries a `[superseded …]` marker SHALL NOT render under Active/Watch/Decayed and SHALL render under the History tail. | `node scripts/memory-consolidate.mjs --self-test` |
| AC-12 | ALL pre-existing `memory-consolidate.mjs` self-test assertions SHALL still pass. | `node scripts/memory-consolidate.mjs --self-test` |
| AC-13 | `npm run memory:supersede` SHALL be wired and runnable. | `npm run memory:supersede --silent; echo "exit=$?"` |
| AC-14 | `npm run memory:status` banner SHALL mention `memory:supersede`. | `npm run memory:status \| grep -q "memory:supersede" && echo OK` |
| AC-15 | No script in this wave SHALL delete or overwrite any observation in any snapshot or staging file (advisory only). | `git status --porcelain docs/memory-*.md .claude/memory-staging` after a run shows no modification |
| AC-16 | Existing memory self-tests SHALL stay green. | `node scripts/memory-consolidate.mjs --self-test` (extract/restore/snapshot/status have no self-test; verify they still run with `--dry`: `node scripts/extract-retro-memory.mjs --dry`) |

---

## 6. What we are NOT doing

- **No auto-delete of memory.** The scanner never edits a snapshot, a staging file, or the graph.
  Marking is a confirmed, agent-performed MCP step; even that REMOVES only to immediately re-add the
  marked form.
- **No fuzzy / NLP contradiction detection.** Only same-entity, same-subject-prefix,
  different-predicate. No embeddings, synonyms, antonyms, or semantic models.
- **No MCP calls from scripts.** Scripts cannot call `mcp__memory__*`. The deterministic/testable
  surface is the snapshot markdown, staging JSON, the ledger, and the consolidate digest; the actual
  graph marking is a documented AGENT step (§4.6 step 7).
- **No new score / tier math** in `memory-consolidate.mjs`. Supersede is a boolean route-out, not a
  weight change; the existing `scoreCluster`/`tierOf`/HALF_LIFE logic is untouched.
- **No second copy of memory logic.** The exclusion lands inside the existing
  `memory-consolidate.mjs`; the four staging scripts are not touched.
- **No change to the `memory-mcp-staging-v1` schema** or the snapshot block grammar — the marker is
  plain suffix text inside an existing observation string, so export/restore round-trip it for free.
- **No hard SessionStart block by default.** Baseline wiring is advisory (banner + SESSION_START.md);
  the hook hard-enforcement is documented as an optional follow-up only.

---

## 7. Backward compatibility

- `memory-consolidate.mjs`: the History routing only triggers on the new marker; ledgers with no
  marker (every current row) render exactly as today. All nine existing self-test assertions stay
  unchanged. The new section appears only when a superseded cluster exists.
- `memory:status` / `extract` / `restore` / `snapshot`: untouched logic; only the status BANNER gains
  one informational line. Their behavior and exit codes are unchanged.
- Snapshot files and staging JSON: byte-unchanged by any script run (AC-15). The marker, when an
  agent eventually writes one, is valid existing-format text (a longer bullet line), so the restore
  parser and snapshot export already handle it with no code change.
- The merge protocol stays additive-by-default; step 7 is the single, agent-gated, reviewable place
  where an old observation is retired — and it loses no information.

---

## 8. LOC budgets + file size targets

| File | Action | Budget |
|---|---|---|
| `scripts/memory-supersede-check.mjs` | new | ≤ 220 LOC total; each function ≤ 40 LOC; zero non-builtin deps |
| `scripts/memory-consolidate.mjs` | modify | 176 → ≤ 215 LOC (adds `isSupersededText`, the `superseded` flag in `.map`, one `ICON` entry, one render section, self-test rows). Stays well under the 400-LOC limit. |
| `scripts/memory-staging-status.mjs` | modify | +1 banner line (~93 → ~95 LOC) |
| `package.json` | modify | +1 script line |
| `docs/SESSION_START.md` | modify | +~12 lines (Check 1b) |
| `docs/MEMORY_MERGE_PROTOCOL.md` | modify | amend step 5, replace line-49 note, add step 7 (~+18 lines net) |

---

## 9. Open questions (for implementer, not blocking spec)

1. **Snapshot order = age order?** The design treats earlier-listed observations in a snapshot block
   as older. Confirm the export writer preserves chronological order; if not, fall back to: staged
   observations (passed via the file arg) are always "newer" than snapshot observations, and within a
   single snapshot, flag the pair as a candidate WITHOUT asserting which is older (let the human pick
   the successor). This keeps the conservatism guarantee either way.
2. **Subject granularity.** First-colon split gives subjects like `Prevention` / `Trigger`. If real
   data shows that is too coarse (everything is `Prevention:`), consider keying the subject on the
   first N words instead — decide from a dry run over the real snapshots, not up front.
3. **`--strict` in CI.** Whether to add `memory:supersede --strict` to a pre-publish gate is a
   follow-up policy call; this wave ships it as a flag, not a wired gate.
