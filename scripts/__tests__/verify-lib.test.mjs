// Помощник проверок (scripts/lib/verify.mjs) — класс green-check-that-checks-nothing.
// Здесь скрипт запускается НАСТОЯЩИМ процессом: встроенная --self-test зовёт функции
// напрямую и не видит поломки точки входа (реестр ошибок, 2026-08-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'verify.mjs');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('same: пустое против пустого — код 3, «не проверено», а не «равно»', () => {
  const r = run('same', '--a', '', '--b', '');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /НЕ ПРОВЕРЕНО/);
});

test('same: одинаковый текст ошибки базы с обеих сторон — код 3', () => {
  const e = 'ERROR:  column "slug" does not exist';
  assert.equal(run('same', '--a', e, '--b', e).status, 3);
});

test('same: равные непустые — код 0, разные — код 1', () => {
  assert.equal(run('same', '--a', '42', '--b', '42').status, 0);
  const r = run('same', '--a', '42', '--b', '43');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /РАЗЛИЧАЕТСЯ/);
});

test('same: забытый --a — неверный вызов, код 2, ничего не выполнено', () => {
  const r = run('same', '--b', '42');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Ничего не выполнено/);
});

test('same --json: вердикт и причина в разборе', () => {
  const r = run('same', '--a', '', '--b', '7', '--json');
  assert.equal(r.status, 3);
  const j = JSON.parse(r.stdout);
  assert.equal(j.verdict, 'unverified');
  assert.match(j.reason, /a/);
});

test('present: недостающие строки названы, код 1', () => {
  const conf = 'include a.conf;\ninclude b.conf;\n';
  const r = run('present', '--text', conf, '--needle', 'error_page 404', '--needle', 'include a.conf;');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /error_page 404/);
  assert.doesNotMatch(r.stderr, /include a\.conf/);
});

test('present --file: всё на месте — код 0; файла нет — код 3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-lib-'));
  try {
    const f = join(dir, 'site.conf');
    writeFileSync(f, 'error_page 404 /404.html;\nreturn 301 https://example.com$request_uri;\n');
    assert.equal(run('present', '--file', f, '--needle', 'error_page 404', '--needle', 'return 301').status, 0);
    assert.equal(run('present', '--file', join(dir, 'нет.conf'), '--needle', 'x').status, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('present: без --needle или с пустой строкой — неверный вызов, код 2', () => {
  assert.equal(run('present', '--text', 'abc').status, 2);
  assert.equal(run('present', '--text', 'abc', '--needle', '').status, 2);
  assert.equal(run('present', '--text', 'abc', '--file', '/tmp/x', '--needle', 'a').status, 2);
});

test('договор CLI: --help 0, незнакомый флаг 2, --self-test 0', () => {
  assert.equal(run('--help').status, 0);
  assert.equal(run('same', '--a', '1', '--b', '1', '--bogus').status, 2);
  assert.equal(run('--self-test').status, 0);
});
