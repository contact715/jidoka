#!/usr/bin/env bash
# Wave-95 — AC traceability check (soft warn by default, hard block if enabled).
#
# Called from .husky/commit-msg:
#   bash scripts/check-ac-reference.sh "$1"
#
# $1 = path to the commit message file (provided by git to commit-msg hook).
#
# Exit codes:
#   0 — always (soft mode) or commit is compliant (hard mode)
#   1 — hard block: feat/refactor >50 LOC with no Closes: wave- footer

set -euo pipefail

MSG_FILE="${1:-}"
if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ]; then
  # No message file — skip silently (e.g., --amend with no message)
  exit 0
fi

MSG=$(cat "$MSG_FILE")

# ── Determine commit type ─────────────────────────────────────────────
COMMIT_TYPE=$(head -1 "$MSG_FILE" | grep -oE '^(feat|refactor)' || true)
if [ -z "$COMMIT_TYPE" ]; then
  # Not a feat or refactor commit — AC footer not required
  exit 0
fi

# ── Count staged LOC (insertions from git diff --cached) ──────────────
# Must use cached diff stat, not file size. Only counts lines under
# lib/, components/, app/ to match AC-C2 scope.
STAGED_LOC=$(git diff --cached --stat -- 'lib/' 'components/' 'app/' 2>/dev/null \
  | tail -1 \
  | grep -oE '[0-9]+ insertion' \
  | grep -oE '[0-9]+' \
  || echo 0)

if [ -z "$STAGED_LOC" ]; then
  STAGED_LOC=0
fi

if [ "$STAGED_LOC" -le 50 ]; then
  # Under threshold — no warning needed
  exit 0
fi

# ── Check for Closes: wave- footer ────────────────────────────────────
if echo "$MSG" | grep -qE '^Closes: wave-'; then
  # Footer present — validate referenced spec file exists
  CLOSES_LINE=$(echo "$MSG" | grep -E '^Closes: wave-' | head -1)
  # Extract wave ID (e.g., wave-95)
  WAVE_REF=$(echo "$CLOSES_LINE" | grep -oE 'wave-[0-9]+(\.[0-9]+)?' | head -1 || true)

  if [ -n "$WAVE_REF" ]; then
    SPEC_FILE="docs/specs/${WAVE_REF}_MASTER_SPEC.md"
    if [ ! -f "$SPEC_FILE" ]; then
      # AC-C4: specific error for missing spec file (soft — exit 0)
      echo "⚠  [AC ref] Closes: references '$WAVE_REF' but $SPEC_FILE does not exist." >&2
      echo "   Check the wave ID in your Closes: footer." >&2
    fi
  fi

  # Footer is present and (soft) valid — no block
  exit 0
fi

# ── Footer missing on a qualifying commit ─────────────────────────────
WARN_MSG="⚠  [AC ref] $COMMIT_TYPE commit with $STAGED_LOC staged LOC in lib/components/app has no 'Closes: wave-' footer.
   Tip: add a footer line to your commit message, e.g.:
   Example: Closes: wave-95 T.1 AC-A2"

# ── Check hard-block mode ─────────────────────────────────────────────
HARD_BLOCK="false"

# Check env var override first
if [ "${SDD_HARD_BLOCK_AC:-}" = "1" ]; then
  HARD_BLOCK="true"
elif [ -f ".sdd-config.json" ]; then
  # Read hard_block_ac field from JSON using node (avoids jq dependency)
  HARD_BLOCK=$(node -p "
    try {
      const cfg = JSON.parse(require('fs').readFileSync('.sdd-config.json', 'utf8'));
      String(cfg.hard_block_ac === true);
    } catch { 'false'; }
  " 2>/dev/null || echo "false")
fi

if [ "$HARD_BLOCK" = "true" ]; then
  echo "$WARN_MSG" >&2
  echo "✖  Hard block active (hard_block_ac=true in .sdd-config.json). Commit refused." >&2
  echo "   To bypass: git commit --no-verify (logged to .sdd-bypass.log)" >&2
  exit 1
else
  echo "$WARN_MSG" >&2
  # Soft mode — always exit 0
  exit 0
fi
