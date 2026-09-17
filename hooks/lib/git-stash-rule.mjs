// git-stash-rule — какие формы `git stash` опасны при параллельных сессиях.
// Класс agent-uses-shared-git-stash (projectx-app, волна 368, 2026-09-17).
//
// Стек stash ОДИН на основную папку и все её worktree, а сессий Claude на машине несколько.
// Дважды за одну волну исполнитель сделал `git stash` / `git stash pop` ради сравнения с базовой
// линией, хотя задание прямо это запрещало. Чужие записи уцелели случайно: запрет жил только в
// тексте задания. Здесь он становится правилом, которое применяет хук permission-gate.
//
// Разрешены только формы, которые не могут взять чужое:
//   git stash list | show            — только чтение
//   git stash push -m "<метка>"      — запись с меткой, её можно найти среди чужих
//   git stash apply <sha>            — по отпечатку, который не сдвигается
//   git stash drop <ref>             — по явной ссылке, найденной по метке
// Всё остальное — голый stash, save, pop, push без метки, apply без отпечатка, drop без ссылки,
// clear, branch, create, store — блокируется. Разрешения на них не бывает: безопасная замена
// есть всегда (STASH_ADVICE).
//
// Цель из переменной: в кавычках ("$SHA") принимается — пустое значение git отвергает и ничего
// не трогает (проверено 2026-09-17 на одноразовом репозитории). БЕЗ кавычек ($SHA) не
// принимается: пустое значение исчезает, и команда становится голой. Числа из одних цифр git
// читает как номер stash@{n} (`apply 0000000` применил верхнюю запись), поэтому отпечаток обязан
// содержать букву a-f или быть полным. Осознанно разрешено: `drop stash@{n}` — ссылка явная, её
// номер ищут по метке прямо перед удалением.
//
// Чистый модуль: при импорте ничего не делает, не бросает.

import { commandName, commandViews, simpleCommands } from './shell-commands.mjs';
import { parseScript } from './shell-parse.mjs';

// глобальные параметры git, которые съедают следующее слово
const GIT_OPT_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source']);
const HELP = new Set(['-h', '--help']);
const DEEP_FORM = 'команда глубже разбора';
const MAX_ALIAS_DEPTH = 5;

/** Команды, которые текст отказа предлагает взамен. Тест проверяет, что сторож их пропускает. */
export const STASH_RECIPES = [
  'git stash push -u -m "<уникальная-метка>"',
  'SHA=$(git stash list --format=\'%H %gs\' | awk \'/<уникальная-метка>/{print $1; exit}\'); git stash apply "$SHA"',
  'REF=$(git stash list --format=\'%gd %gs\' | awk \'/<уникальная-метка>/{print $1; exit}\'); git stash drop "$REF"',
];

export const STASH_ADVICE = [
  '  Стек stash один на основную папку и все worktree, а сессий Claude несколько: чужая запись может оказаться сверху.',
  '  Чем заменить:',
  '    · отложить свою работу — временный коммит: git add -A && git commit -m "WIP <метка>"  (вернуть правки: git reset --soft HEAD~1)',
  '    · сравнить с базовой линией — отдельная папка: git worktree add --detach <путь> <база>  (убрать: git worktree remove <путь>)',
  '    · если без stash никак — метка, возврат по отпечатку, удаление по ссылке, найденной по метке:',
  ...STASH_RECIPES.map((r) => `        ${r}`),
  '  Цель в переменной берите в кавычки: без кавычек пустое значение превращает команду в голую.',
  '  Разрешения на эту форму не выдаётся: безопасная замена есть всегда.',
];

const isSha = (t) => /^[0-9a-f]{7,40}$/i.test(t) && (/[a-f]/i.test(t) || t.length === 40);

/** git-команда в виде { sub, args, words }, или { script } у псевдонима-оболочки, или null. */
export function gitSubcommand(view, aliasDepth = 0) {
  const { argv, words } = view;
  if (!argv.length) return null;
  const name = commandName(argv[0]);
  if (name === 'git-stash') return { sub: 'stash', args: argv.slice(1), words: words.slice(1) };
  const dynamicName = Boolean(words[0] && words[0].dyn);
  if (name !== 'git' && !dynamicName) return null;
  const aliases = new Map();
  let k = 1;
  while (k < argv.length && argv[k].startsWith('-')) {
    const alias = argv[k] === '-c' ? /^alias\.([^=]+)=([\s\S]*)$/i.exec(argv[k + 1] ?? '') : null;
    if (alias) aliases.set(alias[1].toLowerCase(), alias[2]);
    k += GIT_OPT_WITH_VALUE.has(argv[k]) ? 2 : 1;
  }
  if (k >= argv.length) return null;
  const hit = { sub: argv[k], args: argv.slice(k + 1), words: words.slice(k + 1) };
  // имя в переменной ($G, ${GIT:-git}) судится, только если за ним стоит stash
  if (name !== 'git') return hit.sub === 'stash' ? hit : null;
  const body = aliases.get(hit.sub.toLowerCase());
  if (body === undefined || aliasDepth >= MAX_ALIAS_DEPTH) return hit;
  if (body.startsWith('!')) return { script: `${body.slice(1)} ${hit.args.join(' ')}` };
  const head = parseScript(`git ${body}`)[0];
  if (!head) return hit;
  return gitSubcommand({ argv: [...head.argv, ...hit.args], words: [...head.words, ...hit.words] }, aliasDepth + 1);
}

