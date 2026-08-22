#!/usr/bin/env node
// @closes-class: agreement-lives-only-in-chat
// @scope: all
// @scope-ok: почта сессий по определению собирает переписку ВСЕХ сессий машины
/**
 * session-mail — типовые сообщения между сессиями с журналом.
 *
 * ЗАЧЕМ. Слой B (доска) находит пересечение, но разрулить его может только разговор. Разговор
 * у нас уже был и работал: сессия jidoka-ba спросила соседа «визуальные тесты и таймаут vitest
 * твои или ничьи», получила ответ и отдала работу. Проблема в том, что договорённость жила
 * ТОЛЬКО в чате: чат стирается, контекст сворачивается, и через час никто не докажет, кто на
 * что согласился. Это тот же класс, что «доска проекта это база данных, а не список задач».
 *
 * ПОЧЕМУ ФАЙЛ НА ОТПРАВИТЕЛЯ, А НЕ ОДИН ОБЩИЙ ЖУРНАЛ. Сессий несколько, и они пишут
 * одновременно. Общий файл означал бы конкурентную дозапись в один и тот же inode; на коротких
 * строках это обычно проходит, но «обычно» — не инвариант. Каждая сессия дописывает ТОЛЬКО в
 * свой ящик, читатели сливают. Ровно тот приём, что уже доказан доской.
 *
 * ЧТО ЭТО НЕ ЗАМЕНЯЕТ. Мгновенное внимание по-прежнему даёт SendMessage: почта durable, но
 * пассивна. Правильный порядок — записать сюда (останется навсегда) и пингануть SendMessage
 * (разбудит сейчас).
 *
 * Использование:
 *   node scripts/session-mail.mjs --send --to projectx-app-18 --type claim-query \
 *        --subject "e2e/**" --body "твои визуальные тесты или ничьи?"
 *   node scripts/session-mail.mjs --inbox
 *   node scripts/session-mail.mjs --answer <id> --body "мои, не трогай"
 *   node scripts/session-mail.mjs --open          # вопросы без ответа, по всем сессиям
 *   node scripts/session-mail.mjs --thread <id>
 *   node scripts/session-mail.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const MAIL_DIR = path.join(os.homedir(), '.jidoka', 'board', '_mail');

/**
 * Типы сообщений. Список НАМЕРЕННО короткий: язык из двадцати слов никто не выучит, а
 * свободный текст не даёт машине понять, ждёт ли кто-то ответа.
 */
export const TYPES = {
  claim: 'беру эти пути под свою задачу',
  'claim-query': 'эти пути твои или ничьи? (ЖДЁТ ОТВЕТА)',
  release: 'отпускаю, забирай',
  warning: 'не делай X, вот почему',
  verdict: 'решение по спору',
};

/** Типы, которые остаются открытыми, пока на них не ответили. */
export const NEEDS_ANSWER = new Set(['claim-query']);

const arg = (name, dflt = undefined) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};

function me() {
  return process.env.JIDOKA_SESSION || arg('--from') || `${path.basename(process.cwd())}-${String(process.pid).slice(-2)}`;
}

/** Проверка сообщения ПЕРЕД записью: битую строку в журнал не пускаем. */
export function validateMessage(m) {
  const p = [];
  if (!m || typeof m !== 'object') return ['сообщение не объект'];
  for (const f of ['id', 'from', 'to', 'type']) {
    if (!m[f] || typeof m[f] !== 'string' || !m[f].trim()) p.push(`пустое обязательное поле "${f}"`);
  }
  if (m.type && !Object.hasOwn(TYPES, m.type)) p.push(`неизвестный тип "${m.type}", допустимы: ${Object.keys(TYPES).join(', ')}`);
  if (!Number.isFinite(m.at)) p.push('поле "at" должно быть числом');
  if (m.from && m.to && m.from === m.to) p.push('отправитель и получатель совпадают');
  return p;
}

export function readMail(dir = MAIL_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* битую строку пропускаем, а не роняем журнал */ }
    }
  }
  return out.sort((a, b) => (a.at || 0) - (b.at || 0));
}

/** Входящие для сессии. `all` означает объявление всем и попадает всем, кроме автора. */
export function inboxFor(messages, who) {
  return (messages || []).filter((m) => m && (m.to === who || (m.to === 'all' && m.from !== who)));
}

