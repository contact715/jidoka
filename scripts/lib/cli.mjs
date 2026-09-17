// cli — строгий разбор аргументов, один на весь движок.
//
// Зачем (2026-09-16, класс extra-argument-silently-swallowed): скрипты искали свои
// флаги подстрокой и молча пропускали всё остальное. `safe-commit.mjs --help`
// запускал коммит и пуш в main, `research-audit.mjs --bogus --self-test` молча
// работал. Здесь один способ вместо двухсот самодельных:
//
//   · незнакомый флаг, лишнее слово, флаг без значения, неверная команда — код 2
//     ДО любой работы: в stderr причина, «Ничего не выполнено.» и справка;
//   · --help / -h — справка в stdout, код 0;
//   · --self-test — у тех, кто объявил selfTest: true; у остальных это незнакомый флаг.
//
// Текст, который начинается с дефиса ("- пункт", "-5", "-fix: опечатка"), берётся как
// есть, как у `git commit -m`. Похожее на флаг ("-x", "--no-push") остаётся флагом:
// забытое значение не должно молча стать следующим флагом.
//
// Спецификация:
//   const { values, positionals, command } = runCli({
//     name: 'task-queue',                       // для сообщений; по умолчанию — имя файла
//     path: 'scripts/task-queue.mjs',           // для справки; по умолчанию scripts/<name>.mjs
//     selfTest: true,                           // у скрипта есть --self-test
//     summary: 'Очередь задач: по одной за раз.', // первая строка справки (если нет usage)
//     usage: USAGE,                             // готовый текст справки вместо собранного
//     options: {                                // флаги для всех команд
//       json: { type: 'boolean', desc: 'вывод в JSON' },
//       limit: { type: 'number', default: 20, desc: 'сколько строк' },
//       tier: { type: 'string', choices: ['light', 'deep'] },
//       file: { type: 'string', multiple: true, short: 'f' },
//     },
//     positionals: { min: 0, max: 0, name: 'файл' },   // по умолчанию — ни одного; label — готовый вид в справке
//     commands: {                               // подкоманды: первое слово
//       next: {},
//       done: { positionals: { min: 1, max: 1, name: 'id' } },
//       add: { options: { prompt: { type: 'string' } }, positionals: { min: 1, max: 1, name: 'title' } },
//       relay: { passthrough: 'jidoka-relay.mjs', prepend: [] },   // диспетчер: хвост разбирает цель
//     },
//     defaultCommand: 'status',                 // если слово не дано; иначе команда обязательна
//     badCallExit: HOOK_BAD_CALL_EXIT,          // только хуки Claude Code: код 1 вместо 2 (см. ниже)
//   });
//
// Типы флагов: boolean | string | number (число проверяется: не число — код 2).
// Команда с passthrough возвращает { command, rest, forward, prepend } — хвост не разбирается
// здесь: его разберёт строго целевой скрипт, а сверка мест вызова идёт по цепочке.
//
// Это средство, а не сторож: класс extra-argument-silently-swallowed закрывают
// scripts/cli-strictness.mjs (статически) и scripts/__tests__/cli-contract.test.mjs (живым запуском).

import { parseArgs } from 'node:util';
import { writeSync } from 'node:fs';
import { basename } from 'node:path';

