# Push-gate gotchas — long pre-push gates and the SSH idle-drop

Projects on jidoka with a heavy pre-push verify-gate (tsc + full serial vitest +
`next build`) keep a single `git push` running for **8–15 minutes**. During that
whole window the SSH/transport connection to the remote sits **idle** (no bytes
flow until the gate passes and git finally uploads the pack).

## The failure

GitHub (and most SSH hosts) drop an idle connection after a few minutes. So the
gate goes green, git tries to send objects, and the connection is already dead:

```
Connection to github.com closed by remote host.
fatal: the remote end hung up unexpectedly
```

This is **the same root cause as the recurring `SIGPIPE 141` on push** — not a
transport flake, an **idle-timeout**. Retrying just burns another 10-minute gate
cycle and hits the same wall. Caught & fixed in projectx-app 2026-06-24 after it
had recurred across several sessions under different symptoms.

## The fix (environment, durable, reversible)

Keep the SSH connection alive for the duration of the gate. Add to `~/.ssh/config`:

```
Host github.com
    ServerAliveInterval 30
    ServerAliveCountMax 20
    TCPKeepAlive yes
```

A keepalive every 30s resets the host's idle timer, so the connection survives a
15-minute gate. Proven: the exact push that previously died at ~5:30 completed
with **0 connection drops**, gate PASS, ref advanced.

## Reliable push recipe (heavy gate)

1. `rm -rf .next` — stale `.next/types` can fail the gate's tsc (separate gotcha).
2. `nohup git push origin HEAD:dev > push.log 2>&1 </dev/null &` — detach so the
   harness doesn't kill it on the gate's huge stdout (the original `SIGPIPE 141`
   surface).
3. Poll `git ls-remote origin dev` until it equals local `HEAD`. **Be patient —
   the serial vitest genuinely runs 10–15 min.** Watch `push.log` for
   `closed by remote` (now should be 0) and `verify-gate. PASS`.

## Why serial vitest

Full-tree vitest runs with `fileParallelism: false` in these repos (CLI/spec
tests share the filesystem and race in parallel), so the suite is slow by design.
Don't parallelize it to speed the gate — fix the wait instead (keepalive above).

## Mass test failures in the gate = a corrupted shared fixture, not "flakiness"

Caught the hard way in projectx-app 2026-06-24 (cost ~40 steps of wrong theories).

When a pre-push gate fails on **many** tests at once (10-25) with the **same**
error, and especially when the SAME files fail every run, the cause is almost
always a **corrupted shared fixture**, not parallelism or random flake.

Suites where CLI/coverage tests temporarily swap a canonical file (an agent
roster, a registry, a baseline JSON) and restore it in a `finally` are fragile:
**if a full test run is interrupted** (kill, Ctrl-C, timeout) while the swap is
live, the canonical file is left in its stub state on disk, and every subsequent
run deterministically fails the dozens of tests that validate against it.

Rules:
- **Never interrupt a full test run** that swaps shared fixtures. Let it finish;
  wait with a real sleep (`perl -e 'select(undef,undef,undef,N)'`), not a foreground
  `sleep` and not `read </dev/zero` (which may not block).
- **Diagnose mass failures with `git status` FIRST** — look for a gutted/corrupted
  tracked fixture (huge unexpected deletion). `git checkout -- <file>` fixes it.
  Tell-tale: the SAME files fail every run (persistent corruption) vs DIFFERENT
  files each run (genuine intermittent race).
- A subset run (`vitest run path/to/dir`) is NOT a valid repro for suite-level
  failures — coverage tests often depend on state set up by tests outside the subset.
- Adversarial-retry caution: `vitest retry` on a test that holds a shared file in a
  bad state AMPLIFIES the cascade (longer corruption window). Retry the racy check
  INLINE instead, and only when it writes a benign (current, not zeroed) state.
