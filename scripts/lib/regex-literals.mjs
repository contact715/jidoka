// regex-literals — найти регулярки в исходнике JavaScript и разобрать, видят ли они кириллицу.
//
// Зачем свой разборщик. Грубый grep по `/…\w…/` (2026-10-10) нашёл около 50 мест, разбор по
// дереву (acorn) нашёл 307: grep отбрасывал всё с флагом `u` (а `u` не лечит `\w`), не видел
// `new RegExp(…)` и регулярки на нескольких строках. Сторожу нужен точный список, а движок
// живёт без зависимостей, поэтому здесь маленький лексер: строки, шаблоны с вложенными `${}`,
// комментарии, литерал регулярки против деления. Сверен с acorn по всему дереву движка.
//
// Чистый модуль: ничего не делает при импорте.

const ID_START = /[\p{ID_Start}$_]/u;
const ID_PART = /[\p{ID_Continue}$‌‍]/u;
// После этих слов `/` начинает регулярку, а не деление.
const EXPR_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
/** Место вставки `${…}` в шаблоне: содержимое неизвестно, значит может быть любой буквой. */
export const INTERP = '';

/** Значение строкового литерала: `'\\b'` в исходнике это `\b` в регулярке. */
function cook(raw) {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (m, e) => {
    if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r\n': '', '\r': '' }[e] ?? e;
  });
}

/**
 * Лексер. Токены: id, num, str, tpl (шаблон целиком, с кусками), re, p (знак).
 * Внутренности `${…}` выдаются обычными токенами: регулярка внутри шаблона тоже регулярка.
 * @param {string} src
 */
export function tokenize(src = '') {
  const s = String(src);
  /** @type {any[]} */ const out = [];
  /** @type {any[]} */ const stack = []; // 'brace' | объект шаблона, ожидающий `}`
  let i = 0, line = 1;
  if (s.startsWith('#!')) { while (i < s.length && s[i] !== '\n') i++; }
  const prevSig = () => out[out.length - 1];
  const regexAllowed = () => {
    const p = prevSig();
    if (!p) return true;
    if (p.t === 'p') return !(p.v === ')' || p.v === ']' || p.v === '++' || p.v === '--');
    if (p.t === 'id') return EXPR_KEYWORDS.has(p.v);
    return false; // num, str, tpl, re
  };
  const count = (from, to) => { for (let k = from; k < to; k++) if (s[k] === '\n') line++; };

  /** Кусок шаблона от текущей позиции до `${` или закрывающей кавычки. */
  const scanQuasi = (tpl) => {
    const start = i;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '`') break;
      if (s[i] === '$' && s[i + 1] === '{') break;
      i++;
    }
    const raw = s.slice(start, i);
    tpl.raw.push(raw); tpl.cooked.push(cook(raw));
    count(start, i);
    // Служебные знаки: после `${` косая черта открывает регулярку (`${/x/.test(s)}`), после
    // конца шаблона — это деление, шаблон уже значение.
    if (s[i] === '`') { i++; out.push({ t: 'tplend', line }); tpl.end = out.length; return; }
    if (s[i] === '$') { i += 2; out.push({ t: 'p', v: '${', line }); stack.push(tpl); }
  };

  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); const end = e < 0 ? s.length : e + 2; count(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      const start = i++;
      while (i < s.length && s[i] !== c && s[i] !== '\n') i += s[i] === '\\' ? 2 : 1;
      const raw = s.slice(start + 1, i);
      out.push({ t: 'str', v: cook(raw), line });
      count(start, i);
      if (s[i] === c) i++;
      continue;
    }
    if (c === '`') {
      const tpl = { t: 'tpl', raw: [], cooked: [], line, end: -1 };
      out.push(tpl); i++;
      scanQuasi(tpl);
      continue;
    }
    if (c === '}' && stack.length && stack[stack.length - 1] !== 'brace') { const tpl = stack.pop(); i++; scanQuasi(tpl); continue; }
    if (c === '{') { stack.push('brace'); out.push({ t: 'p', v: c, line }); i++; continue; }
    if (c === '}') { stack.pop(); out.push({ t: 'p', v: c, line }); i++; continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false, ok = false;
      while (j < s.length && s[j] !== '\n') {
        const d = s[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        let k = j + 1; while (k < s.length && /[a-z]/.test(s[k])) k++;
        out.push({ t: 're', pattern: s.slice(i + 1, j), flags: s.slice(j + 1, k), line });
        i = k; continue;
      }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const start = i; while (i < s.length && /[0-9a-zA-Z_.]/.test(s[i])) i++;
      out.push({ t: 'num', v: s.slice(start, i), line }); continue;
    }
    const cp = String.fromCodePoint(s.codePointAt(i) || 0);
    if (ID_START.test(cp) || c === '#' || c === '\\') {
      const start = i; i += cp.length;
      while (i < s.length) { const q = String.fromCodePoint(s.codePointAt(i) || 0); if (!ID_PART.test(q)) break; i += q.length; }
      out.push({ t: 'id', v: s.slice(start, i), line }); continue;
    }
    if ((c === '+' || c === '-') && s[i + 1] === c) { out.push({ t: 'p', v: c + c, line }); i += 2; continue; }
    out.push({ t: 'p', v: c, line }); i += cp.length;
  }
  return out;
}

