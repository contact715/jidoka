// cli-replay — прогнать найденные места вызова через спецификации скриптов (без запуска работы).
//
// Для каждого скрипта с `export const CLI` каждый его вызов из инвентаря (cli-callsites.mjs)
// разбирается той же функцией, что и при настоящем запуске. Отказ = место вызова сломано
// строгим разбором: его нужно поправить ДО выкладки, а не узнать о нём от упавшего хука.
//
// Модули импортируются: import-safety гарантирует, что импорт ничего не делает. Для
// второго рубежа replayInSandbox() запускает сверку в отдельном процессе с песочницей.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseCli } from './cli.mjs';
import { PLACEHOLDER, RUNTIME } from './cli-callsites.mjs';
import { PRELOAD } from './cli-probe.mjs';

// Ошибки, которые у неполного вызова (package.json, упоминание в тексте) законны:
// хвост аргументов допишет тот, кто зовёт.
const PARTIAL_OK = /^(?:не хватает аргументов|нужна команда|флагу --[\w-]+ нужно значение)/;
const mentionsPlaceholder = (msg) => msg.includes(`«${PLACEHOLDER}»`) || msg.includes(`«${RUNTIME}»`);

/** Чистая: вердикт по одному вызову при известной спецификации. */
export function judge(call, spec) {
  let r;
  try { r = parseCli(call.args, spec); } catch (e) { return { ok: false, error: `спецификация падает: ${e.message}` }; }
  if (!r.error) return { ok: true, result: r };
  if ((call.partial || call.mention) && PARTIAL_OK.test(r.error)) return { ok: true, result: null };
  // заполнитель документации не обязан попадать в список значений или быть числом;
  // а вот лишнее слово или незнакомая команда — поломка и с заполнителем (`x.mjs $ARGUMENTS`)
  if (/не из списка|нужно число|принимает/.test(r.error) && mentionsPlaceholder(r.error)) return { ok: true, result: null };
  // «<команда>» в документации — любая из команд; значение запуска на её месте — поломка
  if (r.error.startsWith(`незнакомая команда «${PLACEHOLDER}»`)) return { ok: true, result: null };
  return { ok: false, error: r.error };
}

/**
 * Сверить вызовы; specs — Map путь → CLI; nonCli — модули без точки входа.
 * Аргументы модулю без точки входа — сломанное место: их никто не читает, и вызов
 * `node lib.mjs --self-test` выходит с 0, ничего не проверив (так жила проверка приёмки
 * meta-remedies до 2026-09-16).
 */
export function replay(calls, specs, nonCli = new Set(), missing = new Set()) {
  const failures = [];
  let checked = 0;
  const visit = (call, depth) => {
    const spec = specs.get(call.script);
    if (!spec) {
      // строка внутри .mjs чаще пример или данные теста, чем вызов: отсутствие файла судим по
      // исполняемым текстам и инструкциям (хуки git, CI, package.json, shell, CLAUDE.md, команды)
      if (missing.has(call.script) && call.args.length && !call.mention && enginePrefix(call.prefix) && !/\.mjs$/.test(call.source)) {
        checked++;
        failures.push({ ...call, error: 'скрипта нет в движке: вызов упадёт или зовёт чужой файл' });
        return;
      }
      if (nonCli.has(call.script) && call.args.length && !call.mention) {
        checked++;
        failures.push({ ...call, error: 'у модуля нет точки входа: аргументы никто не читает, вызов ничего не делает' });
      }
      return;
    }
    checked++;
    const v = judge(call, spec);
    if (!v.ok) { failures.push({ ...call, error: v.error }); return; }
    // диспетчер: хвост сверяется со спецификацией цели
    if (v.result && v.result.forward && depth < 3) {
      const target = `scripts/${v.result.forward}`;
      visit({ ...call, script: target, args: [...v.result.prepend, ...v.result.rest], via: call.script }, depth + 1);
    }
  };
  for (const c of calls) visit(c, 0);
  return { checked, failures };
}

/**
 * Чистая: указывает ли путь вызова на движок. Пустой префикс и $ROOT — репозиторий движка;
 * .jidoka/ и ~/.claude/jidoka/ — его установки; ~/.claude/hooks — установленные хуки.
 * Прочие (~/.claude/scripts, чужие репозитории) — не наши файлы.
 */
export function enginePrefix(prefix = '') {
  return prefix === '' || /(?:^|\/)(?:\.jidoka|\.claude\/jidoka|jidoka-framework)\/$|\$\{?ROOT\}?\/$|\.claude\/(?:hooks\/)?$/.test(prefix);
}

