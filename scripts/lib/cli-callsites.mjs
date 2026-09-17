// cli-callsites — где и с какими аргументами зовут скрипты движка.
//
// Строгий разбор ломает вызов, который раньше молча проходил: флаг, о котором скрипт не
// знал, теперь даёт код 2. Поэтому до перевода собираются ВСЕ места вызова, а после —
// каждое прогоняется через спецификацию скрипта (scripts/__tests__/cli-callsites.test.mjs).
//
// Разбирается текстовая форма `node <префикс>scripts/имя.mjs <аргументы>` и
// `node <префикс>hooks/имя.mjs <аргументы>` в любых файлах: хуки git, CI, package.json,
// shell-скрипты, строки внутри JS, документация. Аргументы режутся до конца команды
// (перевод строки, | ; && || > <, закрывающая кавычка или обратная кавычка строки JS).
// Заполнители документации (<файл>, "$VAR", ${X}) становятся словом X.
// Форма массива (`spawnSync(node, [SCRIPT, '--x'])`) не разбирается и не выдумывается.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// X — заполнитель документации (<файл>, {id}); $X — значение, которое подставят при запуске ($ARGUMENTS, "$f")
export const PLACEHOLDER = 'X';
export const RUNTIME = '$X';
const CONTINUED = Symbol('продолжение');
const CALL = /\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*(["']?)([^\s"'`;|&<>()]*?)\b(scripts|hooks)\/((?:dashboard\/|lib\/)?[\w.-]+\.mjs)(["']?)/g;

/** Чистая: разбить хвост команды на слова с учётом кавычек и заполнителей. */
export function commandWords(tail) {
  const out = [];
  let i = 0;
  const s = tail;
  const stop = (k) => {
    const c = s[k];
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '>' || c === '<' || c === '`' || c === ')') return true;
    if (c === '\\' && (s[k + 1] === 'n' || s[k + 1] === '`')) return true;   // \n или \` внутри строки JS
    if (c === '2' && s[k + 1] === '>') return true;
    if (c === '#') return true;                                   // комментарий shell
    if (c === '—' || c === '–') return true;                      // проза после команды
    return false;
  };
  out.truncated = false;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '\\' && s[i + 1] === '\n') { i += 2; continue; }
    // заполнитель документации: <файл>, <путь>/docs/x.md — всё слово целиком
    const holder = c === '<' ? s.slice(i).match(/^<[^<>\s/][^<>\n]{0,40}>[^\s;|&<>`()]*/) : null;
    if (holder) { out.push({ w: holder[0].replace(/\]$/, ''), quoted: false, holder: true }); i += holder[0].length; continue; }
    if (stop(i)) break;
    if (c === '(' || c === '·' || c === '→') break;              // пояснение справки
    // русская проза без кавычек; имя файла (отчёт.md, папка/файл) — это значение, не проза
    if (/[а-яё]/.test(c) && !/^[^\s;|&<>`()]*(?:\.[a-z]{1,5}\b|\/)/.test(s.slice(i))) break;
    let w = '';
    let quoted = false;
    let broken = false;
    let inner = false;
    const innerHolder = (k) => (s[k] === '<' ? s.slice(k).match(/^<[^<>\s/][^<>\n]{0,40}>/) : null);
    while (i < s.length && (!/[\s;|&<>`)]/.test(s[i]) || innerHolder(i))) {
      const q = s[i];
      const h = innerHolder(i);
      if (h) { w += h[0]; inner = true; i += h[0].length; continue; }
      if (q === '"' || q === "'") {
        const end = s.indexOf(q, i + 1);
        const nl = s.indexOf('\n', i + 1);
        if (end < 0 || (nl >= 0 && nl < end)) { broken = true; break; }
        w += s.slice(i + 1, end);
        quoted = true;
        i = end + 1;
      } else if (q === '$' && s[i + 1] === '{') {
        // интерполяция шаблона JS целиком принадлежит слову: `${wave ?? 'x'}`
        let d = 0, k = i + 1;
        for (; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}') { d--; if (d === 0) break; } }
        w += s.slice(i, k + 1);
        i = k + 1;
      } else if (q === '\\' && (s[i + 1] === 'n' || s[i + 1] === '`')) { break; } else if (q === '\\' && i + 1 < s.length) { w += s[i + 1]; i += 2; } else { w += q; i++; }
    }
    if (w || quoted) out.push({ w, quoted, holder: inner && !w.startsWith('-') });
    if (inner && w.startsWith('-')) out[out.length - 1].w = w.replace(/<[^<>]*>.*$/, PLACEHOLDER);
    if (broken) { out.truncated = true; break; }
    if (i < s.length && s[i] === '\\' && (s[i + 1] === 'n' || s[i + 1] === '`')) break;
  }
  return out;
}

