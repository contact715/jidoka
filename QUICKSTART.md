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
