#!/bin/sh
# jidoka global secret-guard — a PreToolUse hook on Bash.
# Blocks `git push` / `git commit` ONLY when the project has opted in (has a local
# .jidoka/) AND the pre-publish-guard finds secrets/PII in the tree or history.
# Projects without .jidoka are untouched — this never interferes with unrelated work.
#
# Input: JSON on stdin (tool_name, tool_input.command, cwd). Output: exit 2 = block.

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(((JSON.parse(d).tool_input)||{}).command||'')}catch{}})" 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).cwd||'')}catch{}})" 2>/dev/null)

case "$CMD" in
  *"git push"*|*"git commit"*)
    if [ -f "$CWD/.jidoka/scripts/pre-publish-guard.mjs" ]; then
      if ! ( cd "$CWD" && node .jidoka/scripts/pre-publish-guard.mjs >/dev/null 2>&1 ); then
        echo "jidoka secret-guard: secrets or PII found in tree/history — push/commit blocked." >&2
        echo "  Inspect: cd \"$CWD\" && node .jidoka/scripts/pre-publish-guard.mjs" >&2
        exit 2
      fi
    fi
    ;;
esac
exit 0