/** Чистая: слово документации → то, что увидит скрипт. null — слово выбрасывается. */
export function normalizeWord({ w, quoted, holder }) {
  let t = w.replace(/^\[/, '').replace(/\]$/, '');
  if (!quoted && t === '\\') return CONTINUED;                  // перенос строки внутри строки JS
  if (holder) return PLACEHOLDER;
  if (/^--?[\w-]+=X$/.test(t)) return t;
  if (!quoted && /^[A-Z]$/.test(t)) return PLACEHOLDER;          // N, S, W — заполнители чисел
  if (t === '' && !quoted) return null;
  if (/^(?:…|\.\.\.)$/.test(t)) return quoted ? PLACEHOLDER : CONTINUED;   // "..." — значение, … — продолжение
  if (!quoted && t.includes('|') && t.startsWith('-')) t = t.split('|')[0];
  if (/\$\{?[\w]/.test(t)) {
    // значение запуска: "$f", ${ROOT}/x, $ARGUMENTS; флаг сохраняет имя
    const m = t.match(/^(--?[\w-]+)=/);
    return m ? `${m[1]}=${RUNTIME}` : RUNTIME;
  }
  if (/^<[^>]*>$/.test(t) || /^\{[^}]*\}$/.test(t)) {
    // заполнитель документации: <файл>, {id}; флаг с заполнителем (--x=<v>) сохраняет имя
    const m = t.match(/^(--?[\w-]+)=/);
    return m ? `${m[1]}=${PLACEHOLDER}` : PLACEHOLDER;
  }
  if (/^--?[\w-]+=<[^>]*>$/.test(t)) return `${t.split('=')[0]}=${PLACEHOLDER}`;
  return t;
}

/** Кавычка, внутри которой стоит позиция на её строке (нечётное число открытий), или ''. */
function enclosingQuote(text, idx) {
  const from = text.lastIndexOf('\n', idx - 1) + 1;
  const before = text.slice(from, idx);
  for (const q of ["'", '"', '`']) {
    let n = 0;
    for (let k = 0; k < before.length; k++) if (before[k] === q && before[k - 1] !== '\\') n++;
    if (n % 2 === 1) return q;
  }
  return '';
}

/** Чистая: все вызовы в тексте. */
// Строки состояния живут в корне ~/.claude, а не в scripts/ или hooks/.
const STATUSLINE = /\bnode\s+(["']?)([^\s"'`;|&<>()]*?)\.claude\/(statusline-[\w-]+\.mjs)(["']?)/g;
const STATUSLINE_CANON = { 'statusline-jidoka.mjs': 'global-setup/statusline-jidoka.mjs' };

function* matches(all) {
  for (const m of all.matchAll(CALL)) {
    const [, openQ, prefix = '', dir, name, closeQ] = m;
    yield { m, openQ, prefix, closeQ, script: `${dir}/${name}` };
  }
  for (const m of all.matchAll(STATUSLINE)) {
    const [, openQ, prefix = '', name, closeQ] = m;
    yield { m, openQ, prefix: `${prefix}.claude/`, closeQ, script: STATUSLINE_CANON[name] || `scripts/${name}` };
  }
}