export const EXIT_USAGE = 2;
const FLAG_SHAPED = /^--?[A-Za-z][\w-]*(?:=[\s\S]*)?$/;
const HELP = { help: { type: 'boolean', short: 'h', desc: 'эта справка' } };
const SELF_TEST = { 'self-test': { type: 'boolean', desc: 'самопроверка' } };
// --self-test есть только у того, кто его объявил (selfTest: true). Иначе скрипт без
// самопроверки разобрал бы флаг и молча пошёл делать работу — ровно тот дефект.
const builtin = (spec) => ({ ...HELP, ...(spec.selfTest ? SELF_TEST : {}) });
const EXIT_LINE = 'Коды выхода: 0 — готово, 1 — отказ или находка, 2 — неверный вызов (ничего не выполнено).';
// Хук Claude Code: код 2 у него значит «заблокировать» (PreToolUse — вызов инструмента,
// UserPromptSubmit — сообщение человека, Stop — завершение). Опечатка в settings.json с кодом 2
// заперла бы сессию, поэтому хук отвечает на неверный вызов кодом 1: ошибка видна, но не блокирует.
export const HOOK_BAD_CALL_EXIT = 1;
const HOOK_EXIT_LINE = 'Коды выхода: 0 — пропустить; 2 — заблокировать действие (у хуков, которые умеют блокировать); неверный вызов — 1 (для Claude Code это видимая ошибка без блокировки), ничего не выполнено.';
const HELPER_KEYS = new Set(['type', 'short', 'multiple', 'default', 'desc', 'choices', 'value']);
const SPEC_KEYS = new Set(['name', 'path', 'summary', 'usage', 'selfTest', 'options', 'positionals', 'commands', 'defaultCommand', 'badCallExit']);
const POSITIONAL_KEYS = new Set(['min', 'max', 'name', 'label', 'choices']);
const COMMAND_KEYS = new Set(['desc', 'options', 'positionals', 'passthrough', 'prepend']);
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Ошибка в спецификации — дефект скрипта: опечатка в поле не должна молча менять правило. */
function validateSpec(spec) {
  const unknown = (obj, allowed, where) => {
    for (const k of Object.keys(obj || {})) if (!allowed.has(k)) throw new TypeError(`cli: незнакомое поле спецификации «${k}» (${where})`);
  };
  unknown(spec, SPEC_KEYS, 'верхний уровень');
  unknown(spec.positionals, POSITIONAL_KEYS, 'positionals');
  for (const [cmd, c] of Object.entries(spec.commands || {})) {
    unknown(c, COMMAND_KEYS, `команда ${cmd}`);
    unknown(c && c.positionals, POSITIONAL_KEYS, `команда ${cmd}, positionals`);
  }
  if (spec.badCallExit !== undefined && spec.badCallExit !== EXIT_USAGE && spec.badCallExit !== HOOK_BAD_CALL_EXIT) {
    throw new TypeError(`cli: badCallExit бывает только ${EXIT_USAGE} или ${HOOK_BAD_CALL_EXIT}, дано ${spec.badCallExit}`);
  }
}

function nodeOptions(options, where) {
  const out = {};
  for (const [name, o] of Object.entries(options)) {
    if (!o || !['boolean', 'string', 'number'].includes(o.type)) throw new TypeError(`cli: у флага --${name} (${where}) тип должен быть boolean, string или number`);
    for (const k of Object.keys(o)) if (!HELPER_KEYS.has(k)) throw new TypeError(`cli: у флага --${name} незнакомое поле «${k}»`);
    const n = { type: o.type === 'number' ? 'string' : o.type };
    if (o.short) n.short = o.short;
    if (o.multiple) n.multiple = true;
    out[name] = n;
  }
  return out;
}

/**
 * Чистая: слово, которое пытается быть флагом, но флагом быть не может: `--fiх` с кириллицей,
 * `—fix` после автозамены, `--fix ` с хвостовым пробелом, `--foo.bar`, `-х`. Такое слово не
 * становится молча позиционным. Текст с пробелом внутри («- пункт», «-fix: опечатка») — это текст.
 */
export function lookalikeFlag(a) {
  const t = a.trim();
  if (!t || /\s/.test(t)) return false;
  if (a !== t && /^[-—–]/.test(t)) return true;
  if (FLAG_SHAPED.test(a)) return false;
  return /^--\S/.test(t) || /^[—–]\S/.test(t) || /^-[^\d.\-]/.test(t);
}

/** Текст с дефисом впереди прячется от util.parseArgs и возвращается после разбора. */
function fold(argv) {
  const texts = [];
  let literal = false;
  let bad = null;
  const args = argv.map((raw) => {
    const a = String(raw);
    if (literal) return a;
    if (a === '--') { literal = true; return a; }
    if (!bad && lookalikeFlag(a)) bad = a;
    if (a.length > 1 && a.startsWith('-') && !FLAG_SHAPED.test(a)) {
      texts.push(a);
      return `\u0000${texts.length - 1}`;
    }
    return a;
  });
  const restore = (v) => (typeof v === 'string' && /^\u0000\d+$/.test(v) ? texts[Number(v.slice(1))] : v);
  return { args, restore, bad };
}

function flagIn(message) {
  const quoted = (String(message).match(/'([^']+)'/) || [])[1] || '';
  return (quoted.match(/--[\w-]+/) || quoted.match(/-[\w]/) || [quoted])[0];
}

/** Чистая: причина отказа по-русски, имя флага сохраняется как есть. */
export function explain(e) {
  const m = String(e && e.message ? e.message : e);
  switch (e && e.code) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return `незнакомый флаг ${flagIn(m)}`;
    case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL':
      return `лишнее слово «${(m.match(/'([^']*)'/) || [])[1] ?? ''}»`;
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE': {
      const f = flagIn(m);
      if (/does not take an argument/.test(m)) return `флаг ${f} не принимает значения`;
      if (/argument missing/.test(m)) return `флагу ${f} нужно значение`;
      if (/ambiguous/.test(m)) return `значение флага ${f} похоже на флаг; если это текст, пишите ${f}=<текст>`;
      return m;
    }
    default:
      return m;
  }
}

