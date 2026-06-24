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
