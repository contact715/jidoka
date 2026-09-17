// cli-probe — живая проверка договора строгого разбора в песочнице.
//
// Договор, который проверяется для каждого строгого CLI:
//   --help  → код 0, справка в stdout, ни одной попытки побочного действия;
//   --bogus → код 2 (у хуков Claude Code — 1, см. HOOK_BAD_CALL_EXIT), в stderr названо
//             имя флага, ни одной попытки побочного действия.
//
// Скрипт запускается с предзагрузкой песочницы (cli-sandbox.mjs, preloadUrl), из пустой временной папки и с
// пустым HOME: даже пропущенная песочницей запись ушла бы во временную папку, а не в
// репозиторий или ~/.claude. stdin закрыт, чтобы скрипт-хук не ждал ввода.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { preloadUrl } from './cli-sandbox.mjs';

export const PRELOAD = preloadUrl();
const MARKER = 'CLI-SANDBOX-ATTEMPTS:';

/** Чистая: вытащить попытки побочных действий из stderr. */
export function attemptsIn(stderr = '') {
  const line = String(stderr).split('\n').find((l) => l.startsWith(MARKER));
  if (!line) return [];
  try { return JSON.parse(line.slice(MARKER.length)); } catch { return [{ op: 'неразборчивая строка песочницы', arg: line.slice(0, 120) }]; }
}

/** Запустить скрипт в песочнице. */
export function probe(file, args, { timeoutMs = 15000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cli-probe-'));
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, TMPDIR: dir, LANG: 'C.UTF-8', NO_COLOR: '1' };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', PRELOAD, file, ...args], {
      cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* временная папка — не страшно */ }
      resolve({ status, signal, stdout, stderr, attempts: attemptsIn(stderr) });
    });
  });
}

/** Чистая: нарушения договора по двум прогонам. badCallExit — 2, у хуков Claude Code 1. */
export function problems(help, bogus, flag = '--bogus', badCallExit = 2) {
  const out = [];
  if (help.status !== 0) out.push(`--help: код ${help.status ?? help.signal}, ждали 0`);
  if (!help.stdout.trim()) out.push('--help: справка пуста');
  if (help.attempts.length) out.push(`--help: побочные действия ${help.attempts.map((a) => a.op).join(', ')}`);
  if (bogus.status !== badCallExit) out.push(`${flag}: код ${bogus.status ?? bogus.signal}, ждали ${badCallExit}`);
  if (!bogus.stderr.includes(flag)) out.push(`${flag}: в stderr не названо имя флага`);
  if (bogus.attempts.length) out.push(`${flag}: побочные действия ${bogus.attempts.map((a) => a.op).join(', ')}`);
  return out;
}

/** Проверить договор для файла. */
export async function contract(file, opts = {}) {
  const flag = '--bogus-flag-cli-probe';
  const [help, bogus] = await Promise.all([probe(file, ['--help'], opts), probe(file, [flag], opts)]);
  return { file, help, bogus, problems: problems(help, bogus, flag, opts.badCallExit ?? 2) };
}
