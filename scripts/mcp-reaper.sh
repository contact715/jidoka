#!/bin/bash
# mcp-reaper — убирает процессы, брошенные закрытыми сеансами Claude Code.
#
# Критерий "мусор": родитель = launchd (PPID 1) => сеанс-владелец уже мёртв.
# ЖИВЫЕ сеансы и их дочерние процессы НЕ трогаются (у них PPID = живой claude).
# Отдельный бот castells-comms-agent (venv path) под фильтр не попадает.
#
# 2026-07-21 — MCP через `uv run` (telegram/whatsapp): осиротевшие uv-обёртки.
# 2026-07-24 — добавлены три класса, найденные при разборе "комп зависает":
#   * vitest/tsc forks с PPID 1 — переживают убитый прогон гейтов;
#   * npm exec обёртки с PPID 1 — по ~78 МБ каждая, чистые накладные расходы;
#   * tsc/vitest старше HANG_MIN минут — полный прогон занимает ~6 мин,
#     всё что живёт полчаса, зависло, а не считает.
LOG="$HOME/.claude/logs/mcp-reaper.log"
HANG_MIN=30
mkdir -p "$HOME/.claude/logs"

# --- класс 1: осиротевшие (PPID 1) ------------------------------------------
orphans() {
  # условие держим в одну строку: awk из macOS не принимает перенос после "("
  ps -Axo pid,ppid,command | awk '$2==1 && ($3=="uv" || $0 ~ /\/bin\/uv/ || $0 ~ /telegram-mcp\// || $0 ~ /whatsapp-mcp\// || $0 ~ /vitest\/dist\/workers/ || $0 ~ /\.bin\/vitest/ || $0 ~ /\.bin\/tsc/ || $0 ~ /npm exec/) { print $1 }'
}

# --- класс 2: зависшие проверки (возраст > HANG_MIN) ------------------------
# etime приходит как [[dd-]hh:]mm:ss — считаем в минутах.
hung() {
  ps -Axo pid,etime,command | awk -v cap="$HANG_MIN" '
    /\.bin\/tsc|vitest\/dist\/workers|\.bin\/vitest/ && !/awk/ {
      t=$2; d=0
      if (t ~ /-/) { split(t,a,"-"); d=a[1]; t=a[2] }
      n=split(t,p,":")
      mins = (n==3) ? p[1]*60+p[2] : p[1]
      mins += d*1440
      if (mins > cap) print $1
    }'
}

killed=0
for pid in $(orphans) $(hung); do
  kill -TERM "$pid" 2>/dev/null && killed=$((killed+1))
done
sleep 3
for pid in $(orphans) $(hung); do kill -KILL "$pid" 2>/dev/null; done

left_uv=$(ps -Axo ppid,command | awk '$1==1 && /uv/' | wc -l | tr -d ' ')
left_gate=$(ps -Axo ppid,command | awk '$1==1 && (/vitest/ || /\.bin\/tsc/ || /npm exec/)' | wc -l | tr -d ' ')
swap=$(sysctl -n vm.swapusage | sed 's/.*used = //; s/ .*//')
echo "$(date '+%Y-%m-%d %H:%M:%S')  reaped=$killed  orphan_uv_left=$left_uv  orphan_gate_left=$left_gate  swap_used=$swap" >> "$LOG"