function checkCount(pos, spec, skipMin) {
  const p = { min: 0, max: 0, ...(spec || {}) };
  if (p.choices) {
    const odd = pos.find((x) => !p.choices.includes(x));
    if (odd !== undefined) return `«${odd}» не из списка${p.name ? ` (${p.name})` : ''}: ${p.choices.join(' | ')}`;
  }
  if (pos.length > p.max) {
    const extra = pos[p.max];
    return p.max === 0 ? `лишнее слово «${extra}»` : `лишнее слово «${extra}»: принимается не больше ${p.max}`;
  }
  if (!skipMin && pos.length < p.min) {
    return `не хватает аргументов${p.name ? ` (${p.name})` : ''}: нужно ${p.min}, дано ${pos.length}`;
  }
  return null;
}

function convert(values, all, restore) {
  for (const [name, o] of Object.entries(all)) {
    if (values[name] === undefined) {
      if (o.default !== undefined) values[name] = o.default;   // умолчание уже нужного типа
      continue;
    }
    const one = (v) => {
      const raw = restore(v);
      if (o.type !== 'number') return raw;
      if (!DECIMAL.test(raw)) throw new Error(`флагу --${name} нужно число, дано «${raw}»`);
      return Number(raw);
    };
    values[name] = Array.isArray(values[name]) ? values[name].map(one) : one(values[name]);
    if (o.choices) {
      for (const v of [].concat(values[name])) {
        if (!o.choices.includes(v)) throw new Error(`флаг --${name} принимает ${o.choices.join(' | ')}, дано «${v}»`);
      }
    }
  }
}

/**
 * Чистая: разобрать argv по спецификации.
 * @returns {{error:string}|{help:boolean,selfTest:boolean,values:object,positionals:string[],command:string|null}}
 */
export function parseCli(argv, spec = {}) {
  validateSpec(spec);
  const commands = spec.commands || null;
  // диспетчер: всё после имени команды уходит целевому скрипту, и разбирает его уже он
  if (commands && typeof argv[0] === 'string' && Object.hasOwn(commands, argv[0]) && commands[argv[0]] && commands[argv[0]].passthrough) {
    const c = commands[argv[0]];
    return { help: false, selfTest: false, values: {}, positionals: [], command: argv[0], rest: argv.slice(1).map(String), forward: c.passthrough, prepend: c.prepend || [] };
  }
  const global = { ...builtin(spec), ...(spec.options || {}) };
  const all = { ...global };
  if (commands) {
    for (const [cmd, c] of Object.entries(commands)) {
      for (const [name, o] of Object.entries((c && c.options) || {})) {
        if (all[name] && all[name].type !== o.type) throw new TypeError(`cli: флаг --${name} объявлен с разными типами (команда ${cmd})`);
        all[name] = o;
      }
    }
  }
  const { args, restore, bad } = fold(argv);
  // ошибка в самой спецификации — дефект скрипта, а не неверный вызов: пусть падает громко
  const options = nodeOptions(all, spec.name || 'cli');
  if (bad !== null) return { error: `«${bad}» похоже на флаг, но таким флагом быть не может; если это текст — после -- или через =` };
  let parsed;
  try {
    parsed = parseArgs({ args, options, strict: true, allowPositionals: true, tokens: true });
  } catch (e) {
    return { error: explain(e) };
  }
  const values = { ...parsed.values };
  let positionals = parsed.positionals.map(restore);
  const help = values.help === true;
  const selfTest = values['self-test'] === true;
  const service = help || selfTest;
  const used = parsed.tokens.filter((t) => t.kind === 'option').map((t) => t.name);

  let command = null;
  if (commands) {
    if (positionals.length) {
      command = positionals[0];
      if (!Object.hasOwn(commands, command)) return { error: `незнакомая команда «${command}»; есть: ${Object.keys(commands).join(', ')}` };
      positionals = positionals.slice(1);
    } else if (spec.defaultCommand) {
      command = spec.defaultCommand;
    } else if (!service) {
      return { error: `нужна команда: ${Object.keys(commands).join(', ')}` };
    }
    const allowed = new Set(Object.keys(global));
    if (command) for (const k of Object.keys((commands[command] && commands[command].options) || {})) allowed.add(k);
    const stray = used.find((n) => !allowed.has(n));
    if (stray) return { error: command ? `флаг --${stray} не относится к команде «${command}»` : `флаг --${stray} работает только с командой` };
  }
  // числа, списки значений и умолчания — по флагам той команды, которая выбрана
  const effective = { ...global, ...((command && commands[command] && commands[command].options) || {}) };
  try { convert(values, effective, restore); } catch (e) { return { error: e.message }; }
  const pspec = commands ? (command && commands[command] && commands[command].positionals) : spec.positionals;
  if (!commands || command) {
    const err = checkCount(positionals, pspec, service);
    if (err) return { error: err };
  }
  return { help, selfTest, values, positionals, command };
}

