#!/usr/bin/env bash
# Wave-41 — self-improvement queue trigger.
#
# Runs from .husky/post-commit. When a commit lands a "wave-NN" message
# where NN is divisible by 5, drops a queue file at
# .claude/self-improvement-queue/wave-NN.md telling the next agent to
# dispatch the Self-Improvement Reviewer.
#
# Same shape as wave-33's auto-Reflexion queue. Non-blocking — the hook
# never fails. Manual dispatch always available via
# `npm run agents:improve`.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# --force bypasses the every-5-waves rule (used by `npm run agents:improve`)
FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
fi

# Last commit message (subject only)
SUBJECT="$(git log -1 --pretty=%s 2>/dev/null || echo '')"

# Extract MAJOR wave number — strip sub-wave letters/decimals
# Examples: "wave-40" → 40, "wave-40.1" → 40, "wave-32c" → 32
WAVE_RAW="$(printf '%s' "$SUBJECT" | grep -oE 'wave-[0-9]+' | head -1 | sed 's/wave-//' || true)"

if [ -z "$WAVE_RAW" ]; then
  # Not a wave commit — silent exit unless forced
  if [ "$FORCE" -eq 0 ]; then
    exit 0
  fi
  # Forced path: derive wave from latest retro filename
  WAVE_RAW="$(ls docs/retros/wave-*.md 2>/dev/null | tail -1 | grep -oE 'wave-[0-9]+' | head -1 | sed 's/wave-//' || echo '0')"
fi

# Only fire on multiples of 5, unless forced
if [ "$FORCE" -eq 0 ] && [ $((WAVE_RAW % 5)) -ne 0 ]; then
  exit 0
fi

QUEUE_DIR=".claude/self-improvement-queue"
QUEUE_FILE="$QUEUE_DIR/wave-${WAVE_RAW}.md"

mkdir -p "$QUEUE_DIR"

# Idempotent — don't overwrite an existing queue file (the agent may
# already have it in-flight from an earlier sub-wave of the same major)
if [ -f "$QUEUE_FILE" ]; then
  exit 0
fi

cat > "$QUEUE_FILE" <<EOF
# Self-Improvement review queued — wave-${WAVE_RAW}

**Triggered by commit**: $(git log -1 --pretty=%h)
**Trigger rule**: wave number divisible by 5

---

## Dispatch hint for next agent session

\`\`\`
Run the Self-Improvement Reviewer (see .claude/agents/self-improvement-reviewer.md):

  1. Read the last 5 retros: ls -t docs/retros/wave-*.md | head -5
  2. Apply the 6-step search protocol
  3. Write the report to docs/audit-reports/$(date +%Y-%m-%d)-self-improvement-wave-${WAVE_RAW}.md
  4. Delete this queue file when done: rm .claude/self-improvement-queue/wave-${WAVE_RAW}.md
\`\`\`

---

## Why this was queued

Every 5 waves the system pauses to look at ITSELF, not just the last
feature. The Self-Improvement Reviewer reads a window of retros and
surfaces RECURRING patterns the per-wave Skill Extractor cannot see.

This is the agent-system equivalent of a sprint retrospective: not
"did this wave go well" but "is our process drifting".

Cadence: every 5 waves.
EOF

printf "\033[36mℹ Self-Improvement queued for wave-${WAVE_RAW} (every-5-waves cadence): %s\033[0m\n" "$QUEUE_FILE"
