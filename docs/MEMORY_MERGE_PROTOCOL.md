# Memory MCP merge protocol

How an agent merges `.claude/memory-staging/*.json` files into the live memory MCP graph. Shipped in wave-35; auto-detection added in wave-35b.

## When to merge

At session start. The CLAUDE.md session-start block tells you to run `npm run memory:status` before any wave work. If that command reports unmerged files, do the merge first.

You can also merge any time after running `npm run memory:extract` (wave-35). The extractor walks `docs/retros/` and writes a staging snapshot; the merge step is what gets the new observations into the live graph.

## Why scripts can't do this

The memory MCP tools (`mcp__memory__create_entities`, `mcp__memory__add_observations`, `mcp__memory__create_relations`, `mcp__memory__read_graph`) belong to a Claude agent's context. A bash or node script cannot call them. The extractor stages candidates; the agent does the merge with user-reviewable steps.

## The 6-step merge

1. **List staging files**: `npm run memory:status` or `ls .claude/memory-staging/*.json`.
2. **Read the newest file**: highest date-suffix wins, older files are historical.
3. **Read the live graph**: call `mcp__memory__read_graph()`. Get current entity names + observations.
4. **Diff entities**: for each entity in staging not in the live graph, call `mcp__memory__create_entities([entity])`. Preserve the observations array; the staging format already prefixes each observation with a category tag like `[pattern]`, `[gap]`, `[lesson]`.
5. **Diff observations**: for entities that exist in both, call `mcp__memory__add_observations` with ONLY the observation strings not already present. Compare string-exact (no fuzzy match this version).
6. **Diff relations**: for each relation in staging, only create it if BOTH `from` and `to` entities exist in the live graph after step 4. Skip orphans. Call `mcp__memory__create_relations`.

Show the user the merge summary (`+N entities, +M observations, +K relations`) before declaring done. Optionally `rm` the staging file after a successful merge — `.claude/` is gitignored so this is local cleanup, not a git operation.

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

**Conflicting observation strings** — string-exact compare means "Pattern observed: dual-architect works" and "Pattern observed: Dual-architect works" are treated as different observations. Future enhancement: normalize whitespace + casing before compare.

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

Run `npm run memory:status` to confirm the staging file is detected, then follow the standard 6-step merge above.

### Conflict tiebreaker: graph-wins

If an observation exists in both the snapshot and the live MCP graph with different text (for example, an observation was manually edited in MCP after the last snapshot export), the live graph observation is preserved. The staging merge step 5 string-exact-dedupes — it adds only observations not already present. No existing live graph observation is overwritten by the restore flow.

### MCP constraint

`restore-memory-from-snapshots.mjs` never calls MCP tools directly. All MCP writes occur only via the 6-step merge with agent oversight per this protocol (see lines 12-13 above — scripts cannot call MCP tools; only a Claude agent context can).
