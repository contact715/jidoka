---
status: Approved
version: 1.1.0
level: L3
type: master-spec
wave: wave-claim-wave-id
owner_role: chief-architect
parents:
  - path: docs/NORTH_STAR.md
    version: 1.0.0
    relationship: governs
  - path: docs/CONSTITUTION.md
    version: 2.0.0
    relationship: constraints
complexity: non-trivial
created: 2026-06-10
last_updated: 2026-06-11
---

# wave-claim-wave-id — Master Spec

## 1. Goal (business terms)

Two parallel sessions must be physically unable to take the same wave number. The convention
"git fetch before picking an id" failed in production use: the chosen number lives only in
session memory until the first commit, so the race window is hours wide. Real cost on
projectx (2026-06-10): the same number was taken three times in one day by two sessions,
two pushes were rejected, and generated files had to be hand-merged. Lost: rework time,
broken flow in both sessions, merge risk in generated registries.

## 2. Mechanism

`scripts/claim-wave-id.mjs` reserves a number by PUBLISHING the reservation immediately:

1. `git fetch <remote> <branch>` (remote/branch default to the upstream of HEAD).
   Detached HEAD (worktree, rebase, `checkout --detach`): the literal `HEAD` returned by
   `--abbrev-ref` is never accepted as a branch name — the script dereferences the remote's
   default branch via `git symbolic-ref refs/remotes/<remote>/HEAD`, and if that is not
   configured, fails loudly asking for an explicit `--branch`. Silently pushing to
   `refs/heads/HEAD` is forbidden in all cases (incident: projectx 2026-06-11, a stray
   `HEAD` branch on the remote plus a phantom claim reported as success).
2. Compute the next free number as max+1 over the UNION of sources: local
   `docs/retros|specs|runs` file names (catches a spec created locally and not yet pushed),
   the remote tree (`git ls-tree`), commit subjects of both local HEAD and the remote head,
   and the claim registry `docs/specs/_CLAIMED_WAVES.jsonl` (local file + remote version).
3. Append one JSONL record `{wave, n, session, ts, host}` and commit it DIRECTLY on top of
   the fetched remote head via git plumbing (`hash-object → read-tree` into a temp index
   `→ update-index → write-tree → commit-tree`), then `git push <sha>:refs/heads/<branch>`.
   The local branch, index, and working tree are never touched — a dirty tree or a branch
   N commits behind cannot block or pollute the claim.
4. A rejected push (non-fast-forward) is the compare-and-swap failure signal: re-fetch,
   recompute, take the next number, retry (default 5 attempts).
5. No remote / no remote branch → local fallback: append to the local registry with a warning.

Visibility for sibling sessions costs nothing extra: a successful push updates the local
remote-tracking ref, so the registry's remote version is readable via `git show @{u}:…`
without a pull. `hooks/session-start-digest.mjs` uses exactly that: at session start it
warns about fresh (<24h) claims — a fresh claim at session start is by definition another
session's, because this session has not claimed yet.

## 3. Acceptance criteria (each maps to an executable self-test)

- AC1: numeric ids are parsed from file names, paths, and commit subjects; feature-named
  waves (`wave-judge-debias`) do not occupy numbers. → claim-wave-id T1
- AC2: the first claim lands on the remote registry; the claimer's local branch, index, and
  working tree are untouched. → T2
- AC3: a second session sees the claim WITHOUT pulling and takes the next number. → T3
- AC4: a rejected push resolves to the next free number on the next attempt; the remote
  registry holds strictly sequential, duplicate-free claims. → T4 (deterministic race via
  the `beforePush` test hook)
- AC5: the registry alone is a sufficient source (a number that exists only as a claim is
  not reused). → T5
- AC6: with no remote, the claim falls back to a local registry append and says so. → T6
- AC7: an uncommitted local spec file occupies its number. → T7
- AC8: the session-start digest reports fresh (<24h) claims from the union of the local
  registry and its `@{u}` version, deduped, and stays silent outside git repos.
  → session-start-digest self-test
- AC9: from a detached-HEAD checkout with no explicit `--branch`, the claim either lands on
  the remote's default branch (when `refs/remotes/<remote>/HEAD` is configured) or fails
  with an explicit error naming `--branch`; under no outcome does a branch named `HEAD`
  appear on the remote. → T8

## 4. Wiring (not a ghost)

- `npm run claim:wave`; self-tests in `npm run test:engine` via
  `scripts/__tests__/claim-wave-id.test.mjs` and `session-digest-claims.test.mjs`.
- Installed into products by `install-into.mjs` (COMMON profile → `.jidoka/scripts/`).
- Process doc: `docs/AUTONOMOUS_PIPELINE.md` § "Wave-id claims (parallel sessions)".
- Registry: `docs/specs/_CLAIMED_WAVES.jsonl`, append-only; claims are permanent
  (numbers are cheap; expiry would reintroduce reuse races). The 24h TTL applies only
  to the digest warning, not to number reservation.

## 5. Out of scope

- Renaming feature-named waves to numbers (both schemes coexist; only numeric ids race).
- Auto-installing the registry into existing products (next standard install/update run
  delivers the script; the registry file is created by the first claim).
