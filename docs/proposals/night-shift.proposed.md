# Proposal (DEFERRED, not built): Night Shift — one autonomous wave while you sleep

**Status:** designed, intentionally NOT implemented yet. This is a record, not a stub.
**Why deferred:** building it now would violate the "addition is not free" rule — it would sit
dead until its preconditions exist. See the kill-precedent below.

## The pain it would close
The pipeline only runs while the user is at the keyboard. Pending hands-off tails (a fully-specced
fix, an archived backlog item) wait for a human. The user asked for autonomy three times.

## Why it is NOT built today (honest preconditions)
1. **Kill-precedent:** `scripts/cron-audit.mjs` was a "nightly autonomous run" that executed once
   (3 entries 2026-05-31) and died — never wired to any scheduler. The only nightly job that LIVES
   is `daily-digest` (a passive reader/reporter). Signal: passive readers survive, ambitious writers
   rot. A night shift built before its supports would be the next corpse.
2. **The Mac sleeps at 01:00** (`pmset` shows no scheduled wake then) — a launchd job would not fire.
   A real pilot needs `pmset repeat wakeorpoweron` first.
3. **Phone delivery is deferred:** the morning report + the "approve?" round-trip need Telegram
   delivery, which the user chose to defer (2026-06-10). Without it the night shift is half-blind.

## What is NOW in place that it depends on (built this wave)
- ✅ **Independent acceptance verdict** (`run-state` + `acceptance-verdict.mjs`): a night wave can no
  longer report "done" without a re-run proof — the foundation that makes unattended work trustable.
- ✅ **Red lamp** (`enforcement-reconcile` in the digest): a bypassed/false-refused gate surfaces the
  morning after.
- ⏳ **Carket Andon (phone delivery)** — deferred with Telegram.

## The minimal pilot to build WHEN unblocked (no new services)
1. Clone the one proven scheduler — the `daily-digest` launchd plist — to 00:58, plus
   `pmset repeat wakeorpoweron` so the Mac is awake.
2. It runs `claude -p` (headless) with ONE prompt: take the top item from the existing
   `docs/audits/backlog.jsonl` marked "no human questions", run the normal pipeline, journal position
   via `run-state.mjs`, and STOP at the first question (stopping IS andon — invent nothing).
3. Closing the wave is already gated by the acceptance verdict (built). The morning `daily-digest`
   appends the night's `STATE.md` position + the `approval-queue` tail.
4. **Kill-criteria (2-week pilot):** did the Mac actually wake? did the user actually approve a
   morning result? If not after 2 weeks, do not build the bigger version.

## Do NOT build before the pilot
Dynamic-workflow self-authored orchestrators, a `night-queue.md` (duplicates `backlog.jsonl`),
resume-after-crash machinery. The minimal pilot is the honest test; the rest is speculation.
