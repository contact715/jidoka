#!/usr/bin/env node
// @closes-class: heavy-steps-stack-across-worktrees
// @scope: all
// @scope-ok: смотрит на состояние ВСЕЙ машины по определению — это и есть его предмет
/**
 * machine-guard — сторож, который смотрит на память ВСЕЙ МАШИНЫ, а не одной папки.
 *
 * ЗАЧЕМ. Замер 2026-08-22, после пяти перезагрузок подряд: у нас есть очередь тяжёлых задач
 * (common-launcher, tsc-guard), но её замок привязан к КАТАЛОГУ — `path.resolve(__dirname,'..')`
 * и `process.cwd()`. У проекта три рабочие копии, в домашней папке 14 каталогов с
 * node_modules. Значит замков столько же, сколько копий, и «сериализованные» сборки идут
 * параллельно: каждая до 3,5 ГБ при 18 ГБ физической памяти.
 *
 * Второй слагаемый, которого не видит ни один наш сторож: сам Claude. Замер на ЧИСТОЙ машине
 * сразу после перезагрузки, до единой сборки — 7,5 ГБ: 47 процессов MCP (3,4 ГБ), 6 процессов
 * сессий (1,5 ГБ), 29 процессов приложения (2,6 ГБ). То есть стартовая занятость 42% памяти,
 * и любые две тяжёлые сборки поверх неё гарантированно уводят машину в своп.
 *
 * ЧЕСТНАЯ ГРАНИЦА. Этот сторож НЕ убивает процессы. Убийство чужого шага с живым родителем —
 * ровно то, что запрещено правилом «зависший узнаётся по МЁРТВОМУ родителю» (2026-08-15):
 * у соседней сессии работа живая, и её обрыв выглядел бы как случайная поломка. Сторож только
 * ОТВЕЧАЕТ «сейчас нельзя» и записывает, кто занимает память. Решение убивать принимает человек.
 *
 * Использование:
 *   node scripts/machine-guard.mjs --check      # вердикт + код возврата (1 = нельзя запускать)
 *   node scripts/machine-guard.mjs --watch      # писать снимок раз в 30с, чтобы следующее
 *                                               # зависание было объяснимо, а не загадочно
 *   node scripts/machine-guard.mjs --self-test
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Шаги, которые стоят гигабайты. Список намеренно узкий: точность важнее полноты.
 *
 * ЛОЖНОЕ СРАБАТЫВАНИЕ, ПОЙМАННОЕ НА РЕАЛЬНОЙ МАШИНЕ (2026-08-22). Первая версия шаблона
 * содержала `next[ /-](build|dev)` и совпадала с путём `.../next-devtools-mcp`: сторож
 * объявлял КРИТИЧНО, увидев два безобидных MCP-сервера по 70 МБ. Это класс
 * `guard-fires-on-mention-not-action` (2026-08-08) — детектор сработал на ИМЯ, а не на
 * действие. Поэтому: `dev`/`build` требуют границы слова, и всё, что содержит `mcp`,
 * исключено целиком — сервер инструментов не является тяжёлым шагом никогда.
 */
export const HEAVY_RE = /(\bnext[ /-](build|dev)\b|\bnext-server\b|\btsc\b|tsc\.js|\bvitest\b|\besbuild\b|\bwebpack\b|\bjest\b)/i;
export const NOT_HEAVY_RE = /(mcp|-devtools|language-server|\bgrep\b|machine-guard)/i;

export const LOG_PATH = path.join(os.homedir(), '.jidoka', 'machine-pressure.jsonl');

/**
 * Вердикт по состоянию памяти. Чистая функция — вся арифметика проверяется без запуска ps.
 *
 * Пороги выбраны от НАБЛЮДЁННОГО, а не от красивых чисел: базовая занятость Claude 42%,
 * одна сборка next ~3,5 ГБ это ещё ~19% от 18 ГБ. Значит две сборки поверх базы = 80%,
 * и это уже своп. Поэтому «нельзя» объявляется на 20% свободной памяти, а не на 5%:
 * сторож, который срабатывает в момент отказа, бесполезен — он обязан срабатывать ДО.
 */
