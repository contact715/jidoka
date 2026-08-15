#!/usr/bin/env node
// @ts-check
/**
 * Гейт, который объявляет блокировку, обязан действительно блокировать.
 *
 * @closes-class gate-claims-block-but-passes
 *
 * ПРОИСХОЖДЕНИЕ (2026-06-10). Хук pre-commit печатал «Commit refused», писал
 * запись об обходе в .sdd-bypass.log — и коммит проходил. Причина: код выхода
 * дочернего скрипта не пробрасывался наружу. То есть «жёсткий» гейт был
 * фактически мягким И ЕЩЁ ЛОЖНО ОТЧИТЫВАЛСЯ, будто кто-то его обошёл. Это хуже
 * отсутствующего гейта: отсутствующий виден, а лгущий создаёт уверенность.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Два признака, оба дешёвые и текстовые:
 *
 *   1. ПРОБРОС В ХУКЕ. Строка вида `node scripts/X.mjs` внутри .husky/* обязана
 *      либо нести `|| exit $?`, либо стоять в присваивании (`VAR=$(...)`) или
 *      условии (`if ...`), где код выхода читают осознанно. Голый вызов —
 *      это ровно тот дефект: скрипт вернул 1, шелл пошёл дальше, хук вышел с 0.
 *
 *   2. НЕПУСТОЙ ВЫХОД У БЛОКИРУЮЩЕГО. Скрипт, который печатает слова
 *      блокировки (BLOCKED / refused / заблокирован / отказано), обязан иметь
 *      в коде выход с ненулевым статусом. Если во всём файле только
 *      `process.exit(0)` — он объявляет отказ и пропускает.
 *
 * ЧЕГО НЕ ПРОВЕРЯЕТСЯ, и это честная граница: достижимость ветки выхода. Здесь
 * нет символьного исполнения — только наличие. Скрипт с `process.exit(1)` в
 * мёртвой ветке пройдёт. Проверка ловит грубый и самый частый случай, а не все.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/**
 * Слова отказа. Специально БЕЗ голого «block»: первый вариант ловил его в
 * комментариях вроде «code-block» и «YAML block» и дал одиннадцать ложных
 * тревог на первом же прогоне. Гейт с таким шумом перестают читать, и он
 * становится хуже отсутствующего — ровно та болезнь, которую он лечит.
 */
const СЛОВА_БЛОКИРОВКИ =
  /(BLOCKED|refused|rejected|заблокирован|отказано|не пропус)/;

/**
 * Пробрасывает ли строка хука код выхода дочернего процесса.
 * @param {string} строка
 * @returns {boolean}
 */
