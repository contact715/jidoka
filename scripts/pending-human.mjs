#!/usr/bin/env node
// @closes-class: mechanism-built-human-step-never-taken, state-file-resolved-from-cwd
// @divergence: "повторное объявление НЕ перезаписывает since" — мера «возраст от последнего объявления» говорила «свежий», а правило «шаг ждёт человека с первого объявления» нарушено
// @scope: all
/**
 * pending-human — реестр незакрытых ЧЕЛОВЕЧЕСКИХ шагов, у каждого свой ВОЗРАСТ.
 *
 * Класс, который это закрывает: `mechanism-built-human-step-never-taken`.
 *
 * Замер, породивший механизм (2026-08-17, недельный прогон W34). Обратная ось реестра
 * гейтов (gate-audit#reverseRemedyAudit, построена в W33) семь дней подряд печатала
 * готовый блок регистрации семи живых гейтов. Вставки не было ни разу. Следствие:
 * стартовая сводка звала закрытые классы «живым риском», meta-trend занижал покрытие,
 * и август получил 17 инцидентов при НУЛЕ зарегистрированных гейтов, хотя построено
 * их было семь.
 *
 * Диагноз общий, а не про этот один случай. У нас есть целый род работы, которая
 * построена, доказана и не доведена, потому что последний шаг принадлежит человеку.
 * У такого шага нет ни очереди, ни возраста, ни счётчика: он живёт в выводе одной
 * команды, которую надо не забыть запустить.
 *
 * ЧТО МЕНЯЕТСЯ И ЧТО НЕ МЕНЯЕТСЯ.
 * Не меняется: право записи в L0 (scripts/meta-remedies.mjs) остаётся у человека. Это не
 * недоделка. Агент, который может зарегистрировать себе гейт, может объявить себя
 * безопасным, и вся обратная ось тогда стоит ноль.
 * Меняется: просрочка человеческого шага становится ВИДИМОЙ и измеримой.
 *
 * ГЛАВНОЕ СВОЙСТВО — ВОЗРАСТ СЧИТАЕТСЯ ОТ ПЕРВОГО ОБЪЯВЛЕНИЯ, А НЕ ОТ СЕГОДНЯ.
 * Механизм-производитель зовёт upsert каждый прогон. Если бы `since` перезаписывался,
 * шаг вечно был бы «возрастом ноль дней» и прибор врал бы в успокаивающую сторону —
 * ровно тот класс, против которого этот файл и написан. Поэтому upsertRows НИКОГДА не
 * трогает `since` у уже известного id.
 *
 * ОЧЕРЕДЬ ОДНА, И ЖИВЁТ ОНА В УСТАНОВЛЕННОМ ДВИЖКЕ (класс `state-file-resolved-from-cwd`).
 * Адрес: $JIDOKA_HOME (по умолчанию ~/.claude/jidoka) + docs/audits/_PENDING_HUMAN.jsonl.
 * Туда пишет ежедневная рутина, оттуда читает стартовая сводка. Текущая папка адрес НЕ
 * выбирает: раньше выбирала, и замер 2026-11-11 нашёл четыре файла с этим именем. В каноне
 * 18 шагов против 21 живого, у шести живых шагов копии в каноне не было, а три шага (хук
 * sibling-parity, два кириллических класса) были объявлены ТОЛЬКО в каноне: сводка их не
 * показывала 32–63 дня. Недельные отчёты кайдзен (клон ~/.jidoka-weekly) печатали число
 * из устаревшей копии. Третий путь к той же ошибке: gate-audit --emit-pending из любой
 * папки создавал в ней новую копию. Другой адрес только явным --root (проверки, временные
 * папки). Установки нет — так и сказано, а не «шагов нет»: пустое против пустого не
 * проверка. Записи в несуществующую установку нет: фантомный каталог стал бы ещё одной копией.
 *
 * Использование:
 *   node scripts/pending-human.mjs                 # список открытых, старшие сверху
 *   node scripts/pending-human.mjs --json
 *   node scripts/pending-human.mjs --add '{"id":"...","what":"...","why":"...","source":"..."}'
 *   node scripts/pending-human.mjs --emit '[{...},{...}]'   # идемпотентно, для механизмов
 *   node scripts/pending-human.mjs --close <id> [--by <имя>]
 *   node scripts/pending-human.mjs --absorb <файл>  # влить устаревшую копию, возраст не теряется
 *   node scripts/pending-human.mjs --self-test
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/cli.mjs';

export const LEDGER_REL = 'docs/audits/_PENDING_HUMAN.jsonl';

/**
 * Корень, в котором лежит очередь. Пустая (окружение и домашняя папка передаются).
 * Явный --root побеждает; иначе установленный движок. Текущая папка не участвует НИКОГДА.
 * Имя переменной то же, что у meta-lib (JIDOKA_HOME), чтобы у адреса установки было одно имя.
 */
