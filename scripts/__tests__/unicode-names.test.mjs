// Русские имена в разборщиках, у которых нет своей самопроверки (2026-10-10).
//
// \w и \b в JavaScript считают буквой только [A-Za-z0-9_], и флаг u этого НЕ меняет:
// /\w/u.test('ж') === false. Имя волны, номер критерия, имя навыка, тип сущности пишут люди,
// и бывает по-русски. Ошибки при этом нет: правило просто молча не совпадает. Лечение —
// [\p{L}\p{N}_] (и \p{M} для имён файлов в NFD) с флагом u. Каждая проверка ниже падает на
// прежней регулярке с \w: это сверено прогоном, а не чтением.
//
// Проверки лежат здесь, потому что у этих модулей нет selfTest: sync-specs-to-memory,
// build-lineage-graph, audit-meta-process, restore-memory-from-snapshots, surface-concerns,
// meta-audit. Модули импортируются без побочных эффектов (работа только под isMain).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const load = (rel) => import(join(ROOT, 'scripts', rel));

const { extractACs } = await load('sync-specs-to-memory.mjs');
const { WAVE_NORM_RE, SUPERSEDES_TOKEN_RE } = await load('build-lineage-graph.mjs');
const audit = await load('audit-meta-process.mjs');
const retro = await load('extract-retro-memory.mjs');
const { SKILL_REF_RE } = await load('restore-memory-from-snapshots.mjs');
const { MEMORY_ROW_RE } = await load('surface-concerns.mjs');
const { FIRST_DIR_RE } = await load('meta-audit.mjs');

test('sync-specs-to-memory: русский номер критерия извлекается (**AC-вход.1**)', () => {
  const acs = extractACs('- **AC-вход.1** вход по ссылке из письма работает без пароля\n');
  assert.deepEqual(acs.map((a) => a.label), ['AC-вход.1']);
});

test('build-lineage-graph: русский слаг волны входит в совпадение целиком (wave-117-ретро)', () => {
  // normalizeWaveId берёт только номер, поэтому на его выходе разницы нет; разница в том,
  // где кончается совпадение: прежде оно обрывалось на «wave-117», хвост терялся.
  assert.equal('wave-117-ретро'.match(WAVE_NORM_RE)?.[0], 'wave-117-ретро');
  assert.equal('wave-117-retro'.match(WAVE_NORM_RE)?.[0], 'wave-117-retro');
});

test('build-lineage-graph: файл решения с русским именем — ссылка, а не проза', () => {
  assert.equal(SUPERSEDES_TOKEN_RE.test('docs/decisions/ADR-002-хранение.md'), true);
  assert.equal(SUPERSEDES_TOKEN_RE.test('ADR-002-хранение-токенов'), true);
  assert.equal(SUPERSEDES_TOKEN_RE.test('ADR-002-сбой.md'.normalize('NFD')), true); // «й» = «и» + знак
  // проза по-прежнему отклоняется: пробелы и скобки
  assert.equal(SUPERSEDES_TOKEN_RE.test('часть DEC-002 (возможности)'), false);
});

test('audit-meta-process: ретро русской волны не выпадает из аудита (wave-починка.md)', () => {
  const re = audit.RETRO_FILE_RE;
  assert.equal(re.test('wave-починка.md'), true);
  assert.equal(re.test('wave-сбой.md'.normalize('NFD')), true);
  assert.equal(re.test('wave-tui-top.md'), true);
  assert.equal(re.test('_TEMPLATE.md'), false);
  assert.equal(re.test('wave-починка.txt'), false);
});

test('сёстры: правило имени ретро одинаково в audit-meta-process и extract-retro-memory', () => {
  // две копии одного правила уже расходились (AC_RE, 2026-08): совпадение сверяет машина
  assert.equal(audit.RETRO_FILE_RE.source, retro.RETRO_FILE_RE.source);
  assert.equal(audit.RETRO_FILE_RE.flags, retro.RETRO_FILE_RE.flags);
  assert.equal(retro.RETRO_FILE_RE.test('wave-починка.md'), true);
});

test('restore-memory-from-snapshots: навык с русским именем попадает в связи (skill-навык-тест)', () => {
  const got = 'см. skill-навык-тест и skill-dev-pipeline'.match(SKILL_REF_RE);
  assert.deepEqual(got, ['skill-навык-тест', 'skill-dev-pipeline']);
});

test('surface-concerns: строка снимка памяти с русским типом разбирается (| Решение |)', () => {
  const md = '| `сущность-1` | Решение | наблюдение без отметки | wave-1 |\n'
           + '| `anti-pattern-x` | AntiPattern | Wave origin: wave-145 | wave-145 |\n';
  const rows = [...md.matchAll(MEMORY_ROW_RE)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rows, [['сущность-1', 'Решение'], ['anti-pattern-x', 'AntiPattern']]);
});

test('meta-audit: механизм в папке с русским именем — внешний, а не сломанный (проект/hooks/x.mjs)', () => {
  assert.equal(FIRST_DIR_RE.test('проект/hooks/gate.mjs'), true);
  assert.equal(FIRST_DIR_RE.test('projectx-app/hooks/gate.mjs'), true);
  assert.equal(FIRST_DIR_RE.test('/абсолютный/путь.mjs'), false);
});
