// load-cli — строгий разбор аргументов (scripts/lib/cli.mjs) для хука из ЕГО СОБСТВЕННОГО дерева.
//
// Хук живёт в двух раскладках: канон (<репо>/hooks, <репо>/global-setup/hooks) и установка
// (~/.claude/hooks рядом с ~/.claude/jidoka/scripts). Статический импорт упал бы в одной из них.
// Порядок важен: установка проверяется первой, потому что рядом с ~/.claude/hooks лежит ЧУЖОЙ
// ~/.claude/scripts, и одноимённый файл там не должен перехватить помощник. Домашний каталог
// не используется вовсе: хук из канона обязан судить кодом канона (урок sibling-parity-gate,
// 2026-09-16).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Чистая: кандидаты по каталогу хука, по порядку. */
export function cliCandidates(hookDir) {
  // библиотека хуков (hooks/lib) ищет помощник от каталога хуков
  if (/[\\/]hooks[\\/]lib[\\/]?$/.test(hookDir)) return cliCandidates(dirname(hookDir.replace(/[\\/]$/, '')));
  // строка состояния: установка — ~/.claude/statusline-jidoka.mjs, канон — <репо>/global-setup/
  if (/[\\/]\.claude[\\/]?$/.test(hookDir)) return [join(hookDir, 'jidoka', 'scripts', 'lib', 'cli.mjs')];
  if (/[\\/]global-setup[\\/]?$/.test(hookDir)) return [join(hookDir, '..', 'scripts', 'lib', 'cli.mjs')];
  const out = [
    join(hookDir, '..', 'jidoka', 'scripts', 'lib', 'cli.mjs'),   // ~/.claude/hooks → ~/.claude/jidoka/scripts
    join(hookDir, '..', 'scripts', 'lib', 'cli.mjs'),             // <репо>/hooks → <репо>/scripts
  ];
  // <репо>/global-setup/hooks → <репо>/scripts; только в этой раскладке, иначе ../../ ушло бы в чужой HOME
  if (/[\\/]global-setup[\\/]hooks[\\/]?$/.test(hookDir)) out.push(join(hookDir, '..', '..', 'scripts', 'lib', 'cli.mjs'));
  return out;
}

// Узнаётся по тексту ДО импорта: импорт чужого одноимённого файла — это его запуск.
const OURS = 'export const HOOK_BAD_CALL_EXIT';
const isOurs = (p) => { try { return readFileSync(p, 'utf8').includes(OURS); } catch { return false; } };

/** Загрузить помощник для хука, чей import.meta.url передан. */
export async function loadCli(hookUrl, exists = (p) => existsSync(p) && isOurs(p)) {
  const dir = dirname(fileURLToPath(hookUrl));
  const found = cliCandidates(dir).find((p) => exists(p));
  if (!found) throw new Error(`не найден scripts/lib/cli.mjs рядом с ${dir}`);
  return import(pathToFileURL(found).href);
}
