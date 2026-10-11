#!/usr/bin/env node
// ONE-SHOT, запускает ВЛАДЕЛЕЦ: docs/proposals/cyrillic-word-class.proposed.md
//
// scripts/meta-remedies.mjs защищён: агент не пишет в реестр, по замыслу (агент, который
// регистрирует себе гейт, может объявить себя безопасным). Запуск этого скрипта и есть
// человеческое применение. Он:
//   1. регистрирует два класса на один механизм scripts/cyrillic-boundary.mjs
//      (ascii-word-boundary-blind-in-cyrillic — сторож стоит с 2026-08-26, но в реестре его нет;
//       ascii-word-class-blind-in-cyrillic — новый класс 2026-10-10);
//   2. чинит пять регулярок в самом реестре: две сломаны наверняка (`жёстк\w* гейт`,
//      `общ\w+ (класс…)` — premortem на русском тексте не срабатывал), три получают метку
//      @ascii-ok с причиной. Без этой части pre-commit заблокировал бы коммит регистрации;
//   3. пишет запись в ~/.claude/hooks/l0-write-audit.jsonl;
//   4. проверяет: реестр разбирается, cyrillic-boundary по нему зелёный, premortem ловит
//      русские фразы, meta-audit;
//   5. коммитит и пушит через safe-commit.mjs.
// Повторный запуск ничего не ломает: каждая правка применяется, только если старый текст
// ещё на месте, запись — только если её ещё нет.
//
// Запуск:  node ~/jidoka-framework/docs/proposals/apply-cyrillic-word-class.mjs
// Проба на копиях (без журнала и коммита):
//          node …/apply-cyrillic-word-class.mjs --targets /tmp/a.mjs,/tmp/b.mjs --no-commit

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCli } from '../../scripts/lib/cli.mjs';

const CANON = join(homedir(), 'jidoka-framework');
const { values } = runCli({
  name: 'apply-cyrillic-word-class',
  summary: 'Зарегистрировать классы кириллических регулярок и починить пять регулярок реестра (запускает владелец).',
  options: {
    targets: { type: 'string', value: 'пути', desc: 'через запятую; по умолчанию канон и установленная копия meta-remedies.mjs' },
    'no-commit': { type: 'boolean', desc: 'не писать журнал L0 и не коммитить (проба на копиях)' },
  },
});
const TARGETS = values.targets
  ? values.targets.split(',').map((s) => s.trim()).filter(Boolean)
  : [join(CANON, 'scripts', 'meta-remedies.mjs'), join(homedir(), '.claude', 'jidoka', 'scripts', 'meta-remedies.mjs')];

// Общий premortem двух записей: план говорит о регулярке и русском тексте, а о \p{L},
// юникоде, cyrillic-boundary или метке @ascii-ok — нет.
const PREMORTEM = String.raw`    premortem: {
      risk: /(регуляр|regexp?|word boundary|граница слова)[^\n]{0,80}(русск|кирилл|cyrillic|russian|имя файла|путь|file ?name)|(русск|кирилл|cyrillic|russian)[^\n]{0,80}(регуляр|regexp?|word boundary|граница слова)/i,
      clears: /\\p\{L\}|юникод|unicode|cyrillic-boundary|@ascii-ok/i,
      advise: 'в JavaScript \\w и \\b считают буквой только латиницу, флаг u этого не меняет: буква — [\\p{L}\\p{N}_], имя в коде — [\\p{ID_Start}$_][\\p{ID_Continue}$]*, граница — (?<![\\p{L}\\p{N}]) / (?![\\p{L}\\p{N}]); вход правда латинский — // @ascii-ok: <почему>',
    },`;

