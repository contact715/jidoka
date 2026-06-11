# claim-wave-id — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mechanical wave-id reservation so two parallel sessions can never take the same wave number (projectx-app 2026-06-10: triple collision wave-203/204/205, two rejected pushes).

**Architecture:** A claim is a one-line JSONL record pushed to the remote branch as a micro-commit built **on top of the fetched remote head via git plumbing** (hash-object → read-tree → update-index → write-tree → commit-tree → push `<sha>:refs/heads/<branch>`). The local branch, index, and working tree are never touched, so a dirty tree or a branch that is N commits behind cannot break the claim. A rejected push (non-fast-forward) is the CAS failure signal: re-fetch, recompute next free number, retry. Visibility for sibling sessions is free: a successful push updates the local remote-tracking ref, and the session-start digest reads the registry from `@{u}` + the local file.

**Tech Stack:** zero-dep Node (node:fs, node:child_process), git plumbing, node:test wrapper for `npm run test:engine`.

**Registry:** `docs/specs/_CLAIMED_WAVES.jsonl`, append-only, one JSON object per line: `{wave, n, session, ts, host}`.

**Number sources (union, max+1):** local FS scan of `docs/retros|specs|runs` for `wave-(\d+)`, same scan of the remote tree (`git ls-tree -r <remoteRef>`), registry (local file + `git show <remoteRef>:registry`), commit subjects (`git log --pretty=%s -200` on HEAD and remoteRef). Covers: spec created locally but not pushed; claim on remote not yet pulled; wave referenced only in commit messages.

---

### Task 1: Failing test wrapper (RED)

**Files:** Create `scripts/__tests__/claim-wave-id.test.mjs` — spawns `node scripts/claim-wave-id.mjs --self-test`, asserts exit 0.
Run: `npm run test:engine` → FAIL (script missing). Commit with Task 2.

### Task 2: Self-test first, stubs only (RED)

**Files:** Create `scripts/claim-wave-id.mjs`: full `selfTest()` (scenarios T1–T7 below) calling exported stubs that `throw new Error('not implemented')`.

- T1 unit: `parseWaveNumbers` extracts {205,12,9} from mixed names, ignores `wave-judge-debias`.
- T2 first claim (bare origin + clone A seeded with `docs/retros/wave-206.md`) → `wave-207`; registry line lands on the bare; A's HEAD and working tree untouched.
- T3 second clone B claims → `wave-208` (sees A's claim only through the remote registry).
- T4 race: B's `beforePush` hook lets A claim 209 first → B's push rejected → retry → B returns 210 with `attempts === 2`; bare registry = 207,208,209,210.
- T5 registry-only source: after T7 the max (501) lives only in the registry → B claims 502.
- T6 no-remote repo → local fallback: appends to local registry, returns next number, `mode: 'local'`.
- T7 uncommitted local spec counts: A creates `docs/specs/wave-500_MASTER_SPEC.md` (not committed) → claim returns 501.

Run: `node scripts/claim-wave-id.mjs --self-test` → FAIL list (stubs).

### Task 3: Implement (GREEN)

`parseWaveNumbers`, `collectUsed`, `claimWave({root, session, remote, branch, registryRel, maxAttempts, beforePush})` per Architecture. CLI: `--session --remote --branch --registry --max-attempts --json --self-test`; stdout = `wave-N`, narrative на stderr. Run self-test → PASS; `npm run test:engine` → all green. Commit: `feat(wave): claim-wave-id — атомарное резервирование номера волны`.

### Task 4: Session-start digest warning (RED → GREEN)

**Files:** Modify `hooks/session-start-digest.mjs`: extract `freshClaims(root)` (registry union local + `@{u}`, claims < 24h, dedupe), add `--self-test` (temp repo: fresh + stale claim → only fresh reported). Output line: `⚠️ занятые wave-id (клеймы <24ч): wave-207 (sess, 3ч) — следующий бери через claim-wave-id`. Hook stays always-exit-0, silent on errors. Commit.

### Task 5: Wiring + docs

- `scripts/install-into.mjs`: add `'claim-wave-id.mjs'` to COMMON; run `--self-test` → green.
- `package.json`: `"claim:wave": "node scripts/claim-wave-id.mjs"`.
- `README.md`: script count +1.
- `docs/AUTONOMOUS_PIPELINE.md`: short section — wave numbering goes through claim-wave-id before any spec file is created.
- `docs/specs/wave-claim-wave-id_MASTER_SPEC.md`: master spec (frontmatter per validate-spec-frontmatter).
- `~/.claude/CLAUDE.md`: one line in dev-pipeline section (env-wide rule lives in BOTH places).
Commit: `chore(wave): wire claim-wave-id — installer, digest, docs`.

### Task 6: Ship

Push `claim-wave-id`; fast-forward `origin/main`; mirror to `~/.claude/jidoka/scripts/`, `~/.claude/jidoka/hooks/`, `~/.claude/hooks/`; run installed copy's `--self-test` as proof; remove worktree.
