#!/usr/bin/env bash
# Wave-33 — auto-Reflexion trigger.
#
# Post-commit hook calls this. When the just-landed commit is "large"
# (touches > 100 LOC across TS/TSX files AND > 3 files), drop a
# trigger file at .claude/reflexion-queue/<sha>.md so the next agent
# session knows to dispatch the Reflexion Critic against the diff.
#
# Why post-commit not pre-commit:
# - Pre-commit Reflexion would block ~30s for every >100-LOC commit.
#   That fights you when you're in flow.
# - Post-commit is observation, not blocking. The queue file is a
#   note-to-future-self: "this commit deserved a second look".
# - The actual Reflexion dispatch happens in the next agent session
#   (or via a CI job that reads the queue).
#
# The script writes a tiny markdown stub with the SHA, the commit
# subject, the diff stats, and a 1-line dispatch hint. It NEVER
# blocks the commit — post-commit failures don't surface to git.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SHA="$(git rev-parse HEAD)"
SHA_SHORT="$(git rev-parse --short HEAD)"
SUBJECT="$(git log -1 --pretty=%s)"

# Count TS/TSX lines added+removed in the latest commit
# Per-file numstat (added\tdeleted\tpath) — TS/TSX only. Empty when
# the commit touched no TS/TSX. Sum added+deleted to get LOC churn.
NUMSTAT="$(git show --numstat --format='' HEAD -- '*.ts' '*.tsx' 2>/dev/null || true)"
LOC_CHANGED=0
FILES_CHANGED=0
if [ -n "$NUMSTAT" ]; then
  LOC_CHANGED=$(printf '%s\n' "$NUMSTAT" | awk 'NF==3 && $1!="-" && $2!="-" {s+=$1+$2} END {print s+0}')
  FILES_CHANGED=$(printf '%s\n' "$NUMSTAT" | awk 'NF==3 {c++} END {print c+0}')
fi

# Threshold: > 100 LOC AND > 3 files
LOC_THRESHOLD=100
FILES_THRESHOLD=3
if [ "${LOC_CHANGED:-0}" -le "$LOC_THRESHOLD" ] || [ "${FILES_CHANGED:-0}" -le "$FILES_THRESHOLD" ]; then
  # Small commit — nothing to reflect on. Silent exit.
  exit 0
fi

# Wave-NN extraction so we can group reflexion notes by wave
WAVE="$(printf '%s' "$SUBJECT" | grep -oE 'wave-[0-9]+(\.[0-9]+[a-z]?)?' | head -1 || true)"

QUEUE_DIR=".claude/reflexion-queue"
mkdir -p "$QUEUE_DIR"

OUT="$QUEUE_DIR/${SHA_SHORT}.md"
cat > "$OUT" <<EOF
# Reflexion queued — \`${SHA_SHORT}\`

**Wave**: ${WAVE:-(no wave)}
**Subject**: ${SUBJECT}
**Diff size**: ${LOC_CHANGED} LOC across ${FILES_CHANGED} TS/TSX files
**Threshold**: > ${LOC_THRESHOLD} LOC AND > ${FILES_THRESHOLD} files

---

## Dispatch hint for next agent session

\`\`\`
Run Reflexion Critic against commit ${SHA_SHORT}:
  git show ${SHA_SHORT}

Spec to validate against (if any): docs/specs/${WAVE}_MASTER_SPEC.md
ACs to grep-verify per the wave spec.

After Reflexion completes, delete this queue file:
  rm ${OUT}
\`\`\`

---

## Why this was queued

A post-commit hook (\`scripts/auto-reflexion-trigger.sh\`) flagged this
commit as "large enough to deserve a second look" — > 100 LOC across
> 3 TS/TSX files. Reflexion Critic is the established agent for this
review (see \`.claude/agents/reflexion-critic.md\`).

The hook does NOT block the commit; it just leaves a note. The actual
critique runs in the next agent session via the dispatch hint above.
EOF

# Print to stderr so it surfaces in the shell after commit but doesn't
# pollute git output that scripts may parse.
printf '\033[36mℹ Reflexion queued for %s (%s LOC / %s files): %s\033[0m\n' \
  "$SHA_SHORT" "$LOC_CHANGED" "$FILES_CHANGED" "$OUT" >&2

exit 0