const ENTRIES = String.raw`  'ascii-word-boundary-blind-in-cyrillic': {
    // 2026-08-08 (маркеры отмены), 2026-08-24 ×2 (.jidoka-weekly), 2026-08-26 (closing-summary-gate):
    // \b вплотную к русской букве не срабатывает никогда — граница слова в JavaScript определена
    // по [A-Za-z0-9_]. Ловилось прогоном, ни разу чтением. Сторож построен 2026-08-26 и только
    // подсказывал; блокирующим стал 2026-10-10, когда дерево разобрано до нуля находок.
    since: '2026-10-10',
    mechanism: 'scripts/cyrillic-boundary.mjs',
    family: ['ascii-word-class-blind-in-cyrillic', 'detector-blind-to-non-latin-output'],
${PREMORTEM}
    gate: 'В изменённых .mjs (scripts, hooks, lib, global-setup) нет регулярки, где \\b стоит вплотную '
        + 'к кириллице. Блокирует pre-commit (cyrillic-boundary по staged-файлам), метка не снимает.',
  },
  'ascii-word-class-blind-in-cyrillic': {
    // 2026-10-10: research-audit брал имя файла через [\w./@-]+, адрес CORP_структура_компании.md:15
    // не засчитывался — 5 ложных STATUS-NO-EVIDENCE (в реестре ошибок это запись класса
    // measurement-tool-error-read-as-product-defect). Опись дерева в тот день: 1691 регулярка, 307
    // с \w или \b; 10 русских правил не срабатывали ни разу, разборщики кода не видели русских имён
    // (197 объявлений в движке). \w — только латиница, и флаг u этого не меняет.
    since: '2026-10-10',
    mechanism: 'scripts/cyrillic-boundary.mjs',
    family: ['ascii-word-boundary-blind-in-cyrillic', 'detector-blind-to-non-latin-output'],
${PREMORTEM}
    gate: 'В изменённых .mjs нет регулярки, где \\w, \\W или \\b может встретить русский текст и считает '
        + 'буквой только латиницу: место переписано на \\p{L} / \\p{ID_Continue} с флагом u или несёт '
        + '// @ascii-ok: <почему>; \\w рядом с кириллицей метка не снимает. Имя файла движка — только '
        + 'латиница. Блокирует pre-commit по staged-файлам.',
  },
`;

// [было, стало] — точный текст строк реестра на 2026-10-10.
const EDITS = [
  [String.raw`      clears: /\b(test|spec|passes|passing|exit code|output shown|proof|verified by running|\.test\.|\.spec\.)\b/i,`,
   String.raw`      // @ascii-ok: английский словарь доказательств; \b у латинских слов, находка из-за вариантов «.test.» и «.spec.»
      clears: /\b(test|spec|passes|passing|exit code|output shown|proof|verified by running|\.test\.|\.spec\.)\b/i,`],
  [String.raw`      risk: /\b(write|edit|append|sed -i|tee|cp|mv|writeFileSync)\b.*\b(CONSTITUTION|MISSION|NORTH_STAR|\.secrets|\.env|meta-remedies|baseline)\b/i,`,
   String.raw`      // @ascii-ok: английские глаголы записи и латинские имена защищённых файлов (CONSTITUTION, .env, baseline)
      risk: /\b(write|edit|append|sed -i|tee|cp|mv|writeFileSync)\b.*\b(CONSTITUTION|MISSION|NORTH_STAR|\.secrets|\.env|meta-remedies|baseline)\b/i,`],
  [String.raw`      risk: /\b(flawless|perfect(ly)?|bulletproof|comprehensive|robust|seamless|world[- ]class|state[- ]of[- ]the[- ]art|100%|all \w+ (pass(ed|ing)?|verified|confirmed|successful))\b/i,`,
   String.raw`      // @ascii-ok: английская похвала; «all \w+ passed» — английская фраза вида «all tests passed»
      risk: /\b(flawless|perfect(ly)?|bulletproof|comprehensive|robust|seamless|world[- ]class|state[- ]of[- ]the[- ]art|100%|all \w+ (pass(ed|ing)?|verified|confirmed|successful))\b/i,`],
  [String.raw`      risk: /(hard.?block|blocking gate|refuses|жёстк\w* гейт|блокирует коммит|не пропустит)/i,`,
   String.raw`      risk: /(hard.?block|blocking gate|refuses|жёстк\p{L}* гейт|блокирует коммит|не пропустит)/iu,`],
  [String.raw`      clears: /(clone|shared (class|helper|constant)|same class|клонир|общ\w+ (класс|константа|хелпер)|тот же класс)/i,`,
   String.raw`      clears: /(clone|shared (class|helper|constant)|same class|клонир|общ\p{L}+ (класс|константа|хелпер)|тот же класс)/iu,`],
];

