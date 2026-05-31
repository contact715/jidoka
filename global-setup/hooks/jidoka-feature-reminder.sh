#!/bin/sh
# jidoka feature-reminder — a UserPromptSubmit hook.
# When the user's message looks like a feature/development request, it INJECTS a
# reminder into Claude's context (stdout on exit 0 = added as context) to start with
# business questions → spec → code, instead of jumping to code. This is the mechanical
# backstop for the one gap the behavior test found: it fires regardless of whether the
# dev-pipeline skill auto-loaded. It NEVER blocks (exit 0 always) — soft, not brittle.

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log((JSON.parse(d).prompt||'').toLowerCase())}catch{}})" 2>/dev/null)

case "$PROMPT" in
  *"хочу фичу"*|*"хочу такую фичу"*|*"хочу добавить"*|*"добавь фичу"*|*"добавить фичу"*|*"нужна фича"*|*"сделай фичу"*|*"сделать фичу"*|*"разработай"*|*"реализуй"*|*"построй"*|*"новый проект"*|*"новую фичу"*|*"build a feature"*|*"add a feature"*|*"new feature"*|*"start a project"*|*"implement "*|*"build me"*)
    echo "[dev-pipeline reminder] This is a feature/development request. Before writing ANY code or a technical plan: FIRST ask the user business-logic questions (who uses it, why, constraints, success criteria, edge cases) via AskUserQuestion. Then dispatch architects for the master spec, then tests, then code. Run the dev-pipeline skill. Do not jump straight to code — these requests are always non-trivial."
    ;;
esac
exit 0
