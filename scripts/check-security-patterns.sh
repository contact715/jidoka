#!/bin/bash
# CI security gate — fails build if banned patterns appear in source.
# Run as: npm run check:security
#
# Banned patterns are the residue of vulnerabilities patched across Sprint 14-55.
# Re-introducing any of them would silently regress months of audit work.

set -e

EXIT=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. Raw javascript: URL in <a href> — XSS escape hatch.
#    Always route through lib/utils/safe-redirect.ts (isSafeRedirectUrl).
JS_URL_HITS=$(grep -rn 'href=["'"'"']javascript:' app/ components/ 2>/dev/null | grep -v '\.test\.\|node_modules' || true)
if [ -n "$JS_URL_HITS" ]; then
  echo "FAIL: javascript: URL found in href. Use isSafeRedirectUrl() from lib/utils/safe-redirect.ts"
  echo "$JS_URL_HITS"
  EXIT=1
fi

# 2. dangerouslySetInnerHTML without obvious sanitization adjacent.
#    Warn only (too noisy for hard-fail, manual audit required).
DANGER_HITS=$(grep -rn 'dangerouslySetInnerHTML' app/ components/ 2>/dev/null | grep -v '\.test\.\|node_modules\|sanitize\|DOMPurify' || true)
if [ -n "$DANGER_HITS" ]; then
  echo "WARN: dangerouslySetInnerHTML found without nearby sanitize/DOMPurify reference. Manual audit required."
  echo "$DANGER_HITS" | head -20
fi

# 3. window.location.href assignments — prefer router.push() for SPA navigation.
#    Threshold check (some are legitimate, e.g. external redirects).
LOC_COUNT=$(grep -rn 'window\.location\.href[[:space:]]*=' app/ components/ 2>/dev/null | grep -v '\.test\.\|node_modules\|safe-redirect' | wc -l | tr -d ' ')
if [ "$LOC_COUNT" -gt 5 ]; then
  echo "WARN: $LOC_COUNT window.location.href assignments. Prefer router.push() for SPA navigation."
fi

# 4. setTimeout fake provisioning patterns (Wave 42 pattern).
#    These mocked backend work in the UI without ever calling a real endpoint.
FAKE_HITS=$(grep -rn 'setTimeout.*provision\|setTimeout.*verify\|setTimeout.*deploy' app/ components/ 2>/dev/null | grep -v '\.test\.\|node_modules' || true)
if [ -n "$FAKE_HITS" ]; then
  echo "FAIL: setTimeout-fake-provisioning pattern found. Use real backend or 'Coming soon' UI."
  echo "$FAKE_HITS"
  EXIT=1
fi

# 5. semgrep SAST — graceful-degrade (wave-174, D8).
#    Calls semgrep with the committed ruleset if the binary is in PATH.
#    If semgrep is NOT installed: print a SURFACED SKIP message and continue.
#    This is NOT a vacuous pass — the SKIP is visible so the developer knows
#    SAST did not run locally. The CI gate (security-gate.yml) runs semgrep via
#    returntocorp/semgrep-action regardless of local binary availability.
#    AC-10: must print "SKIP" + "semgrep" when binary is absent.
if command -v semgrep >/dev/null 2>&1; then
  echo "Running semgrep SAST with .semgrep/app-sast.yml ..."
  SEMGREP_EXCLUDE="--exclude node_modules --exclude .next --exclude '*.test.*' --exclude '*.spec.*'"
  # Use env vars to pull the four rulesets declared in .semgrep/app-sast.yml.
  # semgrep exits non-zero when ERROR-severity findings exist.
  SEMGREP_RULES="p/typescript p/react p/owasp-top-ten p/llm-security"
  SEMGREP_CMD="semgrep --config .semgrep/app-sast.yml"
  for rule in $SEMGREP_RULES; do
    SEMGREP_CMD="$SEMGREP_CMD --config $rule"
  done
  # nosemgrep annotations on app/layout.tsx:98,106 + lib/api/client.ts:73-74
  # suppress accepted-risk findings so they don't fail the local check.
  set +e
  eval "$SEMGREP_CMD $SEMGREP_EXCLUDE ." 2>&1
  SEMGREP_EXIT=$?
  set -e
  if [ "$SEMGREP_EXIT" -ne 0 ]; then
    echo "FAIL: semgrep SAST found high/critical findings. See output above."
    EXIT=1
  else
    echo "OK: semgrep SAST — no high/critical findings."
  fi
else
  # SURFACED SKIP — not a silent vacuous pass.
  echo "SKIP: semgrep not in PATH — SAST not run locally. The CI gate .github/workflows/security-gate.yml runs semgrep (OWASP/ts/react/secrets) + trufflehog on every push/PR, so SAST is enforced there."
fi

if [ "$EXIT" -eq 0 ]; then
  echo "OK: Security pattern check passed"
fi
exit $EXIT
