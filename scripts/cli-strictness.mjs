#!/usr/bin/env node
// cli-strictness — скрипт, который читает аргументы, обязан разбирать их строго.
//
// Дефект, который закрывает этот гейт (2026-09-16): скрипт молча пропускает незнакомый
// флаг и делает свою работу. `safe-commit.mjs --help` запускал весь сценарий коммита и
// пуша в main; `research-audit.mjs --bogus --self-test` молча работал, и проверка,
// которой не было, выглядела пройденной. Замер того же дня: из 244 скриптов 232 не
// знали слова --help, 198 разбирали флаги поиском подстроки.
//
// Гейт статический и читающий: он НИКОГДА не запускает проверяемый файл. Запуск с
// незнакомым флагом — ровно то действие, чью опасность он измеряет. Живое
// доказательство (--help → 0, --bogus → 2, ни одного побочного действия) даёт
// scripts/__tests__/cli-contract.test.mjs, и только для файлов, которые этот гейт
// признал строгими, и только в песочнице scripts/lib/cli-sandbox.mjs.
//
// Правило:
//   · CLI с побочными действиями (git, запись, удаление, сеть, процессы, запуск агентов)
//     разбирает аргументы через scripts/lib/cli.mjs с export const CLI — всегда, храповика
//     для них нет. util.parseArgs в строгом режиме строг, но спецификации у него нет, и места
//     вызова такого скрипта сверить не с чем, поэтому он тоже нарушение;
//   · CLI без побочных действий может жить в храповике
//     docs/metrics/cli-strictness-baseline.json, пока его не тронули; храповик только
//     сжимается: починенный или удалённый файл обязан уйти из списка.
//
// Использование — справка: node scripts/cli-strictness.mjs --help
//
// @closes-class: extra-argument-silently-swallowed
// @scope: staged
//   (вся область, 0,75 с, — только когда в правке сам сторож, scripts/lib/cli.mjs,
//   hooks/lib/load-cli.mjs или храповик: иначе устаревшую запись храповика не увидеть)
// @divergence: "parseArgs в комментарии и строке не делает разбор строгим" — прибор, который ищет слово parseArgs по тексту файла, засчитал бы строгость скрипту, где parseArgs упомянут в комментарии, а флаги по-прежнему ищутся подстрокой

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/cli.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const BASELINE = 'docs/metrics/cli-strictness-baseline.json';

// ─────────────────────────────────────────────────────────────────────────────
// Лексер: два вида одного исходника одинаковой длины (переводы строк на местах).
//   code — строки и комментарии забиты пробелами: здесь ищутся конструкции языка;
//   text — забиты только комментарии: здесь ищутся команды внутри строк (git push…).
// ─────────────────────────────────────────────────────────────────────────────

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'yield', 'await', 'void', 'delete', 'throw', 'new', 'instanceof']);

export function lex(src = '') {
  const code = src.split('');
  const text = src.split('');
  const blank = (i, both) => { if (code[i] !== '\n') code[i] = ' '; if (both && text[i] !== '\n') text[i] = ' '; };
  let state = 'code';
  let depth = 0;
  const tpl = [];
  let prevSig = '';
  let word = '';
  let prevWord = '';
  let i = 0;
  if (src.startsWith('#!')) { while (i < src.length && src[i] !== '\n') blank(i++, true); }
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'line') { if (c === '\n') state = 'code'; else blank(i, true); continue; }
    if (state === 'block') { blank(i, true); if (c === '*' && n === '/') { blank(i + 1, true); i++; state = 'code'; } continue; }
    if (state === 'sq' || state === 'dq') {
      blank(i, false);
      if (c === '\\') { blank(i + 1, false); i++; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || c === '\n') state = 'code';
      continue;
    }
    if (state === 're' || state === 'reclass') {
      blank(i, true);
      if (c === '\\') { blank(i + 1, true); i++; continue; }
      if (c === '\n') { state = 'code'; continue; }
      if (state === 're' && c === '[') state = 'reclass';
      else if (state === 'reclass' && c === ']') state = 're';
      else if (state === 're' && c === '/') state = 'code';
      continue;
    }
    if (state === 'tpl') {
      if (c === '\\') { blank(i, false); blank(i + 1, false); i++; continue; }
      if (c === '`') { state = 'code'; prevSig = '`'; continue; }
      if (c === '$' && n === '{') { tpl.push(depth); depth++; i++; state = 'code'; prevSig = '{'; continue; }
      blank(i, false);
      continue;
    }
    // state === 'code'
    if (/[\w$]/.test(c)) { word += c; prevSig = c; continue; }
    if (word) { prevWord = word; word = ''; }
    if (c === '/' && n === '/') { blank(i, true); state = 'line'; continue; }
    if (c === '/' && n === '*') { blank(i, true); blank(i + 1, true); i++; state = 'block'; continue; }
    if (c === "'") { state = 'sq'; continue; }
    if (c === '"') { state = 'dq'; continue; }
    if (c === '`') { state = 'tpl'; continue; }
    if (c === '/') {
      const afterWord = /[\w$]/.test(prevSig);
      if (prevSig === '' || REGEX_PRECEDERS.has(prevSig) || (afterWord && REGEX_KEYWORDS.has(prevWord))) { state = 're'; continue; }
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth = Math.max(0, depth - 1);
      if (c === '}' && tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); state = 'tpl'; continue; }
    }
    if (!/\s/.test(c)) { prevSig = c; prevWord = ''; }
  }
  return { code: code.join(''), text: text.join('') };
}

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}
function lineAt(starts, idx) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Способ разбора аргументов
// ─────────────────────────────────────────────────────────────────────────────

