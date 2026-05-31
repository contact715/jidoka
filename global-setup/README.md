# Global setup — the part that makes EVERY project use the method

This folder is a **versioned snapshot of the global Claude Code setup** (`~/.claude`).
`~/.claude` itself is not a git repo, so without this snapshot the global pieces would
live only on disk. The engine and agents have their source of truth in this repo
(`scripts/`, `.claude/agents/`); this captures the **global-only** pieces.

## What's here
- `CLAUDE.md` — global instructions (anti-AI writing + senior engineering discipline: spec-first, no fake-done, decompose, protect secrets)
- `hooks/jidoka-guard.sh` — PreToolUse secret-guard: blocks `git push`/`commit` if secrets/PII are in tree or history (only in projects that opted in with `.jidoka/`)
- `hooks/jidoka-feature-reminder.sh` — UserPromptSubmit: when you say "хочу фичу", injects a reminder to start with business questions, not code
- `skills/dev-pipeline/SKILL.md` — the orchestration skill: business questions → master spec (architects) → tests → code → gates → debug → memory
- `settings-hooks-fragment.json` — the `hooks` block to merge into `~/.claude/settings.json` (paths use `$HOME`)
- `install-global.sh` — idempotent restorer

## Restore (new machine / after a wipe)
```sh
git clone https://github.com/contact715/jidoka.git
cd jidoka
sh global-setup/install-global.sh
# restart Claude Code so hooks load
```

## What you get
Open Claude in ANY project and it works as a disciplined senior team:
"хочу фичу X" → бизнес-вопросы → мастер-спека → тесты → код → гейты → дебаг → память.
Secrets are guarded on push. Lessons accumulate in the global cross-project ledger
(`~/.claude/jidoka/meta-mistakes.jsonl`) — a class caught in one project is known in all.

## To re-snapshot after changing the global setup
```sh
cp ~/.claude/CLAUDE.md global-setup/CLAUDE.md
cp ~/.claude/hooks/jidoka-*.sh global-setup/hooks/
cp ~/.claude/skills/dev-pipeline/SKILL.md global-setup/skills/dev-pipeline/
# then replace absolute /Users/<you> with $HOME, commit, push
```
