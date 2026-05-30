#!/usr/bin/env bash
# Wave-57 — GSD `research/SUMMARY.md` pattern absorbed.
#
# After Micro/Macro/Cartographer/DSA briefs are written for wave-NN,
# consolidates them into docs/specs/briefs/{wave-NN}_SUMMARY.md.
# Chief Architect reads ONE file instead of FOUR. Shorter input,
# better synthesis.
#
# Usage:
#   bash scripts/research-summary.sh 57   # consolidate wave-57 briefs

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

WAVE="${1:-}"
if [ -z "$WAVE" ]; then
  echo "Usage: $0 <wave-number>" >&2
  echo "Example: $0 57" >&2
  exit 2
fi

BRIEFS_DIR="docs/specs/briefs"
OUT="${BRIEFS_DIR}/wave-${WAVE}_SUMMARY.md"

[ ! -d "$BRIEFS_DIR" ] && mkdir -p "$BRIEFS_DIR"

MICRO="${BRIEFS_DIR}/wave-${WAVE}_MICRO.md"
MACRO="${BRIEFS_DIR}/wave-${WAVE}_MACRO.md"
CARTO="${BRIEFS_DIR}/wave-${WAVE}_CARTO.md"
DSA="${BRIEFS_DIR}/wave-${WAVE}_DSA.md"

FOUND=0
[ -f "$MICRO" ] && FOUND=$((FOUND + 1))
[ -f "$MACRO" ] && FOUND=$((FOUND + 1))
[ -f "$CARTO" ] && FOUND=$((FOUND + 1))
[ -f "$DSA"   ] && FOUND=$((FOUND + 1))

if [ "$FOUND" -eq 0 ]; then
  echo "✗ No briefs found for wave-${WAVE} in $BRIEFS_DIR" >&2
  exit 2
fi

{
  echo "# Wave-${WAVE} Research Summary"
  echo
  echo "**Generated**: $(date '+%Y-%m-%d %H:%M %Z') by \`scripts/research-summary.sh\`"
  echo "**Briefs consolidated**: $FOUND of 4 (Micro / Macro / Cartographer / DSA)"
  echo
  echo "This file is the Chief Architect's primary input. Reads in one pass instead of four. The full briefs are intentionally retained at their individual paths for traceability."
  echo
  echo "---"
  echo

  for label in MICRO MACRO CARTO DSA; do
    case "$label" in
      MICRO) FILE="$MICRO"; HEAD="## Micro Architect (internal / philosophy lens)" ;;
      MACRO) FILE="$MACRO"; HEAD="## Macro Architect (external / market lens)" ;;
      CARTO) FILE="$CARTO"; HEAD="## Surface Cartographer (existing-implementation lens)" ;;
      DSA)   FILE="$DSA";   HEAD="## Design System Architect (token + primitive contract)" ;;
    esac

    if [ -f "$FILE" ]; then
      echo "$HEAD"
      echo
      echo "_Source: \`$FILE\`_"
      echo
      # Skip the file's own H1 (first line) — the H2 header above is enough
      tail -n +2 "$FILE"
      echo
      echo "---"
      echo
    else
      echo "$HEAD"
      echo
      echo "_(no brief written for this wave — Chief Architect's synthesis must note the waiver in §8 Open questions)_"
      echo
      echo "---"
      echo
    fi
  done

  echo "## Synthesis notes for Chief Architect"
  echo
  echo "1. **Honour Cartographer verdict first.** DUPLICATE-BLOCK rejects the spec. REUSE / EXTEND mandate file:line reference in the implementation section."
  echo "2. **Honour DSA contract.** Forbidden values listed must not appear in any new code."
  echo "3. **Cite convergence** explicitly — name what Micro AND Macro AND Cartographer AND DSA agree on. That's the spine."
  echo "4. **Resolve divergence** per axis — Micro vs Macro on differentiation; Cartographer vs Micro on reuse vs new; DSA vs Macro on system tokens vs market patterns."
  echo "5. **Tag every AC** with provenance: \`[micro]\` \`[macro]\` \`[carto]\` \`[dsa]\` or \`[synthesis]\`."
} > "$OUT"

echo "✓ Wrote $OUT (consolidated $FOUND of 4 briefs)"
