#!/usr/bin/env node
// @closes-class: gate-run-claimed-not-proven
// @scope: all
// @scope-ok: вход это ОТПЕЧАТОК всего дерева (коммит + правки + неотслеживаемые +
//            файл блокировки зависимостей). Сузить до правки нельзя по построению:
//            квитанция доказывает прогон на ЭТОМ состоянии, а состояние целостно.
//            Стоимость при этом мизерная: чтение нескольких json и один git status.
// @divergence: "прогон на ДРУГОМ коде — stale" — измеряемая величина «квитанция
//              есть» говорит «чисто», а правило «гейт прогонялся на ЭТОМ коде» нарушено:
//              отпечаток состояния не совпадает, значит доказано вчерашнее, а не нынешнее
/**
 * gate-receipt — квитанция прогона гейта: доказательство, которое пишет НЕ исполнитель.
 *
 * ЗАЧЕМ. Слой D (тимлид) умеет разруливать споры, но не мог ответить на вопрос «прогнал ли
 * сосед гейты перед тем, как сказать готово». Единственное, что у нас было, — отчёт самой
 * сессии. По нашему же правилу от 2026-08-11 доказательство, написанное автором рядом со
 * своей работой, стоит ноль: замер тогда показал, что 31 запись реестра из 35 опиралась на
 * комментарий, а не на поведение.
 *
 * ДВА СВОЙСТВА, БЕЗ КОТОРЫХ ЭТО БЫЛО БЫ ТЕАТРОМ.
 *
 * 1. Квитанцию пишет ОБЁРТКА вокруг гейта, а не сессия. Сессия не сообщает исход, она его
 *    вызывает; исход берётся из кода возврата процесса.
 *
 * 2. Квитанция привязана к ТОМУ, ЧТО ПРОВЕРЯЛОСЬ. Прогон часовой давности ничего не говорит
 *    о нынешнем коде, и это ровно тот способ, которым «готово» появляется без основания.
 *    Поэтому в квитанции лежит отпечаток состояния: коммит ПЛЮС незакоммиченные правки ПЛЮС
 *    неотслеживаемые файлы ПЛЮС файл блокировки зависимостей. Изменилась хоть одна буква —
 *    квитанция становится ПРОСРОЧЕННОЙ и не засчитывается.
 *
 * ЧЕГО ЭТО НЕ ДАЁТ, И ЭТО НАЗВАНО ЧЕСТНО. Защиты от намеренной подделки здесь нет: сессия,
 * которая захочет соврать, может записать что угодно. Механизм закрывает НЕ злой умысел, а
 * оптимизм и спешку — тот самый случай, когда «вроде гонял, вроде зелено». Наш реестр ошибок
 * состоит из вторых, а не из первых.
 *
 * СРОКА ГОДНОСТИ У КВИТАНЦИИ НЕТ, И ЭТО НЕ УПУЩЕНИЕ. Если отпечаток совпал, значит код,
 * правки и зависимости те же самые, и вчерашний прогон доказывает ровно то же, что сегодняшний.
 * Добавить срок означало бы изобразить строгость, ничего не проверив.
 *
 * Использование:
 *   node scripts/gate-receipt.mjs --gate tsc --run "npx tsc --noEmit"
 *   node scripts/gate-receipt.mjs --verify --require tsc,tests
 *   node scripts/gate-receipt.mjs --list
 *   node scripts/gate-receipt.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RECEIPT_DIR = path.join(os.homedir(), '.jidoka', 'board', '_receipts');

const arg = (name, dflt = undefined) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};

function me() {
  return process.env.JIDOKA_SESSION || arg('--session') || `${path.basename(process.cwd())}-${String(process.pid).slice(-2)}`;
}

/**
 * Отпечаток проверенного состояния. Чистая функция — считается из уже собранных строк,
 * поэтому проверяется без git и без файловой системы.
 *
 * Порядок частей фиксирован, потому что отпечаток обязан быть воспроизводимым: та же правка
 * должна давать то же число у любой сессии на любой машине.
 */
export function fingerprintFrom({ head = '', diff = '', untracked = '', lock = '' } = {}) {
  return crypto.createHash('sha256')
    .update(String(head)).update('\0')
    .update(String(diff)).update('\0')
    .update(String(untracked)).update('\0')
    .update(String(lock))
    .digest('hex').slice(0, 16);
}

