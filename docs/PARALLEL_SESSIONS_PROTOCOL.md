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
children: []
breaking_change_in_v: null
created: 2026-07-02
last_validated_against_parents: 2026-07-02
last_updated: 2026-07-02
---

# Parallel Sessions Protocol — one folder, one session; commits by turns; work serial

Set 2026-07-02. The recurring pain: 2, 3, 4 Claude sessions run at once in the same repo.
They overwrite each other's edits, fight over the dev server and browser, and race to push
so commits get buried or a push is rejected and hand-fixed under pressure. This protocol
closes all of that at the system level so we do not return to it.

Three layers, each with a mechanical half (a script) and a semantic half (the model/human
decides). The scripts live in `scripts/` and every one is `--self-test` green.

## Layer 1 — One folder = one session (stops edit-clobbering and server fights)

`session-lock.mjs` already leases a working tree per folder and is wired on
`UserPromptSubmit`. On a conflict it now tells the session what to do:

- Move into an isolated copy: `EnterWorktree` (own directory, own branch). Different folder
  means edits cannot collide and you may start your own dev server on your own port without
  touching the live one the first session holds.
- Or close the second session.

The lock warns, it does not hard-block: the human may intentionally run two sessions and
accept the risk. A silent race is the failure mode, not parallelism.

## Layer 2 — Commit by turns (stops lost commits) — the core fix

Never run raw `git commit && git push` when sessions run in parallel. Use:

```
node scripts/safe-commit.mjs --message "feat: ..." [--repo <path>] [--session <id>] [--target main]
```

What it does, and why it cannot lose a commit:

1. commit locally (clean tree needed for the rebase in step 3)
2. acquire the per-repo **commit-lock** (`commit-lock.mjs`) — from here no other session may
   enter the commit section for this repo
3. `git fetch` then `git rebase origin/<target>` — replay your work on the very latest main
4. `git push HEAD:<target>` — a fast-forward, guaranteed, because you just rebased onto the
   latest main AND you hold the lock, so main cannot have moved under you
5. release the lock

Because steps 3-4 are inside the lock, the window a race needs is closed. Proven live
2026-07-02: two sessions pushing concurrently, both commits survived on the shared main.

**Push policy** (`commit-policy.json`, Engineering-Discipline rule 11):

- `own` (your repos, e.g. contact715/jidoka, projectx) → commit + push to main
- `readOnly` (external/shared production, e.g. nicel3d/castells) → **local commit only, never push**
- unknown remote → safe default: local commit only, do not push, warn

A rebase conflict is not auto-resolved. safe-commit aborts the rebase cleanly, keeps your
commit safe locally, releases the lock, and hands back to you to resolve.

## Layer 3 — Serial task queue (one task at a time)

`task-queue.mjs` holds the backlog and enforces one invariant: at most ONE task is
`in_progress` at any moment, however many are queued (30, 40, 50).

```
node scripts/task-queue.mjs add "title" [--prompt "..."] [--repo <path>]
node scripts/task-queue.mjs status          # counts + which task is active
node scripts/task-queue.mjs next            # start next — REFUSES if one is still open
node scripts/task-queue.mjs done <id>       # then pull the next one
node scripts/task-queue.mjs fail <id> "why"
```

Autonomous loop for a worker session — **the default behaviour, no reminder needed**
(set 2026-07-02): while working autonomously and the queue has waiting items, drive it.

```
next → (blocked? stop) → do the task fully → verify → safe-commit → done <id> → next
```

The session-start digest surfaces `очередь задач: N ждут · в работе: …` so the standing
queue is always visible at the top of every session.

The app's "Suggested task" cards can be routed into this queue (by you or by Claude via
`add`). If the app later gains the ability to launch cards itself, they still flow through
Layer 2, so the commit safety is inherited for free.

> Honest limit: this session cannot click the app's "Start locally" chips or auto-spawn app
> sessions — that is an app feature, not a framework capability. The framework owns the
> serial engine and the commit safety; the chips are fed into it.

## Quick health check

```
node scripts/commit-lock.mjs  --self-test
node scripts/safe-commit.mjs  --self-test
node scripts/task-queue.mjs   --self-test
node scripts/session-lock.mjs --self-test
```
