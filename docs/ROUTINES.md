# Routines — scheduled maintenance

Wave-55 ships bundled weekly + monthly audit routines. They are NPM scripts that compose existing audits. The point: catch drift between sessions without manual triggering.

## Two routines

### Weekly — `npm run routine:weekly`

Bundles 4 fast checks (< 1 min total wallclock, no agent dispatch):

1. **Skills aging** (`scripts/skills-audit.sh`) — citation counts per skill, flag dormant
2. **Design drift snapshot** (`scripts/design-drift-audit.sh`) — 7 violation categories
3. **Audit backlog status** (`scripts/audit-backlog-status.sh`) — open + escalated proposals
4. **Outcomes status** (`scripts/outcome-check.mjs`) — which outcomes met / unmet

Output: `docs/audit-reports/routine-weekly-YYYY-WNN.md`

Diff against prior week's report to see deltas. Action delta-worthy findings before new wave work.

### Monthly — `npm run routine:monthly`

Heavier audit (~15-30 min including agent dispatches the orchestrator picks up from the report):

1. Quick repo stats (LOC, commits, skill count)
2. Security patterns scan (`scripts/check-security-patterns.sh`)
3. Dependency drift (`npm outdated`)
4. Bundle size baseline drift
5. Deep audits queue (orchestrator dispatches these from the report):
   - Philosophy vs Product re-audit (compare to `2026-05-23_philosophy-vs-product-audit.md`)
   - Cartographer whole-repo duplicate re-audit (compare to `2026-05-23_duplicate-surface-audit.md`)
   - Skills aging deep dive

Output: `docs/audit-reports/routine-monthly-YYYY-MM.md`

## Wiring to OS-level cron

The `npm run` commands work standalone. To run them automatically:

### macOS (launchd)

Create `~/Library/LaunchAgents/com.app.routine.weekly.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.app.routine.weekly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd ~/the-app && /opt/homebrew/bin/npm run routine:weekly</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>57</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/routine-weekly.log</string>
  <key>StandardErrorPath</key><string>/tmp/routine-weekly.log</string>
</dict>
</plist>
```

Then:

```
launchctl load ~/Library/LaunchAgents/com.app.routine.weekly.plist
```

Monthly variant: change `StartCalendarInterval` to `{ Day: 1, Hour: 9, Minute: 13 }`.

### Linux / crontab

```
# Weekly: Mondays at 08:57
57 8 * * 1 cd ~/the-app && npm run routine:weekly >> /tmp/routine-weekly.log 2>&1

# Monthly: 1st at 09:13
13 9 1 * * cd ~/the-app && npm run routine:monthly >> /tmp/routine-monthly.log 2>&1
```

### Why off-minute timestamps (57, 13)?

If everyone uses `0 9 * * 1` ("Monday 9am sharp"), distributed cron systems thunder herd. Off-minute (e.g. 57 or 03) spreads load. Borrowed from Anthropic's CronCreate guidance.

## Why NPM scripts, not Claude session crons

`CronCreate` (Claude session tool) is session-scoped. Even with `durable: true` it persists across restarts but expires after 7 days for recurring tasks. That's not "weekly forever" — it's a one-shot countdown.

For true scheduled routines, OS-level cron is the right primitive. Claude session reminders are useful for "remind me in this session if I forget".

## What lives where

| Routine | Tool | Schedule | Output |
|---|---|---|---|
| Weekly bundle | `npm run routine:weekly` → bash | OS cron (or manual) | `docs/audit-reports/routine-weekly-*.md` |
| Monthly bundle | `npm run routine:monthly` → bash | OS cron (or manual) | `docs/audit-reports/routine-monthly-*.md` |
| Per-wave SI Reviewer | `.githooks/post-commit` → bash | Auto on commit when wave-NN % 5 == 0 | `.claude/self-improvement-queue/wave-NN.md` |
| Per-commit Reflexion | `.githooks/post-commit` → bash | Auto when diff > 100 TS LOC + > 3 files | `.claude/reflexion-queue/<sha>.md` |
| Per-commit wave-artifact | `.githooks/commit-msg` → bash | Every commit with wave-NN subject | inline error if missing |

5 distinct cadences, each closing a class of drift the next-finer cadence misses (per wave-41 architecture).

## Honest gaps

- **OS cron setup is opt-in.** The user has to install the launchd plist or crontab line. Without it, the routine scripts exist but don't fire automatically.
- **No CI integration.** Could add as a GitHub Actions schedule (`schedule: '57 8 * * 1'`). Skipped for v1 — local-first audit makes more sense than CI-only, because the artifacts (`docs/audit-reports/routine-*.md`) need to be local for the developer to diff against prior reports.
- **Deep audits in the monthly report are NOT auto-dispatched.** They're queued in the report; the orchestrator picks them up at the start of the next session. Honest design choice — agent dispatches need token budget that bash cron shouldn't decide.
