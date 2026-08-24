#!/usr/bin/env node
// oracle-divergence — требует, чтобы у каждого прибора был КЕЙС РАСХОЖДЕНИЯ: вход, на
// котором измеряемая величина говорит «чисто», а правило нарушено.
//
// @closes-class: guard-unit-mismatched-to-rule
// @scope: changed
// @divergence: "маркер есть, но названной проверки в файле НЕТ" — объявление о наличии
//              кейса это тоже объявление; прибор, который верит маркеру на слово, мерит
//              наличие текста, а не наличие проверки
//
// ЗАЧЕМ. Самый частый способ, которым мы ошибаемся, — прибор мерит не ту величину, о
// которой правило. Замер по реестру ошибок 2026-08-24: режим FM-3.3 повторился 15 раз за
// 30 дней под пятнадцатью разными именами, механизмы есть у 5 имён из 25. Разбор пяти
// августовских случаев показал одну форму:
//
//   guard-triggers-on-level-not-on-rate   мерил УРОВЕНЬ свопа, правило про СКОРОСТЬ
//   guards-measure-size-blind-to-count    мерил РАЗМЕР задачи, правило про СУММУ нагрузки
//   guard-unit-mismatched-to-rule         порог в ЧАСАХ, правило про ОКНО между событиями
//   baseline-count-stale-while-rate-green мерил ДОЛЮ, правило про ЧИСЛО кейсов
//   average-hides-below-corridor-streak   мерил СРЕДНЕЕ, правило про попадание ПО ДНЯМ
//
// У каждого есть очевидный вход, на котором прокси и правило расходятся, и каждый такой
// вход поймал бы отказ ДО выкладки. Обычные примеры («вот нарушение», «вот норма») этого
// не ловят: на них прокси и правило совпадают, поэтому тест зелёный, а прибор неверен.
//
// ПОЧЕМУ МАРКЕР НЕ МОЖЕТ БЫТЬ ПРОСТО КОММЕНТАРИЕМ. Комментарий рядом с починкой пишет
// тот же человек, что и починку, поэтому как доказательство он стоит ноль (правило от
// 2026-08-11). Поэтому `@divergence` обязан НАЗВАТЬ проверку в кавычках, и эта строка
// должна реально встречаться в файле как имя утверждения. Тогда маркер указывает на
// поведение, а не на намерение.
//
// Формат маркера:
//   // @divergence: "<точное имя проверки в самопроверке>" — <чем прокси разошёлся с правилом>
//
// Использование:
//   node scripts/oracle-divergence.mjs                # все механизмы с @closes-class
//   node scripts/oracle-divergence.mjs --changed      # только изменённые в правке
//   node scripts/oracle-divergence.mjs --ratchet      # блокирует НОВЫЕ приборы без кейса
//   node scripts/oracle-divergence.mjs --self-test

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Чистая: несёт ли файл заявление о закрытии класса (то есть является ли он прибором). */
export function declaresClass(text = '') {
  return /@closes-class:\s*\S+/.test(text);
}

/**
 * Чистая: разобрать маркер кейса расхождения.
 * @param {string} text исходник файла
 * @returns {{present:boolean, assertion:string|null, why:string}}
 */
export function divergenceCase(text = '') {
  // Экранированная кавычка ВНУТРИ имени не обрывает имя. Поймано на себе: маркер
  // gate-audit содержал \\" и разбор возвращал огрызок, после чего гейт требовал
  // проверку, которая на самом деле есть. Тот же дефект разбора кавычек, что и в
  // именах тестов у property-vs-method.
  const m = String(text).match(/@divergence:\s*"((?:\\.|[^"\\])+)"\s*(?:—|-{1,2})?\s*([^\n]*)/);
  if (!m) return { present: false, assertion: null, why: '' };
  return { present: true, assertion: m[1].replace(/\\(.)/g, '$1').trim(), why: (m[2] || '').trim() };
}

/**
 * Чистая: ГЛАВНАЯ проверка. Маркер сам по себе ничего не доказывает: названная им
 * проверка обязана существовать в файле. Иначе это снова доказательство, выписанное
 * себе самому, только другими словами.
 *
 * @param {string} text
 * @returns {{verdict:'ok'|'no-marker'|'assertion-missing'|'not-an-oracle', assertion:string|null}}
 */
export function verifyDivergence(text = '') {
  if (!declaresClass(text)) return { verdict: 'not-an-oracle', assertion: null };
  const d = divergenceCase(text);
  if (!d.present) return { verdict: 'no-marker', assertion: null };
  // Имя проверки должно встречаться ЕЩЁ РАЗ, вне самой строки маркера: один раз оно
  // объявлено, второй — использовано как имя утверждения.
  const withoutMarker = String(text).replace(/@divergence:[^\n]*\n/, '\n');
  const found = withoutMarker.includes(d.assertion);
  return { verdict: found ? 'ok' : 'assertion-missing', assertion: d.assertion };
}