export function memoryVerdict({ totalBytes, freeBytes, swapUsedBytes = 0, swapTotalBytes = 0, heavyCount = 0 }) {
  if (!totalBytes || totalBytes <= 0) return { level: 'unknown', reason: 'объём памяти не определён — сторож молчит, а не гадает' };
  const freePct = Math.round((freeBytes / totalBytes) * 100);
  const swapPct = swapTotalBytes > 0 ? Math.round((swapUsedBytes / swapTotalBytes) * 100) : 0;
  const reasons = [];
  let level = 'ok';
  if (freePct < 20) { level = 'critical'; reasons.push(`свободно ${freePct}% памяти`); }
  else if (freePct < 35) { level = 'tight'; reasons.push(`свободно ${freePct}% памяти`); }
  if (swapTotalBytes > 0 && swapPct >= 70) { level = 'critical'; reasons.push(`своп занят на ${swapPct}%`); }
  if (heavyCount >= 2) { level = 'critical'; reasons.push(`тяжёлых шагов уже ${heavyCount}`); }
  else if (heavyCount === 1 && level === 'ok') { level = 'tight'; reasons.push('один тяжёлый шаг уже идёт'); }
  return { level, freePct, swapPct, heavyCount, reason: reasons.join(', ') || `свободно ${freePct}% памяти, тяжёлых шагов нет` };
}

/** Разбор вывода ps. Отдельно от запуска, поэтому проверяется на фиксированной строке. */
export function parseHeavy(psText) {
  const out = [];
  for (const line of String(psText || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, rssKb, args] = m;
    if (!HEAVY_RE.test(args)) continue;
    if (NOT_HEAVY_RE.test(args)) continue;   // сервер инструментов не тяжёлый шаг
    out.push({ pid: Number(pid), ppid: Number(ppid), rssBytes: Number(rssKb) * 1024, args: args.slice(0, 120) });
  }
  return out;
}

/**
 * Доступная память. НА macOS `os.freemem()` НЕПРИГОДЕН.
 *
 * Замер 2026-08-22 на живой машине: `os.freemem()` дал 1%, а `memory_pressure` в ту же секунду
 * 59%. Разница не ошибка системы: macOS держит всю свободную память под кеш и сжатые страницы,
 * поэтому «свободных» страниц там почти всегда около нуля. Сторож на этом числе кричал бы
 * КРИТИЧНО круглосуточно — то есть был бы ровно таким же ложным красным, как детектор пустых
 * самопроверок, который четыре дня валил CI. Ложная тревога учит обходить сторожа.
 *
 * Поэтому на darwin спрашиваем систему напрямую и падаем на freemem только если не вышло.
 */
export function availableBytes(totalBytes, probe = null) {
  const run = probe || ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 5000 }));
  if (process.platform === 'darwin') {
    try {
      const out = run('memory_pressure');
      const m = /free percentage:\s*(\d+)%/i.exec(out);
      if (m) return (Number(m[1]) / 100) * totalBytes;
    } catch { /* падаем ниже */ }
  }
  return os.freemem();
}

function readMemory() {
  const totalBytes = os.totalmem();
  let freeBytes = availableBytes(totalBytes);
  let swapUsedBytes = 0, swapTotalBytes = 0;
  try {
    const s = execSync('sysctl -n vm.swapusage', { encoding: 'utf8', timeout: 5000 });
    const t = /total\s*=\s*([\d.]+)M/.exec(s), u = /used\s*=\s*([\d.]+)M/.exec(s);
    if (t) swapTotalBytes = parseFloat(t[1]) * 1048576;
    if (u) swapUsedBytes = parseFloat(u[1]) * 1048576;
  } catch { /* не macOS или sysctl недоступен — своп просто не учитывается */ }
  return { totalBytes, freeBytes, swapUsedBytes, swapTotalBytes };
}

