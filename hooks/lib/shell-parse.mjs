// shell-parse — чтение строки оболочки в простые команды со словами и признаками слов.
//
// Каждое слово несёт два признака: dyn — в нём есть подстановка ($VAR, ${…}, $(…), `…`), и
// unq — подстановка стоит БЕЗ кавычек. Второй признак нужен правилам: значение без кавычек
// может исчезнуть целиком, и `git stash drop $REF` при пустой переменной становится голым
// `git stash drop` (находка красной команды 2026-09-17).
//
// Команда: { argv: string[], words: {text, dyn, unq}[], stdin: {text, quoted}[], pipedFrom }.
// pipedFrom — команда слева от `|`: её вывод станет входом этой.
//
// Чистый модуль, при импорте ничего не делает. Бросает только ShellDepthError — когда
// вложенность подстановок глубже MAX_NESTING; вызывающий обязан считать такую строку
// неразобранной, а не чистой.

export class ShellDepthError extends Error {}

const MAX_NESTING = 256;
const UNQ = 'unquoted';
const QDYN = 'quoted';
const VAR_START = /[A-Za-z_{0-9@*#?$!-]/;
const ANSI_SIMPLE = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v' };

class Frame {
  constructor(arith) {
    this.parenDepth = 0;
    this.inArith = arith; // внутри (( … )) знак << это сдвиг, а не heredoc
    this.arithBase = 0;
    this.pending = []; // heredoc, чьё тело начнётся со следующей строки
    this.cur = null;
    this.skipNext = false; // следующее слово — цель перенаправления
    this.hereStr = false; // следующее слово — herestring, вход команды
    this.startCommand(null);
  }

  startCommand(pipedFrom) {
    this.words = [];
    this.cmd = { argv: [], words: this.words, stdin: [], pipedFrom };
  }
}

class Parser {
  constructor(s, out, nesting = 0) {
    this.s = s;
    this.i = 0;
    this.out = out;
    this.nesting = nesting;
  }

  run(mode) {
    if (mode === 'heredoc') this.readDouble(null);
    else this.parse(null, false);
  }

  substitution(stop, arith) {
    if (++this.nesting > MAX_NESTING) throw new ShellDepthError(`вложенность глубже ${MAX_NESTING}`);
    try { this.parse(stop, arith); } finally { this.nesting--; }
  }

  parse(stop, arith) {
    const f = new Frame(arith);
    const { s } = this;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === stop && (stop === '`' || f.parenDepth === 0)) { this.i++; this.endCmd(f, null); return; }
      if (this.quoteOrExpansion(f, c)) continue;
      if (c === '#' && f.cur === null) { this.skipComment(); continue; }
      if (c === '\n') { this.i++; this.endCmd(f, null); this.readHeredocBodies(f, stop); continue; }
      if (c === ' ' || c === '\t' || c === '\r') { this.pushWord(f); this.i++; continue; }
      if (c === '(' || c === ')') { this.paren(f, c); continue; }
      if (this.operator(f, c)) continue;
      this.add(f, c);
      this.i++;
    }
    this.endCmd(f, null);
  }

  quoteOrExpansion(f, c) {
    const { s } = this;
    const nx = s[this.i + 1];
    if (c === '\\') {
      if (nx !== '\n' && nx !== undefined) this.add(f, nx);
      this.i += 2;
      return true;
    }
    if (c === "'") {
      const j = s.indexOf("'", this.i + 1);
      const end = j < 0 ? s.length : j;
      this.add(f, s.slice(this.i + 1, end));
      this.i = end + 1;
      return true;
    }
    if (c === '$' && nx === "'") { this.i += 2; this.add(f, this.readAnsiC()); return true; }
    if (c === '"' || (c === '$' && nx === '"')) {
      this.i += c === '"' ? 1 : 2;
      const r = this.readDouble('"');
      this.add(f, r.text, r.dyn ? QDYN : null);
      return true;
    }
    if (c === '$' && nx === '(') { this.i += 2; this.substitution(')', s[this.i] === '('); this.add(f, '$(…)', UNQ); return true; }
    if (c === '`') { this.i++; this.substitution('`', false); this.add(f, '`…`', UNQ); return true; }
    if ((c === '<' || c === '>') && nx === '(' && !f.inArith) { this.i += 2; this.substitution(')', false); this.add(f, '<(…)', UNQ); return true; }
    if (c === '$' && nx !== undefined && VAR_START.test(nx)) { this.add(f, '$', UNQ); this.i++; return true; }
    return false;
  }

  // Двойные кавычки (term = '"') или тело heredoc без кавычек у ограничителя (term = null).
  readDouble(term) {
    const { s } = this;
    let text = '';
    let dyn = false;
    while (this.i < s.length) {
      const ch = s[this.i];
      const nx = s[this.i + 1];
      if (term && ch === term) { this.i++; break; }
      if (ch === '\\') {
        if (nx === '\n') { this.i += 2; continue; }
        if (nx !== undefined && '$`"\\'.includes(nx)) { text += nx; this.i += 2; continue; }
        text += ch;
        this.i++;
        continue;
      }
      if (ch === '$' && nx === '(') { this.i += 2; this.substitution(')', s[this.i] === '('); text += '$(…)'; dyn = true; continue; }
      if (ch === '`') { this.i++; this.substitution('`', false); text += '`…`'; dyn = true; continue; }
      if (ch === '$' && nx !== undefined && VAR_START.test(nx)) dyn = true;
      text += ch;
      this.i++;
    }
    return { text, dyn };
  }

  readAnsiC() {
    const { s } = this;
    let val = '';
    while (this.i < s.length && s[this.i] !== "'") {
      if (s[this.i] !== '\\') { val += s[this.i]; this.i++; continue; }
      const tail = s.slice(this.i + 1, this.i + 10);
      const m = /^(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3}))/.exec(tail);
      if (m) {
        const cp = m[1] ? parseInt(m[1], 16) : m[2] ? parseInt(m[2], 16) : m[3] ? parseInt(m[3], 16) : parseInt(m[4], 8);
        val += cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
        this.i += 1 + m[0].length;
        continue;
      }
      const nx = s[this.i + 1] ?? '';
      val += ANSI_SIMPLE[nx] ?? nx;
      this.i += 2;
    }
    this.i++;
    return val;
  }

  add(f, text, kind = null) {
    if (f.cur === null) f.cur = { text: '', dyn: false, unq: false };
    f.cur.text += text;
    if (kind === UNQ) { f.cur.dyn = true; f.cur.unq = true; }
    if (kind === QDYN) f.cur.dyn = true;
  }

  pushWord(f) {
    const w = f.cur;
    if (w === null) return;
    f.cur = null;
    if (f.skipNext) { f.skipNext = false; return; }
    if (f.hereStr) { f.hereStr = false; f.cmd.stdin.push({ text: w.text, quoted: true }); return; }
    f.words.push(w);
  }

  endCmd(f, sep) {
    this.pushWord(f);
    f.skipNext = false;
    f.hereStr = false;
    const { cmd } = f;
    const keep = cmd.words.length > 0 || cmd.stdin.length > 0;
    if (keep) {
      cmd.argv = cmd.words.map((w) => w.text);
      this.out.push(cmd);
    }
    f.startCommand(sep === '|' && keep ? cmd : null);
  }

  skipComment() {
    while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++;
  }

  paren(f, c) {
    if (c === '(') {
      if (!f.inArith && this.s[this.i + 1] === '(' && f.cur === null && f.words.length === 0) {
        f.inArith = true;
        f.arithBase = f.parenDepth;
      }
      f.parenDepth++;
    } else if (f.parenDepth > 0) {
      f.parenDepth--;
      if (f.inArith && f.parenDepth === f.arithBase) f.inArith = false;
    }
    this.endCmd(f, null);
    this.i++;
  }

  operator(f, c) {
    const { s } = this;
    const nx = s[this.i + 1];
    if (c === '&' && nx === '>') {
      this.pushWord(f);
      this.i += s[this.i + 2] === '>' ? 3 : 2;
      f.skipNext = true;
      return true;
    }
    if (c === '|' && nx !== '|') { this.endCmd(f, '|'); this.i += nx === '&' ? 2 : 1; return true; }
    if (c === ';' || c === '&' || c === '|') {
      this.endCmd(f, null);
      this.i++;
      while (';&|'.includes(s[this.i] ?? '#')) this.i++;
      return true;
    }
    if (c !== '<' && c !== '>') return false;
    if (f.inArith) return false; // сравнение и сдвиг внутри (( … ))
    if (c === '<' && nx === '<' && s[this.i + 2] === '<') { this.pushWord(f); this.i += 3; f.hereStr = true; return true; }
    if (c === '<' && nx === '<') { this.heredocOperator(f); return true; }
    this.redirect(f);
    return true;
  }

  redirect(f) {
    const w = f.cur;
    // номер дескриптора перед оператором (2>, 1>>) — часть оператора, а не слово
    if (w !== null && !w.dyn && /^\d+$/.test(w.text)) f.cur = null;
    else this.pushWord(f);
    this.i++;
    while ('>&|'.includes(this.s[this.i] ?? '#')) this.i++;
    f.skipNext = true;
  }

  heredocOperator(f) {
    const { s } = this;
    this.pushWord(f);
    this.i += 2;
    const strip = s[this.i] === '-';
    if (strip) this.i++;
    while (s[this.i] === ' ' || s[this.i] === '\t') this.i++;
    const { delim, quoted } = this.readHeredocDelimiter();
    if (delim) f.pending.push({ delim, strip, quoted, cmd: f.cmd });
  }

  readHeredocDelimiter() {
    const { s } = this;
    let delim = '';
    let quoted = false;
    while (this.i < s.length && !/[\s;&|<>()]/.test(s[this.i])) {
      const ch = s[this.i];
      if (ch === "'" || ch === '"') {
        quoted = true;
        const j = s.indexOf(ch, this.i + 1);
        const end = j < 0 ? s.length : j;
        delim += s.slice(this.i + 1, end);
        this.i = end + 1;
        continue;
      }
      if (ch === '\\') { quoted = true; delim += s[this.i + 1] ?? ''; this.i += 2; continue; }
      delim += ch;
      this.i++;
    }
    return { delim, quoted };
  }

  // Тело heredoc: строки до ограничителя, сравнение ТОЧНОЕ (пробел в конце — уже не ограничитель).
  readHeredocBodies(f, stop) {
    while (f.pending.length) {
      const h = f.pending.shift();
      const { text, closedSubstitution } = this.readOneBody(h, stop);
      h.cmd.stdin.push({ text, quoted: h.quoted });
      if (!h.quoted) this.expandHeredoc(text);
      if (closedSubstitution) f.pending.length = 0;
    }
  }

  readOneBody(h, stop) {
    const { s } = this;
    const lines = [];
    while (this.i < s.length) {
      const start = this.i;
      let nl = s.indexOf('\n', start);
      if (nl < 0) nl = s.length;
      const line = s.slice(start, nl);
      const tabs = h.strip ? /^\t*/.exec(line)[0].length : 0;
      const probe = line.slice(tabs);
      if (probe === h.delim || probe === `${h.delim}\r`) {
        this.i = Math.min(nl + 1, s.length);
        return { text: lines.join('\n'), closedSubstitution: false };
      }
      // bash: внутри $( … ) строка «EOF)» закрывает и heredoc, и подстановку
      if (stop === ')' && probe.startsWith(`${h.delim})`)) {
        this.i = start + tabs + h.delim.length;
        return { text: lines.join('\n'), closedSubstitution: true };
      }
      lines.push(line);
      this.i = Math.min(nl + 1, s.length);
    }
    return { text: lines.join('\n'), closedSubstitution: false };
  }

  // Тело heredoc без кавычек у ограничителя: команд в нём нет, но $(…) и `…` исполняются.
  expandHeredoc(text) {
    new Parser(text, this.out, this.nesting + 1).run('heredoc');
  }
}

/** Прочитать строку оболочки в простые команды. Бросает только ShellDepthError. */
export function parseScript(src) {
  const out = [];
  new Parser(String(src ?? ''), out).run('script');
  return out;
}
