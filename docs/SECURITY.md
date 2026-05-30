# Security Model

> Frontend security standards for this project

**Last updated:** 2026-03-07

---

## Table of Contents

1. [Security Headers](#security-headers)
2. [Content Security Policy](#content-security-policy)
3. [Authentication Security](#authentication-security)
4. [XSS Prevention](#xss-prevention)
5. [CSRF Protection](#csrf-protection)
6. [Input Validation](#input-validation)
7. [URL & Redirect Safety](#url--redirect-safety)
8. [Secrets Management](#secrets-management)
9. [Dependency Security](#dependency-security)
10. [Checklist](#checklist)

---

## Security Headers

All security headers are set in `proxy.ts` (Next.js middleware):

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer leakage |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Forces HTTPS |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=()` | Restricts browser APIs |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | Isolates browsing context (allows Google OAuth popups) |

### Header NOT Used

| Header | Reason |
|--------|--------|
| `X-XSS-Protection` | Deprecated, can introduce vulnerabilities in older browsers |

### Modifying Headers

Edit `proxy.ts`. Changes apply to all routes matched by the config:

```typescript
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

---

## Content Security Policy

CSP is the primary defense against XSS. The policy lives in `proxy.ts`.

### Current Policy

```
default-src 'self'
script-src  'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net
            https://maps.googleapis.com https://js.stripe.com
            https://accounts.google.com https://apis.google.com
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com
            https://accounts.google.com
img-src     'self' data: blob: https://*.fbcdn.net
            https://lh3.googleusercontent.com https://storage.googleapis.com
            https://maps.googleapis.com https://maps.gstatic.com
            https://*.googleusercontent.com
font-src    'self' https://fonts.gstatic.com
connect-src 'self' http://localhost:8000 http://127.0.0.1:8000
            https://app.app.ai https://*.facebook.com
            https://*.stripe.com https://accounts.google.com
            https://apis.google.com https://www.googleapis.com
frame-src   https://js.stripe.com https://accounts.google.com
            https://www.facebook.com https://apis.google.com
media-src   'self' blob:
object-src  'none'
base-uri    'self'
form-action 'self'
frame-ancestors 'none'
```

### Adding a New Third-Party Service

1. Identify which CSP directives it needs (script, connect, frame, img)
2. Add ONLY the specific domain — never use wildcards like `*`
3. Prefer specific subdomains over wildcard subdomains
4. Document the addition in a commit message
5. Test in production-like environment (CSP violations don't show in dev with `'unsafe-eval'`)

### Known CSP Requirements by Integration

| Integration | Directives Needed |
|-------------|-------------------|
| Google OAuth | script-src, style-src, connect-src, frame-src (`accounts.google.com`, `apis.google.com`) |
| Meta/Facebook | script-src (`connect.facebook.net`), connect-src, frame-src (`*.facebook.com`) |
| Stripe | script-src, connect-src, frame-src (`js.stripe.com`, `*.stripe.com`) |
| Google Maps | script-src, img-src (`maps.googleapis.com`, `maps.gstatic.com`) |
| Google Fonts | style-src (`fonts.googleapis.com`), font-src (`fonts.gstatic.com`) |

### Production Notes

- Remove `http://localhost:8000` and `http://127.0.0.1:8000` from `connect-src` for production
- `'unsafe-inline'` and `'unsafe-eval'` are required by Next.js — cannot be removed currently
- Consider nonce-based CSP when Next.js supports it in App Router

---

## Authentication Security

### Token Storage

| Token | Storage | Lifetime |
|-------|---------|----------|
| `access_token` | `localStorage` | Short-lived (set by backend) |
| `refresh_token` | `localStorage` | Long-lived (set by backend) |
| `avatar_url` | `localStorage` | Cached avatar URL |

### Token Refresh Flow

```
Request fails with 401
    ↓
Check isRefreshing flag (prevent concurrent refreshes)
    ↓
POST /api/auth/refresh { refresh_token }
    ↓
Success → Store new tokens → Retry original request
Failure → Clear all tokens → Redirect to /login
```

### Auth Rules

1. **Never expose tokens in URLs** — use Authorization header only
2. **Token in WebSocket** — passed as query parameter (WSS only in production)
3. **Concurrent refresh guard** — single `isRefreshing` flag prevents race conditions
4. **Graceful storage failure** — try/catch around `localStorage` for private browsing
5. **Logout clears everything** — `token`, `refresh_token`, `avatar_url`

### Route Protection

The `AuthProvider` checks authentication on every route change:

- **No token** + **protected route** → redirect to `/login`
- **Valid token** + **incomplete onboarding** → redirect to `/onboarding`
- **Token validation failure** → attempt refresh → logout if failed

---

## XSS Prevention

### Rules (non-negotiable)

1. **Never use `dangerouslySetInnerHTML`** — use React's built-in text rendering
2. **Never construct HTML strings** — use JSX exclusively
3. **Sanitize all user-displayed data** — React escapes by default, but be vigilant with:
   - URL attributes (`href`, `src`) — validate with `isSafeRedirectUrl()`
   - `style` attributes — avoid dynamic style injection
   - Third-party data rendered in components

### Allowed Exception

The theme detection script in `layout.tsx` uses `dangerouslySetInnerHTML` with a **hardcoded string** (no user input). This is the only acceptable use.

### URL Parameter Safety

Always encode user-provided values in URL paths:

```typescript
// CORRECT
authFetch(`/api/leads/${encodeURIComponent(leadId)}`);

// WRONG — injection risk
authFetch(`/api/leads/${leadId}`);
```

---

## CSRF Protection

### OAuth State Validation

All OAuth flows (Google Calendar, Google Reviews, Google Ads) use CSRF state parameters:

**Before redirect (connector component):**
```typescript
const url = new URL(data.authorization_url);
const state = url.searchParams.get("state");
if (state) {
  sessionStorage.setItem("google_calendar_oauth_state", state);
}
window.location.href = data.authorization_url;
```

**On callback (callback page):**
```typescript
const expectedState = sessionStorage.getItem("google_calendar_oauth_state");
if (expectedState && state !== expectedState) {
  setStatus("error");
  setErrorMsg("Invalid OAuth state — possible CSRF attack");
  return;
}
sessionStorage.removeItem("google_calendar_oauth_state");
```

### State Storage Keys

| Flow | Key |
|------|-----|
| Google Calendar | `google_calendar_oauth_state` |
| Google Reviews | `google_reviews_oauth_state` |
| Google Ads / LSA | `google_lsa_oauth_state` |

---

## Input Validation

### Lead Form Validation (`lib/validation/leadValidator.ts`)

Comprehensive fake-lead detection:

| Check | What it catches |
|-------|-----------------|
| Disposable email blocklist | 100+ throwaway domains (guerrillamail, tempmail, etc.) |
| Free email warning | Gmail, Yahoo, Hotmail flagged (not blocked) |
| Keyboard patterns | qwerty, asdf, zxcv sequences |
| Fake names | test, admin, sample, user, etc. |
| Fake zip codes | 12345, 00000, 99999 |
| N11 phone codes | 211, 311, 411, 511, 611, 711, 811, 911 |
| Submission timing | < 12 seconds = likely bot |
| Repeating characters | aaaa, 1111 patterns |

### Form Validation Rules

1. Required fields must be validated **before** API call
2. Email format validation using standard regex
3. Phone numbers validated for length and format
4. ZIP codes validated against US format (5 or 5+4)

---

## URL & Redirect Safety

### Redirect Validation (`lib/validation/url.ts`)

Before any `window.location.href` assignment, validate the URL:

```typescript
import { isSafeRedirectUrl } from "@/lib/validation/url";

if (!isSafeRedirectUrl(data.authorization_url)) {
  setError("Invalid redirect URL");
  return;
}
window.location.href = data.authorization_url;
```

### Allowed Redirect Hosts

Only these domains are allowed for OAuth redirects:

```
accounts.google.com
www.facebook.com
```

### Rules

1. **Protocol must be HTTPS** — no `http://`, `javascript:`, `data:` URLs
2. **Host must be in whitelist** — prevents open redirect attacks
3. **Apply to ALL external redirects** — OAuth flows, payment redirects
4. **Never redirect based on user-controlled query parameters** without validation

---

## Secrets Management

### Environment Variables

| Variable | Where Used | Sensitive? |
|----------|-----------|------------|
| `NEXT_PUBLIC_API_URL` | API base URL | No |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth | No (public client ID) |
| `NEXT_PUBLIC_STRIPE_PUBLIC_KEY` | Stripe | No (public key) |

### Rules

1. **Never commit `.env` or `.env.local`** — both in `.gitignore`
2. **Never commit `.claude/`** — contains AI assistant config
3. **No secrets in client-side code** — `NEXT_PUBLIC_*` vars are bundled into JS
4. **API keys go in backend** — frontend only uses public keys
5. **No hardcoded API URLs in components** — always use `process.env.NEXT_PUBLIC_API_URL`

### Source Maps

```javascript
// next.config.js
productionBrowserSourceMaps: false, // Never expose source maps in production
```

---

## Dependency Security

### Audit Schedule

Run `npm audit` before every deployment. Zero high/critical vulnerabilities policy.

```bash
npm audit           # Check for vulnerabilities
npm audit fix       # Auto-fix where possible
```

### Update Rules

1. **Security patches** — apply immediately
2. **Minor updates** — apply weekly, test before deploy
3. **Major updates** — plan migration, test thoroughly
4. **Unused dependencies** — remove immediately (`npm prune`)

### Current Status

```
npm audit: 0 vulnerabilities (as of 2026-03-07)
```

---

## Checklist

### Before Every PR

- [ ] No `dangerouslySetInnerHTML` with user data
- [ ] URL parameters encoded with `encodeURIComponent()`
- [ ] No secrets or API keys in code
- [ ] All external redirects validated with `isSafeRedirectUrl()`
- [ ] OAuth flows include state parameter validation
- [ ] `npm audit` shows 0 high/critical vulnerabilities

### Before Every Deploy

- [ ] `productionBrowserSourceMaps: false` in next.config.js
- [ ] CSP does not include `localhost` domains
- [ ] All security headers present in proxy.ts
- [ ] `.env` files not in git
- [ ] No `console.log` / `console.error` with sensitive data

### When Adding New Integration

- [ ] CSP updated with only required domains
- [ ] OAuth flow includes CSRF state validation
- [ ] Redirect URLs validated against whitelist
- [ ] New domains documented in this file
- [ ] Tested with CSP reporting enabled

### Robots & Indexing

Protected routes are disallowed in `public/robots.txt`:

```
Disallow: /dashboard
Disallow: /conversations
Disallow: /pipeline
Disallow: /contacts
Disallow: /calendar
Disallow: /analytics
Disallow: /settings
Disallow: /agents
Disallow: /tasks
Disallow: /team
Disallow: /knowledge
```