// Позиционные аргументы с их словами (параметры пропускаются, после `--` всё позиционное).
function positional(args, words) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '--') {
      for (let j = k + 1; j < args.length; j++) out.push(words[j] ?? { text: args[j] });
      break;
    }
    if (!args[k].startsWith('-')) out.push(words[k] ?? { text: args[k] });
  }
  return out;
}

// Метка записи: побеждает последняя (-m, -m<v>, -um <v>, --message[=], сокращения --mes…);
// --no-message её снимает. Значение без кавычек из переменной меткой не считается.
function hasTag(args, words) {
  let tag = null;
  for (let k = 0; k < args.length; k++) {
    const w = args[k];
    if (w === '--') break;
    if (w === '--no-message') { tag = null; continue; }
    const long = /^--m(?:e(?:s(?:s(?:a(?:g(?:e)?)?)?)?)?)?(?:=([\s\S]*))?$/.exec(w);
    const short = w.startsWith('--') ? null : /^-[kpuaqS]*m([\s\S]*)$/.exec(w);
    if (!long && !short) continue;
    const gluedText = long ? long[1] : (short[1] !== '' ? short[1] : undefined);
    const glued = gluedText !== undefined;
    const word = glued ? words[k] : words[k + 1];
    const text = glued ? gluedText : (args[k + 1] ?? '');
    tag = word && word.unq ? null : text;
    if (!glued) k++;
  }
  return tag !== null && tag.trim() !== '';
}

const ok = (form) => ({ allowed: true, form, reason: '' });
const no = (form, reason) => ({ allowed: false, form, reason });
const VANISH = 'значение из переменной без кавычек может оказаться пустым, и команда станет голой';

const isHelp = (args) => HELP.has(args[0]) || (args.length === 2 && HELP.has(args[1]));

// '' — цель принята; строка — причина отказа; null — отказ с причиной по умолчанию.
function targetVerdict(target, acceptLiteral) {
  if (!target) return null;
  if (target.unq) return VANISH;
  if (target.dyn) return ''; // в кавычках: пустое значение git отвергает
  return acceptLiteral(target.text) ? '' : null;
}

/** Вердикт по аргументам после слова `stash`. `words` — слова тех же аргументов с признаками. */
export function stashVerdict(args = [], words = args.map((text) => ({ text, dyn: false, unq: false }))) {
  if (isHelp(args)) return ok('git stash --help');
  if (!args.length) {
    return no('git stash', 'кладёт запись без метки на вершину общего стека: её не отличить от записи другой сессии');
  }
  // `git stash -u -m x` и `git stash -- путь` — это push без слова push
  const implied = args[0].startsWith('-');
  const sub = implied ? 'push' : args[0];
  const rest = implied ? args : args.slice(1);
  const restWords = implied ? words : words.slice(1);
  switch (sub) {
    case 'list':
    case 'show':
      return ok(`git stash ${sub}`);
    case 'push':
      return hasTag(rest, restWords)
        ? ok('git stash push -m')
        : no('git stash push без -m', 'запись без метки потом не найти среди записей других сессий');
    case 'apply': {
      const p = positional(rest, restWords);
      const why = p.length === 1 ? targetVerdict(p[0], isSha) : null;
      return why === ''
        ? ok('git stash apply <sha>')
        : no('git stash apply без SHA', why || 'номер stash@{n} сдвигается, как только другая сессия положит свою запись, а без номера берётся верхняя, возможно чужая; число из одних цифр git тоже читает как номер');
    }
    case 'drop': {
      const why = targetVerdict(positional(rest, restWords)[0], () => true);
      return why === ''
        ? ok('git stash drop <ref>')
        : no('git stash drop без ссылки', why || 'удаляет верхнюю запись общего стека, а она может быть чужой');
    }
    case 'pop':
      return no('git stash pop', 'забирает ВЕРХНЮЮ запись общего стека, а она может принадлежать другой сессии');
    case 'save':
      return no('git stash save', 'устаревшая форма без надёжной метки, а вернуть такую запись тянет через pop');
    case 'clear':
      return no('git stash clear', 'удаляет записи ВСЕХ сессий разом');
    default:
      return no(`git stash ${sub}`, 'этой формы нет среди безопасных: list, show, push -m, apply <sha>, drop <ref>');
  }
}

function judge(script, found, aliasDepth) {
  for (const cmd of simpleCommands(script)) {
    for (const view of commandViews(cmd)) {
      if (view.unjudged !== undefined) {
        found.push({ form: DEEP_FORM, reason: 'вложенность или число обёрток больше, чем сторож умеет разобрать; неразобранная команда не пропускается — упростите её', argv: [] });
        continue;
      }
      const g = gitSubcommand(view);
      if (!g) continue;
      if (g.script !== undefined) {
        if (aliasDepth < MAX_ALIAS_DEPTH) judge(g.script, found, aliasDepth + 1);
        continue;
      }
      if (g.sub !== 'stash') continue;
      const v = stashVerdict(g.args, g.words);
      if (!v.allowed) found.push({ form: v.form, reason: v.reason, argv: view.argv });
    }
  }
}

/**
 * Нарушения в строке оболочки: [{ form, reason, argv }]. Пусто — чисто.
 * Судит только то, что исполнится; упоминание в тексте коммита нарушением не является.
 * Не бросает: внутренняя ошибка разбора даёт пустой список (хук не должен ломать сессию).
 */
export function stashViolations(script) {
  const found = [];
  try { judge(script, found, 0); } catch { return []; }
  return found;
}
