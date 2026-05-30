#!/usr/bin/env bash
# Wave-30 — wave-artifact enforcement.
#
# Husky commit-msg hook calls this with the commit-message file path.
# When the message contains `wave-NN` (or wave-NN.M / wave-NN.Mx), verify
# that the corresponding retro and metrics-dashboard row exist.
#
# Failure mode:
# - Missing metrics row → BLOCK (cheap to add, one-liner)
# - Missing retro for MAJOR wave (no decimal) → WARN only (retros can
#   be batched across a sub-wave series)
# - Sub-wave commit (wave-29.1, wave-29.2...) → both checks WARN only
#
# Skip entirely if no wave-NN pattern in the message.

set -euo pipefail

MSG_FILE="${1:-}"
if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ]; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Strip comment lines (starting with #) — git includes the template guide
MSG="$(grep -v '^#' "$MSG_FILE" || true)"

# Match wave-29, wave-29.1, wave-29.1b
# Capture the major version (29) AND full version (29.1b) separately.
# `|| true` suppresses grep's non-zero exit when no wave-NN is in the
# message — that's the common non-wave-commit case and should silently skip.
WAVE_FULL="$(printf '%s' "$MSG" | grep -oE 'wave-[0-9]+(\.[0-9]+[a-z]?)?' | head -1 | sed 's/wave-//' || true)"

if [ -z "$WAVE_FULL" ]; then
  # Not a wave commit — skip entirely
  exit 0
fi

# Major version (everything before the first dot)
WAVE_MAJOR="${WAVE_FULL%%.*}"
IS_SUBWAVE=0
if [ "$WAVE_FULL" != "$WAVE_MAJOR" ]; then
  IS_SUBWAVE=1
fi

RETRO_PATH="docs/retros/wave-${WAVE_MAJOR}.md"
METRICS_PATH="docs/metrics/_DASHBOARD.md"

# Track issues
HAS_BLOCKER=0
WARNINGS=()
BLOCKERS=()

# Metrics check — search for any matching wave row in the dashboard
if [ -f "$METRICS_PATH" ]; then
  if ! grep -qE "^\| wave-${WAVE_FULL}[[:space:]]" "$METRICS_PATH"; then
    if [ "$IS_SUBWAVE" -eq 1 ]; then
      WARNINGS+=("metrics dashboard missing row for wave-${WAVE_FULL} (sub-waves: WARN only)")
    else
      BLOCKERS+=("metrics dashboard missing row for wave-${WAVE_FULL} — add one row to ${METRICS_PATH}")
      HAS_BLOCKER=1
    fi
  fi
else
  WARNINGS+=("metrics dashboard ${METRICS_PATH} not found (skipped)")
fi

# Retro check — only blocks on major waves, warns on sub-waves
if [ ! -f "$RETRO_PATH" ]; then
  if [ "$IS_SUBWAVE" -eq 1 ]; then
    WARNINGS+=("retro ${RETRO_PATH} not found (sub-wave commit — write retro once for the whole wave-${WAVE_MAJOR} series)")
  else
    # Major wave commit AND no retro — warn (don't block) since the retro
    # may legitimately be written in a follow-up commit. The Process
    # Engineer agent picks this up via the post-wave hook.
    WARNINGS+=("retro ${RETRO_PATH} not found — write one before the next wave starts")
  fi
fi

# Emit warnings (always non-blocking)
if [ ${#WARNINGS[@]} -gt 0 ]; then
  printf '\033[33m⚠ wave-artifact warnings (wave-%s)\033[0m\n' "$WAVE_FULL" >&2
  for w in "${WARNINGS[@]}"; do
    printf '  • %s\n' "$w" >&2
  done
fi

# Block on hard issues
if [ "$HAS_BLOCKER" -eq 1 ]; then
  printf '\n\033[31m✖ wave-artifact BLOCKERS (wave-%s) — commit refused\033[0m\n' "$WAVE_FULL" >&2
  for b in "${BLOCKERS[@]}"; do
    printf '  • %s\n' "$b" >&2
  done
  printf '\nQuick fix:\n' >&2
  printf '  echo "| wave-%s | $(date +%%Y-%%m-%%d) | ~XXK | n/a | N | ~M min | Shipped | ~X%% |" >> %s\n' "$WAVE_FULL" "$METRICS_PATH" >&2
  printf '\nTo bypass intentionally: git commit --no-verify\n' >&2
  exit 1
fi

exit 0