function sh(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

/** Собрать отпечаток текущего состояния рабочей копии. */
export function treeFingerprint(cwd = process.cwd()) {
  const head = sh('git rev-parse HEAD', cwd).trim();
  const diff = sh('git diff HEAD', cwd);
  const untracked = sh('git ls-files --others --exclude-standard', cwd);
  let lock = '';
  for (const f of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
    const p = path.join(cwd, f);
    if (fs.existsSync(p)) { try { lock = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { /* ok */ } break; }
  }
  return fingerprintFrom({ head, diff, untracked, lock });
}

/**
 * Приговор по одной квитанции. Чистая функция.
 *
 * `stale` — самый важный исход: гейт правда прогонялся, но на ДРУГОМ коде. Засчитывать его
 * значило бы разрешить «я проверял утром», а именно так «готово» и появляется без основания.
 */
export function classifyReceipt(receipt, currentFingerprint) {
  if (!receipt) return 'missing';
  if (receipt.outcome === 'fail') return 'failed';
  if (receipt.outcome !== 'pass') return 'not-run';
  if (!receipt.fingerprint || !currentFingerprint) return 'unverifiable';
  return receipt.fingerprint === currentFingerprint ? 'proven' : 'stale';
}

/**
 * Свод по списку обязательных гейтов. Берётся САМАЯ СВЕЖАЯ квитанция на каждый гейт.
 *
 * Возвращает четыре ведра. Пустое `missing` и пустые `stale`/`failed` — единственное, что
 * означает «работа доказана»; всё остальное это «не доказана», а не «плохая».
 */
export function verifyWork(receipts, currentFingerprint, required = []) {
  const latest = new Map();
  for (const r of receipts || []) {
    if (!r || !r.gate) continue;
    const prev = latest.get(r.gate);
    if (!prev || (r.at || 0) > (prev.at || 0)) latest.set(r.gate, r);
  }
  const buckets = { proven: [], stale: [], failed: [], missing: [], other: [] };
  for (const gate of required) {
    const verdict = classifyReceipt(latest.get(gate), currentFingerprint);
    if (verdict === 'proven') buckets.proven.push(gate);
    else if (verdict === 'stale') buckets.stale.push(gate);
    else if (verdict === 'failed') buckets.failed.push(gate);
    else if (verdict === 'missing') buckets.missing.push(gate);
    else buckets.other.push({ gate, verdict });
  }
  buckets.ok = buckets.stale.length === 0 && buckets.failed.length === 0 && buckets.missing.length === 0 && buckets.other.length === 0;
  return buckets;
}

// ---------- ввод-вывод ----------

export function readReceipts(dir = RECEIPT_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* битую строку пропускаем */ }
    }
  }
  return out;
}

function append(rec) {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  fs.appendFileSync(path.join(RECEIPT_DIR, `${rec.session}.jsonl`), JSON.stringify(rec) + '\n');
}

function cmdRun() {
  const gate = arg('--gate');
  const cmd = arg('--run');
  if (!gate || !cmd) { console.error('нужно --gate <имя> --run "<команда>"'); process.exit(2); }
  const cwd = process.cwd();
  // Отпечаток снимается ДО прогона: он описывает то, что проверяли, а не то, что стало после.
  const fingerprint = treeFingerprint(cwd);
  const started = Date.now();
  const res = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd });
  const code = res.status === null ? 1 : res.status;
  const rec = {
    session: me(), gate, at: Date.now(), durationMs: Date.now() - started,
    cwd, repo: path.basename(sh('git rev-parse --show-toplevel', cwd).trim() || cwd),
    fingerprint,
    outcome: code === 0 ? 'pass' : 'fail',
    exitCode: code,
  };
  append(rec);
  console.log(`\nквитанция: ${gate} — ${rec.outcome} (код ${code}), отпечаток ${fingerprint}`);
  if (rec.outcome === 'fail') console.log('  провал тоже записан: скрывать красное — это и есть подделка доказательства');
  process.exit(code);
}

function cmdVerify() {
  const required = (arg('--require', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!required.length) { console.error('нужно --require <гейт,гейт>'); process.exit(2); }
  const fp = treeFingerprint();
  const r = verifyWork(readReceipts(), fp, required);
  console.log(`проверка доказательств (отпечаток ${fp}):`);
  if (r.proven.length) console.log(`  доказано: ${r.proven.join(', ')}`);
  if (r.stale.length) console.log(`  ПРОСРОЧЕНО (гонялось на другом коде): ${r.stale.join(', ')}`);
  if (r.failed.length) console.log(`  ПРОВАЛ: ${r.failed.join(', ')}`);
  if (r.missing.length) console.log(`  НЕТ КВИТАНЦИИ: ${r.missing.join(', ')}`);
  for (const o of r.other) console.log(`  ${o.gate}: ${o.verdict}`);
  if (r.ok) { console.log('\nработа доказана'); process.exit(0); }
  console.log('\nработа НЕ доказана. Это не значит «плохая» — значит основания нет.');
  console.log(`прогнать с квитанцией: node scripts/gate-receipt.mjs --gate <имя> --run "<команда>"`);
  process.exit(1);
}

function cmdList() {
  const all = readReceipts().sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!all.length) return console.log('квитанций нет');
  const fp = treeFingerprint();
  console.log(`квитанций: ${all.length} (текущий отпечаток ${fp})`);
  for (const r of all.slice(0, 20)) {
    const v = classifyReceipt(r, fp);
    console.log(`  ${v === 'proven' ? 'ok ' : '   '} ${String(r.gate).padEnd(16)} ${String(r.outcome).padEnd(5)} ${r.fingerprint}  ${v === 'stale' ? 'ПРОСРОЧЕНА' : v}  ${r.session}`);
  }
}