const UTIL_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?util['"]/;
const UNKNOWN_CHECK = /(unknown|незнаком|неизвест)\w*\s+(flag|option|arg|argument|флаг|ключ|аргумент|параметр)/i;

/**
 * Чистая: как файл разбирает аргументы.
 * style: helper | util-strict | util-loose | loop | search | none | library
 */
export function parsing(src = '') {
  const { code, text } = lex(src);
  const starts = lineStarts(src);
  const firstAt = (re, where) => { const m = re.exec(where); return m ? lineAt(starts, m.index) : null; };

  // обращения к argv, кроме сторожа импорта (process.argv[1]) и имени интерпретатора ([0])
  const argvRefs = [...code.matchAll(/process\s*\.\s*argv\b(?!\s*\[\s*[01]\s*\])/g)];
  const readsArgs = argvRefs.length > 0;
  const argvLine = readsArgs ? lineAt(starts, argvRefs[0].index) : null;
  // Точка входа CLI — сторож импорта (import-safety требует его от любого исполняемого модуля).
  // Одно чтение argv признаком не служит: помощник scripts/lib/cli.mjs читает argv за вызывающего.
  // Форма записи сторожа бывает разной (argv[1], деструктуризация `const [, script] = process.argv`),
  // поэтому признак — оба участника сравнения в файле, а не одно написание.
  const guard = (/import\s*\.\s*meta\s*\.\s*url/.test(code) && /process\s*\.\s*argv\b/.test(code))
    || /process\s*\.\s*argv\s*\[\s*1\s*\][^\n]{0,40}\.\s*endsWith\s*\(/.test(code);

  let style;
  let line = argvLine;
  let rejects;
  // помощник: статический импорт ./lib/cli.mjs или динамическая загрузка (хуки: две раскладки)
  // Помощник — это настоящая привязка, а не слово: статический импорт runCli из …/cli.mjs,
  // динамический import(…/cli.mjs) или загрузчик хуков load-cli.mjs. Своя функция runCli не в счёт.
  const ownRunCli = /\bfunction\s+runCli\b|\b(?:const|let|var)\s+runCli\s*=/.test(code);
  const staticHelper = /import\s*\{[^}]*\brunCli\b[^}]*\}\s*from\s*['"][^'"]*(?:^|\/)cli\.mjs['"]/.test(text);
  const dynamicHelper = /import\s*\(\s*['"][^'"]*(?:^|\/)cli\.mjs['"]\s*\)/.test(text) && /\.\s*runCli\s*\(/.test(code);
  const loaderHelper = /load-cli\.mjs/.test(text) && /\bloadCli\s*\(/.test(code) && /\.\s*runCli\s*\(/.test(code);
  const helperCall = !ownRunCli && (staticHelper || dynamicHelper || loaderHelper) && /\brunCli\s*\(/.test(code);
  const exportsSpec = /\bexport\s+const\s+CLI\s*=/.test(code);
  const badCallExit = /\bbadCallExit\s*:\s*(?:HOOK_BAD_CALL_EXIT|1)\b/.test(code) ? 1 : 2;
  const utilMatch = UTIL_IMPORT.exec(text);
  let utilName = null;
  if (utilMatch) {
    const spec = utilMatch[1].split(',').map((s) => s.trim()).find((s) => /^parseArgs\b/.test(s));
    if (spec) utilName = (spec.match(/^parseArgs\s+as\s+([\w$]+)$/) || [null, 'parseArgs'])[1];
  }
  const utilCallRe = utilName ? new RegExp(`\\b${utilName.replace(/\$/g, '\\$')}\\s*\\(\\s*\\{`) : null;
  const utilCall = utilCallRe ? utilCallRe.exec(code) : null;

  if (!guard) {
    // без сторожа модуль ничего не запускает сам (import-safety следит, чтобы так и было)
    style = 'library';
    line = null;
    rejects = '—';
  } else if (helperCall && exportsSpec) {
    style = 'helper';
    line = firstAt(/\brunCli\s*\(/g, code) ?? line;
    rejects = badCallExit === 1 ? 'да (код 1: хук)' : 'да';
  } else if (helperCall) {
    // разбор строгий, но спецификация не экспортирована: места вызова нечем сверить
    style = 'helper-hidden';
    line = firstAt(/\brunCli\s*\(/g, code) ?? line;
    rejects = 'да, но спецификация не экспортирована';
  } else if (utilCall) {
    // объект настроек ищется по коду до парной скобки
    let d = 0, end = utilCall.index;
    for (let k = code.indexOf('(', utilCall.index); k < code.length; k++) {
      if (code[k] === '(' || code[k] === '{' || code[k] === '[') d++;
      else if (code[k] === ')' || code[k] === '}' || code[k] === ']') { d--; if (d === 0) { end = k; break; } }
    }
    const body = code.slice(utilCall.index, end);
    const loose = /\bstrict\s*:\s*false\b/.test(body);
    style = loose ? 'util-loose' : 'util-strict';
    line = lineAt(starts, utilCall.index);
    rejects = loose ? 'нет' : 'да';
  } else if (readsArgs) {
    const loop = /for\s*\(\s*(?:const|let|var)\s+[\w$]+\s+of\s+(?:[\w$]*args?|argv|rest|process\s*\.\s*argv)\b|for\s*\(\s*let\s+[\w$]+\s*=\s*\d+\s*;\s*[\w$]+\s*<\s*(?:[\w$]*args?|argv|process\s*\.\s*argv)[\w$.]*\s*\.\s*length|while\s*\(\s*(?:[\w$]*args?|argv)\s*\.\s*length|\b(?:args?|argv)\s*\.\s*shift\s*\(/;
    style = loop.test(code) ? 'loop' : 'search';
    rejects = UNKNOWN_CHECK.test(text) ? 'своя проверка (не доказана)' : 'нет';
  } else {
    style = 'none';
    line = firstAt(/process\s*\.\s*argv\s*\[\s*1\s*\]/g, code) ?? firstAt(/\bprocess\s*\.\s*exit\s*\(/g, code);
    rejects = 'нет (аргументы не читаются)';
  }
  const positionals = readsArgs && /argv\s*\[\s*(?:0|[2-9])\s*\]|args?\s*\[\s*\d\s*\]|filter\s*\(\s*\(?\s*[\w$]+\s*\)?\s*=>\s*!\s*[\w$]+\s*\.\s*startsWith\s*\(|\.\s*_\b|positional/.test(code + text);
  // Строгим считается только разбор через помощник: у util.parseArgs нет экспортированной
  // спецификации, и места вызова такого скрипта сверить не с чем.
  return { style, line, rejects, cli: style !== 'library', positionals, badCallExit, exportsSpec, strict: style === 'helper' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Побочные действия: признак ищется построчно в тексте без комментариев.
// Вес — насколько плохо, если действие случится от опечатки во флаге.
// ─────────────────────────────────────────────────────────────────────────────

const GIT_WRITE = /\bgit\b[^\n]{0,60}?(?:['"`\s,(]|^)(commit|push|add|reset|checkout|switch|rebase|merge|stash|tag|clean|update-ref|restore|rm|mv|pull|cherry-pick|revert|am|apply|notes|commit-tree|update-index|read-tree|worktree\s+(?:add|remove|prune))\b/;
export const EFFECTS = [
  { kind: 'git', weight: 5, where: 'text', re: GIT_WRITE, label: 'пишет в git' },
  { kind: 'agent', weight: 5, where: 'text', re: /\b(?:claude\s+(?:-p|--print)|codex\s+exec)\b|['"`]claude['"`]\s*,\s*\[\s*['"`]-p|['"`]codex['"`]\s*,\s*\[\s*['"`]exec/, label: 'запускает агента' },
  { kind: 'delete', weight: 4, where: 'code', re: /\b(?:unlinkSync|rmSync|rmdirSync)\s*\(|\.\s*(?:unlink|rm|rmdir)\s*\(/, label: 'удаляет файлы' },
  { kind: 'delete', weight: 4, where: 'text', re: /\brm\s+-[a-zA-Z]*[rf]/, label: 'удаляет файлы' },
  { kind: 'network', weight: 4, where: 'code', re: /(?<![\w$.])fetch\s*\(|\b(?:https?|net|tls|dgram)\s*\.\s*(?:request|get|connect|createConnection|createServer|createSocket)\s*\(|new\s+WebSocket\s*\(|\.\s*listen\s*\(\s*[\w$]/, label: 'ходит в сеть' },
  { kind: 'network', weight: 4, where: 'text', re: /\b(?:curl|wget|ssh|scp)\s+-?|\bgh\s+(?:api|pr|issue|release|repo|workflow|run|search|auth)\b|['"`]gh['"`]\s*,\s*\[|api\.telegram\.org|hooks\.slack\.com/, label: 'ходит в сеть' },
  // process.kill(pid, 0) только спрашивает, жив ли процесс, — это чтение, не сигнал
  { kind: 'process', weight: 4, where: 'code', re: /\bprocess\s*\.\s*kill\s*\((?![^()]*,\s*0\s*\))/, label: 'посылает сигналы процессам' },
  { kind: 'process', weight: 4, where: 'text', re: /\b(?:pkill|killall|launchctl)\b|\bkill\s+-/, label: 'посылает сигналы процессам' },
  // writeSync(1|2, …) — вывод в stdout/stderr, а не запись файла
  { kind: 'write', weight: 3, where: 'code', re: /\b(?:writeFileSync|appendFileSync|mkdirSync|renameSync|copyFileSync|cpSync|createWriteStream|symlinkSync|linkSync|chmodSync|truncateSync|utimesSync|mkdtempSync)\s*\(|\bwriteSync\s*\((?!\s*(?:1|2|process\s*\.\s*std(?:out|err)\s*\.\s*fd)\s*,)|\.\s*(?:writeFile|appendFile|mkdir|rename|copyFile|cp|symlink|chmod|truncate)\s*\(/, label: 'пишет файлы' },
  { kind: 'notify', weight: 1, where: 'text', re: /\b(?:osascript|terminal-notifier|afplay|say\s+-)\b/, label: 'уведомляет' },
  // «.exec(» у регулярного выражения — не запуск команды
  { kind: 'spawn', weight: 2, where: 'code', re: /\b(?:execSync|execFileSync|spawnSync|execFile|spawn|fork)\s*\(|(?<![.\w$])exec\s*\(/, label: 'запускает команды' },
];

// Строка-сообщение: команда внутри неё — текст для человека или кейс проверки, а не действие.
const MESSAGE_CALL = /\b(?:console\s*\.\s*\w+|log|say|warn|info|print|ok|check|assert\w*|fires|expect|note|hint|fail|bad|good|out\s*\.\s*push|lines\s*\.\s*push|report\s*\.\s*push)\s*\(|\bthrow\s+new\b/;
// Только функции, которые И ЕСТЬ самопроверка; «pushAfterSelfTest» — рабочий путь.
const SELF_TEST_NAME = '(?:selfTest|selfTestTail|runSelfTests?|selftest|self_test)';
const SELF_TEST_HEAD = new RegExp(`\\b(?:async\\s+)?function\\s*\\*?\\s*${SELF_TEST_NAME}\\s*\\(|\\b(?:const|let)\\s+${SELF_TEST_NAME}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\()`, 'g');
// сообщение человеку, но не строка, где рядом запускается команда
const RUNS_COMMAND = /\b(?:exec\w*|spawn\w*|run\w*|sh\w*|git\w*|cmd)\s*\(/;
const FSP_WRITERS = new Set(['writeFile', 'appendFile', 'mkdir', 'rename', 'rm', 'rmdir', 'unlink', 'copyFile', 'cp', 'symlink', 'chmod', 'truncate', 'mkdtemp']);

/** Чистая: диапазоны строк [от, до] внутри функций самопроверки (по виду code). */
export function selfTestRanges(code) {
  const starts = lineStarts(code);
  const ranges = [];
  for (const m of code.matchAll(SELF_TEST_HEAD)) {
    // тело — первая «{» после закрытия списка параметров
    let k = code.indexOf('(', m.index + m[0].length - 1);
    let d = 0;
    for (; k < code.length; k++) {
      if (code[k] === '(') d++;
      else if (code[k] === ')') { d--; if (d === 0) break; }
    }
    // стрелка без фигурных скобок (`() => check()`) — тело одно выражение, диапазона нет
    const after = code.slice(k + 1).match(/^\s*(?:=>\s*)?(\{)?/);
    if (!after || !after[1]) continue;
    const open = k + 1 + after[0].length - 1;
    d = 0;
    let end = open;
    for (let j = open; j < code.length; j++) {
      if (code[j] === '{') d++;
      else if (code[j] === '}') { d--; if (d === 0) { end = j; break; } }
    }
    ranges.push([lineAt(starts, m.index), lineAt(starts, end)]);
  }
  return ranges;
}

/** Чистая: список побочных действий файла {kind, weight, line, label, test}. */
export function effects(src = '') {
  const { code, text } = lex(src);
  const codeLines = code.split('\n');
  const textLines = text.split('\n');
  const tests = selfTestRanges(code);
  const inTest = (ln) => tests.some(([a, b]) => ln >= a && ln <= b);
  // функции записи, импортированные из fs/promises без префикса: `await writeFile(p, x)`
  const fsp = new Set();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?fs\/promises['"]/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (FSP_WRITERS.has(orig)) fsp.add(alias || orig);
    }
  }
  const fspRe = fsp.size ? new RegExp(`(?<![.\\w$])(?:${[...fsp].join('|')})\\s*\\(`) : null;
  const out = [];
  for (let i = 0; i < codeLines.length; i++) {
    const message = MESSAGE_CALL.test(codeLines[i]) && !RUNS_COMMAND.test(codeLines[i]);
    for (const e of EFFECTS) {
      const hay = e.where === 'code' ? codeLines[i] : textLines[i];
      if (e.where === 'text' && message) continue;
      if (e.re.test(hay)) out.push({ kind: e.kind, weight: e.weight, line: i + 1, label: e.label, test: inTest(i + 1) });
    }
    if (fspRe && fspRe.test(codeLines[i])) out.push({ kind: 'write', weight: 3, line: i + 1, label: 'пишет файлы', test: inTest(i + 1) });
  }
  return out;
}

/**
 * Чистая: сводка по видам — первая строка каждого вида и максимальный вес.
 * Действия внутри самопроверки учитываются отдельно: они работают во временных папках
 * и запускаются только флагом --self-test, поэтому опасность рабочего пути не повышают.
 */
export function effectSummary(list) {
  const pick = (items) => {
    const byKind = new Map();
    for (const e of items) if (!byKind.has(e.kind)) byKind.set(e.kind, e);
    return [...byKind.values()].sort((a, b) => b.weight - a.weight);
  };
  const kinds = pick(list.filter((e) => !e.test));
  const testKinds = pick(list.filter((e) => e.test)).filter((e) => !kinds.some((k) => k.kind === e.kind));
  // «запускает команды» без опознанной команды — слабый признак (git status тоже команда),
  // поэтому вес 2: сам по себе он побочным действием не считается.
  const max = kinds.reduce((m, e) => Math.max(m, e.weight), 0);
  return { kinds, testKinds, max, sideEffects: max >= 3 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Область и сборка отчёта
// ─────────────────────────────────────────────────────────────────────────────

export const STRICTNESS_DIRS = ['scripts', 'hooks', 'lib', 'global-setup'];
const SKIP_DIR = /(?:^|\/)(?:__tests__|node_modules|\.git|fixtures|chaos-fixtures|\.worktrees)(?:\/|$)/;

export function allFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      const rel = relative(root, full);
      if (SKIP_DIR.test(rel)) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (e.endsWith('.mjs')) out.push(rel);
    }
  };
  for (const d of STRICTNESS_DIRS) if (existsSync(join(root, d))) walk(join(root, d));
  return out.sort();
}

export function inStrictnessScope(rel) {
  return rel.endsWith('.mjs') && STRICTNESS_DIRS.some((d) => rel.startsWith(`${d}/`)) && !SKIP_DIR.test(rel);
}

export function analyzeFile(rel, root = ROOT) {
  const src = readFileSync(join(root, rel), 'utf8');
  const p = parsing(src);
  const fx = effectSummary(effects(src));
  return { file: rel, ...p, effects: fx.kinds, testEffects: fx.testKinds, maxWeight: fx.max, sideEffects: fx.sideEffects };
}

/** Опасность для сортировки: тихий разбор + побочные действия — первыми. */
export function danger(r) {
  if (!r.cli) return 0;
  const loose = r.strict ? 0 : 1;
  return loose * 100 + r.maxWeight * 10 + Math.min(r.effects.length, 9);
}

// Потолок храповика. С 2026-09-16 он пуст: все CLI строгие. Поднять потолок можно только
// правкой этого файла — это видно в диффе сторожа, а не в списке, который правится молча.
export const RATCHET_CEILING = 0;

/** Хуки Claude Code: имена скриптов из фрагмента настроек канона. */
export function hookNamesFrom(root = ROOT) {
  const names = new Set();
  try {
    const walk = (v) => {
      if (typeof v === 'string') for (const m of v.matchAll(/([\w-]+\.mjs)/g)) names.add(m[1]);
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk(JSON.parse(readFileSync(join(root, 'global-setup', 'settings-hooks-fragment.json'), 'utf8')));
  } catch { /* фрагмента нет — остаются признаки по расположению */ }
  return names;
}

/** Чистая: хук ли это (код 2 у хука значит «заблокировать»). */
export function isHookFile(file, hookNames = new Set()) {
  const name = file.split('/').pop();
  return /^hooks\/[^/]+\.mjs$/.test(file) || /^global-setup\/hooks\//.test(file)
    || /^statusline-[\w-]+\.mjs$/.test(name) || hookNames.has(name);
}

export function loadBaseline(root = ROOT) {
  const p = join(root, BASELINE);
  if (!existsSync(p)) return new Map();
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return new Map(Object.entries(j.files || {}));
}

/**
 * Чистая: вердикт сторожа по разобранным файлам и храповику.
 * violations — CLI без строгого разбора вне храповика или с побочными действиями;
 * stale — записи храповика, которым там больше не место.
 */
export function strictnessVerdict(rows, baseline, { checkedFiles = null, ceiling = RATCHET_CEILING, hookNames = new Set() } = {}) {
  const violations = [];
  const stale = [];
  const byFile = new Map(rows.map((r) => [r.file, r]));
  if (baseline.size > ceiling) {
    stale.push({ file: BASELINE, why: `храповик больше потолка ${ceiling} (записей ${baseline.size}): он только сжимается, потолок поднимается правкой сторожа` });
  }
  for (const r of rows) {
    if (r.cli && r.strict && isHookFile(r.file, hookNames) && r.badCallExit !== 1) {
      violations.push({ ...r, why: 'хук обязан отвечать на неверный вызов кодом 1 (badCallExit): код 2 у хука Claude Code значит «заблокировать»' });
      continue;
    }
    if (!r.cli || r.strict) continue;
    if (r.style === 'util-strict' || r.style === 'helper-hidden') {
      violations.push({ ...r, why: 'разбор строгий, но без export const CLI: места вызова нечем сверить' });
      continue;
    }
    if (r.sideEffects) { violations.push({ ...r, why: 'побочные действия при нестрогом разборе' }); continue; }
    if (!baseline.has(r.file)) violations.push({ ...r, why: 'новый CLI без строгого разбора' });
  }
  for (const f of baseline.keys()) {
    if (checkedFiles && !checkedFiles.includes(f)) continue;
    const r = byFile.get(f);
    if (!r) stale.push({ file: f, why: 'файла нет или он вне области — убрать из храповика' });
    else if (!r.cli || r.strict) stale.push({ file: f, why: 'уже строгий — убрать из храповика' });
    else if (r.sideEffects) stale.push({ file: f, why: 'с побочными действиями храповик не держит' });
  }
  return { violations, stale, ok: violations.length === 0 && stale.length === 0 };
}

const STYLE_LABEL = {
  helper: 'scripts/lib/cli.mjs',
  'helper-hidden': 'scripts/lib/cli.mjs без export const CLI',
  'util-strict': 'util.parseArgs strict',
  'util-loose': 'util.parseArgs strict:false',
  loop: 'свой цикл',
  search: 'поиск подстроки (includes/indexOf)',
  none: 'не читает аргументы',
  library: 'библиотека, не CLI',
};

export function markdownTable(rows) {
  const sorted = rows.filter((r) => r.cli).sort((a, b) => danger(b) - danger(a) || a.file.localeCompare(b.file));
  const lines = ['| № | Файл | Разбор | Отказ на незнакомом флаге | Побочные действия | Опасность |', '|---|---|---|---|---|---|'];
  sorted.forEach((r, i) => {
    const addr = r.line ? `${r.file}:${r.line}` : r.file;
    const main = r.effects.map((e) => `${e.label} (\`:${e.line}\`)`);
    const test = (r.testEffects || []).map((e) => `в самопроверке: ${e.label} (\`:${e.line}\`)`);
    const fx = [...main, ...test].join('; ') || 'не найдено';
    const level = r.strict ? 'закрыто' : r.sideEffects ? (r.maxWeight >= 4 ? 'высокая' : 'средняя') : 'низкая';
    lines.push(`| ${i + 1} | \`${addr}\` | ${STYLE_LABEL[r.style]} | ${r.rejects} | ${fx} | ${level} |`);
  });
  return lines.join('\n');
}

export function counts(rows) {
  const cli = rows.filter((r) => r.cli);
  const by = (k) => cli.filter((r) => r.style === k).length;
  return {
    files: rows.length,
    cli: cli.length,
    library: rows.length - cli.length,
    strict: cli.filter((r) => r.strict).length,
    loose: cli.filter((r) => !r.strict).length,
    looseWithEffects: cli.filter((r) => !r.strict && r.sideEffects).length,
    looseHigh: cli.filter((r) => !r.strict && r.maxWeight >= 4).length,
    styles: { helper: by('helper'), 'helper-hidden': by('helper-hidden'), 'util-strict': by('util-strict'), 'util-loose': by('util-loose'), loop: by('loop'), search: by('search'), none: by('none') },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Самопроверка: только чистые функции, ни один файл не запускается
// ─────────────────────────────────────────────────────────────────────────────

const GUARD_SRC = "const isMain = process.argv[1] === fileURLToPath(import.meta.url);\n";

export function selfTest() {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond) => { if (cond) pass++; else fail++; console.log(`  ${cond ? '✓' : '✗'} ${name}`); };
  const style = (src) => parsing(src).style;

  // кейс расхождения: слово parseArgs есть, строгого разбора нет
  ok('parseArgs в комментарии и строке не делает разбор строгим',
    style(`${GUARD_SRC}// TODO: перейти на parseArgs({ strict: true })\nconst hint = "parseArgs({ options })";\nif (isMain && process.argv.includes('--json')) run();\n`) === 'search');
  ok('поиск подстроки опознан', style(`${GUARD_SRC}const a = process.argv.slice(2);\nif (isMain) { if (a.includes('--fix')) fix(); }\n`) === 'search');
  ok('свой цикл опознан', style(`${GUARD_SRC}const args = process.argv.slice(2);\nfor (const x of args) { if (x === '--fix') f = 1; }\n`) === 'loop');
  ok('util.parseArgs со strict по умолчанию опознан, но строгим не засчитан (нет спецификации для сверки вызовов)',
    style(`import { parseArgs } from 'node:util';\n${GUARD_SRC}if (isMain) { parseArgs({ options: {} }); }\n`) === 'util-strict'
    && !parsing(`import { parseArgs } from 'node:util';\n${GUARD_SRC}if (isMain) { parseArgs({ options: {} }); }\n`).strict);
  ok('util.parseArgs со strict:false — не строгий',
    style(`import { parseArgs } from 'node:util';\n${GUARD_SRC}if (isMain) { parseArgs({ strict: false, options: {} }); }\n`) === 'util-loose');
  ok('util.parseArgs под другим именем опознан',
    style(`import { parseArgs as p } from 'node:util';\n${GUARD_SRC}if (isMain) { p({ args: process.argv.slice(2), options: {} }); }\n`) === 'util-strict');
  ok('своя функция parseArgs без импорта из util — не строгая',
    style(`${GUARD_SRC}function parseArgs() { return process.argv.slice(2); }\nif (isMain) parseArgs();\n`) === 'search');
  ok('помощник с export const CLI — строгий',
    parsing(`import { runCli } from './lib/cli.mjs';\nexport const CLI = { options: {} };\n${GUARD_SRC}if (isMain) runCli(CLI);\n`).strict);
  ok('помощник без экспорта спецификации — не строгий (вызовы нечем сверить)',
    style(`import { runCli } from './lib/cli.mjs';\n${GUARD_SRC}if (isMain) runCli({ options: {} });\n`) === 'helper-hidden');
  ok('помощник из соседнего файла в lib (./cli.mjs, ./load-cli.mjs) опознан',
    parsing(`import { runCli } from './cli.mjs';\nexport const CLI = {};\n${GUARD_SRC}if (isMain) runCli(CLI);\n`).strict
    && parsing(`import { loadCli } from './load-cli.mjs';\nexport const CLI = {};\n${GUARD_SRC}if (isMain) (await loadCli(import.meta.url)).runCli(CLI);\n`).strict);
  ok('хук с badCallExit опознан', parsing(`import { runCli } from '../scripts/lib/cli.mjs';\nexport const CLI = { badCallExit: HOOK_BAD_CALL_EXIT };\n${GUARD_SRC}if (isMain) runCli(CLI);\n`).badCallExit === 1);
  ok('модуль без сторожа — библиотека, даже если читает argv за вызывающего',
    style('export function runCli(spec, argv = process.argv.slice(2)) { return argv; }\n') === 'library');
  ok('сторож без чтения argv — CLI, который ничего не разбирает', style(`${GUARD_SRC}if (isMain) main();\n`) === 'none');
  ok('сторож по имени файла (argv[1].endsWith) опознан',
    style("if (process.argv[1] && process.argv[1].endsWith('x.mjs')) main();\n") === 'none');

  const kinds = (src) => effects(src).filter((e) => !e.test).map((e) => e.kind);
  ok('git push в сообщении человеку — не действие', !kinds("console.log('потом сделай git push');\n").includes('git'));
  ok('git push в запуске команды — действие', kinds("sh(`git push origin ${b}`);\n").includes('git'));
  ok('git push в массиве аргументов — действие', kinds("spawnSync('git', ['push', 'origin', 'main']);\n").includes('git'));
  ok('git push внутри регулярного выражения — не действие', !kinds("const RE = /git\\s+push/;\nRE.test(x);\n").includes('git'));
  ok('git push в комментарии — не действие', !kinds('// потом git push\nconst a = 1;\n').includes('git'));
  ok('process.kill(pid, 0) — проверка живости, не сигнал', !kinds('try { process.kill(pid, 0); } catch {}\n').includes('process'));
  ok('process.kill(pid, SIGTERM) — сигнал', kinds("process.kill(pid, 'SIGTERM');\n").includes('process'));
  ok('запись файла опознана', kinds("writeFileSync(p, 'x');\n").includes('write'));
  const inTest = effects("function selfTest() {\n  writeFileSync(tmp, 'x');\n}\nconst y = 1;\n");
  ok('запись внутри самопроверки помечена отдельно', inTest.length === 1 && inTest[0].test === true);
  ok('действие в самопроверке не делает скрипт опасным', effectSummary(inTest).sideEffects === false);

  const row = (file, over) => ({ file, cli: true, strict: false, sideEffects: false, effects: [], style: 'search', ...over });
  const base = new Map([['scripts/old.mjs', 'только чтение'], ['scripts/fixed.mjs', 'x'], ['scripts/gone.mjs', 'x'], ['scripts/fx.mjs', 'x']]);
  const v = strictnessVerdict([
    row('scripts/old.mjs'),
    row('scripts/new.mjs'),
    row('scripts/fixed.mjs', { strict: true, style: 'helper' }),
    row('scripts/fx.mjs', { sideEffects: true }),
    row('scripts/ok.mjs', { strict: true, style: 'helper' }),
  ], base, { ceiling: 99 });
  ok('нестрогий CLI только для чтения в храповике — не нарушение', !v.violations.some((x) => x.file === 'scripts/old.mjs'));
  ok('новый нестрогий CLI — нарушение', v.violations.some((x) => x.file === 'scripts/new.mjs'));
  ok('побочные действия при нестрогом разборе — нарушение даже в храповике', v.violations.some((x) => x.file === 'scripts/fx.mjs'));
  ok('починенный файл обязан уйти из храповика', v.stale.some((x) => x.file === 'scripts/fixed.mjs'));
  ok('удалённый файл обязан уйти из храповика', v.stale.some((x) => x.file === 'scripts/gone.mjs'));
  ok('строгий файл вне храповика — чисто', !v.violations.some((x) => x.file === 'scripts/ok.mjs'));
  const part = strictnessVerdict([row('scripts/new.mjs')], base, { checkedFiles: ['scripts/new.mjs'], ceiling: 99 });
  ok('проверка по списку файлов не требует чистить чужие записи храповика', part.stale.length === 0 && part.violations.length === 1);
  ok('пустой список строк не даёт нарушений, но и не выдаётся за проверку', strictnessVerdict([], new Map()).ok === true);

  // храповик только сжимается: потолок записан в стороже, запись сверх него — нарушение
  const grown = strictnessVerdict([row('scripts/ro.mjs')], new Map([['scripts/ro.mjs', 'только чтение']]), { ceiling: 0 });
  ok('новая запись храповика сверх потолка — нарушение', grown.stale.some((x) => /потолок/.test(x.why)));
  ok('в пределах потолка запись храповика допустима', strictnessVerdict([row('scripts/ro.mjs')], new Map([['scripts/ro.mjs', 'x']]), { ceiling: 1 }).ok);

  // хук обязан отвечать на неверный вызов кодом 1
  const hookRow = (file, badCallExit) => ({ file, cli: true, strict: true, style: 'helper', sideEffects: false, effects: [], badCallExit });
  ok('хук в hooks/ без badCallExit: 1 — нарушение (код 2 заблокировал бы действие)',
    strictnessVerdict([hookRow('hooks/x-gate.mjs', 2)], new Map()).violations.some((x) => /кодом 1/.test(x.why)));
  ok('скрипт из фрагмента настроек хуков — тоже хук', strictnessVerdict([hookRow('scripts/skill-selector.mjs', 2)], new Map(), { hookNames: new Set(['skill-selector.mjs']) }).violations.length === 1);
  ok('строка состояния — тоже хук', strictnessVerdict([hookRow('global-setup/statusline-jidoka.mjs', 2)], new Map()).violations.length === 1);
  ok('библиотека хуков (hooks/lib) хуком не считается', strictnessVerdict([hookRow('hooks/lib/tail.mjs', 2)], new Map()).ok);
  ok('хук с badCallExit: 1 — чисто', strictnessVerdict([hookRow('hooks/x-gate.mjs', 1)], new Map()).ok);

  // признаки входа и помощника
  ok('разбор argv деструктуризацией со сторожем — CLI, а не библиотека',
    style("import { fileURLToPath } from 'node:url';\nconst [, script, ...args] = process.argv;\nif (script === fileURLToPath(import.meta.url) && args.includes('--x')) run();\n") === 'search');
  ok('своя функция runCli и упоминание lib/cli.mjs в строке — не помощник',
    !parsing(`const hint = 'scripts/lib/cli.mjs';\nfunction runCli(s) { return s; }\nexport const CLI = {};\n${GUARD_SRC}if (isMain) runCli(CLI);\n`).strict);

  // поиск действий
  ok('writeFile из node:fs/promises без префикса — запись',
    kinds("import { writeFile } from 'node:fs/promises';\nawait writeFile(p, 'x');\n").includes('write'));
  ok('git push внутри условия рядом с fail(...) — всё равно действие',
    kinds("if (run('git push origin main').status) fail('не запушено');\n").includes('git'));
  ok('функция с «SelfTest» в имени на рабочем пути — не самопроверка',
    effects("function pushAfterSelfTest() {\n  sh('git push');\n}\n").some((e) => e.kind === 'git' && !e.test));
  ok('стрелочная самопроверка без фигурных скобок не захватывает соседний блок',
    effects("const selfTest = () => check();\nif (isMain) {\n  sh('git push');\n}\n").some((e) => e.kind === 'git' && !e.test));
  ok('writeSync(1, …) — вывод, не запись файла', !kinds('writeSync(1, text);\n').includes('write'));
  ok('/re/.exec(s) — не запуск команды', !kinds('const m = /a/.exec(s);\n').includes('spawn'));

  // режимы командной строки
  ok('самопроверка вместе с другим режимом — неверный вызов', Boolean(modeError({ 'self-test': true, all: true }, [])));
  ok('--callsites с файлами — неверный вызов', Boolean(modeError({ callsites: true }, ['a.mjs'])));
  ok('--all с файлами — неверный вызов', Boolean(modeError({ all: true }, ['a.mjs'])));
  ok('--json вместе с --report — неверный вызов', Boolean(modeError({ all: true, json: true, report: 'r.md' }, [])));
  ok('--all один — верный вызов', modeError({ all: true }, []) === null);

  console.log(`\ncli-strictness self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

export const CLI = {
  name: 'cli-strictness',
  selfTest: true,
  usage: `Сторож строгого разбора аргументов (класс extra-argument-silently-swallowed).

Использование:
  node scripts/cli-strictness.mjs --all                  вся область (scripts, hooks, global-setup)
  node scripts/cli-strictness.mjs <файл.mjs> …           только названные файлы (pre-commit)
  node scripts/cli-strictness.mjs --all --report <md>    записать таблицу замера
  node scripts/cli-strictness.mjs --all --json           сырые строки замера
  node scripts/cli-strictness.mjs --callsites [--home]   сверить места вызова со спецификациями
  node scripts/cli-strictness.mjs --self-test
  node scripts/cli-strictness.mjs --help

  --home        добавить к сверке ~/.claude (CLAUDE.md, rules, hooks, settings.json, skills,
                commands, agents) — только на машине владельца, в CI этих файлов нет.
  --root <путь> проверить другое дерево той же раскладки (установленную копию
                ~/.claude/jidoka, .jidoka продукта); храповик берётся из него же.

Файлы не запускаются: разбор и побочные действия определяются по тексту; сверка мест вызова
импортирует модули в отдельном процессе под песочницей scripts/lib/cli-sandbox.mjs.
Коды выхода: 0 — нарушений нет, 1 — нарушение, устаревший храповик или сломанный вызов,
2 — неверный вызов (ничего не выполнено), 3 — мерить было нечего (пустая область при --all
или ни одного места вызова).`,
  options: {
    all: { type: 'boolean' },
    report: { type: 'string' },
    json: { type: 'boolean' },
    callsites: { type: 'boolean' },
    home: { type: 'boolean' },
    root: { type: 'string' },
  },
  positionals: { min: 0, max: Infinity, name: 'файл.mjs' },
};

/** Чистая: несовместимые режимы — неверный вызов, а не молчаливый выбор одного из них. */
export function modeError(values, positionals) {
  const modes = [values['self-test'] && '--self-test', values.callsites && '--callsites', values.all && '--all', positionals.length && 'список файлов'].filter(Boolean);
  if (modes.length > 1) return `режимы не сочетаются: ${modes.join(' и ')}`;
  if (!modes.length) return 'нужен --all, --callsites или список файлов';
  if (values.home && !values.callsites) return '--home работает только с --callsites';
  if (values['self-test'] && values.root) return '--root не работает с --self-test';
  if ((values.json || values.report) && !(values.all || positionals.length)) return '--json и --report работают с --all или списком файлов';
  if (values.json && values.report) return '--json и --report не сочетаются: выберите один вывод';
  return null;
}

/** Места вызова: репозиторий всегда, ~/.claude — только по --home. */
export async function collectCalls({ home = false, root = ROOT } = {}) {
  const { collect } = await import('./lib/cli-callsites.mjs');
  const calls = collect(root, { kind: 'repo' });
  if (home) {
    const { homedir } = await import('node:os');
    const H = homedir();
    for (const d of ['CLAUDE.md', 'rules', 'hooks', 'settings.json', 'skills', 'commands', 'agents', 'scripts']) {
      calls.push(...collect(join(H, '.claude', d), { kind: 'home' }));
    }
  }
  return calls;
}

async function runCallsites(home, root = ROOT) {
  const { replayInSandbox } = await import('./lib/cli-replay.mjs');
  const { isLive } = await import('./lib/cli-callsites.mjs');
  const calls = await collectCalls({ home, root });
  if (!calls.length) {
    console.log('cli-strictness: НЕ ИЗМЕРЕНО — мест вызова не найдено');
    return null;
  }
  const r = replayInSandbox(root, calls);
  const live = r.failures.filter((f) => f.kind !== 'repo' || isLive(f.source));
  const history = r.failures.length - live.length;
  console.log(`сверка мест вызова: ${calls.length} найдено, ${r.checked} сверено со спецификациями ${r.specs} скриптов`);
  if (r.attempts.length) console.log(`✗ импорт модулей пытался действовать: ${r.attempts.map((a) => a.op).join(', ')}`);
  for (const b of r.broken) console.log(`✗ ${b.script}: модуль не импортируется — ${b.error}`);
  for (const f of live) {
    const where = f.kind === 'home' ? f.source.replace(/^.*\.claude\//, '~/.claude/') : f.source;
    console.log(`✗ ${where}:${f.line} → ${f.via ? `${f.via} → ` : ''}${f.script}: ${f.error}\n    ${f.raw}`);
  }
  if (history) console.log(`  (в истории — docs/retros, audits, specs… — ещё ${history}: не правятся, это записи прошлого)`);
  const bad = live.length + r.broken.length + r.attempts.length;
  console.log(bad ? `✗ cli-strictness: ${bad} сломанных мест` : '✓ cli-strictness: все живые места вызова разбираются');
  return bad === 0;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const { values, positionals } = runCli(CLI);
  const bad = (why) => {
    console.error(`cli-strictness: неверный вызов — ${why}\nНичего не выполнено.\n\n${CLI.usage}`);
    process.exit(2);
  };
  const modeProblem = modeError(values, positionals);
  if (modeProblem) bad(modeProblem);
  if (values['self-test']) process.exit(selfTest() ? 0 : 1);
  const root = values.root ? resolve(values.root) : ROOT;
  if (values.root && !existsSync(root)) bad(`нет такой папки: ${values.root}`);
  if (values.callsites) {
    const res = await runCallsites(values.home === true, root);
    process.exit(res === null ? 3 : res ? 0 : 1);
  }
  const missing = positionals.filter((p) => !existsSync(resolve(p)));
  if (missing.length) bad(`нет такого файла: ${missing.join(', ')}`);
  const files = values.all
    ? allFiles(root)
    : positionals.map((p) => relative(root, resolve(p))).filter(inStrictnessScope);
  if (!files.length) {
    // файлы правки вне области — законный пропуск; пустая область при --all — замер не состоялся
    console.log('cli-strictness: НЕ ИЗМЕРЕНО — модулей из области нет');
    process.exit(values.all ? 3 : 0);
  }
  const rows = files.map((f) => analyzeFile(f, root));
  if (values.json) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  if (values.report) {
    writeFileSync(values.report, `${markdownTable(rows)}\n`);
    console.log(`таблица записана: ${values.report}`);
  }
  const v = strictnessVerdict(rows, loadBaseline(root), { checkedFiles: values.all ? null : files, hookNames: hookNamesFrom(root) });
  const c = counts(rows);
  if (v.ok) {
    console.log(`✓ cli-strictness: ${c.cli} CLI из ${c.files} файлов, строгих ${c.strict}, в храповике ${c.loose} (без побочных действий)`);
    process.exit(0);
  }
  if (v.violations.length) {
    const loose = v.violations.filter((r) => r.style !== 'util-strict' && r.style !== 'helper-hidden').length;
    console.log(`✗ cli-strictness: ${v.violations.length} CLI нарушают правило разбора (молча проглотят незнакомый флаг: ${loose})`);
    for (const r of v.violations) {
      const fx = r.effects.filter((e) => e.weight >= 3).map((e) => `${e.label} :${e.line}`).join(', ');
      console.log(`  ${r.file}${r.line ? `:${r.line}` : ''} — ${STYLE_LABEL[r.style]}; ${r.why}${fx ? ` (${fx})` : ''}`);
    }
    console.log('\nпочинить: export const CLI = {...} + runCli(CLI) из scripts/lib/cli.mjs; образец — scripts/task-queue.mjs');
  }
  if (v.stale.length) {
    console.log(`✗ cli-strictness: храповик ${BASELINE} устарел в ${v.stale.length} записях`);
    for (const s2 of v.stale) console.log(`  ${s2.file} — ${s2.why}`);
  }
  process.exit(1);
}