function optionLine(name, o) {
  const value = o.type === 'boolean' ? '' : ` <${o.value || (o.type === 'number' ? 'число' : o.choices ? o.choices.join('|') : 'значение')}>`;
  const flag = `${o.short ? `-${o.short}, ` : '    '}--${name}${value}${o.multiple ? ' …' : ''}`;
  const def = o.default !== undefined && o.type !== 'boolean' ? ` (по умолчанию ${o.default})` : '';
  return `  ${flag.padEnd(30)} ${o.desc || ''}${def}`.trimEnd();
}

function positionalLabel(p) {
  if (!p.max) return '';
  if (p.label) return ` ${p.label}`;
  const name = p.name || 'аргумент';
  return ` ${p.min ? `<${name}>` : `[${name}]`}${p.max === Infinity ? ' …' : ''}`;
}

/** Чистая: справка — готовый текст или собранная из спецификации, всегда с кодами выхода. */
export function formatUsage(spec = {}, scriptName = spec.name || 'script') {
  let text = spec.usage;
  if (!text) {
    const file = `node ${spec.path || `scripts/${scriptName}.mjs`}`;
    const lines = [];
    if (spec.summary) lines.push(spec.summary, '');
    lines.push('Использование:');
    if (spec.commands) {
      for (const [cmd, c] of Object.entries(spec.commands)) {
        const arg = positionalLabel((c && c.positionals) || {});
        lines.push(`  ${file} ${cmd}${arg} [флаги]${c && c.desc ? `   ${c.desc}` : ''}`);
      }
    } else {
      const arg = positionalLabel(spec.positionals || {});
      lines.push(`  ${file}${arg} [флаги]`);
    }
    lines.push('', 'Флаги:');
    for (const [name, o] of Object.entries(spec.options || {})) lines.push(optionLine(name, o));
    if (spec.commands) {
      // флаг нескольких команд называется один раз: «(только plan, dispatch)»
      const shared = new Map();
      for (const [cmd, c] of Object.entries(spec.commands)) {
        for (const [name, o] of Object.entries((c && c.options) || {})) {
          if (!shared.has(name)) shared.set(name, { o, cmds: [] });
          shared.get(name).cmds.push(cmd);
        }
      }
      for (const [name, { o, cmds }] of shared) lines.push(optionLine(name, { ...o, desc: `${o.desc || ''} (только ${cmds.join(', ')})`.trim() }));
    }
    for (const [name, o] of Object.entries(builtin(spec))) lines.push(optionLine(name, o));
    text = lines.join('\n');
  }
  const exitLine = spec.badCallExit === HOOK_BAD_CALL_EXIT ? HOOK_EXIT_LINE : EXIT_LINE;
  return /Коды выхода|Exit codes/.test(text) ? text : `${text}\n\n${exitLine}`;
}

function say(fd, text) {
  try { writeSync(fd, text); } catch { (fd === 1 ? process.stdout : process.stderr).write(text); }
}

/**
 * Разобрать process.argv; при ошибке — код 2, при --help — справка и код 0.
 * Возвращает то же, что parseCli, только без поля error.
 */
export function runCli(spec = {}, argv = process.argv.slice(2)) {
  const name = spec.name || basename(process.argv[1] || 'script', '.mjs');
  const r = parseCli(argv, spec);
  const usage = () => formatUsage(spec, name);
  if (r.error) {
    say(2, `${name}: неверный вызов — ${r.error}\nНичего не выполнено.\n\n${usage()}\n`);
    process.exit(spec.badCallExit === HOOK_BAD_CALL_EXIT ? HOOK_BAD_CALL_EXIT : EXIT_USAGE);
  }
  if (r.help) {
    say(1, `${usage()}\n`);
    process.exit(0);
  }
  return r;
}
