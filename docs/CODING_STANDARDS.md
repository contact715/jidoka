# Coding Standards

> Frontend engineering conventions for this project

**Last updated:** 2026-03-07

---

## Table of Contents

1. [File Naming](#file-naming)
2. [Component Structure](#component-structure)
3. [TypeScript Rules](#typescript-rules)
4. [Import Order](#import-order)
5. [State Management](#state-management)
6. [Error Handling](#error-handling)
7. [Performance](#performance)
8. [Styling](#styling)
9. [Testing](#testing)
10. [Git Workflow](#git-workflow)
11. [Completion Audit](#completion-audit)
12. [Anti-Pattern Catalog](#anti-pattern-catalog)

---

## File Naming

| Category | Convention | Example |
|----------|-----------|---------|
| Components | `PascalCase.tsx` | `DealDetailPanel.tsx` |
| Pages | `page.tsx` (Next.js convention) | `app/dashboard/page.tsx` |
| Layouts | `layout.tsx` | `app/(dashboard)/layout.tsx` |
| Hooks | `use{Name}.ts` | `useWebSocket.ts` |
| Stores | `{domain}Store.ts` | `pipelineStore.ts` |
| Types | `{domain}.ts` | `pipeline.ts`, `agents.ts` |
| Utilities | `camelCase.ts` | `leadValidator.ts` |
| Constants | `camelCase.ts` or `kebab-case.ts` | `z-index.ts` |

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase | `DealDetailPanel`, `MessageBubble` |
| Hooks | camelCase with `use` prefix | `useWebSocket`, `useAuth` |
| Store hooks | camelCase with `use` prefix + `Store` | `usePipelineStore` |
| Functions | camelCase | `handleSubmit`, `formatDate` |
| Constants | UPPER_SNAKE_CASE | `MOCK_PIPELINES`, `STAGE_COLORS` |
| Types/Interfaces | PascalCase | `Deal`, `AgentProfile`, `ChatMessage` |
| Type unions | PascalCase | `Platform`, `ViewMode`, `TaskType` |
| Boolean props | `is`/`has`/`show` prefix | `isLoading`, `hasError`, `showModal` |
| Event handlers | `handle` prefix | `handleClick`, `handleSubmit` |
| Callbacks (props) | `on` prefix | `onClose`, `onChange`, `onSelect` |

---

## Component Structure

Every component follows this order:

```tsx
"use client"; // 1. Directive (if needed)

// 2. Imports (see Import Order below)
import { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { usePipelineStore } from "@/lib/store/pipelineStore";
import type { Deal } from "@/lib/types/pipeline";

// 3. Types (component-local)
interface DealCardProps {
  deal: Deal;
  onSelect: (id: string) => void;
}

// 4. Helper functions (pure, no hooks)
function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

// 5. Component
export function DealCard({ deal, onSelect }: DealCardProps) {
  // 5a. Store selectors
  const updateDeal = usePipelineStore((s) => s.updateDeal);

  // 5b. Local state
  const [isExpanded, setIsExpanded] = useState(false);

  // 5c. Derived state (useMemo)
  const formattedValue = useMemo(() => formatCurrency(deal.value), [deal.value]);

  // 5d. Effects (useEffect)
  // ...

  // 5e. Callbacks (useCallback)
  const handleClick = useCallback(() => {
    onSelect(deal.id);
  }, [deal.id, onSelect]);

  // 5f. Event handlers (plain functions)
  const handleExpand = () => setIsExpanded(!isExpanded);

  // 5g. JSX
  return (
    <div onClick={handleClick}>
      {/* ... */}
    </div>
  );
}
```

### Rules

1. **Named exports only** — no `export default`
2. **One component per file** — small helper components in the same file are okay
3. **"use client"** required for: hooks, state, event handlers, browser APIs
4. **Props interface** defined in the same file, not exported unless shared
5. **No business logic in JSX** — extract to handlers or derived state

---

## TypeScript Rules

### Strict Mode

`tsconfig.json` has `strict: true`. This means:

- No implicit `any`
- Strict null checks
- Strict function types

### Rules

```typescript
// CORRECT — explicit types
const items: Deal[] = [];
const loading: boolean = false;
async function fetchDeals(): Promise<void> { }

// WRONG — implicit any
const items = [];                    // any[]
function process(data) { }          // parameter 'data' has implicit 'any'
```

### `as any` Policy

**Never use `as any`** in new code. Existing `as any` should be replaced:

```typescript
// WRONG
{...(props as any)}

// CORRECT — narrow the type
const inputProps = props as React.InputHTMLAttributes<HTMLInputElement>;
{...inputProps}
```

### Type File Structure

```typescript
// lib/types/pipeline.ts

// Primitive unions at the top
export type StageId = "new" | "contact" | "qualified" | "offer" | "won" | "lost";
export type LeadGrade = "A" | "B" | "C" | "D";

// Interfaces for data shapes
export interface Deal {
  id: string;
  title: string;
  value: number;
  stageId: StageId;
  grade: LeadGrade;
  // ...
}

// Complex types at the bottom
export interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
  deals: Record<string, Deal[]>;
}
```

### Backend Data Types

Backend returns snake_case. Type both shapes when needed:

```typescript
// Raw backend shape (only in adapter files)
interface BackendDeal {
  contact_name: string;
  contact_phone: string;
  expected_close_date: string;
}

// Frontend shape (used everywhere else)
interface Deal {
  contactName: string;
  contactPhone: string;
  expectedCloseDate: string;
}
```

---

## Import Order

Imports are grouped with blank lines between groups:

```typescript
// 1. React / Next.js
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import dynamic from "next/dynamic";

// 2. Third-party libraries
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

// 3. Icons (separate from other libraries)
import { ChevronRight, Phone, Mail } from "lucide-react";

// 4. Internal utilities and hooks
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api/client";
import { useWebSocket } from "@/lib/hooks/useWebSocket";

// 5. Stores
import { usePipelineStore } from "@/lib/store/pipelineStore";

// 6. Components
import { DealCard } from "@/components/pipeline/DealCard";

// 7. Types (always last, always with `type` keyword)
import type { Deal, Pipeline } from "@/lib/types/pipeline";
```

---

## State Management

### When to Use What

| Scenario | Solution |
|----------|----------|
| Global app state (deals, conversations) | Zustand store |
| Component-local UI state (open/close, input value) | `useState` |
| Derived from props or state | `useMemo` |
| Shared across sibling components | Lift state up or Zustand |
| Form state | `useState` or `react-hook-form` |

### Zustand Selector Rule

```typescript
// ALWAYS use individual selectors
const deals = usePipelineStore((s) => s.deals);
const fetchDeals = usePipelineStore((s) => s.fetchDeals);

// NEVER destructure the entire store
const { deals, fetchDeals } = usePipelineStore(); // ← re-renders on ANY change
```

### Store Action Pattern

```typescript
// Async action with loading/error
fetchData: async () => {
  set({ loading: true, error: null });
  try {
    const data = await apiClient.domain.list();
    set({ data, loading: false });
  } catch {
    set({ error: "Failed to load", loading: false });
  }
},

// Optimistic update with rollback
toggleStatus: async (id: string) => {
  const previous = get().items.find((i) => i.id === id);
  // Optimistic
  set((s) => ({
    items: s.items.map((i) => i.id === id ? { ...i, active: !i.active } : i),
  }));
  try {
    await apiClient.domain.toggle(id);
  } catch {
    // Rollback
    if (previous) {
      set((s) => ({
        items: s.items.map((i) => i.id === id ? previous : i),
      }));
    }
  }
},
```

---

## Error Handling

### API Errors

```typescript
try {
  const data = await apiClient.leads.list();
  setLeads(data);
} catch (err) {
  const message = err instanceof Error ? err.message : "Something went wrong";
  setError(message);
}
```

### Rules

1. **Always catch async operations** — never let promises reject silently
2. **User-facing messages** — show human-readable error from `err.message`
3. **No `console.error` in production code** — use error state instead
4. **Silent failures are acceptable** for non-critical operations (analytics, prefetch)
5. **Rollback optimistic updates** on API failure

### Loading States

Every async operation has a corresponding loading flag:

```typescript
interface Store {
  loading: boolean;      // Main data loading
  _fetching: Set<string>; // Per-item loading (by ID)
}
```

---

## Performance

### Mandatory Optimizations

| Pattern | When | Example |
|---------|------|---------|
| `useMemo` | Expensive computations, filtered lists | `useMemo(() => items.filter(...), [items])` |
| `useCallback` | Handlers passed as props | `useCallback(() => onClick(id), [id])` |
| Zustand selectors | Always | `useStore((s) => s.field)` |
| `dynamic()` import | Heavy libraries (Recharts, maps) | `dynamic(() => import(...), { ssr: false })` |
| Debounce | API calls triggered by rapid user input | `setTimeout(fetchData, 300)` |

### Image Optimization

```tsx
// CORRECT — Next.js Image component
import Image from "next/image";
<Image src={user.avatar_url} width={40} height={40} alt="" />

// WRONG — raw img tag
<img src={user.avatar_url} />
```

Add remote domains to `next.config.js`:

```javascript
images: {
  remotePatterns: [
    { protocol: "https", hostname: "lh3.googleusercontent.com" },
    { protocol: "https", hostname: "*.fbcdn.net" },
    { protocol: "https", hostname: "storage.googleapis.com" },
  ],
},
```

### Bundle Size

1. Import only what you use from libraries: `import { format } from "date-fns"`
2. Never import entire libraries: `import * as dateFns from "date-fns"` ← wrong
3. Use `dynamic()` with `ssr: false` for client-only heavy components
4. Remove unused dependencies regularly

---

## Styling

### Tailwind Only

No CSS modules, styled-components, or inline style objects (except for dynamic values).

```tsx
// CORRECT — Tailwind classes
<div className="bg-[#282828] rounded-card border border-white/[0.08] p-6">

// CORRECT — dynamic value that can't be a class
<div style={{ backgroundColor: `${event.color}20` }}>

// WRONG — inline styles for static values
<div style={{ backgroundColor: "#282828", borderRadius: "16px" }}>
```

### Class Composition

Use `cn()` (clsx + tailwind-merge) for conditional classes:

```tsx
import { cn } from "@/lib/utils";

<div className={cn(
  "px-4 py-2 rounded-inner text-sm font-medium transition-colors",
  isActive ? "bg-white/[0.10] text-white" : "text-white/50 hover:text-white/70",
  className // allow override from parent
)} />
```

### Design System Classes

Use custom border-radius classes, not standard Tailwind ones:

```
rounded-container  → 20px (layout blocks)
rounded-card       → 16px (cards)
rounded-inner      → 12px (inner elements)
rounded-element    → 8px  (small elements)
rounded-pill       → 9999px (pills)
```

### Z-Index Scale

Use the defined z-index scale from `tailwind.config.ts`:

```
z-base      → 0    (default)
z-content   → 1    (elevated content)
z-sticky    → 10   (sticky elements)
z-sidebar   → 20   (sidebar)
z-header    → 30   (header)
z-dropdown  → 40   (dropdowns)
z-overlay   → 50   (overlay backgrounds)
z-modal     → 60   (modals)
z-toast     → 70   (toasts)
z-critical  → 100  (system-critical)
```

See full design system: [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md)

---

## Testing

### Stack

- **Vitest** — test runner
- **React Testing Library** — component testing
- **jsdom** — DOM environment

### File Location

Tests live alongside source files or in `__tests__/`:

```
components/
  pipeline/
    DealCard.tsx
    DealCard.test.tsx      ← co-located
lib/
  __tests__/
    leadValidator.test.ts  ← grouped
```

### Test Structure

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("DealCard", () => {
  it("renders deal title", () => {
    render(<DealCard deal={mockDeal} onSelect={() => {}} />);
    expect(screen.getByText("New Lead")).toBeInTheDocument();
  });
});
```

### TDD mandate (wave-102)

Tests are written BEFORE implementation in every wave that has testable ACs. The test-engineer agent commits `*.test.ts` stubs (may be `it.todo()` initially) before frontend-agent begins. This is not optional.

TDD flow per `.claude/skills/tdd-flow.md`.

### Quality gate thresholds (wave-102)

| Gate | Tool | WARN | BLOCK (hard stop) |
|---|---|---|---|
| Unit test pass | Vitest | any failure | any failure |
| Coverage delta | @vitest/coverage-v8 + lcov | > 2% drop per file | > 5% drop per file |
| E2E pass | Playwright | any failure | any failure |
| Bundle size | bundle-size-check.mjs | > 10% growth per route | > 25% OR > 50 KB absolute growth per route |
| Accessibility | axe-core/playwright | "moderate" violation | "serious" or "critical" violation |
| Security | npm audit + semgrep | "moderate" finding | "high" or "critical" finding |
| Constitutional | Mission Compass 5Q | — | any Q FAIL |

---

## Git Workflow

### Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code |
| `dev` | Active development |
| `experiment` | Experimental features |
| `finish` | Stable checkpoint |

### Commit Messages

```
feat: add calendar debounce for Google API calls
fix: prevent duplicate messages in conversation store
refactor: migrate AgentsTab to Zustand selectors
chore: remove unused maplibre-gl dependency
```

### PR Rules

1. All changes go through `dev` branch
2. Never push directly to `main`
3. `npm audit` must show 0 vulnerabilities
4. `next build` must pass with 0 errors
5. No `console.log` or `console.error` in committed code

### AC reference convention

`feat` and `refactor` commits with a diff exceeding 50 LOC should include a footer line referencing the acceptance criteria they satisfy:

    Closes: wave-NN T.M AC-X

For multiple ACs: `Closes: wave-95 T.1 AC-A1, AC-A2`
For a wave-level AC without a task: `Closes: wave-95 AC-B1`

The commit-msg hook checks for this footer and prints a warning if missing. It is non-blocking by default (see SDD hard-block activation below).

### Spec lifecycle transitions

| Status | Transition trigger |
|---|---|
| Draft | Chief Architect writes spec |
| Reviewed | Spec Reviewer SR-23 confirms completeness |
| Approved | Owner explicit sign-off (optional step) |
| Implemented | First product commit lands from frontend-agent |
| Shipped | Retro written and metrics row committed |
| Retired | Owner deprecation with note in spec frontmatter |

Update the spec frontmatter `**Status**:` field when each transition occurs. The pre-commit INDEX regeneration picks up the new value automatically.

### Exit code contract

| Exit code | Meaning | Action |
|---|---|---|
| `0` | Success | Continue |
| `1` | Hard failure (lint error, test failure, BLOCK/DEADLOCK, invalid args) | Fix and retry |
| `42` | Halted — awaiting human resume via `node scripts/andon-resume.mjs` | Do NOT retry automatically. Run `node scripts/andon-resume.mjs --wave <id> --approver <name> --reason <text> --root-cause <annotation>` to clear the halt state. |

Exit 42 is the Andon Cord protocol (wave-158). It means the pipeline detected a condition requiring human review before any further work proceeds. Background jobs and pipeline entry gates all check `.sdd-halt-state.json` at startup. CI wrappers should branch on exit 42 vs exit 1: 42 means "await human", 1 means "fix and retry". See `scripts/andon-halt-helpers.mjs` and `scripts/andon-resume.mjs`.

### SDD hard-block activation

The AC-reference enforcement ships in soft mode (warning only, exit 0). To activate hard enforcement:

1. Edit `.sdd-config.json` at the repo root: set `"hard_block_ac": true`.
2. Or set env var `SDD_HARD_BLOCK_AC=1` in your shell before committing.

Recommended: 30-day soft-warn trial first. Review `.sdd-bypass.log` weekly to assess how often teams skip the convention, then enable hard block once compliance rate exceeds 80%.

When hard block is active, `git commit --no-verify` still works — usage is logged to `.sdd-bypass.log` for weekly review.

### Module specs

Every named agent, canonical funnel, primary UI surface, and cross-cutting infrastructure module
shall have a module spec at `docs/specs/modules/<category>/<slug>.md`.

Create a new spec by copying `docs/specs/modules/_MODULE_TEMPLATE.md` into the correct category
directory and filling in all 15 frontmatter fields and 9 sections. See `docs/MODULE_SPEC_SYSTEM.md`
for authoring guidance, granularity rules, and anti-patterns.

When a wave modifies a module, add an entry to the module spec's `linked_waves` frontmatter field
and the `## 9. Linked waves` section:

    wave-NN: <one-line summary of what changed and why>

Update `last_updated` to the current date.

Regenerate the index after authoring or modifying a module spec:

    node scripts/regenerate-modules-index.mjs

The pre-commit hook runs this automatically when `docs/specs/modules/**/*.md` files are staged.
To preview without writing: `node scripts/regenerate-modules-index.mjs --dry`.

### Hierarchical spec assignment

Every new spec file must declare a `level:` and `parents:` block in YAML frontmatter. See `docs/HIERARCHICAL_SPEC_SYSTEM.md` for the full guide and industry references.

**Level-to-parent mapping:**

| Level | Name | Typical parent doc | Example `parents[].path` | Relationship |
|---|---|---|---|---|
| L0 | Constitution | (root — no parents) | — | — |
| L1 | Core Architecture | `docs/MISSION.md` | `docs/MISSION.md` | `implements` |
| L2 | Domain | `docs/FRONTEND_ARCHITECTURE.md` | `docs/FRONTEND_ARCHITECTURE.md` | `refines` |
| L3 | Module | L2 domain spec | `docs/specs/domains/voice-domain.md` | `implements` |
| L4 | Wave | `docs/FRONTEND_ARCHITECTURE.md` | `docs/FRONTEND_ARCHITECTURE.md` | `implements` |

**Minimum valid YAML block per level:**

L0 (no parents):
```yaml
---
level: L0
type: constitution
version: 1.0.0
owner_role: owner
parents: []
created: 2026-05-28
last_validated_against_parents: 2026-05-28
last_updated: 2026-05-28
---
```

L1:
```yaml
---
level: L1
type: core-arch
version: 1.0.0
parents:
  - path: docs/MISSION.md
    version: 1.0.0
    relationship: implements
---
```

L2:
```yaml
---
level: L2
type: domain
version: 1.0.0
parents:
  - path: docs/FRONTEND_ARCHITECTURE.md
    version: 1.0.0
    relationship: refines
---
```

L3:
```yaml
---
level: L3
type: module
version: 1.0.0
parents:
  - path: docs/specs/domains/[domain-name].md
    version: 1.0.0
    relationship: implements
---
```

L4 (wave specs — insert above existing bold-field frontmatter):
```yaml
---
level: L4
type: wave
version: 1.0.0
parents:
  - path: docs/FRONTEND_ARCHITECTURE.md
    version: 1.0.0
    relationship: implements
---
```

After writing a new spec, update `parents[].version` whenever the parent version changes: `node scripts/cascade-regenerate.mjs --root <parent-path>`. Run `node scripts/cascade-validate.mjs --root <parent-path>` to detect drift before committing a parent change.

---

## Quick Reference

### Do

- Use `apiClient` for all API calls
- Use Zustand selectors (not destructuring)
- Use `cn()` for conditional classes
- Use `encodeURIComponent()` for URL parameters
- Use Next.js `<Image>` for images
- Use `dynamic()` for heavy libraries
- Type everything explicitly

### Don't

- Use raw `fetch()` — use `apiClient`
- Use `as any` — find the correct type
- Use `dangerouslySetInnerHTML` — use JSX
- Use `console.error` for user-facing errors
- Use inline styles for static values
- Use standard `rounded-*` classes — use design system classes
- Destructure entire Zustand stores
- Commit `.env` files or secrets

---

## Verification Tiers (wave-103)

All commits flow through a 4-tier verification pipeline. Full details: `docs/MULTI_LEVEL_VERIFICATION.md`.

### Tier 1 — Automated (every commit, < 60s parallel)

TypeScript, lint, unit tests, coverage delta, bundle delta, accessibility, security. Single failure → debug-agent auto-fix attempt.

### Tier 2 — Specialist (per wave, sequential, cap 5 iterations)

reflexion-critic + constitutional-reviewer + visual-qa + integration-tester. Smart routing on REVISE based on failure category.

### Tier 3 — Adversarial debate (high-stakes only)

Triggers: L effort wave OR security-critical OR Mission Compass concern OR billing/payment touching. 3-round prosecutor/defender/judge debate. Verdicts: PASS / REVISE / BLOCK / DEADLOCK.

Opt-in Best-of-N: spec frontmatter `parallel_implementations: 3` runs 3 parallel frontend-agents, best-of-N-judge selects winner.

### Tier 4 — Human escalation

Triggers: Mission Compass FAIL exhausted, cost ceiling > 110%, Tier 3 DEADLOCK, HumanOnlyDecisionRegistry hit, security HIGH, 5-iteration cap. Pipeline pauses until human action.

### Activation flags

`.sdd-config.json` controls all tiers — see `docs/MULTI_LEVEL_VERIFICATION.md §8`.

### Anti-pattern

Disabling tiers to "save time" defeats the autonomous-loop guarantee. Use the iteration cap, not the tier off-switch.

---

## Proactive Holistic Analysis Trigger (wave-117 retro)

**MANDATORY rule for every Claude session.** When user uses phrases like "максимально передовое / state of the art / что не хватает / правильная архитектура / от и до / не иди по пути наименьшего сопротивления" or semantic equivalents — STOP. Do NOT proceed to chief-architect dispatch. Run `.claude/skills/proactive-holistic-analysis.md` first.

6-step protocol: pause → industry pattern research (MDA, DDD, GitOps, Constitutional AI, Multi-Agent Debate, etc.) → map existing к patterns → gap analysis (aim 15-25 items, not 3-5) → propose foundational restructure before incremental → wait for explicit approval before any wave dispatch.

Full rule: `docs/PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER.md`.

**Anti-pattern this prevents:** reactive-incremental-thinking. Failure example: wave-95 → wave-102 → wave-103 sequence shipped 3 incremental waves before AI surfaced missing 5-level hierarchical spec system.

If you skip this trigger, you are likely missing 60-80% of what the user actually needs.

---

## Completion Audit

**Mandatory before any AI message that declares "done", "shipped", "complete", or "closed".**

Before writing any such claim, emit the following block in full. No exceptions.

```
## Completion audit (mandatory before "done" claims)
- **Goal:** <original ask, 1-line>
- **Gaps remaining:** <enumerate with file:line OR "0 — all gaps addressed">
- **Enforcement type:** documentation | active hook | hard block | external audit
- **Closure level:** N% (100% only if all gaps explicitly addressed AND enforcement is not "documentation only")
- **If < 100%:** explicit list of deferred items + why deferred + wave-NN when addressed
```

Enforcement: documented in `.claude/skills/completion-audit.md` (gitignored body) and `docs/skills/completion-audit.md` (git-tracked mirror).

Anti-pattern catalog entry: `partial-closure-via-documentation` (entry 2) and `optimistic-completion-bias` (entry 3) in `docs/ANTI_PATTERNS_CATALOG.md`.

Rules:
- Closure level is 100% ONLY when all gaps are explicitly enumerated and found to be zero, AND enforcement type is not "documentation" alone.
- Deferring without a wave number is not acceptable. Use "wave-NN" or "next session" — not "later" or "eventually".
- The block is mandatory even when the result seems obviously done.

---

## PFCA (Pre-Flight Checklist Agent)

Wave-159 ships the Pre-Flight Checklist Agent: a gate that runs before wave dispatch and asks 5 universal killer items (K1-K5) plus optional per-tier additions.

**Single sources of truth:**
- Definition of Ready: `docs/DOR.md` — 5 killer items with anti-pattern cross-references
- Definition of Done: `docs/DOD.md` — 5 DOD fields mapped to `completion-audit.md`

**Runner:**

```bash
node scripts/run-checklist.mjs --phase <dor|dod|spec-review|task-decomp|closure> --wave wave-NNN
npm run pfca -- --phase dor --wave wave-NNN   # via npm script
```

**Config** (`.sdd-config.json` key `pfca`):
- `pfca.enabled: false` (default) — skips all evaluation; pre-commit hook fast-exits
- `pfca.enabled: true, pfca.hardBlockEnabled: false` — WARN mode; logs to `docs/audits/checklist-runs.jsonl`, exits 0
- `pfca.enabled: true, pfca.hardBlockEnabled: true` — BLOCK mode; calls `writeHaltState()` from `scripts/andon-halt-helpers.mjs`, exits 42

**PFCA is the 9th halt-authority agent.** Hard-block scope is restricted to 3 gates:
(a) chief-architect dispatch, (b) implementation-agent dispatch, (c) done-claim.
Mid-execution tool calls are never blocked (MCAS principle: unbounded blocking is dangerous).

**Audit log:** `docs/audits/checklist-runs.jsonl` — append-only. Never call `writeFileSync`, `truncate`, or `unlink` on this file.

**Note on `andonCord.enabled: false`**: If `andonCord.enabled: false`, halt-state is still written by PFCA BLOCK but the pre-commit halt-state check (`.husky/pre-commit:1-15`) fires only when `andonCord.enabled: true`. The two config flags are independent.

---

## Anti-Pattern Catalog

`docs/ANTI_PATTERNS_CATALOG.md` is the canonical reference for documented failure patterns in the dev system.

Seven anti-patterns documented as of wave-145:

1. `reactive-incremental-thinking` — incremental dispatch without holistic gap analysis
2. `partial-closure-via-documentation` — declaring a fix done via documentation, no enforcement
3. `optimistic-completion-bias` — "done" claim without structured closure audit
4. `asymmetric-closure-standards` — rigorous process for product waves, informal for meta-process
5. `over-documentation` — rules documented in multiple places with no enforcing agent
6. `scope-creep-mid-wave` — implementation adds scope not in approved master spec
7. `wave-spec-drift` — shipped behavior modified without spec amendment

When meta-process-auditor (`L0.98`) emits `CATALOG_UPDATE_NEEDED`, append a new entry to the catalog before starting the next wave.

Memory MCP entities for all 7 anti-patterns: see `docs/memory-anti-patterns.md`.

---

## Proactive Surfacing Protocol

**Mandatory at every session start and after every L-effort wave commit.**

Wave-155 ships the proactive-surfacing-agent (L0.99-1) — a concern queue that fires before the user speaks, not in reaction to user prompting. The pattern closes the `partial-closure-via-documentation` anti-pattern at the session level.

### Trigger conditions

| Condition | Mechanism |
|---|---|
| Session start (every session) | CLAUDE.md step 4: run `npm run surface:concerns`, read output |
| wave-NN % 5 == 0 post-commit | `.husky/post-commit` fires `node scripts/surface-concerns.mjs &` |
| L-effort commit | `.husky/post-commit` fires `node scripts/surface-concerns.mjs &` (subject contains "L effort") |
| Manual | `npm run surface:concerns` |

### Manual command

```bash
npm run surface:concerns
# or with dry-run (stdout only, no file writes):
node scripts/surface-concerns.mjs --dry
```

### Four response types

When a concern is surfaced, the user responds via:

```bash
node scripts/surface-concerns.mjs --respond "<concern-title>" <response-type> [reason]
```

| Response | Meaning |
|---|---|
| `addressed` | Concern resolved — enforcement shipped or root cause fixed |
| `deferred` | Valid concern, deliberately deferred to a named future wave |
| `declined` | Team has decided not to act |
| `disputed` | Concern is factually incorrect — re-investigation required |

### Log location

All responses are appended to `docs/audit-reports/surfaced-concerns-log.md` (append-only, never overwritten).

### Anti-suppression

Concerns with no response after 5 subsequent waves escalate in severity: NICE → IMPORTANT → BLOCKING. A BLOCKING concern is re-surfaced on every script run until responded to.

### Full protocol

See `docs/PROACTIVE_SURFACING_PROTOCOL.md` for: architecture diagram, industry pattern alignment (10 frameworks), E3 escalation rule, output format spec.

---

## Compliance

> Added wave-162. Governs all waves that ship AI agent components or user-facing AI interactions.

Every wave that ships an AI agent component or user-facing AI interaction must satisfy the two
checks below before the wave can be closed. These checks are evaluated in the impl phase gate
(`node scripts/run-checklist.mjs --phase impl`).

### HRAIS Classification Check

Any wave that ships a new AI agent component (new agent in `.claude/agents/`, new funnel stage
with autonomous AI decision-making, or new AI-driven API endpoint) must verify that the component
is covered by the current HRAIS classification in `docs/compliance/eu-ai-act/hrais-classification.md`.

Specifically:
1. Does the new component qualify as a high-risk AI system under any Annex III category that was
   NOT already evaluated in `hrais-classification.md`?
2. If yes: update `hrais-classification.md` and obtain a new human sign-off before the wave ships.
3. If no: add a one-line note in the wave's master spec §9 (Mission Compass) confirming the check
   was performed.

**Reference**: `docs/compliance/eu-ai-act/hrais-classification.md`
**Deadline**: Aug 2, 2026 for all waves shipping before that date.

### Art 13 / Art 50 Disclosure Check

Any wave that ships a user-facing AI interaction (new voice agent surface, new chat surface,
new AI-generated message type delivered to a natural person) must verify that:
1. The Art 50 disclosure statement in `docs/compliance/eu-ai-act/art-13-transparency.md §5`
   is visible to the end user on that surface before or at the start of the interaction.
2. The disclosure uses the approved wording from §5 (voice, chat, or HR variant as applicable).
3. A human transfer path is available on the surface (cannot be disabled by operator config).

If the existing disclosure template does not cover the new surface type, update
`art-13-transparency.md §5` with a new surface-specific variant before closing the wave.

**Reference**: `docs/compliance/eu-ai-act/art-13-transparency.md`
**Deadline**: Aug 2, 2026 for all waves shipping before that date.
