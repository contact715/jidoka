# Skill: Test failure triage — three-class root cause before any fix

> Wave: wave-102  |  Status: experimental  |  Tags: [debugging, testing, triage, process, quality-gate]

---

## When to use

- Any time test-runner emits TEST_FAIL.
- Any time a Vitest or Playwright test fails in CI or post-commit.
- Before debug-agent applies any auto-fix — triage determines who owns the fix.
- When a "passing" test suite suddenly fails after a refactor and the cause is unclear.

---

## Implementation guide

### Step 1 — Read the failure trace without interpreting it

Read the full error output. Do not assume you know the root cause yet. Copy the first 3 lines of the error into a scratch note.

Example raw failure:
```
AssertionError: expected false to equal true
  at leadValidator.test.ts:8:31
```

### Step 2 — Three-class triage

Classify the failure as exactly ONE of:

**Class 1 — Test bug**
The test is wrong. The assertion does not match the spec AC, the mock is incorrect, or the test was written for old behavior.
- Symptom: assertion contradicts the AC wording in `docs/specs/<wave-id>_MASTER_SPEC.md §6`
- Owner: test-engineer fixes the test, not the implementation
- Action: update assertion to match AC, re-run

**Class 2 — Implementation bug**
The code is wrong. The test assertion correctly captures the AC, but the implementation does not satisfy it.
- Symptom: test assertion matches spec AC word-for-word; implementation output differs
- Owner: frontend-agent fixes the implementation
- Action: escalate to frontend-agent with annotated failure

**Class 3 — Environment bug**
Neither the test nor the code is wrong. A missing mock, incorrect setup file, import alias, or environment variable causes the failure.
- Symptom: test passes locally but fails in CI; or error is an import error, "Cannot find module", or undefined mock
- Owner: debug-agent or test-engineer fixes the environment
- Action: check `tests/setup.ts`, check module aliases in `vitest.config.ts`, check if a test-specific mock is missing

### Step 3 — Decision rule

```
Read AC wording from spec.
Does the test assertion match the AC word-for-word?
  YES → Class 2 (impl bug) — escalate to frontend-agent
  NO  → Does the assertion contradict the AC?
          YES → Class 1 (test bug) — fix the test
          NO  → Class 3 (env bug) — fix the environment
```

### Step 4 — Annotate and route

For Class 2 (impl bug), add a comment before escalating:

```
TRIAGE: IMPL BUG
Failure: tests/validators/leadValidator.test.ts:8 — expects validateEmail('user@') to return false
AC-A1 says: "validates email format returns false for malformed input"
Test assertion matches AC. Implementation returned true for 'user@'.
Escalating to frontend-agent: fix lib/validators/leadValidator.ts.
```

For Class 1 (test bug):

```
TRIAGE: TEST BUG
Failure: tests/validators/leadValidator.test.ts:12 — expects result to be string, but AC says boolean
AC-A1 says "returns true for valid email" — return type is boolean, not string.
Fixing test assertion: change expect(result).toBe('valid') to expect(result).toBe(true).
```

---

## Anti-patterns / gotchas

- **Immediately fixing the code**: the most common mistake. Read the AC first. You may be fixing the wrong thing.
- **Assuming "test passes locally" means the test is correct**: local environment may mask a real bug. Run with `--no-cache` and compare.
- **Mixing class 1 and class 2 in one PR**: if both the test and the code need fixes, separate them into two commits so the history is clear.
- **Skipping triage on "obvious" failures**: the obvious fix is often wrong. Spend 2 minutes on triage before touching anything.

---

## Example references

| What | File | Lines |
|------|------|-------|
| Vitest setup | `tests/setup.ts` | full file |
| Test config (aliases, env) | `vitest.config.ts` | L1-L18 |
| Debug agent triage protocol | `.claude/agents/debug-agent.md` | Decision rights section |

---

## Wave history

First applied in wave-102 (quality agency expansion — debug-agent triage runbook).
