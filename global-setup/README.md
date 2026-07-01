# Global setup — the part that makes EVERY project use the method

This folder is a **versioned snapshot of the global Claude Code setup** (`~/.claude`).
`~/.claude` itself is not a git repo, so without this snapshot the global pieces would
live only on disk. The engine and agents have their source of truth in this repo
(`scripts/`, `.claude/agents/`); this captures the **global-only** pieces.

Codex has its own global entrypoint: `~/.codex/AGENTS.md`. This folder also snapshots
that bootstrap so Jidoka is active in every Codex session, not only in projects with
a local `AGENTS.md`.

## What's here
- `CLAUDE.md` — global instructions (anti-AI writing + senior engineering discipline: spec-first, no fake-done, decompose, protect secrets)
- `hooks/jidoka-guard.sh` — PreToolUse secret-guard: blocks `git push`/`commit` if secrets/PII are in tree or history (only in projects that opted in with `.jidoka/`)
- `hooks/jidoka-feature-reminder.sh` — UserPromptSubmit: when you say "хочу фичу", injects a reminder to start with business questions, not code
- `skills/dev-pipeline/SKILL.md` — the orchestration skill: business questions → master spec (architects) → tests → code → gates → debug → memory
- `settings-hooks-fragment.json` — the `hooks` block to merge into `~/.claude/settings.json` (paths use `$HOME`)
- `install-global.sh` — idempotent restorer
- `CODEX_AGENTS.md` — global Codex instructions installed to `~/.codex/AGENTS.md`
- `install-codex.sh` — idempotent Codex-only restorer; also mirrors scripts/docs/skills to `~/.codex/jidoka/`

## Restore (new machine / after a wipe)
```sh
git clone https://github.com/contact715/jidoka.git
cd jidoka
sh global-setup/install-global.sh
# restart Claude Code and start a new Codex session so hooks/instructions load
```

Codex-only refresh:

```sh
sh global-setup/install-codex.sh
```

## What you get
Open Claude in ANY project and it works as a disciplined senior team:
"хочу фичу X" → бизнес-вопросы → мастер-спека → тесты → код → гейты → дебаг → память.
Secrets are guarded on push. Lessons accumulate in the global cross-project ledger
(`~/.claude/jidoka/meta-mistakes.jsonl`) — a class caught in one project is known in all.

Open Codex in ANY project and it loads Jidoka from `~/.codex/AGENTS.md`: target-first,
reuse-before-build, spec-before-code when available, Andon stop-the-line, proportional
process, executable proof before done.

Codex also gets the model-routing layer: Fable 5 is reserved for architecture, root-cause
investigation, long-horizon planning, and high-risk review; Codex 5.5 owns local
implementation, terminal/browser verification, integration, and final evidence.
The active agent classifies ordinary user tasks automatically; the user does not need
to say "use Jidoka" or "use Fable".

```sh
node ~/.codex/jidoka/scripts/jidoka.mjs model-route --task-text "review this auth migration" --json
```

The mirrored protocol and templates live under `~/.codex/jidoka/docs/`.

For no-API coordination, start the local relay watchers:

```sh
node ~/.codex/jidoka/scripts/jidoka.mjs relay start-watchers --allow-codex-write
```

Then run a whole task from one window:

```sh
node ~/.codex/jidoka/scripts/jidoka.mjs relay auto --cwd "$PWD" --from user --task "..." --allow-codex-write
```

## To re-snapshot after changing the global setup
```sh
cp ~/.claude/CLAUDE.md global-setup/CLAUDE.md
cp ~/.claude/hooks/jidoka-*.sh global-setup/hooks/
cp ~/.claude/skills/dev-pipeline/SKILL.md global-setup/skills/dev-pipeline/
cp ~/.codex/AGENTS.md global-setup/CODEX_AGENTS.md
# then replace absolute /Users/<you> with $HOME, commit, push
```
