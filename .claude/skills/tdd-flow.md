# Skill: TDD flow — red-green-refactor before frontend-agent touches code

> Wave: wave-102  |  Status: experimental  |  Tags: [tdd, testing, process, quality-gate]

---

## When to use

- Any wave where the chief-architect spec contains ACs with testable observable outcomes (validation logic, data transformers, store actions, API response handling).
- Before frontend-agent begins implementation — test stubs must be committed first.
- When a test fails post-impl and it is unclear whether the test or the code is wrong.
- When coverage-auditor reports a BLOCK (coverage dropped > 5%) — gap-close starts here.

---

## Implementation guide

### Step 1 — Read ACs and identify testable outcomes

Open `docs/specs/<wave-id>_MASTER_SPEC.md §6`. For each AC:
- Classify: unit-testable, component-testable, visual-only (skip), E2E-only (skip)
- Map each testable AC to a specific function, hook, or store action in the implementation target

### Step 2 — Write the red test (failing stub)

Create the test file before any implementation exists. Use `it.todo()` stubs initially:

```typescript
import { describe, it, expect } from 'vitest';

describe('leadValidator', () => {
  // AC-A1: validates email format returns true for valid email
  it.todo('returns true for a valid email address');

  // AC-A1: validates email format returns false for malformed input
  it.todo('returns false for "user@" (missing domain)');

  // AC-A2 guard: if input is undefined, returns false without throwing
  it.todo('handles undefined input gracefully');
});
```

Commit the stubs BEFORE implementation: `test(leadValidator): stub tests for wave-NN T.1`
Signal: "Test stubs committed. frontend-agent may begin."

### Step 3 — Implement until green (frontend-agent's turn)

frontend-agent writes the implementation. Stubs go from `it.todo()` to real assertions.

Real assertion pattern (per `docs/CODING_STANDARDS.md §Testing`):

```typescript
import { describe, it, expect } from 'vitest';
import { validateEmail } from '@/lib/validators/leadValidator';

describe('leadValidator', () => {
  it('returns true for a valid email address', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('returns false for "user@" (missing domain)', () => {
    expect(validateEmail('user@')).toBe(false);
  });

  it('handles undefined input gracefully', () => {
    expect(validateEmail(undefined as unknown as string)).toBe(false);
  });
});
```

### Step 4 — Refactor if needed (green → clean)

Only refactor after all tests pass. Refactoring must not change observable behavior — tests must still pass after refactor. If a test breaks during refactor, stop and check whether you changed behavior or just style.

---

## Anti-patterns / gotchas

- **Tests written after implementation**: the classic anti-pattern. Tests written after green tend to be tautological (they test what the code does, not what it should do). Write stubs first, even if they are `it.todo()`.
- **Skipping the red phase**: if you never saw the test fail, you have not verified it can detect a real bug. Run `npx vitest run <test-file>` on the stub before impl to confirm it fails.
- **Asserting implementation details**: test the contract (what goes in, what comes out), not internals (which internal function was called, what the intermediate variable was).
- **Over-stubbing**: `it.todo()` is for "I know I need this test but impl does not exist yet." Do not use `it.todo()` permanently. If a test stays todo for > 1 wave, it is a coverage gap.

---

## Example references

| What | File | Lines |
|------|------|-------|
| Vitest config (globals, jsdom, setup) | `vitest.config.ts` | L1-L18 |
| Example test structure | `tests/` or `__tests__/` | existing test files |
| Coverage config | `vitest.config.ts` | coverage block (wave-102 T.16) |

---

## Wave history

First applied in wave-102 (quality agency expansion — TDD mandate introduction).