/**
 * Вопросы, оставшиеся БЕЗ ОТВЕТА. Это несущая функция всего слоя: молчаливо повисший вопрос —
 * ровно тот случай, ради которого переписку и переводят в журнал. Ответом считается любое
 * сообщение с replyTo на этот идентификатор.
 */
export function unanswered(messages, now = Date.now()) {
  const answered = new Set((messages || []).map((m) => m && m.replyTo).filter(Boolean));
  return (messages || [])
    .filter((m) => m && NEEDS_ANSWER.has(m.type) && !answered.has(m.id))
    .map((m) => ({ ...m, waitingMs: now - (m.at || now) }))
    .sort((a, b) => b.waitingMs - a.waitingMs);
}

/** Цепочка: исходное сообщение и всё, что на него ссылается, по времени. */
export function threadOf(messages, rootId) {
  const byId = new Map((messages || []).map((m) => [m.id, m]));
  const root = byId.get(rootId);
  if (!root) return [];
  const chain = [root];
  for (const m of messages) if (m.replyTo === rootId) chain.push(m);
  return chain.sort((a, b) => (a.at || 0) - (b.at || 0));
}

function nextId(from) {
  const mine = readMail().filter((m) => m.from === from).length;
  return `${from}-${String(mine + 1).padStart(3, '0')}`;
}

function append(msg) {
  fs.mkdirSync(MAIL_DIR, { recursive: true });
  fs.appendFileSync(path.join(MAIL_DIR, `${msg.from}.jsonl`), JSON.stringify(msg) + '\n');
}

function cmdSend() {
  const from = me();
  const msg = {
    id: nextId(from),
    at: Date.now(),
    from,
    to: arg('--to', 'all'),
    type: arg('--type', 'claim'),
    subject: arg('--subject', ''),
    body: arg('--body', ''),
    replyTo: arg('--reply-to', null),
  };
  const problems = validateMessage(msg);
  if (problems.length) {
    console.error('session-mail: ОТКАЗ, сообщение не прошло проверку:');
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(2);
  }
  append(msg);
  console.log(`отправлено ${msg.id}: ${msg.from} → ${msg.to} [${msg.type}] ${msg.subject}`);
  if (NEEDS_ANSWER.has(msg.type)) {
    console.log('  это вопрос — он будет висеть в --open, пока на него не ответят');
    console.log(`  разбуди адресата: SendMessage к "${msg.to}" со ссылкой на ${msg.id}`);
  }
}

function cmdAnswer() {
  const from = me();
  const rootId = arg('--answer');
  const all = readMail();
  const root = all.find((m) => m.id === rootId);
  if (!root) { console.error(`нет сообщения с идентификатором ${rootId}`); process.exit(2); }
  const msg = {
    id: nextId(from), at: Date.now(), from, to: root.from,
    type: arg('--type', 'verdict'), subject: root.subject || '', body: arg('--body', ''), replyTo: rootId,
  };
  const problems = validateMessage(msg);
  if (problems.length) { for (const p of problems) console.error(`  ✗ ${p}`); process.exit(2); }
  append(msg);
  console.log(`ответ ${msg.id} на ${rootId} записан: ${msg.body || '(без текста)'}`);
}

