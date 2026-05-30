#!/usr/bin/env bash
# Wave-47 — audit backlog status surface.
#
# Root cause fix for "0 of 5 SI proposals actioned" (wave-45b finding).
# The Self-Improvement Reviewer, Cartographer, and other auditors all write
# their findings to docs/audit-reports/ + retros' "Out-of-scope follow-ups"
# sections. Without a surface that flags OPEN items at session start, those
# findings rot. This script extracts them, cross-references with git log to
# see whether the proposed wave actually shipped, and prints a status banner.
#
# Designed to be safe to run repeatedly. Read-only. Used by:
#   - CLAUDE.md session-start instructions (manual: npm run audit:backlog)
#   - Future: post-merge hook (if discipline drifts again)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── Extract proposed waves from audit reports + retro "Out-of-scope" ──────
#
# Pattern we look for in audit-reports and retros:
#   "wave-NN" or "wave-NN.M" or "wave-NN.Mx" preceded by a backlog marker
#   (Out-of-scope, Recommended, Proposed, Queued, Next, Roadmap).
#
# We exclude lines that look like "wave-NN shipped" or "wave-NN landed".

extract_proposed() {
  # Format: file:line:wave-NN:description
  # Wave-46b — exclude routine-weekly-* and routine-monthly-* derived reports
  # (they embed prior audit-backlog output and would create a self-referential
  # loop where each weekly run picks up the previous week's open list as new).
  git grep -n -P 'wave-\d+(\.\d+[a-z]?)?' \
      -- 'docs/audit-reports/*.md' 'docs/retros/*.md' \
      ':!docs/audit-reports/routine-weekly-*' \
      ':!docs/audit-reports/routine-monthly-*' 2>/dev/null \
    | grep -iE '(out-of-scope|recommended|proposed|queued|next:|roadmap|todo|will pick up|follow-up|escalat)' \
    | grep -v -iE '(shipped|landed|completed|done — see|delivered)' || true
}

# Build a set of waves that have ACTUALLY been committed (subject contains
# wave-NN). This is our ground truth — if git log says wave-X shipped, it did.
SHIPPED_WAVES=$(git log --all --pretty=%s 2>/dev/null \
  | grep -oE 'wave-[0-9]+(\.[0-9]+[a-z]?)?' \
  | sort -u || true)

# Wave-46b — also recognise EXPLICIT closure markers in retros / audit reports.
# When a newer retro says "closes wave-40.2" or "resolves wave-40.1" or
# "actions wave-X.Y" or "wave-40.2 closed", treat the named older wave as
# shipped (the parent wave that wrote that line shipped, and the line is
# the explicit closure record).
#
# Pattern recognises:
#   "closes wave-X.Y" / "closed wave-X.Y" / "closes Finding 1.1 (wave-40.2)"
#   "resolves wave-X.Y" / "resolved by wave-X.Y" / "wave-X.Y resolved"
#   "actions wave-X.Y" / "action on wave-X.Y" / "wave-X.Y actioned"
#   "addresses wave-X.Y"
#   "wave-X.Y closed after N waves"  (the wave-52 retro pattern)
CLOSED_WAVES=$(git grep -hP '\b(clos(es?|ed)|resolv(es?|ed)|action(s|ed)?|address(es)?|fix(es|ed)?)\b[^a-z]*\bwave-\d+(\.\d+[a-z]?)?\b' \
                   -- 'docs/retros/*.md' 'docs/audit-reports/*.md' 2>/dev/null \
                | grep -oE 'wave-[0-9]+(\.[0-9]+[a-z]?)?' \
                | sort -u || true)

# Also match the inverse pattern: "wave-X.Y (closed|resolved|actioned)"
CLOSED_WAVES_INV=$(git grep -hP '\bwave-\d+(\.\d+[a-z]?)?\b[^a-z]*\b(clos(ed)?|resolv(ed)?|action(ed)?|address(ed)?|fix(ed)?|shipped|landed|delivered)\b' \
                       -- 'docs/retros/*.md' 'docs/audit-reports/*.md' 2>/dev/null \
                    | grep -oE 'wave-[0-9]+(\.[0-9]+[a-z]?)?' \
                    | sort -u || true)

