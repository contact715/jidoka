// shell-commands — какие простые команды ИСПОЛНИТ строка оболочки.
//
// Зачем. Сторож, который ищет подстроку в тексте команды, срабатывает на упоминание, а не на
// действие (класс guard-fires-on-mention-not-action): `git commit -m "не делай git stash pop"`
// выглядит как stash. Сторож, который вырезает всё в кавычках, слеп к обратному случаю:
// `bash -c 'git stash pop'` и `"$(git stash pop)"` стоят в кавычках и ИСПОЛНЯЮТСЯ
// (класс guard-bypassed-via-alternate-path). Поэтому здесь разбор по правилам оболочки
// (shell-parse.mjs), а поверх него — что из прочитанного реально запустится:
//   · обёртки снимаются: VAR=x, env (и env -S), command, exec, nohup, time, nice, timeout,
//     sudo/doas, xargs, caffeinate, stdbuf, zsh repeat, `function имя`, if/then/do/{ …;
//   · find -exec/-execdir/-ok/-okdir — каждая вставка отдельной командой;
//   · текст, отданный оболочке: sh/bash/zsh -c, eval, heredoc/herestring на вход оболочке,
//     `bash -` и `bash /dev/stdin`, `echo …|bash`, `printf …|sh`, `cat <<EOF …|bash`.
//
// Пределы — не дыра, а отказ: команда глубже MAX_DEPTH уровней «текст → оболочка» или с числом
// обёрток больше MAX_WRAPPERS возвращается как НЕРАЗОБРАННАЯ ({ unjudged }), и правило решает,
// что с ней делать. Молча пропустить её нельзя: это ровно тот обход, который нашла красная
// команда (21 префикс VAR=1, 7 вложенных eval, 4900 вложенных $( ).
//
// Граница, названная вслух: не раскрываются функции оболочки, объявленные раньше (`f(){…}; f`
// ловится только потому, что тело разбирается как команды), `source файл`, скрипт по пути,
// `curl … | bash` (текста программы в команде нет), код интерпретаторов (`node -e`,
// `python -c`), GNU parallel, раскрытие фигурных скобок (`{git,} stash`).
//
// Чистый модуль: ничего не читает и не пишет, при импорте ничего не делает.

import { parseScript, ShellDepthError } from './shell-parse.mjs';

export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const MAX_DEPTH = 6;
const MAX_WRAPPERS = 256;

const KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'coproc']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;

