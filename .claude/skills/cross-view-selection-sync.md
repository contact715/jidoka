# Skill: Cross-View Selection Sync — Zustand focus store + URL deep-link

> Wave: wave-5  |  Status: active  |  Tags: zustand, deep-link, focus, selection, cross-view

---

## When to use

- A page has multiple views (board, list, inbox, contacts) and clicking an entity in one view must scroll-focus the matching row in another view.
- The focused entity must survive a page refresh or be shareable as a URL.
- The selection state must be cleared when the user switches to a view where it is not meaningful.

---

## Implementation guide

### Step 1 — Use `clientsContextStore`, not local state

The store lives at `lib/store/clientsContextStore.ts`. It holds one focused entity per type: `focusedDealId`, `focusedContactId`, `focusedCompanyId`, `focusedConversationLeadId`. Only one is non-null at a time — each `focus*` action clears the others.

```ts
// lib/store/clientsContextStore.ts:52-65
export const useClientsContextStore = create<ClientsContextStore>((set) => ({
  ...INITIAL_STATE,
  focusDeal: (id) =>
    set({
      focusedDealId: id,
      focusedContactId: null,
      focusedCompanyId: null,
      focusedConversationLeadId: null,
    }),
  // ...
}));
```

### Step 2 — Trigger a highlight after focus

After calling `focusDeal(id)`, call `highlightFor(2000)`. This sets `highlightUntil = Date.now() + 2000`. Row components check `useHighlightActive()` to render a 2-second blue pulse.

### Step 3 — Deep-link on page mount

Read `?dealId=`, `?contactId=`, or `?companyId=` from `useSearchParams()` in the page, dispatch focus + highlightFor, then switch the view to one where the entity is visible. Run this logic in a `useEffect` with an **empty dependency array** — intentionally only once on mount.

```tsx
// app/(dashboard)/clients/page.tsx:100-121
useEffect(() => {
  const dealId = searchParams.get("dealId");
  const contactId = searchParams.get("contactId");

  if (dealId) {
    focusDeal(dealId);
    highlightFor(2000);
    setView((prev) => (prev === "contacts" || prev === "companies" || prev === "inbox" ? "board" : prev));
  } else if (contactId) {
    focusContact(contactId);
    highlightFor(2000);
    setView("contacts");
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Do NOT add `searchParams` to the dependency array — that causes a double-fire bug when Next.js re-renders with a stable but new reference.

### Step 4 — Tab view is also URL-synced

Tab switches write `?view=<tab>` via `router.replace(...)` with `{ scroll: false }`. This keeps the URL current without adding browser history entries on every tab click.

```tsx
// app/(dashboard)/clients/page.tsx:62-67
const handleViewChange = useCallback(
  (next: ClientsView) => {
    setView(next);
    router.replace(`/clients?view=${next}`, { scroll: false });
  },
  [router],
);
```

---

## Example references

| What | File | Lines |
|------|------|-------|
| Store definition | `lib/store/clientsContextStore.ts` | L1–L95 |
| Focus + clear pattern | `lib/store/clientsContextStore.ts` | L52–L75 |
| `highlightFor` action | `lib/store/clientsContextStore.ts` | L89–L93 |
| Deep-link mount effect | `app/(dashboard)/clients/page.tsx` | L100–L121 |
| View tab URL sync | `app/(dashboard)/clients/page.tsx` | L62–L67 |
| Row highlight consumer | `components/pipeline/table/parts/DealRow.tsx` | L8 (`useHighlightActive`) |

---

## Anti-patterns / gotchas

- **Don't put `searchParams` in the deep-link `useEffect` dependency array.** Next.js creates a new reference on every render; adding it causes the effect to run twice, setting view twice and potentially re-opening modals.
- **Don't manage focus in component local state.** A `useState(null)` in `PipelineTable` cannot be read by `ContactsView` in the same page. Always use the shared store.
- **Don't forget to switch the view.** Focusing a `dealId` while the user is on the Contacts tab means the row is off-screen. The mount effect must conditionally switch to "board" or "list".
- **Don't use `router.push` for tab changes.** Use `router.replace` — push accumulates history entries, making browser-back behave unexpectedly for a tab switcher.

---

## Wave reference

First applied: wave-5 (#7 deep-link entity focus).
