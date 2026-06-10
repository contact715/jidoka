#!/usr/bin/env bash
# Wave-55 — weekly maintenance routine.
#
# Bundles the 4 checks that should run every week without manual
# triggering. Output goes to docs/audit-reports/routine-weekly-YYYY-WW.md
# so the delta is reviewable.
#
# Wire to OS cron / launchd (see docs/ROUTINES.md) OR run manually via
# `npm run routine:weekly`. Either way the routine itself is the same.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

YEAR="$(date +%Y)"
WEEK="$(date +%V)"
REPORT="docs/audit-reports/routine-weekly-${YEAR}-W${WEEK}.md"

mkdir -p docs/audit-reports

# Build the report header
cat > "$REPORT" <<EOF
# Weekly routine — ${YEAR} W${WEEK}

**Generated**: $(date '+%Y-%m-%d %H:%M %Z')
**Source**: \`scripts/routine-weekly.sh\`

This is the bundled weekly maintenance audit. Each section is the
output of a single audit. Read top-to-bottom; act on whatever has
non-trivial delta from the previous week.

---

## 1. Skills aging

EOF

if [ -x scripts/skills-audit.sh ]; then
  bash scripts/skills-audit.sh >> "$REPORT" 2>&1 || echo "(skills-audit exited non-zero)" >> "$REPORT"
else
  echo "(scripts/skills-audit.sh not executable; skipping)" >> "$REPORT"
fi

cat >> "$REPORT" <<EOF

---

## 2. Design drift snapshot

EOF

if [ -x scripts/design-drift-audit.sh ]; then
  bash scripts/design-drift-audit.sh >> "$REPORT" 2>&1 || true
else
  echo "(scripts/design-drift-audit.sh not executable; skipping)" >> "$REPORT"
fi

cat >> "$REPORT" <<EOF

---

## 3. Audit backlog status

EOF

if [ -x scripts/audit-backlog-status.sh ]; then
  bash scripts/audit-backlog-status.sh >> "$REPORT" 2>&1 || true
else
  echo "(scripts/audit-backlog-status.sh not executable; skipping)" >> "$REPORT"
fi

cat >> "$REPORT" <<EOF

---

## 4. Outcomes status

EOF

if [ -f scripts/outcome-check.mjs ]; then
  node scripts/outcome-check.mjs >> "$REPORT" 2>&1 || true
else
  echo "(scripts/outcome-check.mjs not present; skipping)" >> "$REPORT"
fi

cat >> "$REPORT" <<EOF

---

## 5. Dev-system Kaizen (the way we build, trending)

EOF

if [ -f scripts/kaizen-feed.mjs ]; then
  node scripts/kaizen-feed.mjs >> "$REPORT" 2>&1 || true
else
  echo "(scripts/kaizen-feed.mjs not present; skipping)" >> "$REPORT"
fi

cat >> "$REPORT" <<EOF

---

## What to do with this report

1. If any drift category INCREASED week-over-week → action a sweep wave before new work.
2. If audit-backlog ESCALATED count > 0 → action the oldest before new work (per wave-47 banner discipline).
3. If skills:audit shows dormant skills (🔴) → either retire them or surface them in agent prompts so they get cited.
4. If outcomes show new misses → either ship the corresponding sweep or honestly mark the outcome as out of reach for now.

The prior week's report (if any) is at \`docs/audit-reports/routine-weekly-*.md\` — diff against it to see deltas.

EOF

echo "✓ Wrote $REPORT"
exit 0
