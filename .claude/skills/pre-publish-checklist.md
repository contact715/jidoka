# Skill: Pre-Publish Checklist — before any irreversible outward-facing action

> Source: 2026-05-29 session retro. Status: active. Tags: [security, irreversible, publication, git-history, self-application]

---

## When this MUST fire

Before ANY of these — they are **irreversible** (cache, forks, search indexing persist even after deletion):

- `git push` to a public repo, or flipping a repo to public visibility
- Sending files or data to an external party (Юра, a client, anyone outside)
- Deploy to production
- Posting to any external service (npm publish, a public gist, social, etc.)

If the action reaches an audience you can't fully recall — STOP and run this checklist.

---

## The failure this prevents

2026-05-29: `claude-code-dev-framework` was pushed to a **public** GitHub repo. The working tree had been anonymized (paths, names, brand) — but the cleanup happened **after** the initial commit, so git **history** still carried `/Users/<user>` (24 lines), a personal name (4), and `settings.local.json`. On a public repo, history is visible to everyone. The orchestrator declared "all clean, committed" having verified **only the working tree, not the history**. The user had to ask "scan again, carefully" to catch it.

**Root cause:** the quality environment (gates, andon, security-scanner) is wired to product CODE. The orchestrator's own meta-operations (git history, publication) bypass those gates. A critical irreversible operation ran without the environment's own security discipline applied to it.

---

## The checklist — every item must pass BEFORE the irreversible action

1. **Clean BEFORE the first commit.** For a new public repo: anonymize + scan the tree, THEN `git init`/commit. Never `git init` on a dirty tree and clean incrementally — the dirt stays in history forever.
2. **Scan HISTORY, not just the tree.** `git log --all -p | grep -iE '<private patterns>'` must be 0. **Tree-clean ≠ history-clean.** This is the line that was missed.
3. **Secrets** — keys, tokens, `-----BEGIN`, Bearer, connection strings — in tree AND history.
4. **Private identity** — absolute paths (`/Users/<user>`), usernames, emails, personal names, internal hostnames/IPs.
5. **Brand / confidential** — product names, internal IDs, anything not meant for this audience.
6. **Say the irreversibility out loud** — "this is public and irreversible" — before acting. When in doubt: private-first, then flip to public once verified.
7. **Verify AFTER** — confirm the remote reflects the clean state (visibility + `git log` on the remote).

---

## Recovery if history is already dirty

Force-push of a clean rewrite is **NOT sufficient** on a public repo: it leaves dangling commits reachable by SHA until GitHub GC (hours–days).

1. Rewrite to a single clean commit (orphan branch) + force-push.
2. **Immediately set the repo PRIVATE** to kill public access to dangling history.
3. Then **delete + recreate** the repo from the clean tree (or grant `delete_repo` scope so the agent can). Don't rely on GC.

---

## The principle (why this is in the framework)

**Apply the environment to itself.** The orchestrator's own irreversible actions are a *critical phase* under Constitution §8 and deserve the same gate discipline as product code. Quality-first is not only for the code we ship — it's for *how we ship it*. An environment that verifies everything except its own publication steps has a hole exactly where the cost of a mistake is highest (irreversible, public, personal data).

---

## Mechanical enforcement (not just this checklist)

A checklist that relies on the agent remembering to read it is not mechanical. This one is backed by a real gate:

- **`scripts/pre-publish-guard.mjs`** scans the working tree AND full git history (`git log --all -p`) for secrets, absolute home paths (`/Users/…`, `/home/…`), and an optional `.jidoka-denylist` of brand/personal terms. Exit 1 blocks.
- **`.githooks/pre-push`** runs the guard on every `git push`. Activate once per clone: `git config core.hooksPath .githooks`.
- **Verified to actually block**: injecting `/Users/<name>/` into a tracked file makes the guard fail the push (naming file:line); removing it unblocks. The check is unavoidable, not advisory.

To extend coverage, add brand or personal terms (one per line) to `.jidoka-denylist`.