/** Собрать текст первого аргумента RegExp(…) из литералов. null — собран из переменных целиком. */
function argPattern(toks, k) {
  let pat = '', literal = false, depth = 0, j = k;
  const end = (t) => t && t.t === 'p' && (t.v === ',' || t.v === ')') && depth === 0;
  const skipTpl = (t) => (t.end > j ? t.end : toks.length); // незакрытый шаблон — до конца
  const interp = () => { if (!pat.endsWith(INTERP)) pat += INTERP; };
  while (j < toks.length && !end(toks[j])) {
    const t = toks[j];
    // Внутри вложенных скобок (вызов, массив без .join) всё — вставка: строки там аргументы
    // других функций, а не куски регулярки.
    if (depth > 0) {
      if (t.t === 'p' && '([{'.includes(t.v)) depth++;
      else if (t.t === 'p' && ')]}'.includes(t.v)) depth--;
      j = t.t === 'tpl' ? skipTpl(t) : j + 1;
      continue;
    }
    if (t.t === 'str') { pat += t.v; literal = true; j++; continue; }
    if (t.t === 'tpl') { pat += t.cooked.join(INTERP); literal = true; j = skipTpl(t); continue; }
    if (t.t === 'id' && t.v === 'String' && toks[j + 1]?.v === '.' && toks[j + 2]?.v === 'raw' && toks[j + 3]?.t === 'tpl') {
      pat += toks[j + 3].raw.join(INTERP); literal = true; j = skipTpl(toks[j + 3]); continue;
    }
    // [ 'a', 'b' ].join('|') — регулярка из списка вариантов (NOT_CHECKED_RE, SYNTHESIS_NAME)
    if (t.t === 'p' && t.v === '[') {
      const parts = []; let m = j + 1;
      while (toks[m]?.t === 'str') { parts.push(toks[m].v); m++; if (toks[m]?.v === ',') m++; }
      if (toks[m]?.v === ']' && toks[m + 1]?.v === '.' && toks[m + 2]?.v === 'join' && toks[m + 3]?.v === '(' && toks[m + 4]?.t === 'str' && toks[m + 5]?.v === ')') {
        pat += parts.join(toks[m + 4].v); literal = true; j = m + 6; continue;
      }
    }
    if (t.t === 'p' && t.v === '+') { j++; continue; }
    if (t.t === 'p' && '([{'.includes(t.v)) depth++;
    interp();
    j++;
  }
  const flagsTok = toks[j]?.v === ',' ? toks[j + 1] : null;
  return { pat: literal ? pat : null, flags: flagsTok ? (flagsTok.t === 'str' ? flagsTok.v : '?') : '' };
}

/**
 * Все регулярки исходника: литералы и `RegExp(…)` / `new RegExp(…)`.
 * kind: 'literal' | 'RegExp' | 'dynamic' (аргумент целиком из переменных — разобрать нельзя).
 * @param {string} src
 * @returns {Array<{line:number, pattern:string|null, flags:string, kind:string}>}
 */
