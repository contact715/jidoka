# Memory MCP merge protocol

How an agent merges `.claude/memory-staging/*.json` files into the live memory MCP graph. Shipped in wave-35; auto-detection added in wave-35b.

## When to merge

At session start. The CLAUDE.md session-start block tells you to run `npm run memory:status` before any wave work. If that command reports unmerged files, do the merge first.

You can also merge any time after running `npm run memory:extract` (wave-35). The extractor walks `docs/retros/` and writes a staging snapshot; the merge step is what gets the new observations into the live graph.

## Why scripts can't do this

The memory MCP tools (`mcp__memory__create_entities`, `mcp__memory__add_observations`, `mcp__memory__create_relations`, `mcp__memory__read_graph`) belong to a Claude agent's context. A bash or node script cannot call them. The extractor stages candidates; the agent does the merge with user-reviewable steps.

## The 7-step merge

1. **List staging files**: `npm run memory:status` or `ls .claude/memory-staging/*.json`.
2. **Read the newest file**: highest date-suffix wins, older files are historical.
3. **Read the live graph**: call `mcp__memory__read_graph()`. Get current entity names + observations.
4. **Diff entities**: for each entity in staging not in the live graph, call `mcp__memory__create_entities([entity])`. Preserve the observations array; the staging format already prefixes each observation with a category tag like `[pattern]`, `[gap]`, `[lesson]`.
5. **Diff observations**: for entities that exist in both, call `mcp__memory__add_observations` with ONLY the observation strings not already present. Compare string-exact (no fuzzy match this version). If a staged observation is marked `[superseded YYYY-MM-DD by: …]`, or the supersede check has flagged the live observation it supersedes, do NOT silently add both — perform step 7.
   - **5.5 Consolidate a superset (W29-R4).** Before adding a staged shared observation that overlaps an existing one, run it past `memory-guard.judgeMemoryWrite`. When it returns `merge: true` with `mergeInto: "<title>"`, the staged record is a *richer superset* of the existing memory — neither append it (bloat: two near-duplicate rows) nor drop it (lossy: the extra information is thrown away). Instead REWRITE the named existing observation into the consolidated superset: `mcp__memory__delete_observations` for the old string, then `mcp__memory__add_observations` for the merged text. This is an edit-in-context with a user-reviewable diff, in the same spirit as step 7 — show the before/after before declaring done. A plain near-duplicate (no new content) stays blocked as before; only a superset triggers the merge.
6. **Diff relations**: for each relation in staging, only create it if BOTH `from` and `to` entities exist in the live graph after step 4. Skip orphans. Call `mcp__memory__create_relations`.
7. **Mark supersedes**: for each contradiction the supersede check flags (or each staged observation carrying a `[superseded …]` marker), the agent retires the old observation in the live graph by REPLACING it with its superseded-marked form — call `mcp__memory__delete_observations` for the bare old string, then `mcp__memory__add_observations` for the same string plus the `[superseded YYYY-MM-DD by: <successor>]` suffix, and add the new (successor) observation. This is the ONLY step allowed to remove an observation, it is agent-performed with user-reviewable output, and it removes ONLY to immediately re-add the marked form (no information is lost). Scripts never do this — MCP belongs to the agent context (see lines 12-13).

Show the user the merge summary (`+N entities, +M observations, +K relations`, plus `+M marked superseded`) before declaring done. Optionally `rm` the staging file after a successful merge — `.claude/` is gitignored so this is local cleanup, not a git operation.

## Observation category tags

Each staging observation is prefixed with one of:

- `[meta]` — wave title, date, source path. Always included.
- `[pattern]` — what repeats across waves. Highest-leverage memory.
- `[gap]` — known limits, honest gaps, residual work.
- `[decision]` — picked X over Y with reasoning.
- `[lesson]` — root-cause distilled.
- `[anti-pattern]` — bash bugs, recurring mistakes.
- `[rationale]` — strategic framing.
- `[followup]` — out-of-scope backlog signal.

Preserve the tags on merge. They become searchable categories in the live graph.

## Edge cases

**Re-running extract with no retro changes** — writes a new staging file with a different timestamp but the same content hash in the filename. The merge step's diff against the live graph will produce zero new entities, which is the correct no-op.

**Two staging files for the same wave** — the newer file's observations are a superset; merging both is safe because step 5 dedupes by string-exact compare. If older observations were edited (rare), the live graph keeps both versions. Manual cleanup via `mcp__memory__delete_observations` if needed.

**A retro was renamed or deleted** — the extracted wave entity stays in the live graph; the merge protocol never deletes anything. To remove a stale wave entity, use `mcp__memory__delete_entities` directly.

**Conflicting observation strings (validity window).** When a newer observation contradicts an older one about the same entity (same subject prefix, different value — see `npm run memory:supersede`), the older observation is not deleted and the two do not silently coexist. The older observation is MARKED superseded with a suffix `[superseded YYYY-MM-DD by: <successor>]`, and the newer observation is added normally. Run `npm run memory:supersede` to list candidates before merging, then apply step 7.

## Audit trail

After a merge, the live graph carries enough metadata to trace each observation back to its source retro: every entity's first observation is `[meta] source: docs/retros/wave-NN.md`. Future agent sessions can verify the origin by reading the source path.

## 7. Per-class restore (wave-151)

### When to run

On a fresh machine after `git pull`, before running `npm run memory:status`. Use this when the `.claude/memory-staging/` directory is empty or absent and the live MCP graph needs to be reconstructed.

### Command

```bash
npm run memory:restore
```

### What it does

Reads all five per-class snapshot files in `docs/`:
- `docs/memory-anti-patterns.md` (AntiPattern entities)
- `docs/memory-waves.md` (wave entities)
- `docs/memory-specs.md` (Spec entities)
- `docs/memory-skills.md` (Skill entities)
- `docs/memory-lessons.md` (Lesson entities)

Parses entity blocks (name, type, observations, wave), then writes a single consolidated staging JSON to `.claude/memory-staging/<date>-restored-<hash>.json` following the `memory-mcp-staging-v1` schema.

### After restore

Run `npm run memory:status` to confirm the staging file is detected, then follow the standard 7-step merge above.

### Conflict tiebreaker: graph-wins

If an observation exists in both the snapshot and the live MCP graph with different text (for example, an observation was manually edited in MCP after the last snapshot export), the live graph observation is preserved. The staging merge step 5 string-exact-dedupes — it adds only observations not already present. No existing live graph observation is overwritten by the restore flow.

### MCP constraint

`restore-memory-from-snapshots.mjs` never calls MCP tools directly. All MCP writes occur only via the 7-step merge with agent oversight per this protocol (see lines 12-13 above — scripts cannot call MCP tools; only a Claude agent context can).
