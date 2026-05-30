# DevOps

> Environments, CI/CD, monitoring, and deployment for this project

**Last updated:** 2026-03-07

---

## Table of Contents

1. [Environments](#environments)
2. [CI/CD Pipeline](#cicd-pipeline)
3. [Monitoring & Analytics](#monitoring--analytics)

---

# Environments

## Overview

| Environment | URL | API URL |
|-------------|-----|---------|
| Development | `http://localhost:3000` | `http://127.0.0.1:8000` |
| Production | `https://app.app.ai` | `https://app.app.ai` |

## Environment Variables

### Development (`.env.local`)
```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSy...
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=pk_test_...
```

### Rules
1. Client-side vars MUST start with `NEXT_PUBLIC_`
2. Never store secrets in `NEXT_PUBLIC_*` — bundled into JS
3. `.env.local` is gitignored
4. Production vars set in Vercel dashboard

### CSP Differences

| Directive | Development | Production |
|-----------|-------------|------------|
| `connect-src` | `localhost:8000`, `127.0.0.1:8000` | `https://app.app.ai` |
| `script-src` | Includes `'unsafe-eval'` (HMR) | Remove if possible |

## Docker (Backend Only)

The frontend does NOT use Docker. Docker is only for PostgreSQL:
```bash
docker start the backend-db     # NEVER create new containers
```

## Ngrok (Development Webhooks)

```bash
ngrok http 8000
curl http://localhost:4040/api/tunnels   # Check tunnel URL
```
Used for: Meta webhooks, Twilio callbacks, Google OAuth during testing.

---

# CI/CD Pipeline

**Current status:** Manual deployment — CI/CD pipeline to be configured.

## Pipeline Flow

```
Push to dev → Lint → Type Check → Build → Test → Deploy Preview
Merge to main → Same checks → Deploy Production
```

## GitHub Actions

### `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [dev, main]
  pull_request:
    branches: [dev, main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci --legacy-peer-deps
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run build
      - run: npm audit --audit-level=high
      - run: npm test -- --run
```

## Required Checks

| Check | Command | Purpose |
|-------|---------|---------|
| Lint | `npm run lint` | Code style |
| Type check | `npx tsc --noEmit` | TypeScript correctness |
| Build | `npm run build` | Compilation |
| Audit | `npm audit --audit-level=high` | Security |

## Branch Strategy

```
main ← stable, production deployments
  ↑
dev ← active development, preview deployments
  ↑
feature/* ← feature branches (merged to dev)
```

| Action | Allowed? |
|--------|----------|
| Push to `dev` | Yes (with checks) |
| Push to `main` | PR only (from dev) |
| Force push to `main` | Never |

## Deployment (Vercel)

| Event | Action |
|-------|--------|
| Push to `dev` | Preview deployment |
| Push to `main` | Production deployment |
| Pull request | Preview with unique URL |

### Vercel Configuration

| Setting | Value |
|---------|-------|
| Framework | Next.js |
| Build Command | `npm run build` |
| Node.js | 20.x |
| Install | `npm install --legacy-peer-deps` |

### Domains

| Domain | Purpose |
|--------|---------|
| `app.app.ai` | Production frontend |
| `api.app.ai` | Production backend (future) |

## Build Verification

```bash
npx tsc --noEmit          # TypeScript
npm run build              # Must show 0 errors, all 70 pages
npm audit                  # 0 high/critical vulnerabilities
npm run lint               # Code style
```

## Rollback

### Vercel
1. Dashboard → Deployments → Find previous working deployment
2. Click "..." → "Promote to Production"

### Git
```bash
git revert HEAD            # Safe — creates new commit
# Never git reset --hard or git push --force without permission
```

---

# Monitoring & Analytics

## Error Tracking

### Current State
Errors caught by `ErrorBoundary`, `try/catch` in stores, and browser console. No production error tracking yet.

### Recommended: Sentry

```bash
npx @sentry/wizard@latest -i nextjs
```

#### Integration Points

| Location | What it catches |
|----------|-----------------|
| `ErrorBoundary` | React render errors |
| `apiClient` | API call failures |
| `useWebSocket` | WebSocket errors |
| Store actions | State management errors |
| `proxy.ts` | Middleware errors |

#### ErrorBoundary + Sentry
```tsx
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
}
```

## Frontend Logging Rules

1. Never use `console.log` in committed code
2. Never use `console.error` — triggers Next.js dev overlay
3. Silent catch is acceptable for non-critical operations
4. Use error state for user-facing issues:
   ```typescript
   catch (err) {
     set({ error: err instanceof Error ? err.message : "Something went wrong" });
   }
   ```

## Core Web Vitals

| Metric | Target |
|--------|--------|
| LCP | < 2.5s |
| FID | < 100ms |
| CLS | < 0.1 |
| INP | < 200ms |
| TTFB | < 800ms |

### Vercel Analytics (recommended)

```tsx
// app/layout.tsx
import { Analytics } from "@vercel/analytics/react";
// Add <Analytics /> to layout
```

## Event Analytics

### Naming Convention
```
{category}_{action}_{target}
```

### Key Events

| Category | Event | Properties |
|----------|-------|------------|
| Auth | `auth_login` | `method: "email" \| "google"` |
| Auth | `auth_signup` | `method: "email" \| "google"` |
| Leads | `lead_form_submit` | `form_id, source` |
| Pipeline | `deal_create` | `pipeline_id, stage` |
| Pipeline | `deal_move` | `from_stage, to_stage` |
| Chat | `message_send` | `platform, has_attachment` |
| Agents | `agent_toggle` | `agent_id, enabled` |

### Implementation
```typescript
// lib/analytics.ts (future)
export function track(event: string, properties?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.analytics) {
    window.analytics.track(event, properties);
  }
}
```

## Health Checks

| Check | How | Frequency |
|-------|-----|-----------|
| Build | `npm run build` | Every PR |
| TypeScript | `npx tsc --noEmit` | Every PR |
| Vulnerabilities | `npm audit` | Weekly |
| Pages load | Playwright smoke test | Per deploy |

## Alerting (Future)

| Alert | Trigger |
|-------|---------|
| Error spike | > 10 errors/min |
| API latency | P95 > 2s |
| Build failure | CI fails |
| Vulnerability | High/critical in `npm audit` |

## Pre-Launch Checklist

- [ ] Vercel deployment configured
- [ ] Production env vars set
- [ ] Custom domain (`app.app.ai`)
- [ ] SSL active
- [ ] CSP updated (no localhost)
- [ ] Error monitoring (Sentry)
- [ ] Analytics configured
- [ ] robots.txt verified
- [ ] sitemap.xml accessible