export function extractRegexes(src = '') {
  const toks = tokenize(src);
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 're') { out.push({ line: t.line, pattern: t.pattern, flags: t.flags, kind: 'literal' }); continue; }
    if (t.t === 'id' && t.v === 'RegExp' && toks[k + 1]?.v === '(' && toks[k - 1]?.v !== '.') {
      const { pat, flags } = argPattern(toks, k + 2);
      out.push({ line: t.line, pattern: pat, flags, kind: pat == null ? 'dynamic' : 'RegExp' });
    }
  }
  return out;
}

// ─── разбор самой регулярки ──────────────────────────────────────────────────────────────
// Вид символа, который атом может съесть:
//   A — латинская буква, цифра или `_` (то, что `\w` и `\b` считают буквой)
//   U — буква другого алфавита, записанная прямо в регулярке (кириллица)
//   W — `\w`: только латиница, хотя выглядит как «любая буква»
//   X — что угодно, включая кириллицу (`.`, `[^…]`, `\S`, `\p{L}`, вставка `${…}`)
//   N — не буква (пробел, знак)
const charKind = (ch) => (/[A-Za-z0-9_]/.test(ch) ? 'A' : /[\p{L}\p{N}\p{M}]/u.test(ch) ? 'U' : 'N');

function rangeKinds(lo, hi) {
  const k = new Set();
  const a = lo.codePointAt(0) || 0, b = hi.codePointAt(0) || 0;
  const asciiHi = Math.min(b, 0x7f);
  for (let x = a; x <= asciiHi; x++) k.add(charKind(String.fromCharCode(x)));
  if (b > 0x7f) k.add('U');
  return k;
}

