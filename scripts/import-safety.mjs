#!/usr/bin/env node
// import-safety — модуль обязан быть импортируемым без последствий.
//
// Дефект, который закрывает этот гейт: файл выполняет работу прямо на верхнем
// уровне, поэтому `import('./x.mjs')` запускает CLI целиком. Замер 2026-08-15
// на канонe: 86 модулей печатали что-то при импорте, один зависал на чтении
// stdin, и 19 файлов репозитория оказались ПЕРЕЗАПИСАНЫ просто оттого, что
// модули импортировали (индексы спек, карта покрытия, реестр доступа агентов).
//
// Гейт статический и читающий: он НИКОГДА не импортирует проверяемый файл,
// потому что импорт — это ровно то действие, чью опасность он измеряет.
// Точность откалибрована по эмпирическому прогону (см. --self-test и
// docs/IMPORT_SAFETY.md), а не по ощущению от регэкспа.
//
// @closes-class: work-runs-at-import-time

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Токенизатор: нужен, чтобы скобка внутри строки или комментария не сдвигала
// глубину. Наивный счётчик символов на этом и ломается.
// ─────────────────────────────────────────────────────────────────────────────

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/**
 * Возвращает для каждой строки исходника глубину вложенности В НАЧАЛЕ строки и
 * признак того, что строка начинается в коде (не внутри строки/комментария).
 */
export function scanLines(src) {
  const lines = src.split('\n');
  const out = [];
  let depth = 0;
  let state = 'code'; // code | line | block | sq | dq | tpl | re
  const tplStack = []; // глубина скобок на момент входа в ${…}
  let prevSig = '';

  for (let i = 0; i < lines.length; i++) {
    const entry = { depth, clean: state === 'code', code: '' };
    out.push(entry);
    const line = lines[i];
    const bare = line.split('');
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (state !== 'code') bare[j] = ' ';
      const n = line[j + 1];
      if (state === 'line') break;
      if (state === 'block') {
        if (c === '*' && n === '/') { state = 'code'; j++; }
        continue;
      }
      if (state === 'sq' || state === 'dq') {
        if (c === '\\') { j++; continue; }
        if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"')) state = 'code';
        continue;
      }
      if (state === 're') {
        if (c === '\\') { j++; continue; }
        if (c === '/') state = 'code';
        continue;
      }
      if (state === 'tpl') {
        if (c === '\\') { j++; continue; }
        if (c === '`') { state = 'code'; continue; }
        if (c === '$' && n === '{') { tplStack.push(depth); depth++; state = 'code'; j++; }
        continue;
      }
      // state === 'code'
      if (c === '/' && n === '/') { state = 'line'; break; }
      if (c === '/' && n === '*') { state = 'block'; j++; continue; }
      if (c === "'") { state = 'sq'; continue; }
      if (c === '"') { state = 'dq'; continue; }
      if (c === '`') { state = 'tpl'; continue; }
      if (c === '/' && (prevSig === '' || REGEX_PRECEDERS.has(prevSig))) { state = 're'; continue; }
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') {
        depth--;
        if (depth < 0) depth = 0;
        if (c === '}' && tplStack.length && depth === tplStack[tplStack.length - 1]) { tplStack.pop(); state = 'tpl'; }
      }
      if (!/\s/.test(c)) prevSig = c;
    }
    if (state === 'line') { for (let k = 0; k < bare.length; k++) if (line[k] === '/' && line[k + 1] === '/') { for (let q = k; q < bare.length; q++) bare[q] = ' '; break; }
      state = 'code'; }
    entry.code = bare.join('');
  }
  return out;
}

