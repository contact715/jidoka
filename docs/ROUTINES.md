# Routines — scheduled maintenance

Wave-55 ships bundled weekly + monthly audit routines. They are NPM scripts that compose existing audits. The point: catch drift between sessions without manual triggering.

## Routines (three local npm audits + one scheduled Kaizen task)

### Daily: `npm run routine:daily`

The fastest cadence, added 2026-08-11. Admission is deliberately strict: a check
belongs here only if it (a) finishes in seconds, (b) dispatches no agents and
spends no tokens, and (c) can genuinely change within a day. Everything else
belongs in the weekly or monthly bundle.

1. **Official skills freshness** (`scripts/skills-freshness.mjs`): are the installed
   Anthropic skills and plugins still identical to what upstream ships?

No report file is written on purpose: 365 files a year go unread and a day-to-day
diff is meaningless. Output goes to stdout and the morning digest
(`~/.claude/hooks/daily-digest.sh`) folds it into that day's digest, and lifts
any `⚠ устарели: N` into the macOS notification itself, because a line in a file
nobody opens fixes nothing.

**Why this check exists.** `skills-audit.sh` (weekly, section 1) measures whether a
skill is USED. It cannot see that the skill itself was rewritten upstream while our
copy stayed put. On 2026-08-11 `frontend-design` turned out to be a half-year-old
4440-byte copy of an 8260-byte skill. The current one calibrates against three
templated "AI looks", works in two passes with a self-critique of the design plan,
and adds a whole section on interface copy. We found out from a social-media post,
not from any gate. Meta class: `installed-copy-drifts-from-upstream`.

**How it stays cheap.** One GitHub API call per repository returns a tree with every
blob's SHA. A git blob SHA is `sha1("blob <len>\0" + content)`, so it is computed
locally and compared without downloading a single file. Full run: ~1.4 s for 55 units.
`GITHUB_TOKEN` / `gh auth token` is used when present (rate limit 60/h → 5000/h).

Fail-open by design: no network, a timeout, or an exhausted rate limit reports the
gap and exits 0. A routine that fails on a plane gets switched off. But partial
coverage is never dressed up as full. When a source is unreachable the summary
leads with "проверено частично", never "все актуальны".

### Weekly — `npm run routine:weekly`

Bundles 6 fast checks (< 1 min total wallclock, no agent dispatch):

1. **Skills aging** (`scripts/skills-audit.sh`): citation counts per skill, flag dormant
2. **Design drift snapshot** (`scripts/design-drift-audit.sh`): 7 violation categories
3. **Audit backlog status** (`scripts/audit-backlog-status.sh`): open + escalated proposals
4. **Outcomes status** (`scripts/outcome-check.mjs`): which outcomes met / unmet
5. **Dev-system Kaizen** (`scripts/kaizen-feed.mjs`): how the way we build is trending
6. **Official skills freshness** (`scripts/skills-freshness.mjs`): installed copy vs upstream
   (same check as the daily routine; here it lands in the diffable weekly report)

Output: `docs/audit-reports/routine-weekly-YYYY-WNN.md`

Diff against prior week's report to see deltas. Action delta-worthy findings before new wave work.

### Between-wave sleep-time — `npm run routine:sleep`

After Letta's sleep-time idea (2026-W27): a wave closes, the agent is idle for a moment, so use
that moment to turn the wave's raw episodic traces into learned context that is READY before the
next session-start, instead of paying that cost on the next session's critical path.

It composes two existing scripts (no new memory logic):

1. **Consolidate** (`scripts/memory-consolidate.mjs`): rebuild the consolidated lessons digest
   (memory-consolidated.md, written to the global engine dir) from the cross-project mistake
   ledger (recency-weighted, decayed).
2. **Distill** (`scripts/reasoning-distill.mjs`): turn captured best-of-N / reflexion contrast
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

The weekly PROCESS itself is a closed, self-measuring loop (not a fresh report each week):
- **Closed-loop outcome tracking** — each run first audits the previous week's plan (shipped /
  open / rejected / regressed) against the live repo and maintains a persistent Kaizen ledger
  (a \_KAIZEN\_LEDGER json-lines file under the weekly research folder), so the process is
  accountable for its own past proposals.
- **Kaizen scorecard (analytics)** — week-over-week metrics: recs/week, adoption rate, mean
  time-to-implement, mistake-class closure, regression rate — trend, not a one-off number.
- **Cross-week rejection memory** — a rejected-candidates json-lines file in the same folder feeds
  the AI-war so the same rejected candidates aren't re-litigated every week.
- **Self-critique / completeness gate** — after synthesis the process critiques its own output
  (empty domains, source-less recs, session-review gaps) and lists what it couldn't close.
- **ROI ranking** — order by impact/effort; a REGRESSING `meta-trend` verdict forces gate
  strengthening above new features.

This is real machinery, not prose: `scripts/kaizen-{ledger,audit,scorecard,critique,rank,engine}.mjs`
(zero-dep, each with a `--self-test` run in CI). `kaizen-engine.mjs --dashboard` composes
audit→scorecard→rank→critique and renders the dashboard. Design: `docs/KAIZEN_ENGINE.md`.

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
| Daily bundle | `npm run routine:daily` → bash | launchd `com.mityamit.claude-daily-digest`, 09:00 | folded into `~/.claude/digests/YYYY-MM-DD.txt` + notification |
| Weekly bundle | `npm run routine:weekly` → bash | OS cron (or manual) | `docs/audit-reports/routine-weekly-*.md` |
| Monthly bundle | `npm run routine:monthly` → bash | OS cron (or manual) | `docs/audit-reports/routine-monthly-*.md` |
| Per-wave SI Reviewer | `.githooks/post-commit` → bash | Auto on commit when wave-NN % 5 == 0 | `.claude/self-improvement-queue/wave-NN.md` |
| Per-commit Reflexion | `.githooks/post-commit` → bash | Auto when diff > 100 TS LOC + > 3 files | `.claude/reflexion-queue/<sha>.md` |
| Per-commit wave-artifact | `.githooks/commit-msg` → bash | Every commit with wave-NN subject | inline error if missing |

6 distinct cadences, each closing a class of drift the next-finer cadence misses (per wave-41 architecture).

The daily bundle deliberately does NOT get its own launchd agent. One already fires
every morning at 09:00 for the digest; a second alarm for the same moment would be a
parallel mechanism to keep in sync, not extra safety. The digest calls the routine.

## Honest gaps

- **OS cron setup is opt-in.** The user has to install the launchd plist or crontab line. Without it, the routine scripts exist but don't fire automatically.
- **No CI integration.** Could add as a GitHub Actions schedule (`schedule: '57 8 * * 1'`). Skipped for v1 — local-first audit makes more sense than CI-only, because the artifacts (`docs/audit-reports/routine-*.md`) need to be local for the developer to diff against prior reports.
- **Deep audits in the monthly report are NOT auto-dispatched.** They're queued in the report; the orchestrator picks them up at the start of the next session. Honest design choice — agent dispatches need token budget that bash cron shouldn't decide.
