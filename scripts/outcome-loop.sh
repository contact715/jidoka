#!/usr/bin/env bash
# Wave-53b — outcome-driven dispatch loop wrapper.
#
# Anthropic's "Outcomes" pattern: define outcome + budget, loop the
# dispatch until outcome met or budget exhausted. Replaces the manual
# "dispatch → check → re-dispatch" rhythm with one command.
#
# Usage:
#   bash scripts/outcome-loop.sh <outcome-name> "<dispatch-command>" [budget]
#
# Example:
#   bash scripts/outcome-loop.sh design-drift-zero-heights \
#     'echo "(orchestrator would dispatch a Haiku sweep agent here)"' \
#     3
#
# The dispatch-command runs in a sub-shell. It can be a bash script,
# an npm command, or a placeholder echo if the orchestrator is the
# real dispatcher.
#
# Exit codes:
#   0  — outcome met (either initially or after N iterations)
#   1  — outcome not met after budget exhausted
#   2  — usage / config error

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [ "$#" -lt 2 ]; then
  cat >&2 <<EOF
Usage: $0 <outcome-name> "<dispatch-command>" [budget]

Arguments:
  outcome-name      Name from scripts/outcomes-registry.json
  dispatch-command  Shell command to run on each unmet iteration
  budget            Max iterations (default 3)

Example:
  $0 design-drift-zero-heights "echo 'TODO: dispatch sweep'" 3
EOF
  exit 2
fi

OUTCOME="$1"
DISPATCH_CMD="$2"
BUDGET="${3:-3}"

# Verify outcome exists in registry (read registry directly — outcome-check
# exits non-zero when outcomes are unmet, which is the normal case).
if ! node -e '
  const r = JSON.parse(require("fs").readFileSync("scripts/outcomes-registry.json","utf8"));
  const ok = r.outcomes.some(o => o.name === process.argv[1]);
  process.exit(ok ? 0 : 1);
' "$OUTCOME" 2>/dev/null; then
  echo "✗ Unknown outcome: $OUTCOME" >&2
  echo "Available:" >&2
  node -e '
    const r = JSON.parse(require("fs").readFileSync("scripts/outcomes-registry.json","utf8"));
    for (const o of r.outcomes) console.error("  - " + o.name);
  ' 2>&1 | sed -n '/  - /p' >&2
  exit 2
fi

ITER=0
banner() {
  echo
  echo "────────────────────────────────────────────────────────────────"
  echo "$1"
  echo "────────────────────────────────────────────────────────────────"
}

while [ "$ITER" -le "$BUDGET" ]; do
  banner "outcome-loop: $OUTCOME (iter $ITER / $BUDGET)"

  if node scripts/outcome-check.mjs --name="$OUTCOME" --json 2>/dev/null \
     | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); process.exit(r.allMet ? 0 : 1);'; then
    echo "✓ Outcome MET ($OUTCOME). Loop done."
    exit 0
  fi

  echo "✗ Outcome NOT met. Running dispatch:"
  echo "  $DISPATCH_CMD"
  echo
  if [ "$ITER" -lt "$BUDGET" ]; then
    eval "$DISPATCH_CMD"
    DISPATCH_EXIT=$?
    echo
    echo "  Dispatch exit: $DISPATCH_EXIT"
  fi

  ITER=$((ITER + 1))
done

banner "outcome-loop: BUDGET EXHAUSTED ($BUDGET iters)"
echo "Outcome $OUTCOME still not met. Escalating to orchestrator." >&2
echo "Options:" >&2
echo "  (a) Increase budget: rerun with higher third arg" >&2
echo "  (b) Refine dispatch command (current shape didn't converge)" >&2
echo "  (c) Modify outcome target (if real constraint is different)" >&2
exit 1