/** Имя команды: без пути, без zsh-префикса «=», в нижнем регистре (файловая система macOS его не различает). */
export function commandName(word) {
  return String(word ?? '').replace(/^.*\//, '').replace(/^=(?=[A-Za-z])/, '').toLowerCase();
}

// Пропустить параметры обёртки, начиная с k. takesValue(w) — съедает ли параметр следующее слово.
function skipOptions(argv, k, takesValue = () => false) {
  while (k < argv.length && argv[k].startsWith('-') && argv[k] !== '-') {
    if (argv[k] === '--') return k + 1;
    k += takesValue(argv[k]) ? 2 : 1;
  }
  return k;
}

const plain = (a, k) => skipOptions(a, k);
const WRAPPERS = {
  command: plain,
  builtin: plain,
  nohup: plain,
  noglob: plain,
  nocorrect: plain,
  time: plain,
  exec: (a, k) => skipOptions(a, k, (w) => w === '-a'),
  nice: (a, k) => skipOptions(a, k, (w) => w === '-n'),
  timeout: (a, k) => skipOptions(a, k, (w) => /^(-s|-k|--signal|--kill-after)$/.test(w)) + 1,
  gtimeout: (a, k) => WRAPPERS.timeout(a, k),
  sudo: (a, k) => skipOptions(a, k, (w) => /^-[A-Za-z]*[ugCDhpRrTt]$/.test(w)),
  doas: (a, k) => skipOptions(a, k, (w) => /^-[A-Za-z]*[uC]$/.test(w)),
  xargs: (a, k) => skipOptions(a, k, (w) => /^-[IdEeLnPsa]$/.test(w)),
  caffeinate: (a, k) => skipOptions(a, k, (w) => /^-[A-Za-z]*[wt]$/.test(w)),
  stdbuf: (a, k) => skipOptions(a, k, (w) => /^-[ioe]$/.test(w)),
  repeat: (a, k) => k + 1, // zsh: repeat N команда
  function: (a, k) => k + 1, // function имя { … }
};

const unjudgedView = (text) => ({ argv: [], words: [], unjudged: String(text) });

// env: параметры и присваивания; -S/--split-string делит строку на слова и запускает их.
function envView(argv, words, k) {
  while (k < argv.length) {
    const x = argv[k];
    const split = /^(?:-S|--split-string=?)([\s\S]*)$/.exec(x);
    if (split) {
      const glued = split[1] !== '';
      const rest = glued ? k + 1 : k + 2;
      const head = parseScript(glued ? split[1] : (argv[k + 1] ?? ''))[0] ?? { argv: [], words: [] };
      return { argv: [...head.argv, ...argv.slice(rest)], words: [...head.words, ...words.slice(rest)] };
    }
    if (x === '--') return { k: k + 1 };
    if (x.startsWith('-')) { k += /^(-u|--unset|-C|--chdir)$/.test(x) ? 2 : 1; continue; }
    if (ASSIGNMENT.test(x)) { k++; continue; }
    break;
  }
  return { k };
}

function findExecViews(argv, words, k, budget) {
  const out = [];
  for (let j = k + 1; j < argv.length; j++) {
    if (!/^-(exec|execdir|ok|okdir)$/.test(argv[j])) continue;
    let e = j + 1;
    while (e < argv.length && argv[e] !== ';' && argv[e] !== '+') e++;
    out.push(...viewsOf(argv.slice(j + 1, e), words.slice(j + 1, e), budget));
    j = e;
  }
  return out;
}

function viewsOf(argv, words, budget = MAX_WRAPPERS) {
  let k = 0;
  for (let steps = 0; k < argv.length; steps++) {
    if (steps > budget) return [unjudgedView(argv.join(' '))];
    const w = argv[k];
    const name = commandName(w);
    if (KEYWORDS.has(w) || ASSIGNMENT.test(w)) { k++; continue; }
    if (name === 'env') {
      const r = envView(argv, words, k + 1);
      if (r.argv) return viewsOf(r.argv, r.words, budget - steps);
      k = r.k;
      continue;
    }
    if (name === 'find') return findExecViews(argv, words, k, budget - steps);
    const wrap = Object.hasOwn(WRAPPERS, name) ? WRAPPERS[name] : null;
    if (!wrap) break;
    k = wrap(argv, k + 1);
  }
  return [{ argv: argv.slice(k), words: words.slice(k) }];
}

/** Что запустит команда после снятия обёрток: [{ argv, words }] или [{ unjudged }]. */
export function commandViews(cmd) {
  if (cmd.unjudged !== undefined) return [unjudgedView(cmd.unjudged)];
  const words = cmd.words ?? cmd.argv.map((text) => ({ text, dyn: false, unq: false }));
  return viewsOf(cmd.argv, words);
}

// Вход команды: heredoc/herestring на ней самой, иначе то, что пишет команда слева от `|`.
function stdinTexts(cmd) {
  if (cmd.stdin.length) return cmd.stdin.map((x) => x.text);
  const src = cmd.pipedFrom;
  if (!src) return [];
  if (src.stdin.length) return src.stdin.map((x) => x.text); // cat <<EOF … | bash
  const texts = [];
  for (const v of commandViews(src)) {
    const name = commandName(v.argv[0]);
    let args = v.argv.slice(1);
    if (name === 'echo') {
      while (args.length && /^-[neE]+$/.test(args[0])) args = args.slice(1);
      texts.push(args.join(' '));
    }
    if (name === 'printf') texts.push(args.join(' ').replace(/\\n/g, '\n'));
  }
  return texts;
}

// Программа, которую получит оболочка: текст после -c или её вход.
function shellProgram(argv, cmd) {
  let hasC = false;
  let fromStdin = false;
  let k = 1;
  for (; k < argv.length; k++) {
    const w = argv[k];
    if (w === '--') { k++; break; }
    if (w === '-') break;
    if (/^[-+][oO]$/.test(w) || w === '--rcfile' || w === '--init-file') { k++; continue; }
    if (/^[-+][A-Za-z]+$/.test(w)) {
      if (w[0] === '-' && w.includes('c')) hasC = true;
      if (w[0] === '-' && w.includes('s')) fromStdin = true;
      continue;
    }
    if (w.startsWith('--')) continue;
    break;
  }
  const operand = k < argv.length ? argv[k] : null;
  if (hasC) return operand === null ? [] : [operand];
  if (fromStdin || operand === null || ['-', '/dev/stdin', '/dev/fd/0'].includes(operand)) return stdinTexts(cmd);
  return [];
}

/** Текст, который эта команда отдаст оболочке на исполнение: sh -c, eval, программа на входе. */
export function executedScripts(cmd) {
  const texts = [];
  for (const v of commandViews(cmd)) {
    if (v.unjudged !== undefined) continue;
    const name = commandName(v.argv[0]);
    if (name === 'eval') texts.push(v.argv.slice(1).join(' '));
    if (SHELLS.has(name)) texts.push(...shellProgram(v.argv, cmd));
  }
  return texts;
}

const unjudgedCommand = (text) => ({ argv: [], words: [], stdin: [], pipedFrom: null, unjudged: String(text) });

/**
 * Все простые команды, которые исполнит эта строка оболочки: верхний уровень, подстановки и
 * текст, отданный оболочке. Возвращает [{ argv, words, stdin, pipedFrom }] и, при упоре в
 * пределы разбора, [{ unjudged: текст }]. Бросает только на внутренней ошибке разбора.
 */
export function simpleCommands(script, depth = 0) {
  const text = String(script ?? '');
  let out;
  try {
    out = parseScript(text);
  } catch (e) {
    if (e instanceof ShellDepthError) return [unjudgedCommand(text)];
    throw e;
  }
  const nested = [];
  for (const cmd of out) {
    for (const t of executedScripts(cmd)) {
      if (depth + 1 >= MAX_DEPTH) nested.push(unjudgedCommand(t));
      else nested.push(...simpleCommands(t, depth + 1));
    }
  }
  return out.concat(nested);
}
