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
created: 2026-07-02
last_validated_against_parents: 2026-07-02
last_updated: 2026-09-17
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

## Layer 2b — The stash stack is shared (stops taking another session's work)

Set 2026-09-17, class `agent-uses-shared-git-stash`. A worktree has its own directory and
branch, but NOT its own stash: the stash ref lives in the common git dir, so the main checkout
and every worktree push onto and pop from ONE stack. With several sessions running, `git stash
pop` takes whatever is on top, and the top may be another session's work. Twice in one wave
(projectx-app, wave 368) an executor ran `git stash` / `git stash pop` to compare against a
baseline although its brief forbade it. Nothing was lost, by luck. A rule that lives only in a
brief is not a guard.

Enforced by `hooks/permission-gate.mjs` (PreToolUse on Bash, Monitor and
`mcp__terminal__run_in_terminal` — every tool that runs a shell command), rule in
`hooks/lib/git-stash-rule.mjs`. Allowed forms, because none of them can take someone else's
entry:

- `git stash list` / `git stash show` — read only
- `git stash push -m "<tag>"` (usually with `-u`) — a tagged entry you can find again
- `git stash apply <sha>` — by a fingerprint that does not shift. An all-digit value is NOT a
  fingerprint: git reads `apply 0000000` as `stash@{0}` (checked on a throwaway repo)
- `git stash drop <ref>` — an explicit ref, re-found by tag right before the drop

Everything else is blocked with exit 2: bare `git stash`, `save`, `pop`, `push` without `-m`,
`apply` without a sha, `drop` without a ref, `clear`, `branch`, `create`, `store`. There is no
permission for these: a safe replacement always exists, and a live `--no-verify` permission
does not switch this check off (it covers only its own action).

- set work aside → a temporary commit: `git add -A && git commit -m "WIP <tag>"`, undo with
  `git reset --soft HEAD~1`
- compare with a baseline → a separate folder: `git worktree add --detach <path> <base>`,
  remove with `git worktree remove <path>`
- if stash is unavoidable, the recipes the block message prints (they pass the guard):

```
git stash push -u -m "<tag>"
SHA=$(git stash list --format='%H %gs' | awk '/<tag>/{print $1; exit}'); git stash apply "$SHA"
REF=$(git stash list --format='%gd %gs' | awk '/<tag>/{print $1; exit}'); git stash drop "$REF"
```

Quote the variable. `"$SHA"` is accepted: an empty quoted value makes git fail and touch
nothing. `$SHA` without quotes is refused: an empty value vanishes and the command becomes a
bare `apply` / `drop` on the top entry.

The guard judges the ACTION, not a mention. `hooks/lib/shell-parse.mjs` reads the command into
real shell words (quotes make one word, a heredoc body is data, `$'…'` escapes are decoded, and
every word remembers whether it holds an unquoted expansion). `hooks/lib/shell-commands.mjs`
then works out what will run: `&&` / `;` / `|` chains, `git -C <dir>` and other global options,
env prefixes and wrappers (`env`, `env -S`, `timeout`, `nice`, `sudo`, `xargs`, `caffeinate`,
`stdbuf`), `find -exec`, `$(…)`, backticks, `bash -c '…'`, `eval`, a heredoc or herestring fed
to a shell, `bash -` / `bash /dev/stdin`, and `echo …|bash`, `printf …|sh`, `cat <<EOF …|bash`.
The git name itself is seen through too: `$G stash`, `GIT stash` (macOS ignores case), the
separate git-stash binary called by its full path, and `git -c alias.x='stash pop' x`. A commit message that says "git stash pop"
passes. `bash -c 'git stash pop'` does not.

A command nested deeper than the parser handles (256 levels of substitution, 6 levels of text
handed to a shell, 256 wrappers) is not waved through: it is blocked as "команда глубже
разбора". Legitimate commands never get there.

Red-teamed 2026-09-17 (84 blocked and 52 allowed shapes in
`scripts/__tests__/git-stash-guard.test.mjs`). Honest limits — not expanded, because their text
is not in the command: shell functions defined earlier, `source <file>`, a script run by path,
`curl … | bash`, code run by an interpreter (`node -e`, `python -c`), GNU parallel, brace
expansion (`{git,} stash`). `drop stash@{n}` is allowed by design — the ref is explicit, and the
recipe re-finds n by tag immediately before the drop.

The installer merges hooks by MATCHER + command (`global-setup/install-global.sh`, step 6).
Before 2026-09-17 it compared the command alone, so the second wiring of permission-gate
(Monitor|terminal) would have been dropped on every fresh install
(`scripts/__tests__/install-hooks-merge.test.mjs`).

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
node hooks/permission-gate.mjs --self-test   # --no-verify + shared git stash
```
