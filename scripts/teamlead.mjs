#!/usr/bin/env node
// @closes-class: conflict-found-but-nobody-acted
// @scope: all
// @scope-ok: роль тимлида по определению смотрит на ВСЕ сессии машины
/**
 * teamlead — сводит доску сессий с перепиской и говорит, что с найденным СДЕЛАНО.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ СЛОЙ. Доска (слой B) находит пересечение. Почта (слой C) даёт разговор. Но
 * между ними остаётся дыра, которая и делает тимлида нужным: **найденный конфликт и конфликт,
 * с которым что-то сделали, — разные вещи.** Прибор, который каждый день печатает один и тот
 * же список столкновений, обучает его пролистывать. Ровно так у нас девять классов ждут
 * регистрации семь дней подряд и десять человеческих шагов просрочены.
 *
 * ЧТО СЧИТАЕТСЯ ДЕЙСТВИЕМ. Между парой сессий есть вопрос `claim-query` по спорному предмету:
 *   - вопроса нет вовсе        → `unasked`  (никто не пошевелился, это главный случай)
 *   - вопрос есть, ответа нет  → `waiting`  (пошевелились, ждём; со временем протухает)
 *   - есть ответ               → `resolved` (договорились, спор закрыт)
 *
 * ЧЕГО ЭТОТ СЛОЙ НЕ ДЕЛАЕТ, И ЭТО НАЗВАНО ЧЕСТНО:
 *   - не блокирует и никого не убивает (те же инварианты, что у доски);
 *   - не судит КАЧЕСТВО чужой работы. Проверка «прогонял ли сосед гейты» требует свидетельств,
 *     которых у нас на сессию нет; выдавать за неё проверку наличия коммита было бы ложным
 *     зелёным. Сегодня качество здесь ограничено одним честным признаком: незакоммиченная
 *     работа, стареющая в общей копии, — она уже стоила нам стёртой чужой правки 2026-08-22.
 *
 * Использование:
 *   node scripts/teamlead.mjs                 # сводка: что найдено и что с этим сделано
 *   node scripts/teamlead.mjs --escalate      # только то, что требует человека; код 1 если есть
 *   node scripts/teamlead.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBoard, conflicts, isStale } from './session-board.mjs';
import { readMail, unanswered } from './session-mail.mjs';
import { readReceipts, treeFingerprint, classifyReceipt } from './gate-receipt.mjs';

/** Сколько вопрос может ждать ответа, прежде чем это станет делом человека. */
export const WAITING_LIMIT_MS = 30 * 60 * 1000;
/** Сколько незакоммиченная работа может стареть, прежде чем это станет риском. */
export const DIRTY_LIMIT_MS = 4 * 60 * 60 * 1000;

/**
 * Обоснованность работы сессии: есть ли доказательство прогона гейтов НА ТЕКУЩЕМ коде.
 * Чистая функция — проверяется без git и без файлов.
 *
 * Намеренно НЕ решает, какие гейты обязательны: набор разный у движка, у продукта и у сайта,
 * и зашить один список значило бы врать в двух проектах из трёх. Здесь отвечают на более
 * скромный и честный вопрос: есть ли вообще основание под тем, что лежит в копии сейчас.
 */
export function provenanceFor(session, receipts, currentFingerprint) {
  const mine = (receipts || []).filter((r) => r && (r.session === session.session || r.cwd === session.worktree));
  const out = { fresh: 0, stale: 0, failed: 0, gates: [] };
  const latest = new Map();
  for (const r of mine) {
    const prev = latest.get(r.gate);
    if (!prev || (r.at || 0) > (prev.at || 0)) latest.set(r.gate, r);
  }
  for (const [gate, r] of latest) {
    const v = classifyReceipt(r, currentFingerprint);
    if (v === 'proven') { out.fresh++; out.gates.push(gate); }
    else if (v === 'stale') out.stale++;
    else if (v === 'failed') out.failed++;
  }
  return out;
}

const between = (m, a, b) => (m.from === a && m.to === b) || (m.from === b && m.to === a) || m.to === 'all';

/**
 * Состояние каждого конфликта: спрашивали ли о нём и чем кончилось. Чистая функция —
 * проверяется целиком без файлов.
 */
