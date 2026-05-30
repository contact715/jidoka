# Web Standards

> Accessibility and SEO standards for this project

**Last updated:** 2026-03-07

---

## Table of Contents

1. [Accessibility (a11y)](#accessibility)
2. [SEO](#seo)

---

# Accessibility

## Keyboard Navigation

1. All interactive elements must be focusable (`<button>`, `<a>`, `<input>`)
2. Never use `<div onClick>` — use `<button>` instead
3. Custom components must support `Tab`, `Enter`, `Escape`, `Arrow` keys
4. Focus order must follow visual layout (no `tabIndex` > 0)
5. Modal dialogs must trap focus inside until closed

```tsx
// CORRECT
<button onClick={handleClick}>Delete</button>

// WRONG
<div onClick={handleClick} className="cursor-pointer">Delete</div>
```

### Focus Indicators

Never remove focus outlines without a visible replacement:
```tsx
// CORRECT — custom focus style
className="focus:outline-none focus:ring-2 focus:ring-blue-500/50"

// WRONG — removes indicator entirely
className="focus:outline-none"
```

## Semantic HTML

1. Heading hierarchy: `h1` → `h2` → `h3` — never skip levels
2. One `<h1>` per page
3. Use `<nav>`, `<main>`, `<aside>` for layout landmarks
4. Use `<ul>/<li>` for lists, not styled `<div>` elements
5. Forms must use `<label>` linked via `htmlFor`

## ARIA Attributes

| Scenario | Attribute |
|----------|-----------|
| Icon-only buttons | `aria-label` |
| Loading states | `aria-busy` |
| Live updates | `aria-live="polite"` |
| Expandable sections | `aria-expanded` |
| Error messages | `aria-describedby` |
| Modal dialogs | `role="dialog"` + `aria-modal="true"` |

```tsx
// Icon button — always needs a label
<button aria-label="Close dialog" onClick={onClose}>
  <X className="w-5 h-5" />
</button>
```

## Color & Contrast

Minimum contrast ratios (WCAG AA):
- Body text: 4.5:1
- Large text (18px+ bold, 24px+): 3:1

| Text Class | Contrast on `#111` | Status |
|------------|-------------------|--------|
| `text-white` | 17.4:1 | Pass |
| `text-white/70` | 8.6:1 | Pass |
| `text-white/50` | 4.4:1 | Borderline |
| `text-white/40` | 3.2:1 | **Fails** — decorative only |

Never convey information through color alone — use icons or text as well.

## Images

```tsx
// Meaningful — descriptive alt
<Image src={avatar} alt="John Smith's profile photo" width={40} height={40} />

// Decorative — empty alt
<Image src={pattern} alt="" width={200} height={200} />

// Icon with text — icon is decorative
<button>
  <Phone className="w-4 h-4" aria-hidden="true" />
  Call Client
</button>
```

## Form Accessibility

```tsx
// Visible label
<label htmlFor="email" className="text-sm text-white/70">Email</label>
<input id="email" type="email" />

// Hidden label (when design requires)
<label htmlFor="search" className="sr-only">Search conversations</label>
<input id="search" type="search" placeholder="Search..." />

// Error state
<input id="email" aria-invalid={!!error} aria-describedby={error ? "email-error" : undefined} />
{error && <p id="email-error" role="alert" className="text-red-400 text-sm">{error}</p>}
```

## Reduced Motion

Framer Motion respects `prefers-reduced-motion` automatically. For CSS:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-drift { animation: none; }
}
```

## Accessibility Checklist

- [ ] Interactive elements are `<button>` or `<a>` (not `<div onClick>`)
- [ ] Icon-only buttons have `aria-label`
- [ ] Form inputs have associated `<label>`
- [ ] Color is not the only way to convey meaning
- [ ] Focus styles are visible
- [ ] Content readable at 200% zoom
- [ ] Modals trap focus and close on `Escape`

---

# SEO

## Scope

SEO applies only to **public pages**. Dashboard pages are blocked by `robots.txt`.

| Page Type | SEO | Example |
|-----------|-----|---------|
| Landing (`/`) | Full | Meta, OG, structured data |
| Solutions (`/solutions/*`) | Full | Per-solution meta |
| Pricing (`/pricing`) | Full | Schema markup |
| Legal (`/legal/*`) | Minimal | Basic meta tags |
| Dashboard | None | Blocked |
| Login/Auth | None | noindex |

## Meta Tags

```tsx
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Chat Agent | this project",
  description: "24/7 AI-powered chat agent that qualifies leads and books appointments for home service businesses.",
  openGraph: {
    title: "AI Chat Agent | this project",
    description: "24/7 AI-powered chat agent that qualifies leads and books appointments.",
    url: "https://app.app.ai/solutions/ai-chat",
    siteName: "this project",
    type: "website",
    images: [{ url: "https://app.app.ai/og/ai-chat.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://app.app.ai/solutions/ai-chat" },
};
```

### Title Format
```
{Page Name} | this project
```
Home page: `this project — Multi-Agent OS for Home Services`

### Description Rules
- 150-160 characters maximum
- Include primary keyword naturally
- Include value proposition
- Unique per page

## Open Graph Images

| Property | Value |
|----------|-------|
| Size | 1200 x 630px |
| Format | PNG or JPG |
| Location | `/public/og/` |

## Structured Data (JSON-LD)

```tsx
// Organization — home page
<script type="application/ld+json">
{JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "this project",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web",
  "offers": { "@type": "AggregateOffer", "lowPrice": "199", "highPrice": "497", "priceCurrency": "USD" }
})}
</script>
```

## Sitemap

Dynamic sitemap in `app/sitemap.ts`:
```typescript
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://app.app.ai", lastModified: new Date(), priority: 1.0 },
    { url: "https://app.app.ai/pricing", lastModified: new Date(), priority: 0.8 },
    // ... public pages only
  ];
}
```

## Core Web Vitals

| Metric | Target |
|--------|--------|
| LCP | < 2.5s |
| FID | < 100ms |
| CLS | < 0.1 |
| INP | < 200ms |

### Image Best Practices
```tsx
// Above-fold — priority loading
<Image src="/hero.png" alt="Dashboard" width={1200} height={800} priority />

// Below-fold — default lazy loading
<Image src="/feature.png" alt="Feature" width={600} height={400} />
```

## SEO Checklist (New Public Pages)

- [ ] `title` set (format: `{Page} | this project`)
- [ ] `description` set (150-160 chars, unique)
- [ ] Open Graph tags (title, description, image, url)
- [ ] Canonical URL set
- [ ] Added to `sitemap.ts`
- [ ] Hero image has `priority` prop
- [ ] All images have descriptive `alt` text
- [ ] Heading hierarchy correct
- [ ] Page loads under 2.5s (LCP)
