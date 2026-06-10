#!/usr/bin/env bash
# Integration test — the SDD hard-block gate must actually block.
# Incident 2026-06-10 (meta class: gate-claims-block-but-passes): check-ac-reference.sh
# printed "Commit refused" with hard_block_ac=true, but .husky/commit-msg swallowed the
# exit code (`|| true`), so the commit landed anyway — and post-commit logged EVERY
# commit to .sdd-bypass.log as if a bypass was requested.
#
# This test runs the repo's REAL hook files (commit-msg, post-commit) and the real
# scripts/check-ac-reference.sh + scripts/check-wave-artifacts.sh inside a throwaway
# git repo in /tmp, and asserts:
#   T1  feat >50 LOC, no 'Closes: wave-' footer, hard_block_ac=true → commit REFUSED,
#       banner "Hard block active" shown
#   T2  same change WITH 'Closes: wave-' footer → commit passes
#   T3  git commit --no-verify → passes AND is the ONLY entry in .sdd-bypass.log
#       (normal commits must NOT be logged as bypasses)
#   T4  hard_block_ac=false (soft mode) → warns but commit passes
#   T5  commit message names wave-NN whose metrics-dashboard row is missing →
#         husky flavor (product repo): wave-artifact BLOCKER refuses the commit
#         githooks flavor (framework): informational by documented design — passes
#
# The fixture pre-commit is a 2-line stub that only writes .sdd-precommit-sentinel —
# the single part of the real pre-commit that bypass detection depends on. Everything
# else (lint-staged, tsc, spec gates) is out of scope here and too heavy for a fixture.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$REPO/.husky/commit-msg" ]; then
  HOOKS_SRC="$REPO/.husky"; FLAVOR="husky"
elif [ -f "$REPO/.githooks/commit-msg" ]; then
  HOOKS_SRC="$REPO/.githooks"; FLAVOR="githooks"
else
  echo "FATAL: no commit-msg hook found in $REPO (.husky or .githooks)"; exit 2
fi

TMP="$(mktemp -d /tmp/sdd-hard-block-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
git init -q
git config user.email test@local
git config user.name sdd-test
git config commit.gpgsign false
git config core.hooksPath hooks
unset SDD_HARD_BLOCK_AC 2>/dev/null || true

mkdir -p scripts hooks lib docs/metrics
cp "$REPO/scripts/check-ac-reference.sh" scripts/
cp "$REPO/scripts/check-wave-artifacts.sh" scripts/
cp "$HOOKS_SRC/commit-msg" hooks/commit-msg
cp "$HOOKS_SRC/post-commit" hooks/post-commit
printf '#!/bin/sh\necho "$$" > .sdd-precommit-sentinel\n' > hooks/pre-commit
chmod +x hooks/commit-msg hooks/post-commit hooks/pre-commit

echo '{ "hard_block_ac": true }' > .sdd-config.json
printf '| wave | date |\n|---|---|\n| wave-95 | 2026-06-10 | row so the T2 footer wave passes the artifact check |\n' > docs/metrics/_DASHBOARD.md

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
commits() { git rev-list --count HEAD 2>/dev/null || echo 0; }
big_file() { # $1 = path; >50 insertions under lib/ to cross the AC-gate threshold
  i=1; : > "$1"
  while [ $i -le 60 ]; do echo "export const v$i = $i;" >> "$1"; i=$((i+1)); done
}

echo "SDD hard-block integration test — flavor: $FLAVOR, fixture: $TMP"

# ── baseline commit (chore — no gate applies) ─────────────────────────
git add -A
if ! git commit -q -m "chore: fixture baseline" >baseline.log 2>&1; then
  echo "FATAL: baseline commit failed:"; cat baseline.log; exit 2
fi

# ── T1: hard block must refuse the commit ─────────────────────────────
echo "T1: feat >50 LOC, no footer, hard_block_ac=true"
big_file lib/big1.ts
git add lib/big1.ts
BEFORE=$(commits)
git commit -m "feat: big change without footer" >t1.log 2>&1
T1_EXIT=$?
grep -q "Hard block active" t1.log \
  && ok "banner 'Hard block active' shown" \
  || bad "banner 'Hard block active' missing (gate did not even fire)"
if [ "$T1_EXIT" -ne 0 ] && [ "$(commits)" -eq "$BEFORE" ]; then
  ok "commit refused (exit=$T1_EXIT, history unchanged)"
else
  bad "commit was NOT refused (exit=$T1_EXIT, commits $BEFORE→$(commits)) — gate-claims-block-but-passes"
  git reset -q --soft HEAD~1 2>/dev/null  # undo the wrongly-landed commit so later tests still run
fi

# ── T2: footer satisfies the gate ─────────────────────────────────────
echo "T2: same change WITH 'Closes: wave-' footer"
big_file lib/big2.ts
git add lib/big2.ts
if git commit -m "feat: big change with footer" -m "Closes: wave-95 T.1 AC-A2" >t2.log 2>&1; then
  ok "commit passed with footer"
else
  bad "commit refused despite footer:"; sed 's/^/      /' t2.log
fi

# ── T3: --no-verify passes and is the ONLY bypass-log entry ──────────
echo "T3: --no-verify bypass is logged — and nothing else is"
big_file lib/big3.ts
git add lib/big3.ts
if git commit --no-verify -m "feat: bypass commit" >t3.log 2>&1; then
  ok "--no-verify commit passed"
else
  bad "--no-verify commit failed:"; sed 's/^/      /' t3.log
fi
BYPASS_HASH=$(git log --pretty=%h -1)
LOG_LINES=$(wc -l < .sdd-bypass.log 2>/dev/null | tr -d ' ' || echo 0)
if [ "${LOG_LINES:-0}" -eq 1 ] && grep -q "commit=$BYPASS_HASH" .sdd-bypass.log 2>/dev/null; then
  ok ".sdd-bypass.log has exactly the bypass commit (1 line)"
else
  bad ".sdd-bypass.log wrong — expected 1 line with commit=$BYPASS_HASH, got ${LOG_LINES:-0} line(s):"
  sed 's/^/      /' .sdd-bypass.log 2>/dev/null || echo "      (no log file)"
fi

# ── T4: soft mode warns but passes ────────────────────────────────────
echo "T4: hard_block_ac=false (soft mode)"
echo '{ "hard_block_ac": false }' > .sdd-config.json
big_file lib/big4.ts
git add lib/big4.ts
if git commit -m "feat: big change in soft mode" >t4.log 2>&1; then
  ok "commit passed in soft mode"
else
  bad "commit refused in soft mode (over-blocking):"; sed 's/^/      /' t4.log
fi

# ── T5: wave-artifact blocker (missing dashboard row) ────────────────
echo "T5: message names wave-7, dashboard has no wave-7 row"
echo "note" > docs/note.md
git add docs/note.md
BEFORE=$(commits)
git commit -m "chore: dashboard row check for wave-7" >t5.log 2>&1
T5_EXIT=$?
if [ "$FLAVOR" = "husky" ]; then
  if [ "$T5_EXIT" -ne 0 ] && [ "$(commits)" -eq "$BEFORE" ]; then
    ok "wave-artifact BLOCKER refused the commit"
  else
    bad "wave-artifact BLOCKER did not block (exit=$T5_EXIT) — same swallowed-exit class"
  fi
else
  # framework .githooks/commit-msg downgrades this to informational by design
  if [ "$T5_EXIT" -eq 0 ]; then
    ok "informational by design — commit passed (githooks flavor)"
  else
    bad "githooks flavor unexpectedly blocked (exit=$T5_EXIT)"
  fi
fi

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
