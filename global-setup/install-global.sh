#!/bin/sh
# Restore the GLOBAL jidoka setup into ~/.claude. Idempotent — safe to re-run.
# Makes Claude Code work as a disciplined senior team in EVERY project.
#
#   sh global-setup/install-global.sh
#   # then restart Claude Code so hooks load
#
# Installs: senior-method CLAUDE.md section, hooks (secret-guard + feature-reminder),
# dev-pipeline skill, the zero-dep engine, the team agents, and merges hooks into
# settings.json WITHOUT touching your permissions/theme.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"   # global-setup/
FW="$(cd "$SRC/.." && pwd)"            # framework root (source of truth for engine + agents)
DEST="$HOME/.claude"
mkdir -p "$DEST/hooks" "$DEST/skills/dev-pipeline" "$DEST/jidoka/scripts" "$DEST/jidoka/lib/redaction" "$DEST/agents"

# 1. hooks (shell guards + node policy-enforce hook)
cp "$SRC/hooks/"*.sh "$DEST/hooks/" 2>/dev/null; chmod +x "$DEST/hooks/"*.sh 2>/dev/null || true
cp "$SRC/hooks/"*.mjs "$DEST/hooks/" 2>/dev/null || true
echo "  ✓ hooks → ~/.claude/hooks/"
# wire policy-enforce-hook into PreToolUse (idempotent, preserves any existing hooks)
node -e 'const fs=require("fs"),os=require("os");const p=os.homedir()+"/.claude/settings.json";let s={};try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}s.hooks=s.hooks||{};s.hooks.PreToolUse=s.hooks.PreToolUse||[];const c="node "+os.homedir()+"/.claude/hooks/policy-enforce-hook.mjs";if(!s.hooks.PreToolUse.some(e=>(e.hooks||[]).some(h=>(h.command||"").includes("policy-enforce-hook")))){s.hooks.PreToolUse.push({matcher:"Write|Edit|MultiEdit|NotebookEdit",hooks:[{type:"command",command:c,timeout:15}]});fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n")}' 2>/dev/null && echo "  ✓ policy-enforce-hook wired into PreToolUse"

# 1b. statusline + slash-commands (Claude-Code-native)
cp "$SRC/statusline-jidoka.mjs" "$DEST/" 2>/dev/null || true
mkdir -p "$DEST/commands"; cp "$SRC/commands/jidoka-"*.md "$DEST/commands/" 2>/dev/null || true
node -e 'const fs=require("fs"),os=require("os");const p=os.homedir()+"/.claude/settings.json";let s={};try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}const c="node "+os.homedir()+"/.claude/statusline-jidoka.mjs";if(!s.statusLine||s.statusLine.command!==c){s.statusLine={type:"command",command:c,padding:0};fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n")}' 2>/dev/null && echo "  ✓ statusline + slash-commands wired"

# 2. dev-pipeline skill
cp "$SRC/skills/dev-pipeline/SKILL.md" "$DEST/skills/dev-pipeline/"
echo "  ✓ dev-pipeline skill"

# 3. engine (from framework — the source of truth, with global ledger path)
for f in meta-lib meta-remedies meta-audit meta-honesty meta-trend meta-premortem meta-log proof-gate pre-publish-guard memory-consolidate northstar-check kaizen-loop charter-check get-spec-context spec-first-gate orchestration-planner debate-trigger adaptive-verify run-state; do
  [ -f "$FW/scripts/$f.mjs" ] && cp "$FW/scripts/$f.mjs" "$DEST/jidoka/scripts/"
done
[ -f "$FW/lib/redaction/redact-pii.mjs" ] && cp "$FW/lib/redaction/redact-pii.mjs" "$DEST/jidoka/lib/redaction/"
# North Star template — the CPO uses it to create docs/NORTH_STAR.md in any project
[ -f "$FW/docs/NORTH_STAR_TEMPLATE.md" ] && cp "$FW/docs/NORTH_STAR_TEMPLATE.md" "$DEST/jidoka/NORTH_STAR_TEMPLATE.md"
[ -f "$FW/docs/PROJECT_CHARTER_TEMPLATE.md" ] && cp "$FW/docs/PROJECT_CHARTER_TEMPLATE.md" "$DEST/jidoka/PROJECT_CHARTER_TEMPLATE.md"
# point meta-lib at the GLOBAL cross-project ledger
perl -i -pe "s{'docs/audits/meta-mistakes.jsonl'}{(process.env.HOME||'')+'/.claude/jidoka/meta-mistakes.jsonl'}g" "$DEST/jidoka/scripts/meta-lib.mjs" 2>/dev/null || true
# rewrite remedy mechanism paths to the installed location so meta-audit's broken-gate check resolves them (parity with install-into.mjs)
perl -i -pe "s{'scripts/}{'$DEST/jidoka/scripts/}g" "$DEST/jidoka/scripts/meta-remedies.mjs" 2>/dev/null || true
echo "  ✓ engine → ~/.claude/jidoka/scripts/"

# 3a. dashboard (framework-level multi-project viewer — npm run dashboard)
mkdir -p "$DEST/jidoka/scripts/dashboard"
cp "$FW/scripts/dashboard/"* "$DEST/jidoka/scripts/dashboard/" 2>/dev/null && echo "  ✓ dashboard → ~/.claude/jidoka/scripts/dashboard/" || true

# 4. team agents (skip the template)
for a in "$FW/.claude/agents/"*.md; do
  [ "$(basename "$a")" = "_TEMPLATE.md" ] || cp "$a" "$DEST/agents/"
done
echo "  ✓ team agents → ~/.claude/agents/"

# 5. CLAUDE.md method (append the senior section if not already present)
if [ -f "$DEST/CLAUDE.md" ] && grep -q "Engineering Discipline" "$DEST/CLAUDE.md"; then
  echo "  • CLAUDE.md method already present (skipped)"
else
  cat "$SRC/CLAUDE.md" >> "$DEST/CLAUDE.md" 2>/dev/null || cp "$SRC/CLAUDE.md" "$DEST/CLAUDE.md"
  echo "  ✓ appended CLAUDE.md method (review once for duplicate sections)"
fi

# 6. merge hooks into settings.json (preserve permissions/theme/etc; expand $HOME)
node -e '
const fs=require("fs"),os=require("os");const home=os.homedir();const p=home+"/.claude/settings.json";
const s=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
const frag=JSON.parse(fs.readFileSync(process.argv[1],"utf8").replaceAll("$HOME",home));
s.hooks=s.hooks||{};
for(const [evt,arr] of Object.entries(frag.hooks||{})){
  s.hooks[evt]=s.hooks[evt]||[];
  for(const h of arr) if(!s.hooks[evt].some(x=>JSON.stringify(x)===JSON.stringify(h))) s.hooks[evt].push(h);
}
fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n");
console.log("  ✓ merged hooks into settings.json (permissions untouched)");
' "$SRC/settings-hooks-fragment.json"

echo "✓ Global jidoka setup restored. Restart Claude Code to load hooks."
