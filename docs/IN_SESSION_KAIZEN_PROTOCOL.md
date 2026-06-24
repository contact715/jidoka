# In-Session Kaizen Protocol

The **real-time tier** of the self-improvement engine. Added 2026-06-24 (owner request).

## The gap this closes

The engine already catches recurrence — but only at wave/retro granularity:

| Tier | Mechanism | Cadence |
|------|-----------|---------|
| Per-wave | Skill Extractor, Reflexion Critic | each commit/wave |
| Cross-wave | self-improvement-reviewer (3-of-5 retros), meta-process-auditor | every 5 waves |
| Over-time | meta-trend, meta-generalize, meta-decay | whole ledger |

What was missing: a pattern that recurs **≥2× inside ONE live session** never surfaced until a retro — hours later, if at all. The owner named this directly: *"если ты видишь повторяющийся паттерн, например 2 раза за сессию, то ты предлагаешь на системном уровне решение, задаёшь вопросы что и как решать, и внедряешь."*

This protocol is that missing real-time tier.

## The rule

When the **same friction, mistake, or pattern recurs ≥2× within one session**, it is a SIGNAL. Do not let it die in the chat.

1. **Log it the moment you notice each occurrence** — `session-pattern-log.mjs log <class> "<note>"`. The tool tracks the running count and shouts `🔴 SURFACE NOW` when a class crosses the threshold (default 2).
2. **Surface it at the next natural pause** (owner's choice — not mid-action; at the end of the current step/task). Name the pattern to the owner in **plain language**.
3. **Decide who decides** (owner's standing rule, 2026-06-24):
   - **Technical "how"** (which script, which gate shape, where the file lives) — *you decide and just do it*, quality-first. Don't make the owner adjudicate implementation detail.
   - **Business / product decisions** (does this change behaviour the owner cares about, a trade-off, a direction) — *discuss in plain, accessible language* before acting.
4. **Fix it at the system level, in jidoka** — the engine, not the product. A reusable methodology, gate, hook, agent, or doc. Survey first (reuse-scan / existing engine) — addition is not free.
5. **Resolve + record** — `session-pattern-log.mjs resolve <class> "<fix>"` closes the open entries AND feeds the cross-wave meta-ledger (via `meta-log`), so the lesson joins meta-trend / meta-audit and outlives the session. Then record the change in **BOTH** places: global `~/.claude/CLAUDE.md` + the framework.

## Threshold & timing

- **Threshold**: 2 occurrences in one session (`$ISK_THRESHOLD`, default 2). Cross-wave stays at 3-of-5 — in-session is reactive and cheaper to raise, so it triggers sooner.
- **Timing**: the next natural pause, never mid-action.
- **"Same pattern"** is a semantic judgement (a café labelled a car-wash ≈ demo contradicts identity; "preview empty" ≈ "couldn't verify visually"). The tool counts; you canonicalise — same as the cross-wave reviewer.

## What counts as a pattern

Friction or a miss that repeats: a verification path that keeps failing the same way, a manual workaround you do twice, a class of mistake (declaration-over-implementation, asking the owner a too-technical question), a step that keeps getting skipped. Positive patterns count too — an approach worth codifying once it proves itself twice.

## Commands

```bash
# global install (cross-project): ~/.claude/jidoka/scripts/session-pattern-log.mjs
# framework repo:                  scripts/session-pattern-log.mjs

node scripts/session-pattern-log.mjs log    <class> "<note>"   # record one occurrence; nudges at the threshold
node scripts/session-pattern-log.mjs report                    # what to surface at the next pause
node scripts/session-pattern-log.mjs resolve <class> "<fix>"   # close + feed the meta-ledger
node scripts/session-pattern-log.mjs --self-test               # 6 checks, must be green
```

## Files

- Tool: `scripts/session-pattern-log.mjs` (tracked; mirrored to `~/.claude/jidoka/scripts/`)
- Ledger: `docs/audits/session-patterns.jsonl` (repo install) or `~/.claude/jidoka/docs/audits/session-patterns.jsonl` (global) — env override `SESSION_PATTERNS`
- Feeds: the global meta-ledger via `scripts/meta-log.mjs` on resolve
- Sits alongside: `docs/SELF_IMPROVEMENT_PROTOCOL.md` (the cross-wave tier)
