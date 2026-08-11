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
  echo ""
  echo "── Контроль гейтов (честность за 26ч) ──"
  node "$HOME/.claude/jidoka/scripts/enforcement-reconcile.mjs" 2>/dev/null | sed $'s/\x1b\\[[0-9;]*m//g'
  echo ""
  node "$HOME/.claude/jidoka/scripts/cost-crosscheck.mjs" 2>/dev/null
  echo ""
  echo "── Ежедневная рутина jidoka ──"
  bash "$HOME/.claude/jidoka/scripts/routine-daily.sh" 2>/dev/null | tail -n +2
} > "$F" 2>&1

TOTAL=$(grep -o 'Итого.*' "$F" | head -1 | sed 's/Итого *//' | cut -c1-80)
# Устаревшие скиллы поднимаются в само уведомление: строка в файле, который
# никто не открыл, ничего не чинит.
STALE=$(grep -o '⚠ устарели: [0-9]*' "$F" | head -1)
[ -n "$STALE" ] && TOTAL="${TOTAL} · скиллы: ${STALE}"
osascript -e "display notification \"${TOTAL:-отчёт готов}\" with title \"Claude — утренний дайджест\" subtitle \"файл: ~/.claude/digests/$(date +%F).txt\"" 2>/dev/null
# звук отключён 2026-07-04: звуки остаются только на вопрос к владельцу и на полное завершение задачи
exit 0