export function arbitrate(conflictList, messages, now = Date.now()) {
  const answered = new Set((messages || []).map((m) => m && m.replyTo).filter(Boolean));
  return (conflictList || []).map((c) => {
    const queries = (messages || []).filter((m) => m && m.type === 'claim-query' && between(m, c.a, c.b));
    if (!queries.length) {
      return { ...c, state: 'unasked', sinceMs: 0,
        action: `node scripts/session-mail.mjs --send --to ${c.b} --type claim-query --subject "${(c.detail || '').slice(0, 40)}" --body "пересекаемся, чьё?"` };
    }
    const resolved = queries.find((q) => answered.has(q.id));
    if (resolved) return { ...c, state: 'resolved', sinceMs: now - (resolved.at || now), queryId: resolved.id, action: null };
    const oldest = queries.sort((x, y) => (x.at || 0) - (y.at || 0))[0];
    return { ...c, state: 'waiting', sinceMs: now - (oldest.at || now), queryId: oldest.id,
      action: `ждём ответа на ${oldest.id}` };
  });
}

/**
 * Что поднимать человеку. НЕ всё найденное: если поднимать всё, человек перестанет читать.
 * Только то, где механизм сам ничего больше сделать не может.
 */
export function escalations(arbitrated, openQuestions = [], dirty = [], now = Date.now(), limits = {}, unproven = []) {
  const waitLimit = limits.waiting ?? WAITING_LIMIT_MS;
  const dirtyLimit = limits.dirty ?? DIRTY_LIMIT_MS;
  const out = [];
  for (const a of arbitrated || []) {
    if (a.level === 'high' && a.state === 'unasked') {
      out.push({ kind: 'высокий конфликт, никто не спросил', who: `${a.a} и ${a.b}`, detail: a.detail, action: a.action });
    } else if (a.state === 'waiting' && a.sinceMs > waitLimit) {
      out.push({ kind: 'вопрос висит без ответа', who: `${a.a} и ${a.b}`, detail: `${a.queryId} ждёт ${Math.round(a.sinceMs / 60000)} мин`, action: 'разбудить адресата или решить за него' });
    }
  }
  for (const q of openQuestions || []) {
    if (q.waitingMs > waitLimit) {
      out.push({ kind: 'вопрос без ответа вне конфликта', who: `${q.from} → ${q.to}`, detail: `${q.id}: ${q.subject || ''}`, action: 'ответить или снять вопрос' });
    }
  }
  for (const d of dirty || []) {
    if (d.ageMs > dirtyLimit) {
      out.push({ kind: 'незакоммиченная работа стареет', who: d.session, detail: `${d.files} файл(ов) в ${d.worktree}, ${Math.round(d.ageMs / 3600000)} ч`, action: 'закоммитить через safe-commit или объяснить, почему висит' });
    }
  }
  for (const u of unproven || []) {
    out.push({ kind: 'работа не доказана', who: u.session,
      detail: u.stale ? `${u.files} файл(ов) правок, ${u.stale} квитанц(ий) просрочено — гонялось на другом коде`
                      : `${u.files} файл(ов) правок, ни одной квитанции прогона`,
      action: 'node scripts/gate-receipt.mjs --gate <имя> --run "<команда>"' });
  }
  return out;
}

