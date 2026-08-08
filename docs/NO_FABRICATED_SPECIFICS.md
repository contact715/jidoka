---
status: Active
version: 1.0.0
level: L1
type: core-arch
owner_role: platform
parents:
  - path: docs/NORTH_STAR.md
    version: 1.0.0
    relationship: implements
    fingerprint: 0c898d66
children: []
breaking_change_in_v: null
created: 2026-07-24
last_validated_against_parents: 2026-07-24
last_updated: 2026-07-24
---

# No Fabricated Specifics — verify the checkable detail before you state it

**Class:** `fabricated-verifiable-specific`
**Set:** 2026-07-24, owner escalation (projectx)
**Enforcement:** mechanical — `scripts/verify-claims.mjs` + `hooks/outbound-claims-gate.mjs`

## What happened

A partner-facing email to Thumbtack's developer program was drafted with:

```
Redirect URI: https://mosco.ai/auth/thumbtack/callback
```

Every part of that address was invented:

- `mosco.ai` serves the marketing site and answers **404** on that path
- no `/auth/thumbtack/callback` route exists anywhere in the repo — the codebase
  convention is `app/api/integrations/<provider>/callback` (see the Meta connector)
- the real app host per `docs/DEVOPS.md` is `app.mosco.ai`, which has **no DNS record**

It was produced by analogy with a February application form that used the same path shape
on the old marketing domain (castells.studio), and then presented to the owner as a fact
inside a letter about to go to a partner already running a KYB check on us. The owner
caught it by eye. No gate looked.

## Why the existing gates missed it

`proof-of-work-gate` and `browser-verify-gate` police whether WORK was proved. Engineering
Discipline rule 4 ("No 'done' without proof") polices claims ABOUT the work. Nothing
policed the FACTS embedded INSIDE a deliverable. A letter can be fully "done" — written,
formatted, ready — and still carry an address that does not exist.

## The rule

Any concrete, checkable specific gets its check run in the same turn, before it is stated.
Three tiers by blast radius:

1. **Leaving the machine** (email, client/partner message, public post, filing, API
   registration) — every specific verified before drafting, verification shown.
2. **Stated to the owner as fact** — verified, or explicitly labelled a proposal.
3. **Internal notes** — verified or marked `TODO(unverified)`. Never silent.

Never derive a specific from a sibling specific. A convention is a hypothesis; DNS, the
registry and the repo are the evidence.

## The tool

```bash
node scripts/verify-claims.mjs --file draft.md --repo /path/to/repo
node scripts/verify-claims.mjs --self-test      # 18 checks
```

Extracts every URL and email from a draft, then:

- resolves DNS (`NXDOMAIN` → DEAD)
- issues a real HTTP request (`404`/`410` → DEAD; `403`/`429` → PROTECTED, not dead)
- for hosts we own, looks for a matching Next.js App Router route in `app/`, honouring
  route groups `(x)` and dynamic segments `[id]` (no route → DEAD, even on a 200 host)

Only definitive negatives fail. Timeouts, 5xx and offline runs report UNVERIFIED and never
fail — a flaky link must not block honest work.

## The forcing function

`hooks/outbound-claims-gate.mjs`, wired into `~/.claude/settings.json`:

| Mode | Fires on | Effect |
|---|---|---|
| `PreToolUse` | any outbound send tool (email draft/send, Telegram, WhatsApp, iMessage, Slack, Jira/Confluence/GitHub comment) | verifies every URL/host in the payload, **blocks the send** on a dead address |
| `Stop` | end of turn | re-reads the session's own assistant text, verifies addresses on **owned** domains only, blocks **once** so an invented detail cannot stand uncorrected |

Fail-open throughout: missing verifier, no transcript, no network → exit 0. The Stop mode
checks owned domains only, so quoting third-party links in chat stays quiet.

**One refinement, found on the gate's first live firing:** it blocked the very message that
honestly disclosed both dead hosts. An address *reported as dead* is the correction, not the
defect. Stop mode now drops a finding when **every** mention of that address sits next to a
dead-marker (`404`, `no DNS`, "does not exist", "выдуман", "не поднят", …). A single bare
mention re-arms the block, so "admit it's dead, then put it in the form anyway" still fails.
PreToolUse is deliberately untouched: a dead address never leaves the machine, framed
however.

Owned domains: `~/.claude/owned-domains.json` (plain array). A domain absent from that list
is not policed as ours — keep it current when a product gets a new domain.

## Proof it works

Run against the original bad draft, from the projectx repo:

```
DEAD https://mosco.ai/auth/thumbtack/callback [ours]
      HTTP 404 — this address does not exist
      no matching route in this repo — the address is invented
ok   https://developers.thumbtack.com/docs/getting-started/authentication
      HTTP 200
ok   contact@castells.media [ours]
exit 1
```

Hook behaviour, six cases: blocks the send carrying the invented URI; passes the same
letter once the URI is removed; ignores non-sending tools; blocks the turn when the
invented address was only stated in chat; releases on the second Stop call (never locks);
stays silent on a clean transcript.

## Composes with

- Engineering Discipline rule 4 (proof for claims about work) — this covers facts inside
  the work
- Engineering Discipline rule 7 ("Don't fabricate") — this is its mechanical enforcement
- `BROWSER_VERIFICATION_MANDATORY.md` — same shape: look at the real thing before reporting