let changed = 0;
for (const target of TARGETS) {
  let src;
  try { src = readFileSync(target, 'utf8'); } catch { console.log(`• ${target} — нет файла, пропущен`); continue; }
  const before = src;
  for (const [was, now] of EDITS) {
    if (src.includes(now)) continue;
    if (!src.includes(was)) { console.error(`✗ ${target} — строка не найдена, файл НЕ тронут:\n  ${was.slice(0, 100)}…`); process.exit(1); }
    src = src.replace(was, now);
  }
  if (!src.includes("'ascii-word-class-blind-in-cyrillic':")) {
    const closing = src.lastIndexOf('};');
    if (closing === -1) { console.error(`✗ ${target} — нет закрывающей "};", файл НЕ тронут`); process.exit(1); }
    src = src.slice(0, closing) + ENTRIES + src.slice(closing);
  }
  if (src === before) { console.log(`• ${target} — уже применено`); continue; }
  writeFileSync(target, src);
  console.log(`✓ ${target} — 2 класса зарегистрированы, 5 регулярок поправлены`);
  changed++;
}

// проверка: реестр разбирается, записи на месте, premortem ловит русские фразы
for (const target of TARGETS) {
  if (!existsSync(target)) continue;
  let mod;
  try { mod = await import(pathToFileURL(target).href + '?v=' + Date.now()); }
  catch (e) { console.error(`✗ ${target} — НЕ РАЗБИРАЕТСЯ: ${e.message}`); process.exit(1); }
  const R = mod.REMEDIES || {};
  const probes = [
    ['оба класса на месте', !!R['ascii-word-boundary-blind-in-cyrillic'] && !!R['ascii-word-class-blind-in-cyrillic']],
    ['premortem «жёсткий гейт» срабатывает', Object.values(R).some((e) => e.premortem?.risk?.test?.('поставим жёсткий гейт на пуш'))],
    ['premortem «общий класс» снимает риск', Object.values(R).some((e) => e.premortem?.clears?.test?.('вынесем в общий класс'))],
    ['premortem класса видит план «регулярка по русскому тексту»', R['ascii-word-class-blind-in-cyrillic']?.premortem.risk.test('добавлю регулярку для русских заголовков')],
  ];
  for (const [name, okv] of probes) {
    console.log(`${okv ? '✓' : '✗'} ${target.replace(homedir(), '~')} — ${name}`);
    if (!okv) process.exit(1);
  }
}
const cb = join(CANON, 'scripts', 'cyrillic-boundary.mjs');
execFileSync(process.execPath, [cb, ...TARGETS.filter(existsSync)], { stdio: 'inherit', cwd: CANON });

if (values['no-commit']) { console.log('\n• проба: журнал L0 и коммит пропущены'); process.exit(0); }
if (changed > 0) {
  appendFileSync(join(homedir(), '.claude', 'hooks', 'l0-write-audit.jsonl'), JSON.stringify({
    ts: new Date().toISOString(),
    target: 'scripts/meta-remedies.mjs (canon + installed)',
    grantedBy: 'owner',
    reason: 'owner ran docs/proposals/apply-cyrillic-word-class.mjs: register ascii-word-boundary-blind-in-cyrillic + ascii-word-class-blind-in-cyrillic → cyrillic-boundary; fix 5 registry regexes (docs/proposals/cyrillic-word-class.proposed.md)',
    appliedBy: 'owner-run apply-cyrillic-word-class.mjs',
  }) + '\n');
  console.log('✓ запись в ~/.claude/hooks/l0-write-audit.jsonl');
  console.log('\n— meta-audit —');
  try { execFileSync(process.execPath, ['scripts/meta-audit.mjs'], { cwd: CANON, stdio: 'inherit' }); } catch { /* отчёт напечатан, код не важен */ }
  console.log('\n— commit —');
  const message = 'gate(registry): кириллические регулярки → cyrillic-boundary (применил владелец)\n\n'
    + 'Два класса на один механизм: ascii-word-boundary-blind-in-cyrillic и\n'
    + 'ascii-word-class-blind-in-cyrillic. Пять регулярок реестра поправлены: две\n'
    + 'русские premortem-фразы не срабатывали (жёсткий гейт, общий класс), три\n'
    + 'помечены @ascii-ok. По docs/proposals/cyrillic-word-class.proposed.md.\n\n'
    + 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
  execFileSync(process.execPath, [join(homedir(), '.claude', 'jidoka', 'scripts', 'safe-commit.mjs'), '--repo', CANON, '--message', message], { stdio: 'inherit' });
}
console.log('\n✓ готово');