function snapshot() {
  const mem = readMemory();
  let heavy = [];
  try {
    heavy = parseHeavy(execSync('ps -Ao pid=,ppid=,rss=,args=', { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 }));
  } catch { /* fail-open: без списка процессов судим только по памяти */ }
  const verdict = memoryVerdict({ ...mem, heavyCount: heavy.length });
  return { mem, heavy, verdict };
}

function fmtGb(b) { return (b / 1073741824).toFixed(1) + ' ГБ'; }

function cmdCheck() {
  const { mem, heavy, verdict } = snapshot();
  const icon = verdict.level === 'critical' ? '\x1b[31m✗' : verdict.level === 'tight' ? '\x1b[33m⚠' : '\x1b[32m✓';
  console.log(`${icon} machine-guard: ${verdict.level.toUpperCase()} — ${verdict.reason}\x1b[0m`);
  console.log(`  память: ${fmtGb(mem.freeBytes)} свободно из ${fmtGb(mem.totalBytes)}` +
    (mem.swapTotalBytes ? `, своп ${fmtGb(mem.swapUsedBytes)} из ${fmtGb(mem.swapTotalBytes)}` : ''));
  if (heavy.length) {
    console.log(`  тяжёлых шагов: ${heavy.length}`);
    for (const h of heavy.slice(0, 6)) console.log(`    ${(h.rssBytes / 1048576).toFixed(0)}МБ pid=${h.pid} ${h.args.slice(0, 70)}`);
  }
  if (verdict.level === 'critical') {
    console.log('\n  Запускать тяжёлый шаг СЕЙЧАС нельзя: он уведёт машину в своп.');
    console.log('  Сторож никого не убивает — у соседней работы живой родитель, и её обрыв');
    console.log('  выглядел бы как случайная поломка. Дождись или закрой лишнюю сессию сам.');
  }
  process.exit(verdict.level === 'critical' ? 1 : 0);
}

function cmdWatch() {
  const everyMs = 30000;
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  console.log(`machine-guard: пишу снимок раз в ${everyMs / 1000}с → ${LOG_PATH}`);
  console.log('Следующее зависание будет объяснимо: в файле останется, кто занимал память.');
  const tick = () => {
    const { mem, heavy, verdict } = snapshot();
    const row = {
      at: new Date().toISOString(),
      freePct: verdict.freePct, swapPct: verdict.swapPct, level: verdict.level,
      heavy: heavy.sort((a, b) => b.rssBytes - a.rssBytes).slice(0, 5)
        .map((h) => ({ mb: Math.round(h.rssBytes / 1048576), args: h.args.slice(0, 80) })),
    };
    try { fs.appendFileSync(LOG_PATH, JSON.stringify(row) + '\n'); } catch { /* fail-open */ }
    if (verdict.level === 'critical') console.log(`\x1b[31m[${row.at.slice(11, 19)}] КРИТИЧНО — ${verdict.reason}\x1b[0m`);
  };
  tick();
  setInterval(tick, everyMs);
}

