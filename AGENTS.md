# Agent Instructions

## Package Manager
- Use **npm**: `npm install`, `npm run test:engine`, `npm run eval`, `npm run jidoka`
- Node: `>=20.9.0`

## Jidoka Framework
- This repository is the source of truth for Jidoka.
- Jidoka means built-in quality: do not pass a known defect to the next station.
- Start with `README.md`, `QUICKSTART.md`, `docs/CONSTITUTION.md`, and `docs/TOYOTA_WAY.md`.
- Use scripts directly in Codex; Claude slash commands are documentation unless a Codex tool exposes them.

## Target First
- Before changing files, classify the target:
- `framework`: reusable agents, skills, scripts, gates, hooks, installers, global instructions.
- `project`: product code or product-specific docs.
- `global`: `~/.claude`, `~/.codex`, local machine bootstrap.
- If the target is ambiguous, ask one short question before editing.

## Codex Global Install
- Codex global bootstrap lives in `global-setup/CODEX_AGENTS.md`.
- Install or refresh it with:

```bash
sh global-setup/install-codex.sh
```

- The installer writes `~/.codex/AGENTS.md` and mirrors framework docs/scripts to `~/.codex/jidoka/`.
- Keep `global-setup/CODEX_AGENTS.md` and this file aligned when Codex behavior changes.

## Model Routing
- Use `scripts/model-router.mjs` for Claude Fable 5 vs Codex GPT-5.5 routing.
- Fable 5 handles architecture, root-cause investigation, ambiguous scope, long-horizon planning, and high-risk review.
- Codex GPT-5.5 handles local implementation, terminal/browser verification, integration, and final evidence.
- The user does not need to say "use Jidoka", "use relay", or "use Fable".
- For every non-trivial development request, classify before implementation:

```bash
node scripts/jidoka.mjs model-route --task-text "<task>" --json
```

- If `automation.autoRelay` is `true`, use one-window relay:

```bash
node scripts/jidoka.mjs relay auto --cwd "$PWD" --from codex --task "<task>" --allow-codex-write
```

- If `automation.mode` is `direct-codex`, continue in the current Codex session.
- If `automation.mode` is `redact-then-relay`, redact sensitive material before any Fable handoff.
- Route non-trivial work with:

```bash
node scripts/jidoka.mjs model-route --task-text "<task>" --json
```

- Follow `docs/MODEL_ROUTING_PROTOCOL.md`.
- Use `docs/templates/FABLE_HANDOFF.md` for Fable planning/investigation.
- Use `docs/templates/FABLE_REVIEW.md` for Fable adversarial review.

## Local Relay
- Use `scripts/jidoka-relay.mjs` for no-API handoff between open Claude Code and Codex sessions.
- Queue location: `~/.jidoka/relay`.
- Protocol: `docs/LOCAL_RELAY_PROTOCOL.md`.
- Start watchers:

```bash
node scripts/jidoka.mjs relay start-watchers --allow-codex-write
```

- Submit work:

```bash
node scripts/jidoka.mjs relay auto --cwd "$PWD" --from user --task "<task>" --allow-codex-write
```

## Quality Gates
- Run focused checks for changed mechanisms:

```bash
npm run test:engine
npm run eval
npm run check:commands
```

- For installer changes, run the installer and verify `codex debug prompt-input` includes the global instructions.
- For Andon changes, verify `scripts/andon-halt-helpers.mjs` and `scripts/andon-resume.mjs` behavior.

## Completion
- Do not claim done without executable proof.
- If a gate fails, fix the root cause or name the exact blocker.

## Commit Attribution
AI commits MUST include:

```text
Co-Authored-By: Codex <codex@openai.com>
```
