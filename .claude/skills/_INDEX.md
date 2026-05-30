# Skills Index

Quick lookup table. Open the skill file for full implementation guide and anti-patterns.

**Status semantics**: `experimental` = 1-4 wave applications (pattern validated but not yet battle-hardened). `stable` = 5+ wave applications (Process Engineer promotes after threshold). `deprecated` = zero citations in the last 5 waves (Process Engineer marks; deletion requires user approval).

| Skill | Tagline | Tags | Wave | Status | Scope |
|-------|---------|------|------|--------|-------|
| [monday-style-table.md](monday-style-table.md) | Grouped rows, sticky first column, inline edit, status popovers | table, pipeline, sticky, grouping, inline-edit | wave-5+ | experimental | global (promoted wave-19) |
| [cross-view-selection-sync.md](cross-view-selection-sync.md) | Zustand focus store + URL deep-link — entity selection across board/list/inbox/contacts views | zustand, deep-link, focus, selection, cross-view | wave-5 | experimental | project |
| [elevenlabs-sphere-hero.md](elevenlabs-sphere-hero.md) | Asymmetric two-column hero with LiveGradientSphere centerpiece | hero, sphere, layout, animation, brand | wave-10/15 | experimental | project |
| [dual-chat-disambiguation.md](dual-chat-disambiguation.md) | AskAssistant (agent) vs MessageComposer (customer channel) — visual and spatial differentiation | chat, inbox, z-index, ux, layout | wave-6 | experimental | project |
| [pill-cta-pattern.md](pill-cta-pattern.md) | rounded-full, font-semibold, sentence-case labels — primary and secondary CTA pills | button, cta, pill, typography, design-system | wave-10/13 | experimental | global (promoted wave-19) |
| [font-picker-dev-widget.md](font-picker-dev-widget.md) | next/font + CSS variable scope on wrapper div — dev-only font comparison widget | fonts, dev-tools, css-variables, next-font | wave-13c | experimental | project |
| [voice-clone-three-step-flow.md](voice-clone-three-step-flow.md) | MediaRecorder record step, animated progress/cloning step, preview + CTA step | voice, media-recorder, multi-step, animation | wave-15 | experimental | project |
| [reduced-motion-isolation.md](reduced-motion-isolation.md) | Freeze animated counters/tickers at useState initializer, not just useEffect, for prefers-reduced-motion | animation, reduced-motion, accessibility, useState, counter, ticker | wave-20 | experimental | project |
| [marketing-section-decompose.md](marketing-section-decompose.md) | Split >400 LOC marketing section into co-located parts/ subcomponents with section-prefixed names | decomposition, components, marketing, parts, architecture | wave-9, wave-20 | experimental | project |
| [surface-audit-before-touch.md](surface-audit-before-touch.md) | Zoom out and count bands/sizes/colours/duplicates before any UI edit | process, polish, ux, anti-tunnel-vision | wave-27.3 | experimental | global |
| [root-cause-over-patch.md](root-cause-over-patch.md) | Five whys before any patch; tag patch-vs-fix decisions explicitly | process, debugging, anti-tunnel-vision | wave-28 | experimental | global |
| [adversarial-self-review.md](adversarial-self-review.md) | Switch frame, attack empty/long/error/edge states, force one real concession | process, qa, falsification | wave-28 | experimental | global |
| [acknowledge-before-explain.md](acknowledge-before-explain.md) | Fix first, justify second; one-sentence acknowledgement, no caveats | communication, trust | wave-28 | experimental | global |
| [proportional-process.md](proportional-process.md) | Match dispatch weight to task tier — trivial / small / medium / large | process, orchestration, cost | wave-28 | experimental | global |
| [multiple-hypothesis-design.md](multiple-hypothesis-design.md) | Sketch three approaches, score against criteria, pick with reasoning | design, decision-making | wave-28 | experimental | global |
| [pre-mortem-checklist.md](pre-mortem-checklist.md) | Project the failure post-mortem before starting; translate to pre-flight checks | planning, risk | wave-28 | experimental | global |
| [rendered-verification.md](rendered-verification.md) | Run `npm run e2e:visual` before declaring done on any UI change; capture verification in commit message | process, qa, visual, anti-tunnel-vision | wave-33 | experimental | global |
| [tdd-flow.md](tdd-flow.md) | Red-green-refactor: write failing test stubs before implementation, commit stubs first, fill assertions as impl lands | tdd, testing, process, quality-gate | wave-102 | experimental | global |
| [test-failure-triage.md](test-failure-triage.md) | Three-class triage: test bug / impl bug / env bug before any fix; decision rule: assertion matches AC = impl bug | debugging, testing, triage, process, quality-gate | wave-102 | experimental | global |
| [coverage-improvement.md](coverage-improvement.md) | Gap closure from lcov: read DA:line,0 entries, focus on guard clauses, error branches, empty-state renders | coverage, testing, quality-gate, lcov | wave-102 | experimental | global |
| [a11y-fix.md](a11y-fix.md) | WCAG 2.1 AA violation remediation map: button-name, color-contrast, label, landmark-one-main, image-alt and more | accessibility, wcag, axe-core, a11y, quality-gate | wave-102 | experimental | global |
| [bundle-optimization.md](bundle-optimization.md) | Code-splitting patterns: dynamic() for client-only >10KB components, named export .then() wrapper, tree-shaking named imports | performance, bundle-size, dynamic-import, next-dynamic, tree-shaking, quality-gate | wave-102 | experimental | global |
| [constitutional-revision.md](constitutional-revision.md) | Critique-revise-verify loop per Anthropic CAI when constitutional-reviewer emits VIOLATION; iteration cap 3, then escalate | constitutional, ai-safety, revision-loop, mission-alignment | wave-103 | experimental | global |
| [proactive-holistic-analysis.md](proactive-holistic-analysis.md) | MANDATORY before dispatch when user says "state of the art / максимально передовое / what's missing": 6-step holistic gap analysis с industry pattern research, 15-25 gap items, foundational restructure proposal before incremental additions | meta, systems-thinking, anti-tunnel-vision, architecture, pre-dispatch | wave-117-retro | experimental | global |
| [completion-audit.md](completion-audit.md) | MANDATORY before any "done"/"shipped"/"complete"/"closed" claim: 5-field structured closure audit (Goal, Gaps remaining, Enforcement type, Closure level, If-less-than-100% deferred items). Prevents optimistic-completion-bias and partial-closure-via-documentation anti-patterns. | meta, process, anti-tunnel-vision, closure, quality-gate | wave-145 | experimental | global |

---

## How to search

```bash
# Find skills by tag
rg "zustand" .claude/skills/

# Find skills that reference a specific component
rg "VoiceHero" .claude/skills/

# Find skills with a specific anti-pattern topic
rg "sticky" .claude/skills/
```

---

## Adding a new skill

1. Copy `_TEMPLATE.md` to a new file named `kebab-case-skill-name.md`.
2. Fill all sections. Do not leave template placeholder text.
3. Add a row to this index.
4. Reference real file:line numbers only — verify they exist.
