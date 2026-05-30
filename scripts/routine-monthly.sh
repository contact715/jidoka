#!/usr/bin/env bash
# Wave-55 — monthly deep-audit routine.
#
# Heavier than the weekly bundle. Outputs go to
# docs/audit-reports/routine-monthly-YYYY-MM.md and surface things
# that drift slowly (philosophy vs product gaps, agent roster vs
# code presence, dependency drift, security patterns).
#
# Wire to OS cron / launchd on the 1st of each month OR run manually
# via `npm run routine:monthly`.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

YEAR_MONTH="$(date +%Y-%m)"
REPORT="docs/audit-reports/routine-monthly-${YEAR_MONTH}.md"

mkdir -p docs/audit-reports

cat > "$REPORT" <<EOF
# Monthly routine — ${YEAR_MONTH}

**Generated**: $(date '+%Y-%m-%d %H:%M %Z')
**Source**: \`scripts/routine-monthly.sh\`

Deeper audit. The weekly routine catches drift in code; the monthly
catches drift between PHILOSOPHY and code, between AGENT ROSTER and
actual code presence, and between SECURITY POSTURE and reality.

The monthly is heavier (it dispatches agents in some sections via
the orchestrator). Expect ~15-30 min total + agent-dispatch tokens.

---

## 1. Quick stats (no dispatch needed)

- Branch: \`$(git branch --show-current)\`
- Commits in last 30 days: \`$(git log --since='30 days ago' --oneline | wc -l | tr -d ' ')\`
- Files in app/+components/+lib/: \`$(find app components lib -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | wc -l | tr -d ' ')\`
- Open audit findings: see \`docs/audit-reports/\` newest report
- Skills count: \`$(ls .claude/skills/*.md 2>/dev/null | wc -l | tr -d ' ')\`

EOF

cat >> "$REPORT" <<EOF

---

## 2. Security patterns scan

EOF

if [ -x scripts/check-security-patterns.sh ]; then
  bash scripts/check-security-patterns.sh >> "$REPORT" 2>&1 || true
else
  echo "(scripts/check-security-patterns.sh not executable; skipping)" >> "$REPORT"
fi

cat >> "$REPORT" <<EOF

---

## 3. Dependency drift

\`\`\`
$(npm outdated 2>/dev/null | head -50 || echo "(npm outdated failed or no drift)")
\`\`\`

---

## 4. Bundle size baseline drift

EOF

if [ -f scripts/bundle-size-check.mjs ]; then
  node scripts/bundle-size-check.mjs >> "$REPORT" 2>&1 || echo "(bundle-size-check needs npm run build first)" >> "$REPORT"
else
  echo "(scripts/bundle-size-check.mjs not present; skipping)" >> "$REPORT"
fi

cat >> "$REPORT" <<EOF

---

## 5. Dispatch the deep audits (manual — orchestrator action)

These need an agent dispatch; the orchestrator picks them up after reading this report:

- [ ] Philosophy vs Product re-audit (compare to \`docs/audit-reports/2026-05-23_philosophy-vs-product-audit.md\`)
- [ ] Cartographer whole-repo duplicate re-audit (compare to \`docs/audit-reports/2026-05-23_duplicate-surface-audit.md\`)
- [ ] Skills aging deep dive (which skills have been added vs cited; retire candidates)

Action protocol:
1. Read the prior month's audit report (\`docs/audit-reports/2026-XX-XX_*.md\`)
2. Dispatch the agent with: "Re-run \\<audit\\>. Compare findings to \\<prior report path\\>. Report ONLY the delta (new findings, resolved findings, escalations)."
3. Stash the delta report at \`docs/audit-reports/${YEAR_MONTH}_<audit-slug>-delta.md\`

This section deliberately doesn't run the dispatches automatically — they need user-aware sequencing + token budget that's not appropriate for a bash cron.

---

## What to do with this report

1. Any new SECURITY pattern hit → action immediately
2. Any major dependency 2+ versions behind → upgrade wave
3. Bundle size > 25% increase → investigate (wave that introduced it)
4. Schedule the deep audits (section 5) at the start of the next session

EOF

echo "✓ Wrote $REPORT"
exit 0
