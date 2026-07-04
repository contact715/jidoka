# Routines — scheduled maintenance

Wave-55 ships bundled weekly + monthly audit routines. They are NPM scripts that compose existing audits. The point: catch drift between sessions without manual triggering.

## Routines (two local npm audits + one scheduled Kaizen task)

### Weekly — `npm run routine:weekly`

Bundles 4 fast checks (< 1 min total wallclock, no agent dispatch):

1. **Skills aging** (`scripts/skills-audit.sh`) — citation counts per skill, flag dormant
2. **Design drift snapshot** (`scripts/design-drift-audit.sh`) — 7 violation categories
3. **Audit backlog status** (`scripts/audit-backlog-status.sh`) — open + escalated proposals
4. **Outcomes status** (`scripts/outcome-check.mjs`) — which outcomes met / unmet

Output: `docs/audit-reports/routine-weekly-YYYY-WNN.md`

Diff against prior week's report to see deltas. Action delta-worthy findings before new wave work.

### Between-wave sleep-time — `npm run routine:sleep`

After Letta's sleep-time idea (2026-W27): a wave closes, the agent is idle for a moment, so use
that moment to turn the wave's raw episodic traces into learned context that is READY before the
next session-start, instead of paying that cost on the next session's critical path.

It composes two existing scripts (no new memory logic):

1. **Consolidate** (`scripts/memory-consolidate.mjs`) — rebuild the consolidated lessons digest
   (memory-consolidated.md, written to the global engine dir) from the cross-project mistake
   ledger (recency-weighted, decayed).
2. **Distill** (`scripts/reasoning-distill.mjs`) — turn captured best-of-N / reflexion contrast
   into gated strategy candidates (private until ≥2 judges are calibrated, then shared through
   memory-guard's dedup).

Best-effort: a failing step is reported, never fatal — a sleep routine must not block the wave
that triggered it. Safe to call at wave close (`node scripts/sleep-consolidate.mjs`) or manually.

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

### Weekly enrichment / Kaizen — scheduled Claude task `jidoka-weekly-enrichment`

External-facing self-improvement (complements the internal weekly audit above). Every Monday
~09:00 a scheduled Claude Code task runs deep GitHub research + an AI-war (prosecutor/defender/judge
debates) to find new repos, methods and technologies that would strengthen jidoka, then writes a
ranked improvement plan. Mode: PROPOSE only — it never implements code, it surfaces a plan for the
owner to approve.

Two mandatory dimensions beyond the GitHub research (added 2026-07-04):
- **Session review** — the task analyses the last ~10 dev sessions for real errors, rework, and
  recurring mistake classes, grounded in DATA not impressions: session-log MCP when available, else
  the engine's own deterministic records (`meta-trend` verdict + ungated classes, `meta-audit`,
  `memory-consolidate`, the mistake ledger). Every finding becomes a concrete FIX proposal AND a
  dev-environment mechanism that closes the class for good (a hook/gate/lint-rule/agent), not a
  one-off. It heeds a REGRESSING `meta-trend` verdict — strengthen leaking/missing gates before
  adding new mechanisms.
- **Killer features** — 1–3 leverage moves per week that strengthen BOTH jidoka AND the Claude
  Code dev environment through jidoka (a forcing-function / gate / self-improvement loop /
  automation that makes EVERY project on the engine better), each tagged where it lands (jidoka repo
  and/or global `~/.claude`).

- Engine: `.claude/workflows/jidoka-enrichment.js` (recon current state → research 8 domains →
  adversarial verify → debates → ranked synthesis). Phase 0 reads the live jidoka state so it never
  re-proposes what is already shipped. Session review + killer-feature synthesis are run by the task
  agent around the workflow (see the scheduled task's SKILL.md for the exact steps).
- The task clones a clean `main` into `~/.jidoka-weekly`, runs the workflow there, writes
  `docs/research/weekly/jidoka-enrichment-YYYY-WNN.md`, commits + pushes to `main`, and notifies.
- Manage it from the Claude Code "Scheduled" sidebar, or `list_scheduled_tasks` /
  `update_scheduled_task` (taskId `jidoka-weekly-enrichment`). Runs while the app is open; if closed
  when due, runs on next launch.
- Run on demand: `Workflow({scriptPath:"<repo>/.claude/workflows/jidoka-enrichment.js"})`.

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