function selfTest() {
  const checks = [];
  const ok = (n, c) => checks.push({ n, pass: !!c });
  const GB = 1073741824;

  ok('много свободной памяти и нет тяжёлых → ok',
    memoryVerdict({ totalBytes: 18 * GB, freeBytes: 12 * GB }).level === 'ok');
  ok('свободно 18% → critical (срабатывает ДО отказа, а не в момент)',
    memoryVerdict({ totalBytes: 18 * GB, freeBytes: 3.2 * GB }).level === 'critical');
  ok('свободно 30% → tight, но не critical',
    memoryVerdict({ totalBytes: 18 * GB, freeBytes: 5.4 * GB }).level === 'tight');
  ok('своп занят на 70% → critical даже при свободной памяти',
    memoryVerdict({ totalBytes: 18 * GB, freeBytes: 9 * GB, swapUsedBytes: 7 * GB, swapTotalBytes: 10 * GB }).level === 'critical');
  ok('два тяжёлых шага → critical (это и есть наложение по копиям)',
    memoryVerdict({ totalBytes: 18 * GB, freeBytes: 12 * GB, heavyCount: 2 }).level === 'critical');
  ok('один тяжёлый шаг → tight',
    memoryVerdict({ totalBytes: 18 * GB, freeBytes: 12 * GB, heavyCount: 1 }).level === 'tight');
  ok('нулевая память → unknown, сторож молчит вместо выдумки',
    memoryVerdict({ totalBytes: 0, freeBytes: 0 }).level === 'unknown');
  ok('своп не учитывается, если его нет вовсе (swapTotal=0)',
    memoryVerdict({ totalBytes: 18 * GB, freeBytes: 12 * GB, swapUsedBytes: 0, swapTotalBytes: 0 }).level === 'ok');
  ok('причина всегда названа словами',
    /свободно/.test(memoryVerdict({ totalBytes: 18 * GB, freeBytes: 12 * GB }).reason));

  const ps = [
    '  501   1 3670016 /usr/bin/node next build',
    '  502   1  120000 /usr/bin/node --max-old-space-size=3584 node_modules/typescript/lib/tsc.js',
    '  503   1   50000 /usr/bin/node vitest run',
    '  504   1   10000 /Applications/Safari.app/Contents/MacOS/Safari',
    '  505   1   10000 grep next build',
  ].join('\n');
  const heavy = parseHeavy(ps);
  ok('ps: next build опознан', heavy.some((h) => /next build/.test(h.args)));
  ok('ps: tsc опознан', heavy.some((h) => /tsc\.js/.test(h.args)));
  ok('ps: vitest опознан', heavy.some((h) => /vitest/.test(h.args)));
  ok('ps: Safari НЕ опознан как тяжёлый шаг', !heavy.some((h) => /Safari/.test(h.args)));
  ok('ps: размер переведён в байты', heavy[0].rssBytes === 3670016 * 1024);
  ok('ps: мусорные строки не роняют разбор', parseHeavy('вообще не ps\n\n').length === 0);

  // ЛОЖНЫЕ СРАБАТЫВАНИЯ, ПОЙМАННЫЕ НА ЖИВОЙ МАШИНЕ 2026-08-22 — закреплены тестами
  ok('next-devtools-mcp НЕ тяжёлый шаг (ловил на имени, а не на действии)',
    parseHeavy('  700   1  72000 /usr/bin/node /home/.claude/mcp-bin/next-devtools-mcp').length === 0);
  ok('любой mcp-сервер НЕ тяжёлый шаг',
    parseHeavy('  701   1  90000 /usr/bin/node playwright-mcp --browser chromium').length === 0);
  ok('сам сторож не считает себя тяжёлым',
    parseHeavy('  702   1  20000 /usr/bin/node scripts/machine-guard.mjs --watch').length === 0);
  ok('настоящий next build по-прежнему опознан',
    parseHeavy('  703   1 3670016 /usr/bin/node next build').length === 1);

  // availableBytes: на macOS берём memory_pressure, а не freemem
  const GB2 = 18 * GB;
  ok('availableBytes читает процент из memory_pressure',
    Math.round(availableBytes(GB2, () => 'System-wide memory free percentage: 59%') / GB2 * 100) === 59);
  ok('availableBytes падает на freemem, если проба сломалась',
    availableBytes(GB2, () => { throw new Error('нет команды'); }) === os.freemem());

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`${c.pass ? '  ✓' : '  ✗'} ${c.n}`);
  console.log(`\nmachine-guard самопроверка: ${checks.length - failed.length} прошло, ${failed.length} упало`);
  process.exit(failed.length ? 1 : 0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  else if (process.argv.includes('--watch')) cmdWatch();
  else cmdCheck();
}
