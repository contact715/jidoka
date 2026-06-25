# jidoka — Quickstart

jidoka is an agentic engineering framework for Claude Code. It runs a build through a senior-engineer
pipeline (business questions, spec, tests, code, gates, learning) and refuses to call work "done"
without an executable proof. Its core rule is mechanism, not declaration: every claim points at a
script that runs.

This page gets you to a first build in minutes. The philosophy (`README.md`, `docs/CONSTITUTION.md`,
`docs/TOYOTA_WAY.md`) can wait until after you have shipped something.

## Run your first build

Drive it phase by phase with slash commands. Each phase has a fresh agent context, and the position is
journaled to disk so an interrupted build resumes instead of restarting.

```
/jidoka-new-project   a one-line description of what you want
/jidoka-plan          wave-01 normal backend,frontend     # composes the agent graph + opens the journal
/jidoka-build         wave-01                              # implements against the real contract
/jidoka-verify        wave-01                              # runs the gates + proves it executes
/jidoka-ship          wave-01                              # pre-publish guard + captures the lesson
```

Lost your context or starting a new session mid-build?

```
/jidoka-resume        # reads docs/runs/<wave>/STATE.md, tells you what is done and what is next
```

## Install jidoka into an existing project

Pick a profile by how much you need. The learning kernel (the meta-engine, honesty audit, sandbox,
run-state) ships in every profile; heavier profiles add more gates.

```
node scripts/install-into.mjs /path/to/your/project --profile=core      # smallest, still honest
node scripts/install-into.mjs /path/to/your/project --profile=standard  # default: kernel + everyday gates
node scripts/install-into.mjs /path/to/your/project --profile=full      # everything
```

The installer is secret-safe: it ensures `.gitignore` covers secret-shaped files before wiring any git
hooks, and it never runs `git add` or `git commit`.

## Make Jidoka always run in Codex

Codex reads global instructions from `~/.codex/AGENTS.md`. Install the Jidoka Codex bootstrap once:

```
sh global-setup/install-codex.sh
```

This writes `~/.codex/AGENTS.md` and mirrors framework scripts/docs/skills to `~/.codex/jidoka/`.
Start a new Codex session after running it.

## Route Fable 5 vs Codex 5.5

Use Fable 5 for architecture, root-cause investigation, long-horizon planning, and high-risk review.
Use Codex 5.5 for local implementation, tests, builds, browser/terminal work, and final proof.

```
node scripts/jidoka.mjs model-route --task-text "plan a billing migration" --json
node scripts/jidoka.mjs model-route --task-text "add a button and run tests" --json
node scripts/jidoka.mjs model-route --task-text "review this auth diff" --phase after-code --changed-lines 120 --json
```

Protocol: `docs/MODEL_ROUTING_PROTOCOL.md`. Handoff templates:
`docs/templates/FABLE_HANDOFF.md` and `docs/templates/FABLE_REVIEW.md`.

## Run Claude and Codex together without an API

For normal use, just write the task. Jidoka classifies it first and only starts the relay when Fable 5 is useful.

```
node ~/.codex/jidoka/scripts/jidoka.mjs model-route --task-text "plan and implement the billing migration" --json
```

Start the local watchers:

```
node ~/.codex/jidoka/scripts/jidoka.mjs relay start-watchers --allow-codex-write
```

Then work from one window:

```
node ~/.codex/jidoka/scripts/jidoka.mjs relay auto --cwd "$PWD" --from user --task "plan and implement the billing migration" --allow-codex-write
```

The relay stores every run in `~/.jidoka/relay/runs/`. Fable has a default `240000ms` timeout; Codex has a default `600000ms` timeout. Override them with `--claude-timeout-ms`, `--codex-timeout-ms`, `JIDOKA_CLAUDE_TIMEOUT_MS`, or `JIDOKA_CODEX_TIMEOUT_MS`.

If Fable times out, Codex is queued with an explicit local fallback instead of leaving the run stuck. Timeout fallback is not a Fable handoff. See `docs/LOCAL_RELAY_PROTOCOL.md`.

## Check the system anytime

```
/jidoka-health     eval pass-rate, engine self-tests, ghosts, measured judges, regressions
/jidoka-audit      recurring mistakes, regressions, ghost mechanisms (declared but not real)
/jidoka-eval       the deterministic eval suite vs baseline
/jidoka-steward    a project's North Star + Integrity Charter + defense readiness
```

## Go deeper (after your first build)

- `README.md` — the full map of scripts, agents, and docs
- `docs/AUTONOMOUS_PIPELINE.md` — the build flow and the resumable run-state
- `docs/CONSTITUTION.md` + `docs/TOYOTA_WAY.md` — the quality philosophy
- `~/.claude/skills/dev-pipeline/SKILL.md` — how the orchestrator leads the agent team

What you get that a lighter tool does not: a deterministic eval suite that proves the engine itself has
not regressed, a cross-session learning loop that turns each mistake into a gate, and an anti-ghost
audit that keeps "we have a gate" meaning the gate actually runs.
