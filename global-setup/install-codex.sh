#!/bin/sh
# Restore the GLOBAL Jidoka setup for Codex. Idempotent — safe to re-run.
# Makes Codex load Jidoka process rules in every project via ~/.codex/AGENTS.md.
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
FW="$(cd "$SRC/.." && pwd)"
DEST="$HOME/.codex"
JIDOKA="$DEST/jidoka"

mkdir -p "$DEST" "$JIDOKA/scripts" "$JIDOKA/docs/templates" "$JIDOKA/skills" "$JIDOKA/agents" "$JIDOKA/lib/redaction"

TMP="$DEST/AGENTS.md.tmp"
sed "s#__JIDOKA_FRAMEWORK_ROOT__#$FW#g" "$SRC/CODEX_AGENTS.md" > "$TMP"
if [ -f "$DEST/AGENTS.md" ] && ! cmp -s "$TMP" "$DEST/AGENTS.md"; then
  cp "$DEST/AGENTS.md" "$DEST/AGENTS.md.bak-$(date +%Y%m%d%H%M%S)"
fi
mv "$TMP" "$DEST/AGENTS.md"
echo "  ✓ Codex global instructions → ~/.codex/AGENTS.md"

cp "$FW/scripts/"*.mjs "$JIDOKA/scripts/" 2>/dev/null || true
cp "$FW/scripts/"*.sh "$JIDOKA/scripts/" 2>/dev/null || true
chmod +x "$JIDOKA/scripts/"*.sh 2>/dev/null || true
[ -f "$FW/lib/redaction/redact-pii.mjs" ] && cp "$FW/lib/redaction/redact-pii.mjs" "$JIDOKA/lib/redaction/"
echo "  ✓ engine mirror → ~/.codex/jidoka/scripts/"

for d in NORTH_STAR CONSTITUTION MISSION HIERARCHICAL_SPEC_SYSTEM MODULE_SPEC_SYSTEM MULTI_LEVEL_VERIFICATION AUTONOMOUS_PIPELINE AGENT_ROSTER TOYOTA_WAY DOD DOR ENGINEERING_SYSTEM_ASSESSMENT MEMORY_MERGE_PROTOCOL PROACTIVE_HOLISTIC_ANALYSIS_TRIGGER PROACTIVE_SURFACING_PROTOCOL MODEL_ROUTING_PROTOCOL LOCAL_RELAY_PROTOCOL; do
  [ -f "$FW/docs/$d.md" ] && cp "$FW/docs/$d.md" "$JIDOKA/docs/$d.md"
done
[ -d "$FW/docs/templates" ] && cp "$FW/docs/templates/"*.md "$JIDOKA/docs/templates/" 2>/dev/null || true
[ -f "$FW/docs/NORTH_STAR_TEMPLATE.md" ] && cp "$FW/docs/NORTH_STAR_TEMPLATE.md" "$JIDOKA/NORTH_STAR_TEMPLATE.md"
[ -f "$FW/docs/PROJECT_CHARTER_TEMPLATE.md" ] && cp "$FW/docs/PROJECT_CHARTER_TEMPLATE.md" "$JIDOKA/PROJECT_CHARTER_TEMPLATE.md"
echo "  ✓ canon docs → ~/.codex/jidoka/docs/"

cp "$FW/.claude/skills/"*.md "$JIDOKA/skills/" 2>/dev/null || true
for a in "$FW/.claude/agents/"*.md; do
  [ "$(basename "$a")" = "_TEMPLATE.md" ] || cp "$a" "$JIDOKA/agents/"
done
echo "  ✓ skills + agents mirror → ~/.codex/jidoka/"

echo "✓ Global Codex Jidoka setup restored. Start a new Codex session for the global AGENTS.md to load."
