# Debugging Guide

> Troubleshooting common issues in this project frontend

**Last updated:** 2026-03-07

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Build Errors](#build-errors)
3. [Runtime Errors](#runtime-errors)
4. [Network & API Errors](#network--api-errors)
5. [Authentication Issues](#authentication-issues)
6. [WebSocket Issues](#websocket-issues)
7. [Third-Party Integration Errors](#third-party-integration-errors)
8. [Performance Debugging](#performance-debugging)

---

## Development Setup

### Startup Sequence

Follow this exact order. See `CLAUDE.md` for full details.

```bash
# 1. Docker
docker start the backend-db

# 2. Backend
cd ~/the backend
source venv/bin/activate
python run.py                    # → http://localhost:8000

# 3. Frontend
cd ~/the-app
npm run dev                      # → http://localhost:3000

# 4. Ngrok (when needed)
ngrok http 8000                  # → https://xxxx.ngrok.io
```

### Common Startup Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| `Port 3000 is in use` | Previous dev server still running | `lsof -ti:3000 \| xargs kill -9` |
| `Unable to acquire lock at .next/dev/lock` | Two Next.js instances | Kill the other process, delete `.next/dev/lock` |
| `ECONNREFUSED 127.0.0.1:8000` | Backend not running | Start backend first |
| `connect ECONNREFUSED 127.0.0.1:5436` | Docker not running | `docker start the backend-db` |

---

## Build Errors

### TypeScript Errors

**"Cannot find module" or "Cannot find namespace"**

```
Type error: Cannot find module 'some-package'
```

Fix: Install the missing package or its types:
```bash
npm install some-package --legacy-peer-deps
# or for types only:
npm install --save-dev @types/some-package --legacy-peer-deps
```

**"Type 'X' is not assignable to type 'Y'"**

Usually means a prop type mismatch. Check:
1. The component's props interface
2. The data being passed from the parent
3. Backend response shape vs frontend type (snake_case vs camelCase)

### CSS / Tailwind Errors

**"Could not parse CSS" or build fails on generated CSS**

```
Error: Could not parse CSS: after\:after\:rounded-full
```

Fix: Search for broken Tailwind class patterns. Common culprit: doubled pseudo-class prefixes (`after:after:`).

```bash
# Find broken patterns
grep -r "after:after:" components/
grep -r "before:before:" components/
```

### Next.js 16 Specific

**`useRef` requires initial value (React 19)**

```
TS2554: Expected 1 arguments, but got 0.
```

Fix:
```typescript
// WRONG (React 18)
const ref = useRef<HTMLElement>();

// CORRECT (React 19)
const ref = useRef<HTMLElement>(null);
const timerRef = useRef<NodeJS.Timeout>(undefined);
```

**Middleware renamed to Proxy**

Next.js 16 uses `proxy.ts` instead of `middleware.ts`. If you see middleware not executing, check:
1. File is named `proxy.ts` (not `middleware.ts`)
2. Function is exported as `proxy` (not `middleware`)

---

## Runtime Errors

### Next.js Dev Overlay

The Next.js dev overlay (red error screen) shows `console.error` calls as errors. This causes false positives.

**Rule:** Never use `console.error` for expected failures. Use error state instead:

```typescript
// WRONG — triggers dev overlay
catch (err) {
  console.error("Failed to load data", err);
}

// CORRECT — silent to console, visible to user
catch (err) {
  setError(err instanceof Error ? err.message : "Failed to load");
}
```

### Hydration Mismatch

```
Warning: Text content did not match. Server: "X" Client: "Y"
```

Common causes:
1. **Theme script** — `layout.tsx` has `suppressHydrationWarning` for this
2. **Date/time rendering** — server and client may have different timezones
3. **localStorage reads** — only available client-side

Fix: Wrap client-only logic in `useEffect` or use `"use client"` directive.

### "Cannot read properties of null"

Usually means accessing state before it's loaded. Check:
1. Loading guard: `if (loading) return <Skeleton />`
2. Null check: `user?.name` instead of `user.name`
3. Optional chaining on store data

---

## Network & API Errors

### "Failed to fetch"

**In browser console:**
```
TypeError: Failed to fetch
```

**Checklist:**
1. Is the backend running? → `curl http://127.0.0.1:8000/docs`
2. Does `.env.local` have the correct API URL?
3. Does CSP `connect-src` include the API URL?
4. Check both `http://localhost:8000` AND `http://127.0.0.1:8000` in CSP

**CSP blocking check:**
```
Look in browser console for:
"Refused to connect to 'http://...' because it violates the following
 Content Security Policy directive: 'connect-src ...'"
```

Fix: Add the blocked domain to CSP in `proxy.ts`.

### CORS Errors

```
Access to fetch at 'http://localhost:8000/api/...' has been blocked by CORS policy
```

This is a **backend issue**. The FastAPI backend must include CORS headers. Check:
1. Backend CORS middleware allows the frontend origin
2. Frontend is calling the correct API URL (not a typo)

### 401 Unauthorized

**Flow:**
1. Token expired → `authFetch` attempts refresh
2. Refresh succeeds → request retried automatically
3. Refresh fails → user redirected to `/login`

**If 401 persists after refresh:**
- Clear localStorage manually: `localStorage.clear()`
- Check backend: is the refresh endpoint working?
- Check: is the token being sent? (Network tab → Authorization header)

### 422 Unprocessable Entity

Backend validation error. The response body contains details:

```json
{
  "detail": [
    {
      "loc": ["body", "email"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

Fix: Check the request body matches what the backend expects.

---

## Authentication Issues

### Login Fails Silently

1. Check Network tab for the actual response
2. Check `.env.local` has `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`
3. Check backend is running and accessible
4. Check CSP allows the API URL

### Google Login Fails

**"FedCM: Error contacting the provider"**

This is a Google Sign-In API issue. Requires:
1. CSP allows `accounts.google.com` and `apis.google.com` (script, connect, frame)
2. COOP is `same-origin-allow-popups` (not `same-origin`)
3. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set in `.env.local`
4. Google Cloud Console has the correct authorized origins

**"Google login failed" in console**

Check:
1. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is valid
2. Backend endpoint `POST /api/auth/google/token` is working
3. CSP allows Google domains

### Onboarding Redirect Loop

If the app keeps redirecting to `/onboarding`:
1. Check backend: `GET /api/company/onboarding-status` — what does it return?
2. If `onboarding_completed: false`, the redirect is correct
3. Complete the onboarding flow to stop the redirect
4. If already completed, check the backend database

---

## WebSocket Issues

### Connection Not Establishing

1. Is the backend WebSocket endpoint running?
2. Is the token valid? (WebSocket passes token in query string)
3. Check browser console for WebSocket errors
4. Check CSP `connect-src` allows `ws://` or `wss://` URLs

### Duplicate Messages

The `conversationsStore` deduplicates via `_seenMessageIds` Set. If duplicates appear:
1. Check if message IDs are unique
2. Check if the Set is being cleared unexpectedly
3. Verify the WebSocket isn't reconnecting and replaying messages

### Connection Drops

**Expected behavior:**
- Auto-reconnect with exponential backoff (3s → 6s → 12s → ... → 30s max)
- Maximum 20 reconnect attempts
- Heartbeat ping every 30 seconds

**Code 4001:** Token expired — no reconnect, redirect to login.

**Debugging:**
```typescript
// The hook exposes status
const { status } = useWebSocket({ ... });
// status: "connecting" | "connected" | "disconnected" | "error"
```

---

## Third-Party Integration Errors

### CSP Violations

**Pattern:** Feature works in development but breaks in production (or with CSP enabled).

**Diagnosis:**
1. Open browser DevTools → Console tab
2. Look for "Refused to load/connect/execute" messages
3. The message tells you which CSP directive is blocking

**Fix:** Add the domain to the appropriate CSP directive in `proxy.ts`.

### OAuth Callback Errors

**"Invalid OAuth state — possible CSRF attack"**

This means the state parameter doesn't match. Possible causes:
1. User opened the OAuth flow in a different tab
2. Session storage was cleared between redirect and callback
3. Actual CSRF attack (unlikely in development)

Fix: Retry the OAuth flow from the beginning.

### Stripe Integration

**"Refused to frame 'https://js.stripe.com'"**

CSP `frame-src` must include `https://js.stripe.com`.

---

## Performance Debugging

### Slow Re-renders

**Diagnosis:** React DevTools Profiler (Components tab → "Highlight updates when components render")

**Common causes:**
1. Zustand store destructuring instead of selectors
2. Missing `useMemo` for expensive computations
3. Missing `useCallback` for handlers passed as props
4. Large component not split into smaller ones

**Fix checklist:**
- [ ] All Zustand reads use `useStore((s) => s.field)` selectors
- [ ] Derived data wrapped in `useMemo`
- [ ] Handlers passed to children wrapped in `useCallback`
- [ ] Heavy components use `dynamic()` import

### Large Bundle Size

```bash
# Analyze bundle
npx next build
# Check .next/analyze/ if configured, or use:
npx @next/bundle-analyzer
```

**Common offenders:**
| Library | Size | Solution |
|---------|------|----------|
| Recharts | ~200KB | `dynamic(() => import(...), { ssr: false })` |
| Framer Motion | ~100KB | Tree-shakeable, import specific components |
| date-fns | Varies | Import specific functions only |

### API Call Debugging

Use the Network tab in DevTools:
1. Filter by `Fetch/XHR`
2. Check request URL, headers, body
3. Check response status, body
4. Check timing (waterfall)

For WebSocket: Filter by `WS` in Network tab.