/** Разобрать текст регулярки в дерево: альтернативы → последовательности → атомы. */
export function parsePattern(p) {
  let i = 0;
  /** @type {any[]} */ const words = []; // все \w \W \b \B: { tok, node }
  function escAtom(n) {
    const pos = i - 2;
    if (n === 'b' || n === 'B') { const node = { kind: 'zero', boundary: n, pos }; words.push({ tok: '\\' + n, node }); return node; }
    if (n === 'w') { const node = { kind: 'set', kinds: new Set(['W']), pos }; words.push({ tok: '\\w', node }); return node; }
    if (n === 'W') { const node = { kind: 'set', kinds: new Set(['X']), pos }; words.push({ tok: '\\W', node }); return node; }
    if (n === 'd') return { kind: 'set', kinds: new Set(['A']) };
    if (n === 's') return { kind: 'set', kinds: new Set(['N']) };
    if (n === 'D' || n === 'S') return { kind: 'set', kinds: new Set(['X']) };
    if (n === 'p' || n === 'P') { if (p[i] === '{') i = p.indexOf('}', i) + 1 || p.length; return { kind: 'set', kinds: new Set(['X']) }; }
    if (n === 'k') { if (p[i] === '<') i = p.indexOf('>', i) + 1 || p.length; return { kind: 'set', kinds: new Set(['X']) }; }
    if (/[1-9]/.test(n || '')) { while (/[0-9]/.test(p[i] || '')) i++; return { kind: 'set', kinds: new Set(['X']) }; }
    if (n === 'x') { const ch = String.fromCharCode(parseInt(p.slice(i, i + 2), 16)); i += 2; return { kind: 'set', kinds: new Set([charKind(ch)]) }; }
    if (n === 'u') {
      const m = /^\{([0-9a-fA-F]+)\}|^([0-9a-fA-F]{4})/.exec(p.slice(i));
      if (m) { i += m[0].length; return { kind: 'set', kinds: new Set([charKind(String.fromCodePoint(parseInt(m[1] || m[2], 16)))]) }; }
    }
    if (n === 'c') { i++; return { kind: 'set', kinds: new Set(['N']) }; }
    if ('nrtfv0'.includes(n)) return { kind: 'set', kinds: new Set(['N']) };
    return { kind: 'set', kinds: new Set([charKind(n || '')]) };
  }
  function parseClass() {
    i++; // [
    const negated = p[i] === '^'; if (negated) i++;
    const kinds = new Set();
    /** @type {any} */ const node = { kind: 'set', kinds };
    while (i < p.length && p[i] !== ']') {
      let lo;
      if (p[i] === '\\') {
        const n = p[i + 1]; i += 2;
        if (n === 'w') { kinds.add('W'); words.push({ tok: '\\w', node, inClass: true }); continue; }
        if (n === 'W' || n === 'S' || n === 'D' || n === 'p' || n === 'P') {
          if ((n === 'p' || n === 'P') && p[i] === '{') i = p.indexOf('}', i) + 1 || p.length;
          if (n === 'W') words.push({ tok: '\\W', node, inClass: true });
          kinds.add('X'); continue;
        }
        if (n === 'd') { kinds.add('A'); continue; }
        if (n === 's' || n === 'b') { kinds.add('N'); continue; }
        lo = n === 'u' && /^[0-9a-fA-F]{4}/.test(p.slice(i)) ? (i += 4, String.fromCharCode(parseInt(p.slice(i - 4, i), 16)))
          : n === 'x' ? (i += 2, String.fromCharCode(parseInt(p.slice(i - 2, i), 16)))
          : 'nrtfv0'.includes(n) ? ' ' : n;
      } else { lo = String.fromCodePoint(p.codePointAt(i) || 0); i += lo.length; }
      if (p[i] === '-' && p[i + 1] && p[i + 1] !== ']') {
        i++;
        let hi;
        if (p[i] === '\\') { const n = p[i + 1]; i += 2; hi = n === 'u' ? (i += 4, String.fromCharCode(parseInt(p.slice(i - 4, i), 16))) : n === 'x' ? (i += 2, String.fromCharCode(parseInt(p.slice(i - 2, i), 16))) : n; }
        else { hi = String.fromCodePoint(p.codePointAt(i) || 0); i += hi.length; }
        for (const k of rangeKinds(lo, hi)) kinds.add(k);
      } else kinds.add(charKind(lo));
    }
    i++; // ]
    if (negated) { kinds.clear(); kinds.add('X'); }
    return node;
  }
  function parseAtom() {
    const c = p[i];
    if (c === '(') {
      i++;
      let look = false;
      if (p[i] === '?') {
        if (p[i + 1] === ':') i += 2;
        else if (p[i + 1] === '=' || p[i + 1] === '!') { look = true; i += 2; }
        else if (p[i + 1] === '<' && (p[i + 2] === '=' || p[i + 2] === '!')) { look = true; i += 3; }
        else if (p[i + 1] === '<') { const e = p.indexOf('>', i); i = e < 0 ? p.length : e + 1; }
        else i += 1;
      }
      const alts = parseAlts(true);
      if (p[i] === ')') i++;
      return look ? { kind: 'zero', alts } : { kind: 'group', alts };
    }
    if (c === '[') return parseClass();
    if (c === '\\') { const n = p[i + 1]; i += 2; return escAtom(n); }
    if (c === '^' || c === '$') { i++; return { kind: 'zero' }; }
    if (c === '.' || c === INTERP) { i++; return { kind: 'set', kinds: new Set(['X']) }; }
    const ch = String.fromCodePoint(p.codePointAt(i) || 0); i += ch.length;
    return { kind: 'set', kinds: new Set([charKind(ch)]) };
  }
  function parseQuant(atom) {
    const m = /^(?:[*?]|\+|\{\d+(?:,\d*)?\})\??/.exec(p.slice(i));
    if (!m) return;
    i += m[0].length;
    if (m[0][0] === '*' || m[0][0] === '?' || /^\{0[,}]/.test(m[0])) atom.min0 = true;
  }
  function parseAlts(inGroup) {
    const alts = [[]];
    while (i < p.length) {
      const c = p[i];
      if (c === ')') { if (inGroup) break; i++; continue; }
      if (c === '|') { alts.push([]); i++; continue; }
      const atom = parseAtom();
      parseQuant(atom);
      alts[alts.length - 1].push(atom);
    }
    return alts;
  }
  const alts = parseAlts(false);
  return { alts, words };
}

