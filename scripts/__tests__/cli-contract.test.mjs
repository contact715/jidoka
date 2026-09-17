// Договор строгого разбора, проверенный ЖИВЫМ запуском — класс extra-argument-silently-swallowed.
//
// Для каждого CLI, который cli-strictness признал строгим: --help → 0 и справка, незнакомый
// флаг → 2 (у хуков Claude Code → 1) с именем флага, и ни одной попытки побочного действия.
// Запуск только в песочнице scripts/lib/cli-sandbox.mjs, из пустой временной папки.
// Непереведённые скрипты не запускаются: их незнакомый флаг — ровно та опасность, которую мы меряем.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { allFiles, analyzeFile } from '../cli-strictness.mjs';
import { contract, problems, probe } from '../lib/cli-probe.mjs';
import { importAllInSandbox } from '../lib/cli-replay.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const files = allFiles(ROOT);
const strict = files.map((f) => analyzeFile(f, ROOT)).filter((r) => r.cli && r.strict);

/** Чистая: пути в справке с тем же именем файла, но из другой папки. */
export function wrongPaths(help, file) {
  const name = file.split('/').pop();
  return [...String(help).matchAll(/\bnode\s+(\S+\.mjs)\b/g)].map((m) => m[1])
    .filter((p) => p.split('/').pop() === name && !p.endsWith(file));
}

describe('проверка пути в справке сама умеет краснеть', () => {
  it('scripts/x.mjs вместо scripts/dashboard/x.mjs — нарушение', () => {
    assert.deepEqual(wrongPaths('node scripts/x.mjs --json', 'scripts/dashboard/x.mjs'), ['scripts/x.mjs']);
  });
  it('путь установки с тем же хвостом — не нарушение', () => {
    assert.deepEqual(wrongPaths('node ~/.claude/jidoka/scripts/dashboard/x.mjs', 'scripts/dashboard/x.mjs'), []);
  });
});

describe('договор проверяется не на пустом множестве', () => {
  it('строгих CLI больше нуля', () => assert.ok(strict.length > 0, 'нечего проверять — зелёный был бы ложным'));
});

describe('песочница ловит действия, а не только их упоминание', () => {
  it('запись файла через именованный импорт, запуск команды и сеть пойманы, файла нет', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-sbx-test-'));
    const target = join(dir, 'written.txt');
    const mod = join(dir, 'act.mjs');
    writeFileSync(mod, [
      "import { writeFileSync } from 'node:fs';",
      "import { execSync } from 'node:child_process';",
      `try { writeFileSync(${JSON.stringify(target)}, 'x'); } catch {}`,
      "try { execSync('echo hi'); } catch {}",
      "try { await fetch('https://example.com'); } catch {}",
    ].join('\n'));
    try {
      const r = await probe(mod, []);
      const ops = r.attempts.map((a) => a.op);
      assert.ok(ops.includes('fs.writeFileSync'), ops.join(','));
      assert.ok(ops.includes('child_process.execSync'), ops.join(','));
      assert.ok(ops.includes('fetch'), ops.join(','));
      assert.equal(existsSync(target), false, 'песочница пропустила запись');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('обходные пути тоже пойманы: отчёт процесса, права через дескриптор, сервер, сокет, dns, объект без прототипа', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-sbx-test-'));
    const report = join(dir, 'report.json');
    const target = join(dir, 'ro.txt');
    writeFileSync(target, 'x');
    const mod = join(dir, 'act2.mjs');
    writeFileSync(mod, [
      "import fs from 'node:fs';",
      "import net from 'node:net';",
      "import http from 'node:http';",
      "import dns from 'node:dns';",
      "import v8 from 'node:v8';",
      "import { Worker } from 'node:worker_threads';",
      `try { process.report.writeReport(${JSON.stringify(report)}); } catch {}`,
      `try { const fd = fs.openSync(${JSON.stringify(target)}, 'r'); fs.fchmodSync(fd, 0o600); } catch {}`,
      "try { new net.Server().listen(0); } catch {}",
      "try { new net.Socket().connect(9, '127.0.0.1'); } catch {}",
      "try { http.request({ __proto__: null, host: '127.0.0.1', port: 9 }); } catch {}",
      "try { dns.lookup('example.com', () => {}); } catch {}",
      "try { v8.writeHeapSnapshot(); } catch {}",
      "try { new Worker('0', { eval: true }); } catch {}",
      "process.exit(0);",
    ].join('\n'));
    try {
      const r = await probe(mod, []);
      const ops = r.attempts.map((a) => a.op).join(',');
      for (const op of ['process.report.writeReport', 'fs.fchmodSync', 'net.Server.listen', 'net.Socket.connect', 'http.request', 'dns.lookup', 'v8.writeHeapSnapshot', 'worker_threads.Worker']) {
        assert.ok(ops.includes(op), `не пойман ${op}: ${ops}`);
      }
      assert.equal(existsSync(report), false, 'отчёт процесса записан');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('модуль песочницы при импорте ничего не подменяет', async () => {
    const fs = await import('node:fs');
    const before = fs.writeFileSync;
    await import('../lib/cli-sandbox.mjs');
    assert.equal(fs.writeFileSync, before);
  });
});

describe('зонд сам умеет краснеть', () => {
  const run = (status, stdout = '', stderr = '', attempts = []) => ({ status, stdout, stderr, attempts, signal: null });
  it('код 1 на незнакомом флаге — нарушение', () => {
    assert.ok(problems(run(0, 'справка'), run(1, '', '--x'), '--x').some((p) => /ждали 2/.test(p)));
  });
  it('попытка записи до разбора — нарушение', () => {
    assert.ok(problems(run(0, 'справка'), run(2, '', '--x', [{ op: 'fs.writeFileSync' }]), '--x').some((p) => /побочные/.test(p)));
  });
  it('пустая справка — нарушение', () => {
    assert.ok(problems(run(0, ''), run(2, '', '--x'), '--x').some((p) => /справка пуста/.test(p)));
  });
  it('у хука ждём 1, а не 2', () => {
    assert.deepEqual(problems(run(0, 'справка'), run(1, '', '--x'), '--x', 1), []);
  });
});

describe('строгие CLI выполняют договор', { concurrency: 8 }, () => {
  for (const r of strict) {
    it(`${r.file}: --help → 0, незнакомый флаг → ${r.badCallExit}, без побочных действий`, async () => {
      const c = await contract(join(ROOT, r.file), { badCallExit: r.badCallExit });
      assert.deepEqual(c.problems, [], `${r.file}\nstdout: ${c.bogus.stdout.slice(0, 300)}\nstderr: ${c.bogus.stderr.slice(0, 600)}`);
      assert.deepEqual(wrongPaths(c.help.stdout, r.file), [], `${r.file}: справка называет файл не по его месту`);
    });
  }
});

describe('импорт модулей ничего не делает (живая проверка поверх import-safety)', () => {
  const r = importAllInSandbox(ROOT, files);
  it('импортировано всё множество, а не пустое', () => assert.equal(r.imported, files.length));
  it('ни один модуль не пытается писать, запускать, ходить в сеть при импорте', () => {
    assert.deepEqual(r.attempts.map((a) => `${a.during}: ${a.op} ${a.arg.slice(0, 60)}`), []);
  });
  it('каждый модуль импортируется', () => assert.deepEqual(r.broken, []));
});