function selfTest() {
  const checks = [];
  const ok = (n, c) => checks.push({ n, pass: !!c });
  const now = Date.now();
  const R = (o) => ({ session: 's', gate: 'tsc', at: now, fingerprint: 'aaa', outcome: 'pass', ...o });

  ok('отпечаток воспроизводим', fingerprintFrom({ head: 'h', diff: 'd' }) === fingerprintFrom({ head: 'h', diff: 'd' }));
  ok('другой коммит даёт другой отпечаток', fingerprintFrom({ head: 'h1' }) !== fingerprintFrom({ head: 'h2' }));
  ok('НЕЗАКОММИЧЕННАЯ правка меняет отпечаток (иначе квитанция пережила бы правку)',
    fingerprintFrom({ head: 'h', diff: '' }) !== fingerprintFrom({ head: 'h', diff: '+строка' }));
  ok('новый неотслеживаемый файл меняет отпечаток',
    fingerprintFrom({ head: 'h' }) !== fingerprintFrom({ head: 'h', untracked: 'new.ts' }));
  ok('смена зависимостей меняет отпечаток',
    fingerprintFrom({ head: 'h' }) !== fingerprintFrom({ head: 'h', lock: 'abc' }));
  ok('перестановка частей не путается (разделитель работает)',
    fingerprintFrom({ head: 'ab', diff: 'c' }) !== fingerprintFrom({ head: 'a', diff: 'bc' }));

  ok('свежий проход — proven', classifyReceipt(R(), 'aaa') === 'proven');
  ok('прогон на ДРУГОМ коде — stale', classifyReceipt(R(), 'bbb') === 'stale');
  ok('провал — failed', classifyReceipt(R({ outcome: 'fail' }), 'aaa') === 'failed');
  ok('нет квитанции — missing', classifyReceipt(null, 'aaa') === 'missing');
  ok('квитанция без отпечатка непроверяема, а не доказана',
    classifyReceipt(R({ fingerprint: '' }), 'aaa') === 'unverifiable');
  ok('исход не pass и не fail — not-run', classifyReceipt(R({ outcome: 'skipped' }), 'aaa') === 'not-run');

  const recs = [
    R({ gate: 'tsc', at: now - 1000, fingerprint: 'old' }),
    R({ gate: 'tsc', at: now, fingerprint: 'aaa' }),
    R({ gate: 'tests', fingerprint: 'aaa', outcome: 'fail' }),
  ];
  const v = verifyWork(recs, 'aaa', ['tsc', 'tests', 'build']);
  ok('берётся САМАЯ СВЕЖАЯ квитанция на гейт', v.proven.includes('tsc'));
  ok('провал попадает в свой ящик', v.failed.includes('tests'));
  ok('гейт без квитанции попадает в missing', v.missing.includes('build'));
  ok('работа с провалом и пропуском НЕ доказана', v.ok === false);
  ok('всё доказано только когда все три ящика пусты',
    verifyWork([R({ gate: 'a' })], 'aaa', ['a']).ok === true);
  ok('просроченная квитанция НЕ доказывает',
    verifyWork([R({ gate: 'a', fingerprint: 'иной' })], 'aaa', ['a']).ok === false);
  ok('пустой список обязательных — доказано по умолчанию', verifyWork([], 'aaa', []).ok === true);
  ok('квитанции без имени гейта не роняют свод', verifyWork([{ at: now }], 'aaa', ['a']).missing.includes('a'));

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`${c.pass ? '  ok ' : '  ХХ '} ${c.n}`);
  console.log(`\ngate-receipt самопроверка: ${checks.length - failed.length} прошло, ${failed.length} упало`);
  process.exit(failed.length ? 1 : 0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  else if (process.argv.includes('--verify')) cmdVerify();
  else if (process.argv.includes('--run')) cmdRun();
  else cmdList();
}
