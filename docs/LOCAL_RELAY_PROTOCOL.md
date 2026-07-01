# Local Relay Protocol

## Purpose
- Run Claude Code and Codex as two local workstations without a custom API.
- Use the local `claude` CLI for Fable 5 planning/review.
- Use the local `codex exec` CLI for GPT-5.5 implementation/proof.
- Coordinate through files in `~/.jidoka/relay`.
- Let the agent decide automatically when relay is needed.

## Automatic Intake
The user can write a normal task. The active agent classifies it:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs model-route --task-text "<task>" --json
```

- `automation.autoRelay: true` means run `relay auto`.
- `automation.mode: direct-codex` means stay in the current Codex session.
- `automation.mode: redact-then-relay` means redact locally before any Fable handoff.
- Relay worker prompts must not call the relay again.

## Start The Watchers
One command starts both local watchers in the background:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay start-watchers --allow-codex-write
```

Timeouts are active by default:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay start-watchers --allow-codex-write --claude-timeout-ms 240000 --codex-timeout-ms 600000
```

- Fable/Claude default timeout: `240000ms`.
- Codex default timeout: `600000ms`.
- Environment overrides: `JIDOKA_CLAUDE_TIMEOUT_MS`, `JIDOKA_CODEX_TIMEOUT_MS`.
- Restart watchers after changing timeout settings.

Status and stop:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay watcher-status
node ~/.codex/jidoka/scripts/jidoka.mjs relay stop-watchers
```

## Submit A Task
One-window mode from any repo:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay auto --cwd "$PWD" --from user --task "plan and implement the billing migration" --allow-codex-write
```

Queue-only mode:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay start --cwd "$PWD" --from user --task "plan and implement the billing migration"
```

## Flow
- If the task needs Fable first, the Claude watcher runs `claude --model fable` in planning mode.
- The relay saves Fable output into the run folder.
- The relay creates a Codex prompt with the Fable handoff.
- The Codex watcher runs `codex exec -m gpt-5.5` in the target repo.
- Outputs and status stay in `~/.jidoka/relay/runs/<run-id>/`.

In `auto` mode, the same command runs those steps in sequence and waits for completion.

## Timeout Fallback
- If Fable times out, the relay records `claude-timed-out`, writes a timeout fallback into `fable-output.md`, and queues Codex with `phase: codex-after-fable-timeout`.
- A Fable timeout is not a completed Fable handoff or review. Codex must continue from the original task, inspect the repo, make the smallest safe local plan, and run proof.
- If Codex times out, the relay records `codex-timed-out`, marks the run `failed`, and must not be reported as complete.

## Manual Mode
Use this when you want to paste prompts into open app sessions yourself:

```bash
node ~/.codex/jidoka/scripts/jidoka.mjs relay next --agent claude
node ~/.codex/jidoka/scripts/jidoka.mjs relay prompt --id <run-id> --agent claude
node ~/.codex/jidoka/scripts/jidoka.mjs relay run --id <run-id> --agent claude
node ~/.codex/jidoka/scripts/jidoka.mjs relay run --id <run-id> --agent codex --allow-codex-write
```

## Safety
- Codex write mode requires `--allow-codex-write`.
- Fable runs in planning mode and should not edit files.
- Secrets, credentials, PII, and regulated data stay local unless redacted first.
- Do not claim Fable or Codex ran unless the relay has an output file for that run.
- Do not call a timeout fallback a Fable result. Report it as Codex local fallback after Fable timeout.
