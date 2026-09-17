#!/usr/bin/env node
// sibling-parity-gate — Stop-хук: правка коснулась ОДНОГО места из нескольких похожих.
//
// Класс rule-reached-one-branch-of-three рецидивировал дважды за двое суток, оба раза
// поймал человек: правило про мёртвые кнопки применено к Import CSV и не применено к
// Import contacts и Import companies в том же файле; минимум цели пальца закрыл одну
// ветку разметки из трёх. Режим отказа FM-2.2 покрыт нулём механизмов.
//
// ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ, и один раз за сессию. Отключить одну кнопку из трёх
// бывает правильно; хук не знает замысла и не притворяется, что знает. Он называет
// соседей и спрашивает. Замер шума на 12 настоящих коммитах движка: 7 срабатываний на
// 773 изменённых строки, то есть 0,9 процента.
//
// Живёт в ~/.claude, а НЕ в репозитории продукта: правило линтера в общем конфиге
// принуждало бы коллег к канону, о котором с ними не договаривались. Канон — hooks/
// репозитория jidoka, установленная копия — ~/.claude/hooks/.
//
// Fail-open по построению: любая ошибка — выход 0. Пропущенное предупреждение это
// неудобство, а хук, ломающий завершение сессии, ломает работу.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Механизм ищется в СОБСТВЕННОМ дереве хука, а не в домашнем каталоге: установленная
 * копия (~/.claude/hooks + ~/.claude/jidoka/scripts) и канон (<репо>/hooks +
 * <репо>/scripts). Адрес от HOME заставлял хук из канона молча судить установленной
 * копией, а в чистом клоне CI — молча выходить с нулём. Установленная раскладка
 * проверяется первой: рядом с ней лежит ЧУЖОЙ ~/.claude/scripts, а в каноне
 * каталога jidoka/ нет. Пока путь был только домашним, кейс eval зеленел у владельца
 * и краснел в CI: main был красным с 2026-09-14 по 2026-09-16.
 */
export function resolveMech(hookDir, exists = fs.existsSync) {
  const candidates = [
    path.join(hookDir, '..', 'jidoka', 'scripts', 'sibling-parity.mjs'),
    path.join(hookDir, '..', 'scripts', 'sibling-parity.mjs'),
  ];
  return candidates.find((p) => exists(p)) || null;
}

const ownMech = () => resolveMech(path.dirname(fileURLToPath(import.meta.url)));

// Только исходники. Реестры, отчёты и снимки состоят из однотипных строк по построению,
// и разбор их формы дал бы шум, не связанный с правилами.
const SOURCE = /\.(tsx|jsx|ts|js|mjs|cjs|css|scss|vue|svelte|py|go|rb|java|kt|swift)$/i;
const SKIP = /(node_modules|\.next|dist|build|__tests__|\.test\.|\.spec\.)/i;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

/** Чистая: номера добавленных строк по файлам из вывода git diff -U0. */
export function addedLines(diff = '') {
  const byFile = new Map();
  let file = null, next = 0;
  for (const line of String(diff).split('\n')) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { file = f[1]; continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { next = Number(h[1]); continue; }
    if (!file) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(next);
      next++;
    }
  }
  return byFile;
}