/**
 * Где лежит файл вызова. В каноне хуки из global-setup ставятся в тот же ~/.claude/hooks.
 * В установке (корень — ~/.claude/jidoka) папки global-setup нет: её файлы разложены по
 * ~/.claude, поэтому global-setup/x ищется как ../x. Без этого сверка, запущенная из установки
 * (так её и советуют звать), называла строку состояния «скриптом, которого нет в движке».
 */
export function resolveScript(root, script) {
  if (existsSync(join(root, script))) return script;
  const alt = script.replace(/^hooks\//, 'global-setup/hooks/');
  if (alt !== script && existsSync(join(root, alt))) return alt;
  const installed = basename(root) === 'jidoka' && basename(dirname(root)) === '.claude';
  if (installed && alt.startsWith('global-setup/')) {
    const up = join('..', alt.slice('global-setup/'.length));
    if (existsSync(join(root, up))) return up;
  }
  return null;
}

/** Загрузить спецификации скриптов из дерева root (импорт модулей). */
export async function loadSpecs(root, scripts) {
  const specs = new Map();
  const broken = [];
  const nonCli = new Set();
  const missing = new Set();
  const { parsing } = await import('../cli-strictness.mjs');
  for (const s of scripts) {
    const real = resolveScript(root, s);
    if (!real) { missing.add(s); continue; }
    const file = join(root, real);
    const src = readFileSync(file, 'utf8');
    // импортируются только модули со спецификацией: у остальных сверять не с чем
    if (!/\bexport\s+const\s+CLI\s*=/.test(src)) {
      if (!parsing(src).cli) nonCli.add(s);
      continue;
    }
    globalThis.__cliSandboxModule = s;   // песочница припишет попытку действия этому модулю
    try {
      const m = await import(pathToFileURL(file).href);
      if (m.CLI && typeof m.CLI === 'object') specs.set(s, m.CLI);
    } catch (e) {
      broken.push({ script: s, error: String(e && e.message ? e.message : e).slice(0, 200) });
    }
    globalThis.__cliSandboxModule = null;
  }
  return { specs, broken, nonCli, missing };
}

/** Сверка в отдельном процессе под песочницей: импорт чужого модуля не тронет мир. */
export function replayInSandbox(root, calls) {
  const self = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const code = `
    import { loadSpecs, replay } from ${JSON.stringify(self)};
    import { readFileSync } from 'node:fs';
    const calls = JSON.parse(readFileSync(0, 'utf8'));
    const scripts = [...new Set(calls.map((c) => c.script))];
    const { specs, broken, nonCli, missing } = await loadSpecs(${JSON.stringify(root)}, scripts);
    const r = replay(calls, specs, nonCli, missing);
    process.stdout.write(JSON.stringify({ ...r, broken, specs: specs.size }));
  `;
  const res = spawnSync(process.execPath, ['--import', PRELOAD, '--input-type=module', '-e', code], {
    input: JSON.stringify(calls), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: root, timeout: 120000,
  });
  if (res.status !== 0) throw new Error(`сверка упала: ${res.stderr.slice(0, 800)}`);
  const out = JSON.parse(res.stdout);
  const attempts = (res.stderr.split('\n').find((l) => l.startsWith('CLI-SANDBOX-ATTEMPTS:')) || '').slice(21).trim();
  return { ...out, attempts: attempts ? JSON.parse(attempts) : [] };
}

/**
 * Импортировать модули в отдельном процессе под песочницей и приписать попытки действий.
 * Живая проверка поверх статического import-safety: 2026-09-16 она нашла три модуля,
 * которые действовали при импорте (execSync, mkdtempSync, http.createServer), а статический
 * гейт считал их объявления безопасными.
 */
export function importAllInSandbox(root, files) {
  const code = `
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    import { readFileSync } from 'node:fs';
    const files = JSON.parse(readFileSync(0, 'utf8'));
    const broken = [];
    for (const f of files) {
      globalThis.__cliSandboxModule = f;
      try { await import(pathToFileURL(join(${JSON.stringify(root)}, f)).href); }
      catch (e) { broken.push({ script: f, error: String(e && e.message ? e.message : e).slice(0, 200) }); }
      globalThis.__cliSandboxModule = null;
    }
    process.stdout.write(JSON.stringify({ broken, imported: files.length }));
  `;
  const res = spawnSync(process.execPath, ['--import', PRELOAD, '--input-type=module', '-e', code], {
    input: JSON.stringify(files), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: root, timeout: 120000,
  });
  if (res.status !== 0) throw new Error(`импорт упал: ${String(res.stderr).slice(0, 800)}`);
  const out = JSON.parse(res.stdout);
  const line = res.stderr.split('\n').find((l) => l.startsWith('CLI-SANDBOX-ATTEMPTS:'));
  return { ...out, attempts: line ? JSON.parse(line.slice(21).trim()) : [] };
}