export function ledgerRoot({ root, env = process.env, home = homedir() } = {}) {
  if (root) return root;
  return env.JIDOKA_HOME || join(home, '.claude', 'jidoka');
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Порог, после которого шаг зовётся просроченным. Ниже — просто ожидание. */
export const OVERDUE_DAYS = 3;

/** Разбор даты вида YYYY-MM-DD или полного ISO. Возвращает мс или NaN. */
export function parseDay(s) {
  if (!s || typeof s !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Схема строки. Обязательны четыре поля, потому что шаг без КАЖДОГО из них не
 * действие, а напоминание:
 *   id     — чтобы механизм мог звать upsert каждый прогон и не плодить дубли
 *   what   — что человек должен СДЕЛАТЬ (глагол, а не название проблемы)
 *   why    — что сломано, пока шаг не сделан (иначе шаг нечем приоритизировать)
 *   source — кто объявил (чтобы можно было проверить, актуально ли ещё)
 * Пустая. Возвращает список нарушений.
 */
export function validateStep(row) {
  const p = [];
  if (!row || typeof row !== 'object') return ['строка не объект'];
  for (const f of ['id', 'what', 'why', 'source']) {
    if (!row[f] || typeof row[f] !== 'string' || !row[f].trim()) p.push(`нет обязательного поля "${f}"`);
  }
  if (row.since !== undefined && Number.isNaN(parseDay(row.since))) p.push('поле "since" не дата вида ГГГГ-ММ-ДД');
  if (row.closedAt !== undefined && Number.isNaN(parseDay(row.closedAt))) p.push('поле "closedAt" не дата вида ГГГГ-ММ-ДД');
  return p;
}

/**
 * Слияние по id. Правила, каждое против конкретной лжи:
 *  - `since` существующей строки НЕ ПЕРЕЗАПИСЫВАЕТСЯ (иначе возраст всегда ноль);
 *  - закрытая строка НЕ ВОСКРЕСАЕТ повторным объявлением того же id: механизм не
 *    знает, что человек уже сделал шаг вручную, и заново открывал бы его вечно;
 *  - порядок первого появления сохраняется, чтобы файл читался как история.
 * Пустая.
 */
export function upsertRows(existing = [], incoming = []) {
  const out = existing.map((r) => ({ ...r }));
  const byId = new Map(out.map((r, i) => [r.id, i]));
  for (const raw of incoming) {
    if (!raw || !raw.id) continue;
    const idx = byId.get(raw.id);
    if (idx === undefined) {
      out.push({ ...raw, since: raw.since || raw.today || todayIso() });
      byId.set(raw.id, out.length - 1);
      continue;
    }
    const prev = out[idx];
    if (prev.closedAt) continue;                       // закрытое не воскрешаем
    out[idx] = { ...prev, ...raw, since: prev.since }; // возраст неприкосновенен
  }
  return out;
}

/** Закрыть шаг. Пустая. Возвращает {rows, closed:boolean}. */
export function closeRow(rows = [], id, atIso, by = 'human') {
  let closed = false;
  const out = rows.map((r) => {
    if (r.id !== id || r.closedAt) return r;
    closed = true;
    return { ...r, closedAt: atIso, closedBy: by };
  });
  return { rows: out, closed };
}

/**
 * Открытые шаги с возрастом, старшие сверху. Пустая.
 * Строка без разбираемого `since` получает возраст null, а не ноль: неизвестное
 * не притворяется свежим.
 */
export function pendingSteps(rows = [], nowIso = todayIso()) {
  const now = parseDay(nowIso);
  return rows
    .filter((r) => r && r.id && !r.closedAt)
    .map((r) => {
      const t = parseDay(r.since);
      const ageDays = Number.isNaN(t) || Number.isNaN(now) ? null : Math.max(0, Math.round((now - t) / DAY_MS));
      return { ...r, ageDays, overdue: ageDays !== null && ageDays >= OVERDUE_DAYS };
    })
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
}

/**
 * Одна строка для стартовой сводки. Пустая строка, если ждать нечего —
 * сводка не должна печатать «0», это шум, который учат пролистывать.
 */
export function digestLine(steps = []) {
  if (!steps.length) return '';
  const oldest = steps[0];
  const age = oldest.ageDays === null ? 'возраст неизвестен' : `старшему ${oldest.ageDays} дн.`;
  const overdue = steps.filter((s) => s.overdue).length;
  const tail = overdue ? `, просрочено ${overdue}` : '';
  return `ждут ЧЕЛОВЕКА: ${steps.length} (${age}${tail}) — node scripts/pending-human.mjs`;
}

/**
 * Свести классы, которые обратная ось реестра гейтов зовёт незарегистрированными, с тем,
 * что реестр шагов уже знает. Пустая.
 *
 * Зачем отдельной функцией: стартовая сводка НИЧЕГО НЕ ПИШЕТ (она стартует в каждой сессии,
 * запись оттуда была бы гонкой между параллельными сессиями), поэтому возраст она может
 * только ПРОЧИТАТЬ. Если ежедневная рутина ещё не наполнила реестр, шаг обязан остаться
 * видимым, но с честным `since: null` — возраст неизвестен, а не ноль. Ноль здесь был бы
 * ложью в успокаивающую сторону, ровно тем, против чего написан весь этот файл.
 */
export function mergeGatePending(classes = [], known = []) {
  const open = known.filter((k) => k && k.id && !k.closedAt);
  const byId = new Map(open.map((k) => [k.id, k]));
  const rows = classes.map((cls) => {
    const id = `register-class:${cls}`;
    return byId.get(id) || {
      id,
      what: `вставить блок регистрации класса "${cls}" в scripts/meta-remedies.mjs`,
      why: 'гейт работает, но метрики его не видят',
      source: 'gate-audit#reverseRemedyAudit',
      since: null,
    };
  });
  const seen = new Set(rows.map((r) => r.id));
  return [...rows, ...open.filter((k) => !seen.has(k.id))];
}

/**
 * Влить устаревшую копию очереди в живую. Пустая. Правила, каждое против конкретной потери:
 *  - шаг, которого живая очередь не знает, добавляется КАК ЕСТЬ, со своим since: это не новое
 *    объявление, и штамп «сегодня» омолодил бы его (а без since возраст честно неизвестен);
 *  - у общего шага since берётся САМЫЙ РАННИЙ: возраст считается от первого объявления, где
 *    бы оно ни случилось (замер 2026-11-11: канон 08-24, живая 08-25);
 *  - текст общего шага берётся из живой очереди: она моложе по содержанию;
 *  - закрытие из копии переносится (человек закрыл шаг там), закрытое в живой не открывается.
 * Возвращает {rows, added, aged, closed}.
 */
export function absorbRows(live = [], other = []) {
  const out = live.map((r) => ({ ...r }));
  const byId = new Map(out.map((r, i) => [r.id, i]));
  let added = 0, aged = 0, closed = 0;
  for (const raw of other) {
    if (!raw || !raw.id) continue;
    const idx = byId.get(raw.id);
    if (idx === undefined) {
      out.push({ ...raw });
      byId.set(raw.id, out.length - 1);
      added++;
      continue;
    }
    const next = { ...out[idx] };
    const mine = parseDay(next.since), theirs = parseDay(raw.since);
    if (!Number.isNaN(theirs) && (Number.isNaN(mine) || theirs < mine)) { next.since = raw.since; aged++; }
    if (!next.closedAt && raw.closedAt) { next.closedAt = raw.closedAt; next.closedBy = raw.closedBy || 'human'; closed++; }
    out[idx] = next;
  }
  return { rows: out, added, aged, closed };
}

export function todayIso(d = new Date()) { return d.toISOString().slice(0, 10); }

// ---------- ввод-вывод (не пустые, поэтому отделены от логики) ----------

/** Строки файла и число битых строк. Битая строка не роняет реестр, но и не прячется. */
export function readRows(p) {
  const rows = [];
  let bad = 0;
  if (!existsSync(p)) return { rows, bad };
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { bad++; }
  }
  return { rows, bad };
}

export function loadLedger(root = ledgerRoot(), rel = LEDGER_REL) {
  return readRows(join(root, rel)).rows;
}

export function saveLedger(rows, root = ledgerRoot(), rel = LEDGER_REL) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  return p;
}

// ---------- самопроверка ----------

function selfTest() {
  const fails = [];
  let checks = 0;
  const ok = (name, cond) => { checks++; if (!cond) fails.push(name); console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const step = (id, since) => ({ id, what: 'вставить блок', why: 'метрики врут', source: 'gate-audit', since });

  ok('дата разбирается', parseDay('2026-08-10') === Date.UTC(2026, 7, 10));
  ok('полный ISO разбирается', parseDay('2026-08-10T12:00:00Z') === Date.UTC(2026, 7, 10));
  ok('мусор не разбирается', Number.isNaN(parseDay('вчера')));
  ok('пустое не разбирается', Number.isNaN(parseDay('')));

  ok('строка без what невалидна', validateStep({ id: 'a', why: 'x', source: 'y' }).length === 1);
  ok('полная строка валидна', validateStep(step('a', '2026-08-10')).length === 0);
  ok('кривая since ловится', validateStep({ ...step('a'), since: 'позавчера' }).some((m) => /since/.test(m)));
  ok('не объект ловится', validateStep(null).length === 1);

  // ГЛАВНОЕ СВОЙСТВО: повторное объявление не омолаживает шаг
  const first = upsertRows([], [step('reg-x', '2026-08-10')]);
  const again = upsertRows(first, [step('reg-x', '2026-08-17')]);
  ok('повторное объявление НЕ перезаписывает since', again[0].since === '2026-08-10');
  ok('повторное объявление не плодит дубль', again.length === 1);
  ok('новый id добавляется', upsertRows(first, [step('reg-y', '2026-08-17')]).length === 2);
  ok('строка без id игнорируется', upsertRows([], [{ what: 'x' }]).length === 0);
  ok('since проставляется, если не дан', upsertRows([], [{ id: 'z', what: 'a', why: 'b', source: 'c' }])[0].since);

  // закрытое не воскресает
  const { rows: closed, closed: didClose } = closeRow(first, 'reg-x', '2026-08-12', 'владелец');
  ok('закрытие проставляет closedAt', closed[0].closedAt === '2026-08-12');
  ok('закрытие возвращает признак', didClose === true);
  ok('закрытие несуществующего не врёт', closeRow(first, 'нет-такого', '2026-08-12').closed === false);
  ok('повторное закрытие не перезаписывает', closeRow(closed, 'reg-x', '2026-08-20').closed === false);
  const resurrect = upsertRows(closed, [step('reg-x', '2026-08-17')]);
  ok('закрытая строка НЕ воскресает повторным объявлением', resurrect[0].closedAt === '2026-08-12');
  ok('воскрешение не плодит дубль', resurrect.length === 1);

  // возраст и порядок
  const steps = pendingSteps([step('a', '2026-08-16'), step('b', '2026-08-10')], '2026-08-17');
  ok('возраст считается в днях', steps[0].ageDays === 7);
  ok('старшие сверху', steps[0].id === 'b');
  ok('свежий не просрочен', steps[1].overdue === false);
  ok('старый просрочен', steps[0].overdue === true);
  ok('закрытые не попадают в открытые', pendingSteps(closed, '2026-08-17').length === 0);
  ok('неразбираемый since даёт null, а не ноль', pendingSteps([step('c', 'когда-то')], '2026-08-17')[0].ageDays === null);

  // слияние с обратной осью реестра гейтов
  const knownRows = [step('register-class:aaa', '2026-08-10'), { ...step('unrelated', '2026-08-01') }];
  const m1 = mergeGatePending(['aaa'], knownRows);
  ok('известный класс сохраняет свой возраст', m1.find((r) => r.id === 'register-class:aaa').since === '2026-08-10');
  ok('посторонний открытый шаг не теряется при слиянии', m1.some((r) => r.id === 'unrelated'));
  const m2 = mergeGatePending(['bbb'], knownRows);
  ok('НЕизвестный класс получает since=null, а не сегодня', m2.find((r) => r.id === 'register-class:bbb').since === null);
  ok('неизвестный возраст печатается как неизвестный, а не как ноль',
    /возраст неизвестен/.test(digestLine(pendingSteps(mergeGatePending(['bbb'], []), '2026-08-17'))));
  ok('закрытый шаг не всплывает при слиянии',
    mergeGatePending([], [{ ...step('done-x', '2026-08-01'), closedAt: '2026-08-02' }]).length === 0);
  ok('пустой вход даёт пустой выход', mergeGatePending([], []).length === 0);

  // строка сводки
  ok('пустой список даёт пустую строку', digestLine([]) === '');
  ok('строка сводки называет число и возраст', /ждут ЧЕЛОВЕКА: 2 \(старшему 7 дн\., просрочено 1\)/.test(digestLine(steps)));
  ok('строка сводки даёт команду', /pending-human\.mjs/.test(digestLine(steps)));
  ok('без просрочки хвост не печатается', !/просрочено/.test(digestLine(pendingSteps([step('a', '2026-08-17')], '2026-08-17'))));

  // ОДИН АДРЕС: текущая папка его не выбирает
  ok('по умолчанию очередь в установленном движке',
    ledgerRoot({ env: {}, home: '/h' }) === join('/h', '.claude', 'jidoka'));
  ok('JIDOKA_HOME переносит адрес установки',
    ledgerRoot({ env: { JIDOKA_HOME: '/x/inst' }, home: '/h' }) === '/x/inst');
  ok('явный --root сильнее установки', ledgerRoot({ root: '/tmp/r', env: { JIDOKA_HOME: '/x' }, home: '/h' }) === '/tmp/r');

  // слияние устаревшей копии
  const liveQ = [step('both', '2026-08-25'), { ...step('live-only', '2026-09-08') }];
  const copyQ = [{ ...step('both', '2026-08-24'), what: 'старый текст' }, step('canon-only', '2026-09-09'),
    { ...step('closed-there', '2026-08-01'), closedAt: '2026-08-05', closedBy: 'владелец' }];
  const ab = absorbRows(liveQ, copyQ);
  ok('у общего шага берётся самый ранний since', ab.rows.find((r) => r.id === 'both').since === '2026-08-24');
  ok('текст общего шага остаётся живым', ab.rows.find((r) => r.id === 'both').what === 'вставить блок');
  ok('шаг только из копии добавляется со своим возрастом', ab.rows.find((r) => r.id === 'canon-only').since === '2026-09-09');
  ok('закрытый в копии шаг приходит закрытым', ab.rows.find((r) => r.id === 'closed-there').closedAt === '2026-08-05');
  ok('счётчики слияния честные', ab.added === 2 && ab.aged === 1 && ab.closed === 0);
  ok('более поздний since копии возраст не омолаживает',
    absorbRows([step('a', '2026-08-01')], [step('a', '2026-09-01')]).rows[0].since === '2026-08-01');
  ok('шаг без since из копии не получает «сегодня»',
    absorbRows([], [{ id: 'n', what: 'a', why: 'b', source: 'c' }]).rows[0].since === undefined);
  const closeThere = absorbRows([step('k', '2026-08-01')], [{ ...step('k', '2026-08-01'), closedAt: '2026-08-03', closedBy: 'владелец' }]);
  ok('закрытие из копии переносится на открытый шаг', closeThere.rows[0].closedAt === '2026-08-03' && closeThere.closed === 1);
  const keepClosed = absorbRows([{ ...step('k', '2026-08-01'), closedAt: '2026-08-02', closedBy: 'a' }], [step('k', '2026-08-01')]);
  ok('закрытое в живой очереди копия не открывает', keepClosed.rows[0].closedAt === '2026-08-02');
  ok('слияние дубль не плодит', absorbRows(liveQ, liveQ).rows.length === liveQ.length);

  const total = checks;
  console.log(`\n${fails.length ? `\x1b[31mpending-human self-test FAILED (${fails.length}): ${fails.join(', ')}\x1b[0m` : `\x1b[32m✓ pending-human self-test: ${total} проверок пройдено\x1b[0m`}`);
  process.exit(fails.length ? 1 : 0);
}

// ---------- запуск ----------

export const CLI = {
  name: 'pending-human',
  summary: 'Очередь человеческих шагов с возрастом: что построено и ждёт решения человека. Без флагов — список, старшие сверху.',
  selfTest: true,
  options: {
    json: { type: 'boolean', desc: 'список открытых шагов в JSON' },
    add: { type: 'string', value: 'json', desc: 'добавить шаг: {"id","what","why","source"}' },
    emit: { type: 'string', value: 'json', desc: 'добавить список шагов идемпотентно (для механизмов)' },
    close: { type: 'string', value: 'id', desc: 'закрыть шаг' },
    by: { type: 'string', value: 'имя', desc: 'кто закрыл (по умолчанию human)' },
    absorb: { type: 'string', value: 'файл', desc: 'влить устаревшую копию очереди: самый ранний since, новые шаги, закрытия; файл не трогается' },
    root: { type: 'string', value: 'папка', desc: 'корень с очередью (по умолчанию установленный движок: $JIDOKA_HOME или ~/.claude/jidoka; текущая папка не участвует)' },
  },
};

/** Где очереди нет — сказать прямо. Отдельно от «шагов нет»: это разные состояния. */
function missingRootText(root, explicit) {
  return explicit
    ? `папки ${root} нет`
    : `установленной копии нет (${root}): очередь живёт только там, другой адрес — явным --root`;
}

function main() {
  const { values, selfTest: wantsSelfTest } = runCli(CLI);
  if (wantsSelfTest) return selfTest();

  const explicit = values.root !== undefined;
  const root = ledgerRoot({ root: values.root });
  const writes = values.add !== undefined || values.emit !== undefined || values.close !== undefined || values.absorb !== undefined;
  if (!existsSync(root)) {
    if (writes) {
      console.error(`pending-human: запись не сделана — ${missingRootText(root, explicit)}. Каталог не создаётся: он стал бы ещё одной копией очереди.`);
      process.exit(2);
    }
    if (values.json) {
      console.error(`pending-human: ${missingRootText(root, explicit)} — пустой список ниже значит «читать неоткуда», а не «шагов нет»`);
      console.log('[]');
      return;
    }
    console.log(`○ pending-human: ${missingRootText(root, explicit)}. Это не «шагов нет»: на этой машине очереди просто не существует.`);
    return;
  }

  if (values.absorb !== undefined) {
    const src = resolve(values.absorb);
    const dst = resolve(join(root, LEDGER_REL));
    if (!existsSync(src)) { console.error(`pending-human: файла ${src} нет`); process.exit(2); }
    if (src === dst) { console.error('pending-human: это и есть живая очередь, вливать нечего'); process.exit(2); }
    const { rows: incoming, bad } = readRows(src);
    const problems = incoming.flatMap((r) => validateStep(r).map((m) => `${r?.id || '?'}: ${m}`));
    if (problems.length) { console.error('строки копии не прошли схему, ничего не влито:\n  ' + problems.join('\n  ')); process.exit(2); }
    const { rows, added, aged, closed } = absorbRows(loadLedger(root), incoming);
    saveLedger(rows, root);
    console.log(`pending-human: из ${src} взято ${added} новых, возраст удлинён у ${aged}, закрытий перенесено ${closed}` +
      `${bad ? `, битых строк пропущено ${bad}` : ''}; источник не тронут, очередь ${dst}`);
    return;
  }

  if (values.add !== undefined || values.emit !== undefined) {
    const raw = values.add || values.emit || '[]';
    let incoming;
    try { incoming = JSON.parse(raw); } catch (e) { console.error(`не разобрал JSON: ${e.message}`); process.exit(2); }
    if (!Array.isArray(incoming)) incoming = [incoming];
    const problems = incoming.flatMap((r) => validateStep(r).map((m) => `${r?.id || '?'}: ${m}`));
    if (problems.length) { console.error('строки не прошли схему:\n  ' + problems.join('\n  ')); process.exit(2); }
    const before = loadLedger(root);
    const after = upsertRows(before, incoming);
    saveLedger(after, root);
    const added = after.length - before.length;
    console.log(`pending-human: ${added} новых, ${incoming.length - added} уже известны (возраст сохранён)`);
    return;
  }

  if (values.close !== undefined) {
    const id = values.close;
    const { rows, closed } = closeRow(loadLedger(root), id, todayIso(), values.by || 'human');
    if (!closed) { console.error(`pending-human: шаг "${id}" не найден или уже закрыт`); process.exit(1); }
    saveLedger(rows, root);
    console.log(`pending-human: закрыт "${id}"`);
    return;
  }

  const steps = pendingSteps(loadLedger(root), todayIso());
  if (values.json) { console.log(JSON.stringify(steps, null, 2)); return; }
  if (!steps.length) { console.log('\x1b[32m✓ pending-human: человеческих шагов в очереди нет\x1b[0m'); return; }
  console.log(`\x1b[33m⚠ ${digestLine(steps)}\x1b[0m\n`);
  for (const s of steps) {
    const age = s.ageDays === null ? '  ?д' : `${String(s.ageDays).padStart(3)}д`;
    console.log(`  ${s.overdue ? '\x1b[31m' : ''}${age}\x1b[0m  ${s.id}`);
    console.log(`        что: ${s.what}`);
    console.log(`        зачем: ${s.why}`);
    console.log(`        объявил: ${s.source}`);
  }
  console.log(`\n  закрыть: node scripts/pending-human.mjs --close <id>`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