const nullable = (a) => a.kind === 'zero' || a.min0 || (a.kind === 'group' && a.alts.some((s) => s.every(nullable)));
const firstOf = (a) => (a.kind === 'set' ? a.kinds : a.kind === 'group' ? union(...a.alts.map((s) => edge(s, 0, 1, () => new Set()))) : new Set());
const lastOf = (a) => (a.kind === 'set' ? a.kinds : a.kind === 'group' ? union(...a.alts.map((s) => edge(s, s.length - 1, -1, () => new Set()))) : new Set());
function union(...sets) { const u = new Set(); for (const s of sets) for (const x of s) u.add(x); return u; }
/** Что может стоять в seq начиная с from в сторону dir; дошли до края — спросить у родителя. */
function edge(seq, from, dir, outer) {
  const acc = new Set();
  for (let k = from; k >= 0 && k < seq.length; k += dir) {
    for (const x of dir > 0 ? firstOf(seq[k]) : lastOf(seq[k])) acc.add(x);
    if (!nullable(seq[k])) return acc;
  }
  for (const x of outer()) acc.add(x);
  return acc;
}

/**
 * Каждому `\w` `\W` `\b` `\B` вердикт:
 *   definite — рядом записана кириллица: правило гарантированно не работает на русском тексте;
 *   decide   — регулярка может встретить кириллицу, решает человек (`\p{L}` или метка с причиной);
 *   safe     — граница стоит у латинской буквы, записанной в самой регулярке (латинский якорь).
 * @param {string} pattern
 */
export function analyzePattern(pattern) {
  const { alts, words } = parsePattern(String(pattern));
  /** @type {Map<any, {seq:any[], idx:number, before:()=>Set<string>, after:()=>Set<string>}>} */
  const where = new Map();
  const OUT = () => new Set(['OUT']);
  (function walk(seqs, before, after) {
    for (const seq of seqs) {
      seq.forEach((node, idx) => {
        const b = () => edge(seq, idx - 1, -1, before);
        const a = () => edge(seq, idx + 1, 1, after);
        where.set(node, { seq, idx, before: b, after: a });
        // Содержимое группы и проверки вида (?<!…) / (?=…) стоит в той же точке строки,
        // поэтому его соседи — соседи самой группы.
        if (node.alts) walk(node.alts, b, a);
      });
    }
  })(alts, OUT, OUT);

  const onlyLatin = (s) => s.size > 0 && [...s].every((x) => x === 'A');
  return words.map(({ tok, node, inClass }) => {
    const w = where.get(node);
    const before = w ? w.before() : new Set(['OUT']), after = w ? w.after() : new Set(['OUT']);
    const near = union(before, after);
    if (tok === '\\b' || tok === '\\B') {
      // Сначала якорь: если с одной стороны заведомо латинская буква или цифра, граница
      // определена при любом соседе (`\D{0,20}\b(\d+)` после «проверок» — начало числа).
      // Немеет `\b` только когда с другой стороны пробел или неизвестное, а рядом кириллица.
      if (onlyLatin(before) || onlyLatin(after)) return { tok, verdict: 'safe', why: 'латинский якорь' };
      if (near.has('U')) return { tok, verdict: 'definite', why: `${tok} рядом с кириллицей: граница считается по латинице, на русском слове правило молчит` };
      return { tok, verdict: 'decide', why: `${tok} рядом с тем, что может быть русской буквой` };
    }
    // \w \W: класс, где кириллица записана явно ([а-яё\w]), автор кириллицу уже учёл
    if (inClass && node.kinds.has('U')) return { tok, verdict: 'safe', why: 'кириллица в том же классе' };
    if (near.has('U')) return { tok, verdict: 'definite', why: `${tok} рядом с кириллицей: русское окончание не войдёт, слово целиком не найдётся` };
    return { tok, verdict: 'decide', why: `${tok} считает буквой только латиницу` };
  });
}
