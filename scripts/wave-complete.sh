#!/usr/bin/env bash
# Wave-57 — GSD `complete-milestone` pattern absorbed.
#
# Tags the most-recent wave commit as a release marker. Lets us answer
# "when did wave-50 actually ship" without git log archaeology.
#
# Usage:
#   bash scripts/wave-complete.sh        # tag latest wave-NN commit
#   bash scripts/wave-complete.sh 52     # tag the wave-52 commit
#
# After tagging:
#   git tag --list 'wave-*'   # see all wave releases
#   git show wave-52          # see what shipped in that wave

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

WAVE_NUM="${1:-}"

if [ -z "$WAVE_NUM" ]; then
  WAVE_NUM=$(git log --all --pretty=%s 2>/dev/null \
    | grep -oE 'wave-[0-9]+(\.[0-9]+[a-z]?)?' \
    | grep -oE '[0-9]+' \
    | sort -n | tail -1)
fi

if [ -z "$WAVE_NUM" ]; then
  echo "✗ No wave commits found." >&2
  exit 2
fi

TAG="wave-${WAVE_NUM}"

COMMIT=$(git log --all --pretty='%H %s' 2>/dev/null \
  | grep -E "wave-${WAVE_NUM}\b" \
  | head -1 \
  | awk '{print $1}')

if [ -z "$COMMIT" ]; then
  echo "✗ No commit found for wave-${WAVE_NUM}" >&2
  exit 2
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  EXISTING=$(git rev-parse "$TAG")
  if [ "$EXISTING" = "$COMMIT" ]; then
    echo "✓ $TAG already tagged at $COMMIT"
    exit 0
  else
    echo "⚠ $TAG exists but points at a different commit ($EXISTING vs $COMMIT)" >&2
    echo "  Move with: git tag -fa $TAG $COMMIT" >&2
    exit 1
  fi
fi

git tag -a "$TAG" "$COMMIT" -m "Release: $TAG"
echo "✓ Tagged $TAG → $COMMIT"
echo "  Push tags with: git push --tags"
