#!/bin/zsh
# tool-failure-sound — хук PostToolUseFailure: тихий низкий тон при провале инструмента.
# Дебаунс 60 секунд (частые мелкие провалы — обычное дело, трещать на каждый нельзя).
M=/tmp/claude-failure-sound.last
now=$(date +%s)
last=$(cat "$M" 2>/dev/null || echo 0)
[ $((now - last)) -lt 60 ] && exit 0
echo "$now" > "$M"
afplay -v 0.35 "$HOME/.claude/sounds/halt.wav" > /dev/null 2>&1 &
exit 0
