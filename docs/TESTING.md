# Testing Strategy

> When, what, and how to test in this project frontend

**Last updated:** 2026-03-07

---

## Stack

| Tool | Purpose |
|------|---------|
| **Vitest** | Test runner (fast, Vite-native) |
| **React Testing Library** | Component rendering and interaction |
| **jsdom** | DOM environment for tests |
| **@testing-library/jest-dom** | Custom matchers (`toBeInTheDocument`, etc.) |

---

## When to Write Tests

### Always Test

| What | Why | Example |
|------|-----|---------|
| Validation logic | Business-critical, pure functions | `leadValidator.ts` |
| Data transformations | Must be correct | `pipeline-adapter.ts` |
| Store actions | State changes must be predictable | `pipelineStore.ts` |
| Utility functions | Reused across components | `cn()`, date formatters |
| Complex conditional rendering | Easy to break | Role-based UI, status-dependent content |

### Don't Test

| What | Why |
|------|-----|
| Static JSX rendering | Low value, high maintenance |
| Tailwind class names | Not behavior |
| Third-party library internals | Not our code |
| Simple pass-through components | No logic to test |
| CSS/visual appearance | Use visual regression tools instead |

---

## Test Types

### Unit Tests (primary)

Test pure functions and store logic in isolation.

```typescript
// lib/validation/__tests__/leadValidator.test.ts
import { describe, it, expect } from "vitest";
import { isDisposableEmail, isFakeName } from "../leadValidator";

describe("leadValidator", () => {
  describe("isDisposableEmail", () => {
    it("detects disposable email domains", () => {
      expect(isDisposableEmail("user@guerrillamail.com")).toBe(true);
      expect(isDisposableEmail("user@tempmail.com")).toBe(true);
    });

    it("allows legitimate emails", () => {
      expect(isDisposableEmail("user@gmail.com")).toBe(false);
      expect(isDisposableEmail("user@company.com")).toBe(false);
    });
  });

  describe("isFakeName", () => {
    it("detects test names", () => {
      expect(isFakeName("test")).toBe(true);
      expect(isFakeName("Test User")).toBe(true);
      expect(isFakeName("admin")).toBe(true);
    });

    it("allows real names", () => {
      expect(isFakeName("John Smith")).toBe(false);
    });
  });
});
```

### Store Tests

Test Zustand store actions and state transitions.

```typescript
// lib/store/__tests__/pipelineStore.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePipelineStore } from "../pipelineStore";

// Mock apiClient
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    pipeline: {
      deals: vi.fn(),
    },
  },
}));

describe("pipelineStore", () => {
  beforeEach(() => {
    // Reset store between tests
    usePipelineStore.setState({
      deals: {},
      loading: false,
      error: null,
    });
  });

  it("sets loading state during fetch", async () => {
    const store = usePipelineStore.getState();
    const fetchPromise = store.fetchDeals();

    expect(usePipelineStore.getState().loading).toBe(true);

    await fetchPromise;

    expect(usePipelineStore.getState().loading).toBe(false);
  });
});
```

### Component Tests (selective)

Test components with meaningful logic — not simple display.

```typescript
// components/pipeline/__tests__/DealCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DealCard } from "../DealCard";

const mockDeal = {
  id: "1",
  title: "New HVAC Install",
  value: 5000,
  stageId: "new",
  // ...
};

describe("DealCard", () => {
  it("renders deal title and value", () => {
    render(<DealCard deal={mockDeal} onSelect={() => {}} />);

    expect(screen.getByText("New HVAC Install")).toBeInTheDocument();
    expect(screen.getByText("$5,000")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<DealCard deal={mockDeal} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("New HVAC Install"));

    expect(onSelect).toHaveBeenCalledWith("1");
  });
});
```

---

## File Organization

Tests live next to the code they test:

```
lib/
  validation/
    leadValidator.ts
    __tests__/
      leadValidator.test.ts
  store/
    pipelineStore.ts
    __tests__/
      pipelineStore.test.ts
  api/
    pipeline-adapter.ts
    __tests__/
      pipeline-adapter.test.ts
components/
  pipeline/
    DealCard.tsx
    __tests__/
      DealCard.test.tsx
```

### Naming

- Test files: `{source}.test.ts` or `{source}.test.tsx`
- Test folders: `__tests__/` inside the module directory
- Mock files: `__mocks__/` if needed

---

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode (development)
npm test -- --watch

# Run specific file
npm test -- leadValidator

# Run with coverage
npm test -- --coverage

# Run once (CI mode)
npm test -- --run
```

---

## Mocking

### API Client

```typescript
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    leads: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: "1", title: "Test" }),
    },
  },
}));
```

### localStorage

```typescript
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, "localStorage", { value: localStorageMock });
```

### Router

```typescript
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/dashboard",
}));
```

---

## Coverage Targets

| Category | Target | Current |
|----------|--------|---------|
| Validation functions | 90%+ | — |
| Data transformers | 90%+ | — |
| Store actions | 70%+ | — |
| Utility functions | 90%+ | — |
| Components (with logic) | 50%+ | — |
| Overall | 60%+ | — |

### Priority for Coverage

1. **Validation** (`lib/validation/`) — highest priority, business-critical
2. **API adapter** (`lib/api/pipeline-adapter.ts`) — data integrity
3. **Store actions** (`lib/store/`) — state correctness
4. **Utils** (`lib/utils/`) — shared logic
5. **Components** — only those with conditional logic

---

## Test Quality Rules

1. **Test behavior, not implementation** — test what the user sees/does
2. **One assertion per concept** — not per test, but per logical check
3. **No testing implementation details** — don't test internal state, test outputs
4. **Use realistic data** — mocks should resemble real backend responses
5. **Tests must be deterministic** — no random data, no time-dependent tests
6. **Each test is independent** — reset state in `beforeEach`
7. **Name tests clearly** — describe what happens, not how

```typescript
// GOOD test names
it("detects disposable email domains")
it("redirects to login when token is expired")
it("shows error message when API call fails")

// BAD test names
it("works correctly")
it("test1")
it("should handle the thing")
```

---

## E2E Tests (Future)

### Recommended: Playwright

```bash
npm install --save-dev @playwright/test
```

### Critical Flows to Cover

| Flow | Priority |
|------|----------|
| Login (email + Google) | P0 |
| Dashboard loads | P0 |
| Create/move deal | P1 |
| Send message | P1 |
| Connect integration | P2 |
| Settings update | P2 |

### Example

```typescript
// e2e/login.spec.ts
import { test, expect } from "@playwright/test";

test("user can login with email", async ({ page }) => {
  await page.goto("/login");
  await page.fill('[type="email"]', "test@example.com");
  await page.fill('[type="password"]', "password123");
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL("/dashboard");
  await expect(page.locator("h1")).toContainText("Mission Control");
});
```

---

## Checklist

### Before Writing Tests

- [ ] Identify what behavior to test (not implementation)
- [ ] Check if similar test exists
- [ ] Mock external dependencies (API, router, storage)

### Before Committing

- [ ] All tests pass: `npm test -- --run`
- [ ] No skipped tests without comment explaining why
- [ ] New logic has corresponding tests
- [ ] Tests run in < 30 seconds total
