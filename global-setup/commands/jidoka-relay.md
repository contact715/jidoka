---
description: Submit a task to the local no-API Claude/Codex relay
argument-hint: <task>
allowed-tools: Bash
---
Submit a task to the local relay. Args: $ARGUMENTS.

1. Run the whole relay from the current repo:
   `node ~/.claude/jidoka/scripts/jidoka.mjs relay auto --cwd "$PWD" --from claude --task "$ARGUMENTS" --allow-codex-write`
2. Report the run id, route, run folder, and final output path.
3. If Fable times out, report Codex fallback explicitly; do not call it a Fable handoff.
4. If the run fails, report the failed station and the exact log file.