// ── непрозрачная часть ──────────────────────────────────────────────────────
function listScripts(dir) {
  const out = [];
  const walk = (d) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p); }
      else if (/\.(mjs|sh)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function changedFiles() {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter((f) => /\.(mjs|sh)$/.test(f)).map((f) => join(ROOT, f)).filter((f) => existsSync(f));
  } catch { return []; }
}

export function auditFiles(files) {
  const rows = [];
  for (const f of files) {
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const v = verifyDivergence(text);
    if (v.verdict === 'not-an-oracle') continue;
    rows.push({ file: relative(ROOT, f), ...v });
  }
  return rows;
}

function selfTest() {
  const fails = [];
  let ran = 0;
  const ok = (n, c) => { ran++; if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('файл без @closes-class прибором не считается',
    verifyDivergence('const a = 1;').verdict === 'not-an-oracle');
  ok('прибор без маркера расхождения — no-marker',
    verifyDivergence('// @closes-class: some-class\nconst a = 1;').verdict === 'no-marker');
  ok('маркер разбирается: имя проверки и пояснение',
    (() => { const d = divergenceCase('// @divergence: "уровень высокий, скорость ноль" — прокси мерит уровень'); return d.assertion === 'уровень высокий, скорость ноль' && /прокси/.test(d.why); })());

  // САМОЕ ВАЖНОЕ УТВЕРЖДЕНИЕ ЭТОГО ФАЙЛА.
  // Оно же — собственный кейс расхождения прибора: измеряемая величина (есть строка
  // @divergence) говорит «чисто», а правило (кейс расхождения реально проверяется)
  // нарушено. Без него oracle-divergence мерил бы наличие ТЕКСТА вместо наличия проверки.
  ok('маркер есть, но названной проверки в файле НЕТ',
    verifyDivergence('// @closes-class: c\n// @divergence: "нет такой проверки" — пояснение\nconst a = 1;').verdict === 'assertion-missing');

  ok('маркер есть и названная проверка в файле есть — ok',
    verifyDivergence('// @closes-class: c\n// @divergence: "мой кейс" — пояснение\nok("мой кейс", true);').verdict === 'ok');
  ok('имя проверки возвращается для отчёта',
    verifyDivergence('// @closes-class: c\n// @divergence: "мой кейс" — п\nok("мой кейс", true);').assertion === 'мой кейс');
  ok('дефис вместо тире тоже разбирается',
    divergenceCase('// @divergence: "имя" - пояснение').assertion === 'имя');
  ok('РАСХОЖДЕНИЕ: экранированная кавычка внутри имени не обрывает имя',
    divergenceCase('// @divergence: "флаг \\"--repo\\" это корень" — п').assertion === 'флаг "--repo" это корень');
  ok('аудит пропускает файлы, которые не приборы',
    auditFiles([]).length === 0);

  if (fails.length) { console.log(`\n\x1b[31moracle-divergence self-test FAILED (${fails.length} из ${ran})\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ oracle-divergence: ${ran} прошло, 0 упало\x1b[0m`);
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const onlyChanged = process.argv.includes('--changed');
  const ratchet = process.argv.includes('--ratchet');
  const files = onlyChanged ? changedFiles() : listScripts(join(ROOT, 'scripts')).concat(listScripts(join(ROOT, 'hooks')));
  const rows = auditFiles(files);
  const missing = rows.filter((r) => r.verdict !== 'ok');

  console.log(`oracle-divergence — приборов проверено: ${rows.length}${onlyChanged ? ' (только изменённые)' : ''}`);
  const withCase = rows.filter((r) => r.verdict === 'ok').length;
  console.log(`  с кейсом расхождения: ${withCase} · без него: ${missing.length}`);
  for (const r of missing.slice(0, 40)) {
    const why = r.verdict === 'no-marker'
      ? 'нет маркера @divergence: не назван вход, где прокси говорит «чисто», а правило нарушено'
      : `маркер называет проверку «${r.assertion}», но такой проверки в файле нет`;
    console.log(`  \x1b[33m!\x1b[0m ${r.file}\n      ${why}`);
  }
  if (missing.length > 40) console.log(`  …и ещё ${missing.length - 40}`);

  if (ratchet && missing.length) {
    // Храповик: старый долг остаётся видимым и НЕ блокирует, новый прибор без кейса
    // расхождения не проходит. Блокировать всё разом значило бы объявить построенное
    // непостроенным и научить обходить гейт в первый же день.
    const changed = new Set(changedFiles().map((f) => relative(ROOT, f)));
    const fresh = missing.filter((r) => changed.has(r.file));
    if (fresh.length) {
      console.error(`\n\x1b[31m✗ ${fresh.length} изменённ(ых) прибор(ов) без кейса расхождения:\x1b[0m`);
      for (const f of fresh) console.error(`    ${f.file}`);
      console.error('  Назови вход, на котором измеряемая величина говорит «чисто», а правило нарушено,');
      console.error('  и заведи под него проверку. Формат: // @divergence: "<имя проверки>" — <чем разошлись>');
      process.exit(1);
    }
  }
  process.exit(0);
}