// ---------- сбор фактов ----------

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function dirtyWork(entries) {
  const out = [];
  for (const e of entries) {
    if (!e.worktree || !fs.existsSync(e.worktree)) continue;
    try {
      const n = execSync('git status --porcelain', { cwd: e.worktree, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n').filter(Boolean).length;
      if (!n) continue;
      out.push({ session: e.session, worktree: e.worktree, files: n, ageMs: Date.now() - (e.startedAt || Date.now()) });
    } catch { /* не репозиторий или недоступен — молчим, а не выдумываем */ }
  }
  return out;
}

function fmtAge(ms) { const m = Math.round(ms / 60000); return m < 60 ? `${m}м` : `${Math.round(m / 60)}ч`; }

function collect() {
  const now = Date.now();
  const live = readBoard().filter((e) => !isStale(e, now, pidAlive(e.pid)));
  const cs = conflicts(live);
  const mail = readMail();
  const arb = arbitrate(cs, mail, now);
  const open = unanswered(mail, now);
  const dirty = dirtyWork(live);
  // Обоснованность спрашиваем ТОЛЬКО у сессий с незакоммиченной работой: у чистой копии
  // доказывать нечего, и требовать квитанцию там значило бы кричать без повода.
  const receipts = readReceipts();
  const unproven = [];
  for (const d of dirty) {
    let fp = null;
    try { fp = treeFingerprint(d.worktree); } catch { /* не репозиторий — молчим */ }
    if (!fp) continue;
    const pr = provenanceFor({ session: d.session, worktree: d.worktree }, receipts, fp);
    if (pr.fresh === 0) unproven.push({ session: d.session, files: d.files, stale: pr.stale, failed: pr.failed });
  }
  return { now, live, arb, open, dirty, unproven, esc: escalations(arb, open, dirty, now, {}, unproven) };
}

function cmdReport() {
  const { live, arb, open, dirty, unproven, esc } = collect();
  console.log(`тимлид: живых сессий ${live.length}, столкновений ${arb.length}, вопросов без ответа ${open.length}`);
  if (!live.length) return console.log('  доска пуста — сессии не объявляют, чем заняты (node scripts/session-board.mjs --publish)');

  if (arb.length) {
    console.log('\nстолкновения и что с ними сделано:');
    for (const a of arb) {
      const mark = a.state === 'resolved' ? 'решено' : a.state === 'waiting' ? `ждём ${fmtAge(a.sinceMs)}` : 'НИКТО НЕ СПРОСИЛ';
      console.log(`  [${a.level}] ${a.a} и ${a.b} — ${mark}`);
      console.log(`      ${a.detail}`);
      if (a.action && a.state === 'unasked') console.log(`      спросить: ${a.action}`);
    }
  }
  if (dirty.length) {
    console.log('\nнезакоммиченная работа и её обоснованность:');
    for (const d of dirty) {
      const u = unproven.find((x) => x.session === d.session);
      const mark = !u ? 'доказана прогоном' : u.stale ? `НЕ доказана (${u.stale} квитанц. просрочено)` : 'НЕ доказана (квитанций нет)';
      console.log(`  ${d.session}: ${d.files} файл(ов), ${fmtAge(d.ageMs)} — ${mark}`);
    }
  }
  if (esc.length) {
    console.log(`\nТРЕБУЕТ ЧЕЛОВЕКА: ${esc.length}`);
    for (const e of esc) console.log(`  ${e.kind} — ${e.who}\n      ${e.detail}\n      ${e.action}`);
  } else {
    console.log('\nчеловеку поднимать нечего');
  }
}

function cmdEscalate() {
  const { esc } = collect();
  if (!esc.length) { console.log('тимлид: человеку поднимать нечего'); process.exit(0); }
  console.log(`тимлид: требует человека — ${esc.length}`);
  for (const e of esc) console.log(`  ${e.kind} — ${e.who}\n      ${e.detail}\n      ${e.action}`);
  process.exit(1);
}

function selfTest() {
  const checks = [];
  const ok = (n, c) => checks.push({ n, pass: !!c });
  const now = Date.now();
  const C = (o) => ({ level: 'high', kind: 'claims-overlap', a: 'x', b: 'y', detail: 'пути', ...o });
  const Q = (o) => ({ id: 'x-001', at: now, from: 'x', to: 'y', type: 'claim-query', subject: 's', ...o });

  ok('конфликт без вопроса — unasked', arbitrate([C()], [])[0].state === 'unasked');
  ok('unasked несёт готовую команду', /session-mail/.test(arbitrate([C()], [])[0].action));
  ok('вопрос без ответа — waiting', arbitrate([C()], [Q()], now)[0].state === 'waiting');
  ok('вопрос с ответом — resolved',
    arbitrate([C()], [Q(), { id: 'y-001', at: now, from: 'y', to: 'x', type: 'verdict', replyTo: 'x-001' }], now)[0].state === 'resolved');
  ok('вопрос между ДРУГОЙ парой не засчитывается',
    arbitrate([C()], [Q({ from: 'p', to: 'q' })], now)[0].state === 'unasked');
  ok('объявление всем засчитывается как разговор',
    arbitrate([C()], [Q({ from: 'x', to: 'all' })], now)[0].state === 'waiting');
  ok('время ожидания считается от САМОГО СТАРОГО вопроса',
    arbitrate([C()], [Q({ id: 'x-002', at: now - 1000 }), Q({ id: 'x-003', at: now })], now)[0].sinceMs >= 1000);
  ok('пустой вход не роняет', arbitrate([], []).length === 0);

  const arbUnasked = arbitrate([C()], []);
  ok('высокий и никто не спросил — поднимаем человеку', escalations(arbUnasked, [], [], now).length === 1);
  ok('средний и никто не спросил — НЕ поднимаем (иначе перестанут читать)',
    escalations(arbitrate([C({ level: 'medium' })], []), [], [], now).length === 0);
  ok('решённый конфликт не поднимаем',
    escalations(arbitrate([C()], [Q(), { id: 'y-1', at: now, from: 'y', to: 'x', type: 'verdict', replyTo: 'x-001' }], now), [], [], now).length === 0);
  ok('свежий waiting не поднимаем',
    escalations(arbitrate([C()], [Q()], now), [], [], now).length === 0);
  ok('протухший waiting поднимаем',
    escalations(arbitrate([C()], [Q({ at: now - WAITING_LIMIT_MS - 1 })], now), [], [], now).length === 1);
  ok('старый вопрос вне конфликта поднимаем',
    escalations([], [{ id: 'q1', from: 'a', to: 'b', subject: 's', waitingMs: WAITING_LIMIT_MS + 1 }], [], now).length === 1);
  ok('свежий вопрос вне конфликта не поднимаем',
    escalations([], [{ id: 'q1', from: 'a', to: 'b', waitingMs: 1000 }], [], now).length === 0);
  ok('старая незакоммиченная работа поднимается',
    escalations([], [], [{ session: 's', worktree: '/w', files: 3, ageMs: DIRTY_LIMIT_MS + 1 }], now).length === 1);
  ok('свежая незакоммиченная работа не поднимается',
    escalations([], [], [{ session: 's', worktree: '/w', files: 3, ageMs: 1000 }], now).length === 0);
  ok('пороги настраиваются извне (иначе проверяема одна сторона из двух)',
    escalations([], [], [{ session: 's', worktree: '/w', files: 1, ageMs: 5000 }], now, { dirty: 1000 }).length === 1);

  // обоснованность работы: доказательство прогона на ТЕКУЩЕМ коде
  const RC = (o) => ({ session: 's', gate: 'tsc', at: now, fingerprint: 'aaa', outcome: 'pass', ...o });
  ok('свежая квитанция считается доказательством',
    provenanceFor({ session: 's' }, [RC()], 'aaa').fresh === 1);
  ok('квитанция с другого кода в доказательство НЕ идёт',
    provenanceFor({ session: 's' }, [RC({ fingerprint: 'иной' })], 'aaa').fresh === 0);
  ok('просроченная квитанция считается отдельно',
    provenanceFor({ session: 's' }, [RC({ fingerprint: 'иной' })], 'aaa').stale === 1);
  ok('провал не считается доказательством',
    provenanceFor({ session: 's' }, [RC({ outcome: 'fail' })], 'aaa').fresh === 0);
  ok('чужая квитанция не засчитывается',
    provenanceFor({ session: 's' }, [RC({ session: 'другая', cwd: '/чужое' })], 'aaa').fresh === 0);
  ok('квитанция по рабочей копии засчитывается даже при другом имени сессии',
    provenanceFor({ session: 's', worktree: '/w' }, [RC({ session: 'иная', cwd: '/w' })], 'aaa').fresh === 1);
  ok('берётся самая свежая квитанция на гейт',
    provenanceFor({ session: 's' }, [RC({ at: now - 1000, fingerprint: 'старый' }), RC({ at: now })], 'aaa').fresh === 1);
  ok('недоказанная работа поднимается человеку',
    escalations([], [], [], now, {}, [{ session: 's', files: 3, stale: 0 }]).length === 1);
  ok('в тексте эскалации названа причина: просрочка или отсутствие',
    /просрочено/.test(escalations([], [], [], now, {}, [{ session: 's', files: 3, stale: 2 }])[0].detail));

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`${c.pass ? '  ok ' : '  ХХ '} ${c.n}`);
  console.log(`\nteamlead самопроверка: ${checks.length - failed.length} прошло, ${failed.length} упало`);
  process.exit(failed.length ? 1 : 0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  else if (process.argv.includes('--escalate')) cmdEscalate();
  else cmdReport();
}