# Wave-46b — explicit closures manifest. Manual fallback when retro prose
# phrasing is too varied for the auto-heuristic to catch.
# Format per line: "wave-X.Y -> wave-Z  [reason]"
MANUAL_CLOSED_WAVES=""
CLOSURES_FILE="docs/audit-reports/_CLOSURES.md"
if [ -f "$CLOSURES_FILE" ]; then
  MANUAL_CLOSED_WAVES=$(grep -oE '^wave-[0-9]+(\.[0-9]+[a-z]?)?' "$CLOSURES_FILE" | sort -u || true)
fi

# Merge all sources
SHIPPED_WAVES=$(printf "%s\n%s\n%s\n%s\n" "$SHIPPED_WAVES" "$CLOSED_WAVES" "$CLOSED_WAVES_INV" "$MANUAL_CLOSED_WAVES" \
                | grep -v '^$' | sort -u || true)

is_shipped() {
  local w="$1"
  echo "$SHIPPED_WAVES" | grep -qx "wave-${w}"
}

# Find proposed waves from our extracted set.
# Strip the `file:line:` prefix from git-grep output before extracting wave-NN —
# otherwise filename paths like `docs/retros/wave-103.md` contribute `wave-103`
# as a self-reference, producing spurious escalations. Fix: 2× `sed` strips
# file: then line: prefix, leaving only the actual matched content.
PROPOSED_RAW=$(extract_proposed)
PROPOSED=$(echo "$PROPOSED_RAW" | sed 's/^[^:]*://;s/^[^:]*://' | grep -oE 'wave-[0-9]+(\.[0-9]+[a-z]?)?' | sed 's/wave-//' | sort -u)

# Age of a proposal = how many wave-NN commits have landed AFTER it was first
# proposed. ≥ 2 = escalation candidate ("named in 2+ SI cycles without ship").
LATEST_WAVE=$(echo "$SHIPPED_WAVES" | grep -oE '[0-9]+' | sort -n | tail -1)

# ── Output ────────────────────────────────────────────────────────────────
banner=$(printf '─%.0s' {1..68})

open_count=0
escalated_count=0
shipped_count=0

# Buffer output so we don't print headers if there's nothing to show
buf_open=""
buf_escalated=""

for w in $PROPOSED; do
  if is_shipped "$w"; then
    shipped_count=$((shipped_count + 1))
    continue
  fi

  # First proposal source — pick the OLDEST file that mentions it
  first_source=$(echo "$PROPOSED_RAW" | grep -E "wave-${w}\b" | head -1 | awk -F: '{print $1}')

  # Major wave number of proposal source — used to estimate age
  src_wave=$(echo "$first_source" | grep -oE 'wave-[0-9]+' | head -1 | sed 's/wave-//' || true)
  if [ -n "${src_wave:-}" ] && [ -n "${LATEST_WAVE:-}" ]; then
    age=$((LATEST_WAVE - src_wave))
  else
    age=0
  fi

  if [ "$age" -ge 5 ]; then
    escalated_count=$((escalated_count + 1))
    buf_escalated+=$(printf "  wave-%-8s  age %-3s  proposed in %s\n" "$w" "$age" "$first_source")$'\n'
  else
    open_count=$((open_count + 1))
    buf_open+=$(printf "  wave-%-8s  age %-3s  proposed in %s\n" "$w" "$age" "$first_source")$'\n'
  fi
done

# Print summary
echo
echo "$banner"
echo "Audit backlog status — wave-${LATEST_WAVE:-?} latest"
echo "$banner"
echo
echo "  proposed total : $((open_count + escalated_count + shipped_count))"
echo "  shipped        : $shipped_count"
echo "  open           : $open_count"
echo "  escalated (≥5) : $escalated_count"
echo

if [ "$escalated_count" -gt 0 ]; then
  printf "\033[31mESCALATED — open for 5+ waves. Action one BEFORE starting new wave work:\033[0m\n\n"
  printf "%s" "$buf_escalated"
  echo
fi

if [ "$open_count" -gt 0 ]; then
  echo "OPEN proposals (newer):"
  echo
  printf "%s" "$buf_open"
  echo
fi

if [ "$escalated_count" -eq 0 ] && [ "$open_count" -eq 0 ]; then
  echo "✓ No open proposals. System clean."
fi

echo "$banner"
echo "Source files scanned: docs/audit-reports/*.md + docs/retros/*.md"
echo "Override marker: a line containing 'shipped'/'landed'/'completed'/'done — see'/'delivered' counts the wave as actioned."
echo "$banner"
echo

# Exit code: 0 always. This is informational, not gating. (The wave-46 design
# drift ratchet IS gating; this banner is "agent, look at this before you
# pick up new work".)
exit 0