export function пробрасываетКод(строка) {
  const т = строка.trim();
  if (!/^\S*node\s+\S+\.mjs/.test(т)) return true; // не прямой вызов — не наш случай
  if (/\|\|\s*exit/.test(т)) return true;          // || exit $?
  if (/\|\|\s*\{/.test(т)) return true;            // || { ...; exit 1; }
  if (/^\w+=\$\(/.test(т)) return true;            // VAR=$(node ...) — код читают отдельно
  if (/^if\s|^\s*if\s/.test(т)) return true;       // if node ...; then
  if (/\|\|\s*true/.test(т)) return true;          // осознанно НЕблокирующий
  if (/&&/.test(т)) return true;                   // цепочка — код участвует
  return false;
}

/**
 * Объявляет ли скрипт блокировку, не умея выйти ненулевым кодом.
 * @param {string} исходник
 * @returns {boolean}
 */
export function лжётОБлокировке(исходник) {
  // Считается только то, что скрипт РЕАЛЬНО ПЕЧАТАЕТ в канал ошибок. Упоминание
  // слова в комментарии или в обычном логе — не объявление блокировки.
  const каналОшибок = [...исходник.matchAll(/(?:process\.stderr\.write|console\.error)\(([\s\S]{0,400}?)\)/g)]
    .map((m) => m[1])
    .join('\n');
  if (!СЛОВА_БЛОКИРОВКИ.test(каналОшибок)) return false;
  const выходы = [...исходник.matchAll(/process\.exit\(\s*(\d+)/g)].map((m) => Number(m[1]));
  if (выходы.length === 0) return false;          // выходов нет вовсе — не наш признак
  return выходы.every((к) => к === 0);            // умеет выходить ТОЛЬКО нулём
}

/** @returns {string[]} претензии */
export function проверить() {
  const претензии = [];

  const husky = path.join(ROOT, '.husky');
  if (fs.existsSync(husky)) {
    for (const имя of fs.readdirSync(husky)) {
      const p = path.join(husky, имя);
      if (!fs.statSync(p).isFile()) continue;
      const строки = fs.readFileSync(p, 'utf8').split('\n');
      строки.forEach((строка, i) => {
        if (строка.trim().startsWith('#')) return;
        if (!пробрасываетКод(строка)) {
          претензии.push(
            `.husky/${имя}:${i + 1}: код выхода не пробрасывается — ` +
            `скрипт вернёт ошибку, а хук выйдет с нулём: ${строка.trim().slice(0, 70)}`,
          );
        }
      });
    }
  }

  const scripts = path.join(ROOT, 'scripts');
  if (fs.existsSync(scripts)) {
    for (const имя of fs.readdirSync(scripts)) {
      if (!имя.endsWith('.mjs')) continue;
      const исходник = fs.readFileSync(path.join(scripts, имя), 'utf8');
      if (лжётОБлокировке(исходник)) {
        претензии.push(
          `scripts/${имя}: объявляет блокировку, но во всём файле только process.exit(0) — ` +
          `гейт отчитывается об отказе и пропускает`,
        );
      }
    }
  }

  return претензии;
}

function самопроверка() {
  const случаи = [
    ['голый вызов ловится', !пробрасываетКод('node scripts/foo.mjs --staged')],
    ['|| exit $? пропускается', пробрасываетКод('node scripts/foo.mjs || exit $?')],
    ['присваивание пропускается', пробрасываетКод('OUT=$(node scripts/foo.mjs)')],
    ['условие пропускается', пробрасываетКод('if node scripts/foo.mjs; then')],
    ['|| true пропускается (осознанно мягкий)', пробрасываетКод('node scripts/foo.mjs || true')],
    ['не-node строка не трогается', пробрасываетКод('echo "hello"')],
    ['лгущий скрипт ловится', лжётОБлокировке('console.error("BLOCKED"); process.exit(0);')],
    ['честный скрипт не ловится', лжётОБлокировке('console.error("BLOCKED"); process.exit(1);') === false],
    ['скрипт без слов блокировки не трогается', лжётОБлокировке('console.log("ok"); process.exit(0);') === false],
    ['слово в КОММЕНТАРИИ не считается объявлением',
      лжётОБлокировке('// prevents code-block text from matching\nprocess.exit(0);') === false],
    ['слово в обычном логе не считается объявлением',
      лжётОБлокировке('console.log("YAML block parsed"); process.exit(0);') === false],
  ];
  let плохо = 0;
  for (const [имя, ок] of случаи) {
    process.stdout.write(`${ок ? '  ok  ' : '  FAIL'} ${имя}\n`);
    if (!ок) плохо++;
  }
  process.stdout.write(`[gate-honesty] самопроверка: ${случаи.length - плохо}/${случаи.length}\n`);
  return плохо === 0;
}

const запущенНапрямую =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);


const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  if (запущенНапрямую) {
    if (process.argv.includes('--self-test')) process.exit(самопроверка() ? 0 : 1);

    const претензии = проверить();
    if (претензии.length === 0) {
      process.stdout.write('[gate-honesty] ✓ гейты не лгут о блокировке\n');
      process.exit(0);
    }
    process.stderr.write('[gate-honesty] ГЕЙТ ОБЪЯВЛЯЕТ БЛОКИРОВКУ, НО ПРОПУСКАЕТ:\n');
    for (const п of претензии) process.stderr.write(`  • ${п}\n`);
    process.stderr.write(
      '\nЛгущий гейт хуже отсутствующего: отсутствующий виден, а этот создаёт\n' +
      'уверенность. Добавь `|| exit $?` к вызову или ненулевой выход в скрипт.\n',
    );
    process.exit(1);
  }
}
