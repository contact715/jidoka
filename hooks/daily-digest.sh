#!/bin/zsh
# daily-digest — утренний отчёт Claude Code: аналитика за вчера + здоровье jidoka.
# Запускается launchd-агентом com.mityamit.claude-daily-digest ежедневно в 09:00.
# Пишет файл в ~/.claude/digests/ и показывает уведомление macOS со звуком.

set -u
DIGESTS="$HOME/.claude/digests"
mkdir -p "$DIGESTS"
F="$DIGESTS/$(date +%F).txt"

{
  echo "Claude Code — утренний дайджест $(date '+%d.%m.%Y')"
  echo ""
  node "$HOME/.claude/jidoka/scripts/cc-stats.mjs" --days 1 2>/dev/null | sed $'s/\x1b\\[[0-9;]*m//g'
  echo ""
  node "$HOME/.claude/hooks/session-start-digest.mjs" < /dev/null 2>/dev/null
} > "$F" 2>&1

TOTAL=$(grep -o 'Итого.*' "$F" | head -1 | sed 's/Итого *//' | cut -c1-80)
osascript -e "display notification \"${TOTAL:-отчёт готов}\" with title \"Claude — утренний дайджест\" subtitle \"файл: ~/.claude/digests/$(date +%F).txt\"" 2>/dev/null
afplay -v 0.5 "$HOME/.claude/sounds/attention.wav" 2>/dev/null
exit 0
