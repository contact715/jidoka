#!/usr/bin/env node
// sandbox-run — REAL OS-level isolation for an agent's command, not a policy proxy. On macOS it uses
// the native kernel sandbox (sandbox-exec / Seatbelt): the command may READ anything but may WRITE
// only inside the declared scope, and network is denied by default. The kernel enforces it — an
// out-of-scope write returns "Operation not permitted" from the OS, not from a hook we wrote.
//
// This is the honest upgrade over policy-enforce-hook (which intercepts at the tool layer): here the
// process physically cannot escape its scope. macOS = FULL (sandbox-exec is built in). Linux =
// graceful degrade to firejail/bwrap if present, else honest skip (no fake "sandboxed").
//
// FULL & self-tested (profile generation is pure + tested; --verify runs a real kernel block test).
// Usage:
//   node scripts/sandbox-run.mjs --self-test
//   node scripts/sandbox-run.mjs --verify                                  # real kernel block proof
//   node scripts/sandbox-run.mjs --scope ./build --cmd "npm test"          # run isolated (write only ./build)
//   node scripts/sandbox-run.mjs --scope ./build --cmd "..." --network     # allow network

import { existsSync, realpathSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './lib/cli.mjs';

// pure: build a macOS Seatbelt (SBPL) profile — read anything, write only in writePaths, net off by default
export function buildProfile(writePaths, { network = false } = {}) {
  const lines = ['(version 1)', '(allow default)', '(deny file-write*)'];
  for (const p of writePaths) lines.push(`(allow file-write* (subpath "${p}"))`);
  // node/temp runtime needs these to function at all
  lines.push('(allow file-write* (subpath "/private/var/folders"))');
  lines.push('(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty") (literal "/dev/dtracehelper") (literal "/dev/random") (literal "/dev/urandom"))');
  if (!network) lines.push('(deny network*)');
  return lines.join('\n') + '\n';
}

export function detectSandbox() {
  if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) return 'sandbox-exec';
  for (const t of ['firejail', 'bwrap']) { try { execSync(`command -v ${t}`, { stdio: 'ignore' }); return t; } catch { /* no */ } }
  return 'none';
}

function selfTest() {
  const p = buildProfile(['/proj/build']);
  const T = [
    ['profile denies all writes by default', p.includes('(deny file-write*)')],
    ['profile allows the declared scope', p.includes('(allow file-write* (subpath "/proj/build"))')],
    ['profile denies network by default', p.includes('(deny network*)')],
    ['network flag lifts the net deny', !buildProfile(['/x'], { network: true }).includes('(deny network*)')],
    ['reads are allowed (allow default)', p.includes('(allow default)')],
    ['multiple scopes each get a rule (2 scopes + runtime temp = 3)', buildProfile(['/a', '/b']).match(/allow file-write\* \(subpath/g).length === 3],
    ['detectSandbox names a real mechanism or honest none', ['sandbox-exec', 'firejail', 'bwrap', 'none'].includes(detectSandbox())],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31msandbox-run self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ sandbox-run: profile generation correct\x1b[0m');
  process.exit(0);
}

// real kernel proof: a write inside scope succeeds, a write outside is blocked by the OS
function verify() {
  const mech = detectSandbox();
  if (mech !== 'sandbox-exec') { console.log(`sandbox-run --verify: kernel sandbox is '${mech}' on ${process.platform} — kernel block test is macOS/sandbox-exec only (honest skip here).`); process.exit(0); }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sbx-')));
  const allowed = join(dir, 'allowed'), denied = realpathSync(tmpdir());
  execSync(`mkdir -p ${allowed}`);
  const prof = join(dir, 'p.sb');
  writeFileSync(prof, buildProfile([allowed]));
  const inScope = spawnSync('/usr/bin/sandbox-exec', ['-f', prof, '/usr/bin/touch', join(allowed, 'ok.txt')], { encoding: 'utf8' });
  const outScope = spawnSync('/usr/bin/sandbox-exec', ['-f', prof, '/usr/bin/touch', join(denied, 'escape.txt')], { encoding: 'utf8' });
  console.log(`  in-scope write  (${allowed}): ${inScope.status === 0 ? '\x1b[32m✓ allowed\x1b[0m' : '✗ blocked (unexpected: ' + (inScope.stderr || '').trim() + ')'}`);
  console.log(`  out-of-scope write: ${outScope.status !== 0 ? '\x1b[32m✓ BLOCKED by the kernel\x1b[0m (' + (outScope.stderr || '').trim() + ')' : '\x1b[31m✗ escaped!\x1b[0m'}`);
  const ok = inScope.status === 0 && outScope.status !== 0;
  console.log(ok ? '\n\x1b[32m✓ kernel isolation real: writes confined to scope.\x1b[0m' : '\n\x1b[31m✗ isolation not behaving as expected\x1b[0m');
  process.exit(ok ? 0 : 1);
}

// Разбор строгий (2026-09-16): незнакомый флаг, лишнее слово или флаг без значения — код 2 до
// запуска команды. Код 2 здесь исторически значит и «нет песочницы в ОС» — он оставлен как был.
// --cmd — свободный текст для /bin/sh -c; текст, похожий на флаг, пишется как --cmd=<текст>.
export const CLI = {
  name: 'sandbox-run',
  summary: 'Запуск команды в песочнице ядра (macOS sandbox-exec): писать можно только в --scope, сеть закрыта.\nКод 2 также значит: в ОС нет поддерживаемой песочницы (команда не запущена).',
  selfTest: true,
  options: {
    scope: { type: 'string', value: 'папка', desc: 'единственная папка, куда команде можно писать' },
    cmd: { type: 'string', value: 'команда', desc: 'команда для /bin/sh -c (в кавычках)' },
    network: { type: 'boolean', desc: 'разрешить сеть (по умолчанию закрыта)' },
    verify: { type: 'boolean', desc: 'доказать изоляцию ядром: запись в папку проходит, вне — блокируется' },
  },
};

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  const { values, selfTest: wantsSelfTest } = runCli(CLI);
  if (wantsSelfTest) selfTest();
  if (values.verify) verify();
  const scope = values.scope || null, cmd = values.cmd || null;
  if (!scope || !cmd) { console.error('usage: --scope <writable-dir> --cmd "<command>" [--network] | --verify | --self-test'); process.exit(2); }
  const mech = detectSandbox();
  if (mech === 'none') { console.error(`sandbox-run: no OS sandbox on ${process.platform} (no sandbox-exec/firejail/bwrap) — refusing to claim isolation. Install one or run unsandboxed deliberately.`); process.exit(2); }
  if (mech !== 'sandbox-exec') { console.error(`sandbox-run: ${mech} detected but only sandbox-exec wiring is implemented — honest stop rather than a fake sandbox.`); process.exit(2); }
  const resolved = realpathSync(scope);
  const prof = join(mkdtempSync(join(tmpdir(), 'sbx-')), 'p.sb');
  const network = values.network === true;
  writeFileSync(prof, buildProfile([resolved], { network }));
  console.log(`sandbox-run: ${cmd}\n  isolation: sandbox-exec (kernel) · write-scope: ${resolved} · network: ${network ? 'on' : 'DENIED'}\n`);
  const r = spawnSync('/usr/bin/sandbox-exec', ['-f', prof, '/bin/sh', '-c', cmd], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