export function extract(text, source = '') {
  const calls = [];
  const all = String(text);
  for (const { m, openQ, prefix, closeQ, script } of matches(all)) {
    if (/node_modules/.test(prefix)) continue;
    const start = m.index + m[0].length;
    let tail = all.slice(start, start + 600);
    // кавычка сразу за именем без парной перед путём закрывает саму строку: команда кончилась
    if (closeQ && !openQ) tail = '';
    // имя, склеенное с продолжением (`x.mjs${…}`, `x.mjs:12`, `x.mjs,`), — упоминание, а не вызов
    if (tail && !/^\s/.test(tail)) tail = '';
    const q = enclosingQuote(all, m.index);
    let wrapped = false;
    if (q === '`') {
      const end = tail.indexOf(q);
      // экранированная кавычка (\`) внутри шаблона — тоже конец команды, слэш не часть слова
      if (end >= 0) tail = tail.slice(0, end).replace(/\\$/, '');
      // инлайн-код markdown, перенесённый на другую строку, разобрать надёжно нельзя
      wrapped = /\.md$/.test(source) && tail.includes('\n');
    } else if (q) {
      // "…" или '…': конец — первая НЕэкранированная кавычка; \" внутри — кавычка аргумента
      let end = -1;
      for (let k = 0; k < tail.length; k++) { if (tail[k] === '\\') { k++; continue; } if (tail[k] === q) { end = k; break; } }
      if (end >= 0) tail = tail.slice(0, end);
      tail = tail.split(`\\${q}`).join(q);
    }
    const ws = commandWords(tail);
    const norm = ws.map(normalizeWord);
    const continued = norm.includes(CONTINUED);
    const args = norm.filter((w) => w !== null && w !== CONTINUED);
    const line = all.slice(0, m.index).split('\n').length;
    const eol = tail.indexOf('\n');
    const raw = all.slice(m.index, start + Math.min(eol < 0 ? tail.length : eol, 160)).trim();
    // упоминание: имя скрипта в строке или в `коде` без аргументов — это не вызов
    const mention = args.length === 0 && Boolean(q);
    // неполный вызов: хвост допишет вызывающий (package.json, «…»), или кавычка ушла за строку
    const partial = /(?:^|\/)package\.json$/.test(source) || continued || ws.truncated || wrapped;
    calls.push({ script, prefix, args, source, line, raw, mention, partial });
  }
  return calls;
}

/** Чистая: строки JSON (раскодированные) — команды в JSON записаны с экранированием. */
function jsonStrings(value, acc = []) {
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) for (const v of value) jsonStrings(v, acc);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) jsonStrings(v, acc);
  return acc;
}

export function extractFile(text, source) {
  if (/\.jsonl?$/.test(source)) {
    const out = [];
    const rows = /\.jsonl$/.test(source) ? text.split('\n').map((l, i) => [l, i + 1]) : [[text, 0]];
    for (const [l, n] of rows) {
      if (!l.trim()) continue;
      let v;
      try { v = JSON.parse(l); } catch { continue; }
      for (const str of jsonStrings(v)) for (const c of extract(str, source)) out.push({ ...c, line: n || c.line });
    }
    return out;
  }
  return extract(text, source);
}

const TEXT_FILE = /\.(?:mjs|cjs|js|ts|sh|zsh|bash|json|jsonl|md|ya?ml|txt|toml)$|^(?:pre-commit|pre-push|commit-msg|post-commit|pre-merge-commit|post-merge|prepare-commit-msg|Makefile)$/;
// __tests__ — данные тестов (вызовы вымышленных скриптов), а не места вызова.
// local-hooks — архив хуков ПРОДУКТА в установке (~/.claude/jidoka/local-hooks/<продукт>): их
// `node scripts/x.mjs` зовёт скрипт продукта, и спецификация движка к нему не относится.
const SKIP = /(?:^|\/)(?:node_modules|\.git|\.next|graphify-out|dist|build|coverage|\.worktrees|worktrees|__tests__|local-hooks)(?:\/|$)/;

/** Собрать вызовы из дерева. kind помечает происхождение для отчёта. */
export function collect(root, { kind = 'repo', maxBytes = 2_000_000, skip = null } = {}) {
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      const rel = relative(root, full);
      if (SKIP.test(rel) || (skip && skip.test(rel))) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!TEXT_FILE.test(e) || st.size > maxBytes) continue;
      let text;
      try { text = readFileSync(full, 'utf8'); } catch { continue; }
      if (!/scripts\/|hooks\//.test(text)) continue;
      for (const c of extractFile(text, rel)) out.push({ ...c, kind, root });
    }
  };
  let st;
  try { st = statSync(root); } catch { return out; }
  if (st.isDirectory()) walk(root);
  else {
    const text = readFileSync(root, 'utf8');
    for (const c of extractFile(text, root)) out.push({ ...c, kind, root });
  }
  return out;
}

/**
 * Чистая: исполняемое ли место вызова (его сломанность ломает работу) или история.
 * Живые инструкции (CLAUDE.md, скиллы, команды, README) приравнены к исполняемым:
 * агент копирует их дословно.
 */
export function isLive(source) {
  // спецификации модулей живые (их проверки приёмки исполняет ac-verify-map), брифы волн — история;
  // docs/metrics собирается из спецификаций заново
  if (/(?:^|\/)docs\/(?:retros|audits|research|specs\/briefs|debates|metrics|evals\/runs|runs|proposals|kaizen|archive|reports|decisions|plans)\//.test(source)) return false;
  if (/\.jsonl$/.test(source)) return false;
  return true;
}
