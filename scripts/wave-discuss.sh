#!/usr/bin/env bash
# Wave-57 — GSD `discuss-phase` pattern absorbed.
#
# Between research (briefs) and synthesis (Chief Architect spec), pause
# for explicit user check-in. Prevents the case where the user sees a
# spec for the first time when it's committed. Run AFTER briefs are
# written and BEFORE Chief Architect is dispatched.
#
# Prints a digest of the briefs + asks for explicit go/no-go. Output
# is human-readable; the orchestrator reads it back to the user.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

WAVE="${1:-}"
if [ -z "$WAVE" ]; then
  echo "Usage: $0 <wave-number>" >&2
  exit 2
fi

BRIEFS_DIR="docs/specs/briefs"
banner=$(printf '─%.0s' {1..70})

echo
echo "$banner"
echo "wave-${WAVE} — discuss-phase check-in"
echo "$banner"
echo

for label in MICRO MACRO CARTO DSA; do
  FILE="${BRIEFS_DIR}/wave-${WAVE}_${label}.md"
  if [ ! -f "$FILE" ]; then
    printf "  ✗ %-6s brief: not written\n" "$label"
    continue
  fi
  WORDS=$(wc -w < "$FILE" | tr -d ' ')
  HEADLINE=$(grep -E '^## ' "$FILE" | head -3 | sed 's/^## //' | paste -sd '; ' -)
  printf "  ✓ %-6s brief: %s words\n" "$label" "$WORDS"
  echo "      sections: $HEADLINE"
done

echo
echo "$banner"
echo "Before Chief Architect synthesis, confirm with user:"
echo "  1. Did the briefs surface the right surface? (no blind spots)"
echo "  2. Any constraints the briefs missed? (deadline, dependency)"
echo "  3. Any tradeoff the user wants to call BEFORE the spec locks it?"
echo
echo "Proceed (synthesis next):  bash scripts/research-summary.sh ${WAVE}"
echo "Or extend a brief: edit ${BRIEFS_DIR}/wave-${WAVE}_<lens>.md and re-run this."
echo "$banner"
echo
