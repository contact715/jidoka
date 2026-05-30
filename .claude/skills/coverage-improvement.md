# Skill: Coverage improvement — close gap files identified by lcov delta

> Wave: wave-102  |  Status: experimental  |  Tags: [coverage, testing, quality-gate, lcov]

---

## When to use

- coverage-auditor emits BLOCK (any file dropped > 5% vs baseline).
- coverage-auditor emits WARN (any file dropped 2-5%) — prevent it from becoming a BLOCK.
- A new utility, transformer, or store action was added without tests.
- A refactor touched a file and its coverage dropped because old tests no longer exercise the new code paths.

---

## Implementation guide

### Step 1 — Identify the gap files from lcov output

Read `coverage/lcov.info` or the coverage-delta table. Find lines marked `[FAIL]` or `[WARN]`:

```
[FAIL] lib/utils/phoneFormat.ts: baseline 80% → current 74% (-6%)
```

### Step 2 — Open the lcov detail for that file

Run:
```bash
npx vitest run --coverage --reporter=verbose
```

Or inspect `coverage/lcov.info` for the specific file. Look for lines starting with `DA:<lineno>,0` — these are uncovered lines.

lcov line format:
```
DA:23,0   ← line 23, hit 0 times (not covered)
DA:24,1   ← line 24, hit 1 time (covered)
```

### Step 3 — Focus on high-value uncovered patterns

Priority order for gap closure:

1. **Guard clauses** — `if (x === null) return false;` — these are cheap to test and catch real bugs
2. **Error branches** — `catch (err) { return null; }` — often 0% because happy-path tests never throw
3. **Empty-state renders** — a component rendering `<EmptyState />` when data is `[]` — test with empty mock
4. **Edge case inputs** — `undefined`, `''`, `0`, `NaN` — one test per guard clause

### Step 4 — Write the gap-closing test

Target the specific uncovered line numbers. Example for a guard clause at line 23:

```typescript
// lib/utils/phoneFormat.ts:23 — guard: returns '' for null input
it('returns empty string for null input', () => {
  expect(formatPhone(null as unknown as string)).toBe('');
});

// lib/utils/phoneFormat.ts:31 — error branch: catches malformed input
it('returns empty string on parse error', () => {
  expect(formatPhone('not-a-phone')).toBe('');
});
```

### Step 5 — Re-run coverage to verify closure

```bash
npx vitest run --coverage
node scripts/coverage-delta.mjs
```

Confirm the file moves from `[FAIL]` or `[WARN]` to `[OK]`.

### Step 6 — Update baseline after intentional drop

If coverage dropped because of an intentional refactor (e.g., moved code to a new file with its own tests), update the baseline:

```bash
node scripts/coverage-delta.mjs --update
```

This writes the current state as the new baseline. Only do this after confirming the drop is intentional and all gap files have meaningful coverage.

---

## Anti-patterns / gotchas

- **Coverage theater**: adding tests that just call the function without asserting anything — `expect(fn()).toBeTruthy()`. This hides real bugs. Write assertions that would catch a real failure.
- **Chasing 100%**: 100% line coverage does not mean 100% correctness. Focus on the branches that carry business logic, not trivial accessors.
- **Updating baseline to hide a drop**: only update the baseline when you understand why coverage dropped. Running `--update` without investigation hides regressions.
- **Writing tests for generated or type-only files**: `*.d.ts` files and generated API clients are excluded in `vitest.config.ts` coverage excludes. Do not write tests for them.

---

## Example references

| What | File | Lines |
|------|------|-------|
| Coverage config | `vitest.config.ts` | coverage block (wave-102 T.16) |
| Baseline file | `docs/metrics/coverage-baseline.json` | full file |
| Delta script | `scripts/coverage-delta.mjs` | full file |

---

## Wave history

First applied in wave-102 (quality agency expansion — coverage-auditor gate introduction).