async function main() {
  const raw = readStdin();
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }
  if (payload.stop_hook_active) process.exit(0);

  const cwd = payload.cwd || process.cwd();
  const mech = ownMech();
  if (!mech) process.exit(0);                          // механизма нет — молча пропускаем

  // блокируем не больше одного раза за сессию
  const sessionId = payload.session_id || 'unknown';
  const markerDir = path.join(os.tmpdir(), 'sibling-parity-gate');
  const marker = path.join(markerDir, `${sessionId}.fired`);
  if (fs.existsSync(marker)) process.exit(0);

  let diff = '';
  try {
    diff = execFileSync('git', ['diff', '-U0', 'HEAD'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch { process.exit(0); }                          // не репозиторий или нет HEAD — не наше дело

  const byFile = addedLines(diff);
  if (!byFile.size) process.exit(0);

  const { oddOneOut } = await import(pathToFileURL(mech).href);
  const findings = [];
  let examined = 0;
  for (const [rel, lines] of byFile) {
    if (!SOURCE.test(rel) || SKIP.test(rel)) continue;
    const abs = path.join(cwd, rel);
    if (!fs.existsSync(abs)) continue;
    let src = '';
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    examined += lines.length;
    for (const f of oddOneOut(src.split('\n'), lines)) findings.push({ ...f, file: rel });
  }

  if (!findings.length) process.exit(0);

  try { fs.mkdirSync(markerDir, { recursive: true }); fs.writeFileSync(marker, String(Date.now())); }
  catch { /* не смогли пометить — предупредим ещё раз, это не страшно */ }

  const out = [
    'SIBLING-PARITY: правка коснулась ОДНОГО места из нескольких похожих.',
    `Осмотрено изменённых строк: ${examined}. Мест с довеском, которого нет у соседей: ${findings.length}.`,
    '',
  ];
  for (const f of findings.slice(0, 8)) {
    out.push(`  ${f.file}:${f.line} — есть «${f.distinguishing.slice(0, 3).join('», «')}», у соседей (строки ${f.siblings.slice(0, 5).join(', ')}) этого нет`);
  }
  out.push('');
  out.push('Так и задумано — скажи это в итоге одной строкой и заканчивай.');
  out.push('Не задумано — правило накрыло одну дверь из трёх: класс rule-reached-one-branch-of-three,');
  out.push('он рецидивировал дважды за двое суток и оба раза его ловил владелец, а не механизм.');
  process.stderr.write(out.join('\n') + '\n');
  process.exit(2);
}

// @divergence: "соседи в добавленных строках разбираются по номерам" — разбор заголовка @@
// мог бы считать номера от старой стороны диффа, тогда прибор смотрел бы НЕ ТЕ строки и
// молчал бы на настоящей правке, оставаясь зелёным.
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

  const diff = [
    'diff --git a/x.tsx b/x.tsx',
    '--- a/x.tsx',
    '+++ b/x.tsx',
    '@@ -10,0 +11,2 @@',
    '+первая',
    '+вторая',
    '@@ -30,1 +40,1 @@',
    '-старое',
    '+новое',
  ].join('\n');
  const m = addedLines(diff);
  ok('файл найден', m.has('x.tsx'));
  ok('номера берутся с НОВОЙ стороны диффа', JSON.stringify(m.get('x.tsx')) === '[11,12,40]');
  ok('удалённые строки не считаются добавленными', m.get('x.tsx').length === 3);
  ok('пустой дифф даёт пустую карту', addedLines('').size === 0);
  ok('мусор не роняет разбор', addedLines('не дифф вовсе\n@@ кривой').size === 0);

  const has = (...ps) => (p) => ps.includes(p);
  const canon = path.join('/r', 'scripts', 'sibling-parity.mjs');
  const installed = path.join('/h', '.claude', 'jidoka', 'scripts', 'sibling-parity.mjs');
  ok('канон: механизм берётся из scripts/ того же репозитория',
    resolveMech(path.join('/r', 'hooks'), has(canon)) === canon);
  ok('установка: механизм берётся из ~/.claude/jidoka/scripts',
    resolveMech(path.join('/h', '.claude', 'hooks'), has(installed)) === installed);
  ok('установка: одноимённый файл в чужом ~/.claude/scripts не перехватывает механизм',
    resolveMech(path.join('/h', '.claude', 'hooks'),
      has(path.join('/h', '.claude', 'scripts', 'sibling-parity.mjs'), installed)) === installed);
  ok('механизма нет нигде — null, хук молчит, а не падает',
    resolveMech(path.join('/x', 'hooks'), () => false) === null);
  ok('хук из канона не читает установленную копию в домашнем каталоге',
    resolveMech(path.join('/r', 'hooks'), has(canon, path.join(os.homedir(), '.claude', 'jidoka', 'scripts', 'sibling-parity.mjs'))) === canon);
  // Реальное дерево: хук, который не находит своего механизма, молчит вечно и выглядит здоровым.
  const mech = ownMech();
  ok('механизм найден из собственного дерева', !!mech && fs.existsSync(mech));

  console.log(`\nsibling-parity-gate self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url) || sameReal(process.argv[1], fileURLToPath(import.meta.url));
function sameReal(a, b) { try { return !!a && fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } }

if (isMain && process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

if (isMain) {
  main().catch(() => process.exit(0));
}
