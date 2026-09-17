// cli-sandbox — песочница для доказательства «--help и --bogus ничего не делают».
//
//   в коде: spawn(node, ['--import', preloadUrl(), file, ...args]) — см. scripts/lib/cli-probe.mjs
//
// Сам модуль при импорте ничего не делает (import-safety): подмена включается явным вызовом
// installSandbox(), а preloadUrl() даёт data:-адрес крошечной предзагрузки, которая его делает.
//
// Подменяет всё, чем скрипт может изменить мир: запись, переименование и удаление
// файлов, запуск команд, сеть, сигналы процессам. Любая попытка записывается и
// роняет вызов исключением. При выходе список попыток печатается в stderr одной
// строкой `CLI-SANDBOX-ATTEMPTS: [...]` — её читает scripts/lib/cli-probe.mjs.
// Скрипт, который проглотил исключение и продолжил, всё равно попадёт в список.
//
// Чтение не трогается: справке и разбору аргументов можно читать файлы.
// stdout и stderr (дескрипторы 1 и 2) открыты — иначе не напечатать справку.
//
// Чего песочница НЕ ловит (сказано вслух, чтобы зелёный не читался шире, чем есть):
// прямые привязки (process.binding, internalBinding), родные модули (.node), WASI,
// запись через дескриптор, открытый до её загрузки, inspector, подмену самой песочницы
// кодом скрипта. Для доказательства «разбор идёт раньше работы» этого достаточно: разбор —
// первое, что делает строгий скрипт, и обходить песочницу ему незачем.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import v8 from 'node:v8';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';

export const MARKER = 'CLI-SANDBOX-ATTEMPTS:';

/** data:-адрес предзагрузки, которая включает песочницу до загрузки проверяемого файла. */
export function preloadUrl() {
  const self = new URL(import.meta.url).href;
  return `data:text/javascript,${encodeURIComponent(`import { installSandbox } from ${JSON.stringify(self)}; installSandbox();`)}`;
}

const WRITES = ['writeFile', 'appendFile', 'mkdir', 'rename', 'copyFile', 'cp', 'symlink', 'link', 'chmod', 'chown',
  'lchown', 'lchmod', 'truncate', 'utimes', 'lutimes', 'mkdtemp', 'mkdtempDisposable', 'unlink', 'rm', 'rmdir',
  // через уже открытый дескриптор: права, владелец, размер, время, запись векторами
  'fchmod', 'fchown', 'ftruncate', 'futimes', 'writev'];
const DNS = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx',
  'resolveNs', 'resolveTxt', 'resolveSrv', 'resolvePtr', 'reverse'];
// Описание аргумента не должно само падать: у объекта без прототипа String() бросает исключение,
// и попытка не попала бы в список, хотя действие отменено (найдено ревью 2026-09-16).
const describe = (v) => {
  try { return String(v).slice(0, 160); } catch { return Object.prototype.toString.call(v); }
};
const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_TRUNC;
const writesTo = (flags) => (typeof flags === 'number' ? (flags & WRITE_FLAGS) !== 0 : /[wa+]/.test(String(flags ?? 'r')));

let installed = false;

/** Подменить всё, чем процесс может изменить мир. Повторный вызов ничего не делает. */
export function installSandbox() {
  if (installed) return;
  installed = true;
  const attempts = [];
  const writeSync = fs.writeSync.bind(fs);
  const openSync = fs.openSync.bind(fs);
  const fsOpen = fs.open.bind(fs);
  const fspOpen = fsp.open.bind(fsp);

  const trap = (op) => function trapped(...args) {
    attempts.push({ op, arg: describe(args[0]), during: globalThis.__cliSandboxModule || null });
    throw new Error(`CLI-SANDBOX: побочное действие до разбора аргументов: ${op}`);
  };

  for (const k of WRITES) {
    if (typeof fs[k] === 'function') fs[k] = trap(`fs.${k}`);
    if (typeof fs[`${k}Sync`] === 'function') fs[`${k}Sync`] = trap(`fs.${k}Sync`);
    if (typeof fsp[k] === 'function') fsp[k] = trap(`fs/promises.${k}`);
  }
  fs.createWriteStream = trap('fs.createWriteStream');

  fs.openSync = function sandboxOpenSync(p, flags, ...rest) {
    if (writesTo(flags)) return trap('fs.openSync(запись)')(p);
    return openSync(p, flags, ...rest);
  };
  fs.open = function sandboxOpen(p, flags, ...rest) {
    if (typeof flags !== 'function' && writesTo(flags)) return trap('fs.open(запись)')(p);
    return fsOpen(p, flags, ...rest);
  };
  fsp.open = function sandboxPromisesOpen(p, flags, ...rest) {
    if (writesTo(flags)) return trap('fs/promises.open(запись)')(p);
    return fspOpen(p, flags, ...rest);
  };
  fs.writeSync = function sandboxWriteSync(fd, ...rest) {
    if (fd === 1 || fd === 2) return writeSync(fd, ...rest);
    return trap('fs.writeSync')(fd);
  };
  fs.write = trap('fs.write');

  for (const k of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) cp[k] = trap(`child_process.${k}`);
  for (const [name, mod] of [['http', http], ['https', https]]) {
    for (const k of ['request', 'get', 'createServer']) mod[k] = trap(`${name}.${k}`);
  }
  for (const k of ['connect', 'createConnection', 'createServer']) net[k] = trap(`net.${k}`);
  // сервер и сокет, созданные конструктором, минуют createServer/connect модуля
  net.Server.prototype.listen = trap('net.Server.listen');
  net.Socket.prototype.connect = trap('net.Socket.connect');
  tls.connect = trap('tls.connect');
  dgram.createSocket = trap('dgram.createSocket');
  for (const k of DNS) {
    if (typeof dns[k] === 'function') dns[k] = trap(`dns.${k}`);
    if (dns.promises && typeof dns.promises[k] === 'function') dns.promises[k] = trap(`dns/promises.${k}`);
  }
  globalThis.fetch = trap('fetch');
  if (typeof globalThis.WebSocket === 'function') globalThis.WebSocket = trap('WebSocket');
  process.kill = trap('process.kill');
  if (typeof process.execve === 'function') process.execve = trap('process.execve');
  if (process.report) process.report.writeReport = trap('process.report.writeReport');
  v8.writeHeapSnapshot = trap('v8.writeHeapSnapshot');
  workerThreads.Worker = trap('worker_threads.Worker');

  syncBuiltinESMExports();

  process.on('exit', () => {
    if (attempts.length) writeSync(2, `\n${MARKER} ${JSON.stringify(attempts)}\n`);
  });
}