const DECLARATION = /^(?:export\s|import\s|import\(|const\s|let\s|var\s|function[\s*]|async\s+function[\s*]|class\s|#!|\/\/|\/\*|\*|\*\/)/;
// Узкое исключение: однострочная необязательная загрузка соседнего модуля
// `try { ({ x } = await import('./y.mjs')); } catch { }`. Это загрузка модуля,
// а не работа: сам модуль y обязан быть безопасным по этому же правилу.
const OPTIONAL_IMPORT = /^try\s*\{(.*)\}\s*catch\b/;
function isOptionalImport(line) {
  const m = line.match(OPTIONAL_IMPORT);
  if (!m || !/await\s+import\(/.test(m[1])) return false;
  // в теле не должно быть НИКАКИХ других вызовов — иначе это уже работа
  return !/[\w$]\s*\(/.test(m[1].replace(/await\s+import\([^)]*\)/g, ''));
}
const CLOSER = /^[}\])`;,]/;

/**
 * Имена настоящих сторожей: СРАВНЕНИЕ import.meta.url с process.argv.
 * Одного упоминания import.meta.url мало — `const __dirname =
 * path.dirname(fileURLToPath(import.meta.url))` это путь, он всегда истинен,
 * и `if (__dirname)` не сторожит НИЧЕГО. Ровно на этом кодмод один раз уже
 * написал 58 пустышек; поймал эмпирический прогон, а не самопроверка.
 */
export function guardNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]{0,220}?);/g)) {
    if (m[2].includes('import.meta.url') && m[2].includes('process.argv')) names.add(m[1]);
  }
  return names;
}

/**
 * Строка-сторож: условие опирается на import.meta.url (напрямую или через имя),
 * либо сверяет process.argv[1] с СОБСТВЕННЫМ именем файла. Вторая форма слабее
 * (совпадение по имени, а не по пути), но свойство «импорт ничего не запускает»
 * она держит: argv[1] импортирующего оканчивается на другое имя.
 */
export function isGuard(line, names, basename = '') {
  if (!/^(?:if|else\s+if)\s*\(/.test(line)) return false;
  if (line.includes('import.meta.url')) return true;
  for (const n of names) if (new RegExp(`\\b${n}\\b`).test(line)) return true;
  if (basename && line.includes('process.argv[1]') && line.includes(`'${basename}'`)) return true;
  return false;
}

/** Имена, привязанные к сверке argv[1] с собственным именем файла. */
export function basenameGuardNames(src, basename) {
  const names = new Set();
  if (!basename) return names;
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]*);/g)) {
    if (m[2].includes('process.argv[1]') && m[2].includes(`'${basename}'`)) names.add(m[1]);
  }
  return names;
}

/** Верхнеуровневые объявления внутри диапазона строк [from, to). */
export function declaredIn(src, from, to) {
  const lines = src.split('\n');
  const info = scanLines(src);
  const names = new Set();
  for (let i = from; i < Math.min(to, lines.length); i++) {
    if (!info[i] || info[i].depth !== 0 || !info[i].clean) continue;
    const m = (info[i].code || lines[i]).match(/^(?:const|let|var|function\*?|async\s+function\*?|class)\s+([A-Za-z_$][\w$]*)/);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * Есть ли выше строки `limit` СВОБОДНАЯ ссылка на имя `name` — то есть такая,
 * которая после переноса объявления в блок сломается. Не считаются: обращение
 * к свойству (`console.log`), параметр объемлющей функции (`function f(rows)`)
 * и её локальная переменная (`const roster = new Map()`).
 */
export function freeReferenceAbove(lines, info, limit, name) {
  // ключ объектного литерала (`missing: x`) ссылкой не является; сокращённая
  // запись `{ missing }` без двоеточия — является, её не исключаем
  const word = new RegExp(`(^|[^\\w$.])${name}(?![\\w$])(?!\\s*:)`);
  const FN_HEAD = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+[\w$]*\s*\(([^)]*)\)|(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>)/;
  for (let i = 0; i < limit; i++) {
    const code = info[i] && info[i].clean !== undefined ? info[i].code || '' : '';
    if (!word.test(code)) continue;
    if (new RegExp(`^(?:export\\s+)?(?:const|let|var|function\\*?|async\\s+function\\*?|class)\\s+${name}\\b`).test(code)) continue;

    // ближайший сверху заголовок функции на верхнем уровне
    let head = -1;
    for (let j = i; j >= 0; j--) {
      if (!info[j] || info[j].depth !== 0 || !info[j].clean) continue;
      const c = info[j].code || '';
      if (FN_HEAD.test(c)) { head = j; break; }
      if (j < i && /^\S/.test(c)) break; // до функции встретился код модуля
    }
    if (head === -1) return true; // ссылка на уровне модуля — сломается точно

    const m = (info[head].code || '').match(FN_HEAD);
    const params = (m && (m[1] || m[2])) || '';
    if (word.test(params) || new RegExp(`\\b${name}\\b`).test(params)) continue;

    let boundLocally = false;
    for (let j = head; j <= i; j++) {
      const c = (info[j] && info[j].code) || '';
      const declared = new RegExp(`(?:const|let|var)\\s+\\b${name}\\b`).test(c)
        // объявление через разбор: const [pass, detail] = … / const { a, b } = …
        || new RegExp(`(?:const|let|var)\\s*[[{][^\\]}]*\\b${name}\\b`).test(c)
        || new RegExp(`for\\s*\\((?:const|let|var)\\s+[[{]?[^\\]})]*\\b${name}\\b`).test(c)
        // параметр стрелочной функции внутри тела: (a, name) => …
        || new RegExp(`\\([^)]*\\b${name}\\b[^)]*\\)\\s*=>`).test(c);
      if (declared) { boundLocally = true; break; }
    }
    if (!boundLocally) return true;
  }
  return false;
}

/**
 * Разбор одного модуля.
 * exec      — верхнеуровневые исполняемые строки, не прикрытые сторожем
 * wrapStart — с какой строки (0-индекс) можно обернуть хвост в сторож
 * blockers  — причины, по которым машинально обернуть НЕЛЬЗЯ
 */
export function analyze(src, filePath = '') {
  const lines = src.split('\n');
  const info = scanLines(src);
  const basename = filePath ? filePath.split('/').pop() : '';
  const names = new Set([...guardNames(src), ...basenameGuardNames(src, basename)]);
  // функции, объявленные в этом же файле: вызов такой функции из объявления
  // верхнего уровня — это работа, спрятанная за словом const
  const localFns = new Set([...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
  // Вызовы, у которых есть ПОСЛЕДСТВИЯ, даже если функция не своя. Список
  // намеренно узкий: path.join и JSON.parse сюда не входят, иначе гейт зашумит.
  // Ловится только НАСТОЯЩИЙ вызов — определение функции (const f = () => …)
  // при импорте ничего не делает.
  const EFFECTFUL = /(?:execSync|execFileSync|spawnSync|fetch|readFileSync|readdirSync|writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|copyFileSync)\s*\(/;
  const IS_FN_DEF = /=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|=\s*(?:async\s+)?function\b/;
  const exec = [];
  let guardedTail = false;
  // цепочка if / else if / else на верхнем уровне — ОДНО целое: если её голова
  // сторож, продолжения тоже прикрыты; если голова дефект, он уже посчитан
  let inChain = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.length || /^\s/.test(line)) continue;
    if (!info[i].clean || info[i].depth !== 0) continue;
    if (/^else\b/.test(line)) { if (inChain) continue; }
    if (DECLARATION.test(line) || CLOSER.test(line)) {
      inChain = false;
      const code = info[i].code || line;
      const call = code.match(/^(?:export\s+)?(?:const|let|var)\s+[^=]*=\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/);
      const isDecl = /^(?:export\s+)?(?:const|let|var)\s/.test(code);
      if ((call && localFns.has(call[1])) || (isDecl && !IS_FN_DEF.test(code) && EFFECTFUL.test(code))) {
        exec.push({ line: i, text: line.trim().slice(0, 80) });
      }
      continue;
    }
    if (isOptionalImport(line)) { inChain = false; continue; }
    if (isGuard(line, names, basename)) { guardedTail = true; inChain = true; continue; }
    inChain = /^if\s*\(/.test(line);
    exec.push({ line: i, text: line.trim().slice(0, 80) });
  }

  const blockers = [];
  let wrapStart = null;
  if (exec.length) {
    wrapStart = exec[0].line;
    // экспорт после точки обёртки → синтаксическая ошибка
    for (let i = wrapStart; i < lines.length; i++) {
      if (info[i] && info[i].clean && info[i].depth === 0 && /^export[\s{]/.test(lines[i])) {
        blockers.push(`export на строке ${i + 1} попал бы внутрь блока`);
        break;
      }
    }
    // объявление внутри обёртки, на которое ссылается код выше → оно станет невидимым.
    // Считается только СВОБОДНАЯ ссылка: параметр функции, локальная переменная или
    // обращение к свойству (console.log) одноимённым объявлением не является.
    const inside = declaredIn(src, wrapStart, lines.length);
    // сторож, объявленный НИЖЕ точки обёртки: ссылка на него сверху упала бы в TDZ
    for (const n of names) {
      if (inside.has(n)) { blockers.push(`сторож «${n}» объявлен ниже точки обёртки`); break; }
    }
    // только КОД выше: слово в комментарии или строке ссылкой не является
    for (const n of inside) {
      if (freeReferenceAbove(lines, info, wrapStart, n)) {
        blockers.push(`«${n}» объявлено ниже, но используется выше — блок скроет его`);
        break;
      }
    }
  }

  return { exec, wrapStart, blockers, hasGuard: guardedTail, guardNames: [...names] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Кодмод: обернуть хвост в сторож, ничего не переставляя.
// ─────────────────────────────────────────────────────────────────────────────

export const GUARD_LINE = "const isMain = process.argv[1] === fileURLToPath(import.meta.url);";

export function applyGuard(src, filePath = '') {
  const a = analyze(src, filePath);
  if (!a.exec.length) return { changed: false, src, reason: 'уже безопасен' };
  if (a.blockers.length) return { changed: false, src, reason: a.blockers[0] };

  const lines = src.split('\n');
  const names = a.guardNames;
  let guardVar = names[0];
  const pre = [];

  if (!guardVar) {
    // имя переменной: если isMain в файле уже занято другим смыслом, второе
    // объявление уронит модуль целиком
    guardVar = /\b(?:const|let|var|function|class)\s+isMain\b/.test(src) ? '__isMain' : 'isMain';
    // импорт: важно наличие ИМЕНИ fileURLToPath, а не модуля node:url. Файл
    // может импортировать оттуда pathToFileURL — тогда имени нет, и модуль
    // падает с ReferenceError уже при импорте. Синтаксическая проверка такое
    // пропускает; поймал прогон поведения.
    const hasName = /(?:^|[^\w$])fileURLToPath(?:[^\w$]|$)/m.test(src.split('\n').filter((l) => /^import\s/.test(l)).join('\n'));
    if (!hasName) pre.push("import { fileURLToPath } from 'node:url';");
    pre.push(`const ${guardVar} = process.argv[1] === fileURLToPath(import.meta.url);`);
  }

  // куда вставить объявление сторожа: перед первой исполняемой строкой
  const head = lines.slice(0, a.wrapStart);
  const tail = lines.slice(a.wrapStart);
  while (tail.length && tail[tail.length - 1].trim() === '') tail.pop();

  const out = [...head];
  if (pre.length) {
    // импорт — к остальным импортам наверх, сторож — прямо перед хвостом
    const importLine = pre.find((p) => p.startsWith('import '));
    if (importLine) {
      let last = -1;
      for (let i = 0; i < head.length; i++) if (/^import\s/.test(head[i])) last = i;
      // импортов нет — вставляем ПОСЛЕ shebang, иначе `#!` уедет на вторую
      // строку и файл перестанет быть исполняемым (и разбираемым)
      const at = last >= 0 ? last + 1 : head[0] && head[0].startsWith('#!') ? 1 : 0;
      out.splice(at, 0, importLine);
    }
    out.push('', pre.find((p) => p.startsWith('const ')));
  }
  // отступ добавляем ТОЛЬКО строкам, которые начинаются в коде: строка внутри
  // многострочного шаблона — это содержимое вывода, лишние пробелы его изменят
  const tailInfo = scanLines(tail.join('\n'));
  const body = tail.map((l, i) => (tailInfo[i] && tailInfo[i].clean && l.trim() ? '  ' + l : l));

  out.push('', `if (${guardVar}) {`, ...body, '}', '');
  return { changed: true, src: out.join('\n'), reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Область гейта: рабочие модули движка. Тесты исключены намеренно — файл теста
 * ПО ЗАМЫСЛУ выполняется при загрузке, это его способ регистрации. Образцы и
 * предложения исключены: они нарочно неправильные.
 */
export const SCAN_DIRS = ['scripts', 'hooks', 'lib', 'global-setup'];
const SKIP_DIR = /(?:^|\/)(?:__tests__|node_modules|\.git|fixtures|\.worktrees)(?:\/|$)/;

export function allModules(root = '.') {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = `${dir}/${e}`;
      if (SKIP_DIR.test(full)) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (e.endsWith('.mjs')) out.push(full.replace(/^\.\//, ''));
    }
  };
  for (const d of SCAN_DIRS) walk(`${root}/${d}`.replace(/^\.\//, ''));
  return out.sort();
}

export function checkFiles(paths) {
  const findings = [];
  for (const p of paths) {
    let src;
    try { src = readFileSync(p, 'utf8'); } catch { continue; }
    const a = analyze(src, p);
    if (a.exec.length) findings.push({ path: p, ...a });
  }
  return findings;
}

function selfTest() {
  const t = [];
  const ok = (name, cond) => t.push({ name, pass: Boolean(cond) });

  // 1. скобка внутри строки не должна сдвигать глубину
  ok('строка со скобкой не ломает глубину', scanLines("const a = '{';\nmain();\n")[1].depth === 0);
  // 2. то же для шаблона
  ok('шаблон со скобкой не ломает глубину', scanLines('const a = `${x}{`;\nmain();\n')[1].depth === 0);
  // 3. и для комментария
  ok('комментарий со скобкой не ломает глубину', scanLines('// {\nmain();\n')[1].depth === 0);
  // 4. регэксп со слэшем
  ok('регэксп не открывает комментарий', scanLines('const r = /a\\/{b/;\nmain();\n')[1].depth === 0);
  // 5. голый вызов ловится
  ok('голый main() — дефект', analyze('function main(){}\nmain();\n').exec.length === 1);
  // 6. сторож не считается дефектом
  ok(
    'if (isMain) — не дефект',
    analyze("import { fileURLToPath } from 'node:url';\nconst isMain = process.argv[1] === fileURLToPath(import.meta.url);\nif (isMain) {\n  main();\n}\n").exec.length === 0,
  );
  // 7. сторож через прямое сравнение тоже
  ok('if (import.meta.url === …) — не дефект', analyze('if (import.meta.url === x) {\n  main();\n}\n').exec.length === 0);
  // 8. генератор — объявление, а не работа
  ok('function* — объявление', analyze('function* walk(){}\n').exec.length === 0);
  // 9. process.argv.includes НЕ сторож: родительский CLI со своим --self-test запустит чужой
  ok("process.argv.includes('--self-test') — дефект", analyze("if (process.argv.includes('--self-test')) selfTest();\n").exec.length === 1);
  // 10. экспорт ниже точки обёртки блокирует машинную правку
  ok('экспорт после обёртки блокирует', analyze('main();\nexport const x = 1;\n').blockers.length === 1);
  // 11. объявление, нужное коду выше, блокирует
  ok('используемое выше объявление блокирует', analyze('export function f(){ return CFG; }\nmain();\nconst CFG = 1;\n').blockers.length >= 1);
  // 12. кодмод даёт синтаксически валидный и уже безопасный текст
  const fixed = applyGuard('function main(){}\nmain();\n');
  ok('кодмод сработал', fixed.changed);
  ok('после кодмода дефекта нет', analyze(fixed.src).exec.length === 0);
  ok('кодмод добавил импорт node:url', fixed.src.includes("from 'node:url'"));
  // 15. кодмод переиспользует существующий сторож, а не плодит второй
  const reuse = applyGuard("import { fileURLToPath } from 'node:url';\nconst isMain = process.argv[1] === fileURLToPath(import.meta.url);\nmain();\n");
  ok('существующий сторож переиспользован', (reuse.src.match(/const isMain/g) || []).length === 1);
  // 16. идемпотентность
  ok('повторный прогон ничего не меняет', applyGuard(fixed.src).changed === false);
  // 49. настоящий ввод-вывод в объявлении — дефект
  ok(
    'const x = readFileSync(...) — дефект',
    analyze("import { readFileSync } from 'node:fs';\nconst raw = readFileSync('a.txt', 'utf8');\n", 'a.mjs').exec.length === 1,
  );
  // 50. а определение функции с тем же вызовом внутри — нет
  ok(
    'const f = (p) => readFileSync(p) — не дефект',
    analyze("import { readFileSync } from 'node:fs';\nconst read = (p) => readFileSync(p, 'utf8');\n", 'a.mjs').exec.length === 0,
  );
  // 51. и безобидный помощник не считается
  ok(
    'const ROOT = path.join(...) — не дефект',
    analyze("import path from 'node:path';\nconst ROOT = path.join('a', 'b');\n", 'a.mjs').exec.length === 0,
  );
  // 46. обход области видит настоящие файлы движка и не лезет в тесты
  const mods = allModules('.');
  ok('обход находит модули движка', mods.length > 100 && mods.includes('scripts/import-safety.mjs'));
  ok('тесты в область не входят', !mods.some((m) => m.includes('__tests__')));
  ok('образцы в область не входят', !mods.some((m) => m.includes('fixtures')));
  // 44. необязательная загрузка модуля в одну строку — не работа
  ok(
    'try { await import } catch — не дефект',
    analyze("let plan = null;\ntry { ({ plan } = await import('./p.mjs')); } catch { }\n", 'a.mjs').exec.length === 0,
  );
  // 45. но если в том же try есть ВЫЗОВ — это уже работа
  ok(
    'вызов рядом с import снова дефект',
    analyze("try { await import('./p.mjs'); run(); } catch { }\n", 'a.mjs').exec.length === 1,
  );
  // 43. shebang обязан остаться первой строкой
  ok(
    'shebang не сдвигается',
    applyGuard('#!/usr/bin/env node\nfunction main(){}\nmain();\n', 'a.mjs').src.startsWith('#!/usr/bin/env node\n'),
  );
  // 40. ключ объектного литерала не блокирует
  ok(
    'ключ объекта не считается ссылкой',
    analyze('function f() { return { approver: 1 }; }\nmain();\nconst approver = 2;\n', 'a.mjs').blockers.length === 0,
  );
  // 41. но сокращённая запись { approver } — считается
  ok(
    'сокращённая запись объекта — ссылка',
    analyze('function f() { return { approver }; }\nmain();\nconst approver = 2;\n', 'a.mjs').blockers.length >= 1,
  );
  // 42. объявление через разбор массива не блокирует
  ok(
    'const [pass, detail] не блокирует',
    analyze('function f() { const [pass, detail] = g(); return pass + detail; }\nmain();\nconst pass = 1;\n', 'a.mjs').blockers.length === 0,
  );
  // 36. параметр функции с тем же именем — НЕ ссылка
  ok(
    'параметр функции не блокирует',
    analyze('export function sum(rows) { return rows.length; }\nmain();\nconst rows = [];\n', 'a.mjs').blockers.length === 0,
  );
  // 37. свойство объекта — тоже не ссылка
  ok(
    'console.log не считается ссылкой на log',
    analyze("function f() { console.log('x'); }\nmain();\nconst log = 1;\n", 'a.mjs').blockers.length === 0,
  );
  // 38. а настоящая свободная ссылка из функции блокирует
  ok(
    'свободная ссылка из функции блокирует',
    analyze('export function f() { return CFG.x; }\nmain();\nconst CFG = {};\n', 'a.mjs').blockers.length >= 1,
  );
  // 39. и ссылка на уровне модуля тоже
  ok(
    'ссылка на уровне модуля блокирует',
    analyze('const a = CFG;\nmain();\nconst CFG = 1;\n', 'a.mjs').blockers.length >= 1,
  );
  // 34. работа, спрятанная в объявлении: const x = локальнаяФункция()
  ok(
    'const x = локальнаяФункция() — дефект',
    analyze('function load() { console.log(1); }\nconst cfg = load();\n', 'a.mjs').exec.length === 1,
  );
  // 35. а вызов чужого помощника таким не считается (иначе шум на path.join и подобных)
  ok(
    'const x = path.join(...) — не дефект',
    analyze("import path from 'node:path';\nconst ROOT = path.join('a', 'b');\n", 'a.mjs').exec.length === 0,
  );
  // 31. node:url импортирован, но БЕЗ нужного имени — импорт всё равно нужен
  ok(
    'импорт добавляется, если взято другое имя из node:url',
    applyGuard("import { pathToFileURL } from 'node:url';\nmain();\n", 'a.mjs').src.includes('fileURLToPath } from'),
  );
  // 32. а если имя уже есть — второй импорт не нужен
  ok(
    'повторный импорт не добавляется',
    (applyGuard("import { fileURLToPath } from 'node:url';\nmain();\n", 'a.mjs').src.match(/fileURLToPath \} from/g) || []).length === 1,
  );
  // 33. занятое имя isMain не переобъявляется
  ok(
    'занятое имя isMain обходится',
    applyGuard("import { fileURLToPath } from 'node:url';\nfunction isMain() {}\nmain();\n", 'a.mjs').src.includes('const __isMain ='),
  );
  // 29. многострочный шаблон обязан пережить отступ БЕЗ изменений
  const tplSrc = 'function main(){}\nmain();\nconsole.log(`первая\nвторая`);\n';
  ok('содержимое шаблона не сдвинуто', applyGuard(tplSrc, 'a.mjs').src.includes('\nвторая`'));
  // 30. а код внутри блока — сдвинут
  ok('код в блоке получил отступ', applyGuard('function main(){}\nmain();\n', 'a.mjs').src.includes('\n  main();'));
  // 26-27. путь к папке — НЕ сторож: он всегда истинен
  ok(
    '__dirname не считается сторожем',
    guardNames("const __dirname = path.dirname(fileURLToPath(import.meta.url));\n").size === 0,
  );
  ok(
    'if (__dirname) — дефект, а не сторож',
    analyze("const __dirname = path.dirname(fileURLToPath(import.meta.url));\nif (__dirname) { main(); }\n", 'a.mjs').exec.length === 1,
  );
  // 28. кодмод при наличии только __dirname обязан завести НОВЫЙ сторож
  ok(
    'кодмод не переиспользует __dirname',
    applyGuard("import { fileURLToPath } from 'node:url';\nconst __dirname = path.dirname(fileURLToPath(import.meta.url));\nmain();\n", 'a.mjs').src.includes('const isMain ='),
  );
  // 24-25. цепочка else после сторожа прикрыта им же
  ok(
    'else if после сторожа — не дефект',
    analyze("const isMain = process.argv[1] === fileURLToPath(import.meta.url);\nif (!isMain) { }\nelse if (x) run();\nelse run2();\n", 'a.mjs').exec.length === 0,
  );
  ok(
    'цепочка без сторожа считается один раз, с головы',
    (() => { const a = analyze("if (x) run();\nelse run2();\n", 'a.mjs'); return a.exec.length === 1 && a.wrapStart === 0; })(),
  );
  // 23. сторож, объявленный ниже точки обёртки, блокирует машинную правку
  ok(
    'сторож ниже точки обёртки блокирует',
    analyze("run();\nconst isMain = process.argv[1] === fileURLToPath(import.meta.url);\nif (isMain) main();\n", 'a.mjs').blockers.length >= 1,
  );
  // 21. слово в комментарии выше — не ссылка, оборачивать можно
  ok(
    'имя в комментарии не блокирует',
    analyze('// проза про project и его судьбу\nmain();\nconst project = 1;\n', 'a.mjs').blockers.length === 0,
  );
  // 22. а в строке — тоже не ссылка
  ok(
    'имя в строковом литерале не блокирует',
    analyze("const msg = 'смотри project';\nmain();\nconst project = 1;\n", 'a.mjs').blockers.length === 0,
  );
  // 17-18. сторож по собственному имени файла — тоже сторож, но только по СВОЕМУ имени
  ok(
    'argv[1].endsWith(своё имя) — не дефект',
    analyze("if (process.argv[1] && process.argv[1].endsWith('a.mjs')) { main(); }\n", 'scripts/a.mjs').exec.length === 0,
  );
  ok(
    'argv[1].endsWith(ЧУЖОЕ имя) — дефект',
    analyze("if (process.argv[1] && process.argv[1].endsWith('b.mjs')) { main(); }\n", 'scripts/a.mjs').exec.length === 1,
  );
  // 19. argv[2] сторожем не является
  ok("process.argv[2] === 'x' — дефект", analyze("if (process.argv[2] === 'x') { run(); }\n", 'scripts/a.mjs').exec.length === 1);
  // 20. пустой ввод — не «всё хорошо», а «нечего мерить»
  ok('пустой список файлов не даёт ложного зелёного', checkFiles([]).length === 0);

  const failed = t.filter((x) => !x.pass);
  for (const x of t) console.log(`${x.pass ? '✓' : '✗'} ${x.name}`);
  console.log(`\nimport-safety self-test: ${t.length - failed.length}/${t.length}`);
  process.exit(failed.length ? 1 : 0);
}

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) selfTest();

  const fix = args.includes('--fix');
  let paths = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--all')) paths = allModules('.');
  if (!paths.length) {
    console.log('использование: import-safety.mjs <файлы…> [--fix] [--self-test]');
    console.log('  без --fix — только отчёт; выход 1, если найден дефект');
    process.exit(0);
  }

  if (fix) {
    let done = 0;
    const skipped = [];
    for (const p of paths) {
      const src = readFileSync(p, 'utf8');
      const r = applyGuard(src, p);
      if (r.changed) { writeFileSync(p, r.src); done++; }
      else if (r.reason !== 'уже безопасен') skipped.push(`${p}: ${r.reason}`);
    }
    console.log(`обёрнуто файлов: ${done}`);
    if (skipped.length) {
      console.log(`требуют руки: ${skipped.length}`);
      for (const s of skipped) console.log('  ·', s);
    }
    process.exit(0);
  }

  const findings = checkFiles(paths);
  // пустой вход — это «не измерено», а не «всё чисто»
  if (!paths.length) {
    console.log('import-safety: НЕ ИЗМЕРЕНО — ни одного файла на входе');
    process.exit(0);
  }
  if (!findings.length) {
    console.log(`✓ import-safety: ${paths.length} файл(ов) импортируются без последствий`);
    process.exit(0);
  }
  console.log(`✗ import-safety: работа на верхнем уровне в ${findings.length} файл(ах) — импорт запустит её`);
  for (const f of findings) {
    console.log(`  ${f.path}`);
    for (const e of f.exec.slice(0, 3)) console.log(`      ${e.line + 1}: ${e.text}`);
    if (f.exec.length > 3) console.log(`      … и ещё ${f.exec.length - 3}`);
  }
  console.log('\nпочинить: node scripts/import-safety.mjs <файл> --fix');
  process.exit(1);
}
