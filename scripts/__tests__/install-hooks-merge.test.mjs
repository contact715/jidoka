// Слияние хуков установщиком (global-setup/install-global.sh, шаг 6) — 2026-09-17.
//
// Установщик сравнивал хуки только по команде. Один и тот же хук, подключённый к двум наборам
// инструментов (permission-gate на Bash и на Monitor|mcp__terminal__run_in_terminal), при
// установке на чистую машину терял вторую привязку молча: команда «уже была». Ключ теперь
// «набор + команда». Тест гоняет настоящий кусок установщика на временной домашней папке.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const INSTALLER = join(ROOT, 'global-setup', 'install-global.sh');
const FRAGMENT = join(ROOT, 'global-setup', 'settings-hooks-fragment.json');

function mergeScript() {
  const src = readFileSync(INSTALLER, 'utf8');
  const m = /# 6\. merge hooks[^\n]*\nnode -e '\n([\s\S]*?)\n' "\$SRC\/settings-hooks-fragment\.json"/.exec(src);
  assert.ok(m, 'в установщике не найден шаг 6 — тест проверял бы пустоту');
  return m[1];
}

function runMerge(home) {
  const r = spawnSync(process.execPath, ['-e', mergeScript(), FRAGMENT], {
    env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(r.status, 0, r.stderr);
}

const gateMatchers = (settings) => settings.hooks.PreToolUse
  .filter((b) => b.hooks.some((h) => h.command.includes('permission-gate.mjs')))
  .map((b) => b.matcher);

describe('установщик: слияние хуков в settings.json', () => {
  it('один хук на двух наборах инструментов ставится оба раза и не дублируется при повторе', () => {
    const home = mkdtempSync(join(tmpdir(), 'install-merge-'));
    try {
      mkdirSync(join(home, '.claude'));
      const settingsPath = join(home, '.claude', 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        theme: 'dark',
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node ${home}/.claude/hooks/permission-gate.mjs` }] }] },
      }));
      runMerge(home);
      const first = JSON.parse(readFileSync(settingsPath, 'utf8'));
      assert.deepEqual(gateMatchers(first).sort(), ['Bash', 'Monitor|mcp__terminal__run_in_terminal']);
      assert.equal(first.theme, 'dark', 'чужая настройка потеряна');
      runMerge(home);
      const second = JSON.parse(readFileSync(settingsPath, 'utf8'));
      assert.deepEqual(second, first, 'повторная установка изменила настройки');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