function fmtAge(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}м` : `${Math.round(m / 60)}ч`;
}

function cmdInbox() {
  const who = me();
  const all = readMail();
  const mine = inboxFor(all, who);
  if (!mine.length) return console.log(`почта ${who}: пусто`);
  const answered = new Set(all.map((m) => m.replyTo).filter(Boolean));
  console.log(`почта ${who}: ${mine.length} сообщени(й)`);
  for (const m of mine) {
    const open = NEEDS_ANSWER.has(m.type) && !answered.has(m.id);
    console.log(`  ${open ? '?' : '-'} ${m.id}  от ${m.from}  [${m.type}]  ${fmtAge(Date.now() - m.at)} назад`);
    if (m.subject) console.log(`      предмет: ${m.subject}`);
    if (m.body) console.log(`      ${m.body}`);
    if (open) console.log(`      ЖДЁТ ОТВЕТА: node scripts/session-mail.mjs --answer ${m.id} --body "..."`);
  }
}

function cmdOpen() {
  const open = unanswered(readMail());
  if (!open.length) { console.log('вопросов без ответа нет'); process.exit(0); }
  console.log(`вопросов без ответа: ${open.length}`);
  for (const m of open) {
    console.log(`  ${m.id}  ${m.from} → ${m.to}  ждёт ${fmtAge(m.waitingMs)}`);
    console.log(`      предмет: ${m.subject || '(не назван)'}`);
    if (m.body) console.log(`      ${m.body}`);
  }
  console.log('\nВопрос, повисший без ответа, — это и есть та потеря, ради которой заведён журнал.');
  process.exit(1);
}

function cmdThread() {
  const chain = threadOf(readMail(), arg('--thread'));
  if (!chain.length) return console.log('такой цепочки нет');
  for (const m of chain) {
    console.log(`  ${m.id}  ${m.from} → ${m.to}  [${m.type}]  ${new Date(m.at).toISOString().slice(11, 16)}`);
    if (m.body) console.log(`      ${m.body}`);
  }
}

function selfTest() {
  const checks = [];
  const ok = (n, c) => checks.push({ n, pass: !!c });
  const now = Date.now();
  const M = (o) => ({ id: 'a-001', at: now, from: 'a', to: 'b', type: 'claim', subject: 's', body: '', replyTo: null, ...o });

  ok('корректное сообщение проходит', validateMessage(M()).length === 0);
  ok('пустой получатель отклоняется', validateMessage(M({ to: '' })).some((p) => /"to"/.test(p)));
  ok('неизвестный тип отклоняется и перечисляет допустимые',
    validateMessage(M({ type: 'болтовня' })).some((p) => /неизвестный тип/.test(p) && /claim-query/.test(p)));
  ok('сообщение самому себе отклоняется', validateMessage(M({ to: 'a' })).some((p) => /совпадают/.test(p)));
  ok('нечисловое время отклоняется', validateMessage(M({ at: 'вчера' })).some((p) => /"at"/.test(p)));
  ok('не объект отклоняется', validateMessage(null).length > 0);

  const all = [
    M({ id: 'a-001', from: 'a', to: 'b', type: 'claim-query', subject: 'e2e/**' }),
    M({ id: 'b-001', from: 'b', to: 'a', type: 'verdict', replyTo: 'a-001', at: now + 1 }),
    M({ id: 'a-002', from: 'a', to: 'c', type: 'claim-query', subject: 'lib/**', at: now - 3600000 }),
    M({ id: 'c-001', from: 'c', to: 'all', type: 'warning', subject: 'npm audit fix', at: now + 2 }),
  ];

  ok('входящие для b содержат адресованное b', inboxFor(all, 'b').some((m) => m.id === 'a-001'));
  ok('объявление всем доходит до постороннего', inboxFor(all, 'b').some((m) => m.id === 'c-001'));
  ok('объявление всем НЕ возвращается автору', !inboxFor(all, 'c').some((m) => m.id === 'c-001'));
  ok('чужая личная переписка не попадает во входящие', !inboxFor(all, 'b').some((m) => m.id === 'a-002'));

  const open = unanswered(all, now);
  ok('отвеченный вопрос закрыт', !open.some((m) => m.id === 'a-001'));
  ok('неотвеченный вопрос виден', open.some((m) => m.id === 'a-002'));
  ok('не-вопросы в открытые не попадают', !open.some((m) => m.type === 'warning'));
  ok('дольше ждущий идёт первым', open[0].id === 'a-002');
  ok('время ожидания считается', open[0].waitingMs >= 3600000);
  ok('пустой список не роняет', unanswered([]).length === 0);

  const th = threadOf(all, 'a-001');
  ok('цепочка содержит вопрос и ответ', th.length === 2 && th[0].id === 'a-001' && th[1].id === 'b-001');
  ok('несуществующая цепочка пуста', threadOf(all, 'нет').length === 0);

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`${c.pass ? '  ok ' : '  ХХ '} ${c.n}`);
  console.log(`\nsession-mail самопроверка: ${checks.length - failed.length} прошло, ${failed.length} упало`);
  process.exit(failed.length ? 1 : 0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  else if (process.argv.includes('--send')) cmdSend();
  else if (process.argv.includes('--answer')) cmdAnswer();
  else if (process.argv.includes('--open')) cmdOpen();
  else if (process.argv.includes('--thread')) cmdThread();
  else cmdInbox();
}
