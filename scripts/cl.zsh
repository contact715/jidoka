# cl — status-aware project launcher (cockpit) for the jidoka dev environment.
# Source this from ~/.zshrc, or copy the function in. Requires: fzf, node.
# Reads the project list from ~/.claude/projects.list (lines: "name<TAB>path", # = comment).
# The "brain" that computes the traffic-light status + preview lives in
# scripts/cl-launcher.mjs (installed at ~/.claude/jidoka/scripts/cl-launcher.mjs).
#
# Features:
#   - traffic-light dot per project (🟢 clean / 🟡 dirty|out-of-sync / 🔴 HALT / ⚪ not git / 🔒 read-only)
#   - rich preview: branch, ahead/behind, uncommitted count, last commit, current wave, eval baseline
#   - smart ordering: most recently committed project floats to the top
#   - intent keys: Enter (launch) · Ctrl-O (cd only) · Ctrl-G (portfolio+launch) · Ctrl-N (new wave)
#   - read-only guard: warns before you work in a protected/prod repo
#   - context pre-warm: prints the project status as you land, then starts claude
#   - cl -s : portfolio view (status of all projects at once)

cl() {
  local list="$HOME/.claude/projects.list"
  local launch="$HOME/.claude/jidoka/scripts/cl-launcher.mjs"
  # fallback to the old dumb picker if the launcher brain is missing
  if [[ ! -f "$launch" ]]; then
    local line
    line=$(grep -v '^#' "$list" | fzf --prompt="Проект: " --query="$*" \
      --delimiter='\t' --with-nth=1 --height=40% --reverse --preview 'ls {2}')
    [[ -z "$line" ]] && return
    cd "${line#*$'\t'}" && [[ "$1" != "-c" ]] && claude
    return
  fi
  case "$1" in
    -e) ${EDITOR:-nano} "$list"; return ;;
    -s) node "$launch" portfolio; return ;;
    -h|--help)
      print -r -- 'cl — запускатор проектов (кокпит)
  cl            выбрать проект (светофор + превью)
  cl <текст>    сразу отфильтровать по имени
  cl -s         портфель: статус всех проектов
  cl -c         только перейти в папку (без claude)
  cl -e         редактировать список проектов
горячие клавиши в списке:
  Enter   перейти + статус проекта + запустить claude
  Ctrl-O  только перейти в папку
  Ctrl-G  перейти + портфель, затем claude
  Ctrl-N  перейти + claude для новой волны'
      return ;;
  esac
  local cd_only=""
  if [[ "$1" == "-c" ]]; then cd_only=1; shift; fi
  local out key line dir
  out=$(node "$launch" list 2>/dev/null | fzf --prompt="Проект: " --query="$*" --select-1 \
      --delimiter='\t' --with-nth=1 --height=55% --reverse \
      --header='Enter запуск · Ctrl-O папка · Ctrl-G портфель · Ctrl-N новая волна' \
      --expect=ctrl-o,ctrl-g,ctrl-n \
      --preview "node \"$launch\" preview {2}" --preview-window=right:50%)
  [[ -z "$out" ]] && return
  key="${out%%$'\n'*}"
  line="${out#*$'\n'}"
  [[ -z "$line" ]] && return
  dir="${line##*$'\t'}"
  cd "$dir" || return
  # read-only guard: warn (never block the cd) for protected/prod repos
  node "$launch" guard "$dir" >/dev/null 2>&1 || print -P "%F{yellow}🔒 READ-ONLY проект — не пушь, только локально%f"
  [[ -n "$cd_only" ]] && return
  case "$key" in
    ctrl-o) ;;
    ctrl-g) node "$launch" portfolio; claude ;;
    ctrl-n) print -P "%F{cyan}▶ новая волна: опиши фичу — запустится dev-pipeline%f"; claude ;;
    *) node "$launch" preview "$dir" | sed -n '1,9p'; claude ;;
  esac
}
