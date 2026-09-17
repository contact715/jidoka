#!/usr/bin/env node
// jidoka statusline — compact framework health in the Claude Code status bar.
//
// Reads ONLY cached values (eval baseline, halt-state file, git branch) so it stays instant on the
// render path — it never runs a heavy gate (eval/instantiation-audit) per keystroke. Works in the
// framework repo AND in any project the framework is installed into (.jidoka/ present).
//
// Wired via settings.json "statusLine": { type: command, command: "node <path>/statusline-jidoka.mjs" }.
// Claude Code pipes a JSON context on stdin: { model:{display_name}, workspace:{current_dir} }.
//
// FULL & self-tested. Usage:
//   node scripts/statusline-jidoka.mjs --self-test
//   echo '{"workspace":{"current_dir":"."}}' | node scripts/statusline-jidoka.mjs

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Строгий разбор аргументов (2026-09-16). Строку состояния зовёт Claude Code, как и хуки, поэтому
// договор тот же: неверный вызов — код 1 (видимая ошибка без блокировки), ничего не выполнено.
const HOOK_BAD_CALL_EXIT = 1;

// Помощник грузится из СОБСТВЕННОГО дерева. В установке файл лежит в ~/.claude рядом с
// hooks/lib/load-cli.mjs; в каноне (global-setup/) загрузчик — hooks/lib/load-cli.mjs репозитория.
// Статический импорт упал бы в одной из раскладок. Второй адрес проверяется только в канонической
// раскладке: из ~/.claude путь ../ ушёл бы в чужой ~/hooks.
async function loadStrictCli() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [new URL('./hooks/lib/load-cli.mjs', import.meta.url)];
  if (/[\\/]global-setup[\\/]?$/.test(here)) candidates.push(new URL('../hooks/lib/load-cli.mjs', import.meta.url));
  const found = candidates.find((u) => existsSync(u));
  if (!found) throw new Error(`statusline-jidoka: не найден hooks/lib/load-cli.mjs рядом с ${here}`);
  const { loadCli } = await import(found.href);
  return loadCli(import.meta.url);
}

// pure: build the status string from already-read facts (testable without fs/git)
export function render({ jidoka, evalPct, halt, branch, model }) {
  if (!jidoka) return [branch, model].filter(Boolean).join(' · ');
  const icon = halt ? '🔴 HALT' : evalPct === 100 ? '🟢' : evalPct != null ? '🟡' : '⚪';
  const parts = [`${icon} jidoka`];
  if (evalPct != null) parts.push(`eval ${evalPct}%`);
  if (branch) parts.push(branch);
  if (model) parts.push(model);
  return parts.join(' · ');
}

function gather(cwd) {
  const isJidoka = existsSync(join(cwd, 'docs/evals/_baseline.json')) || existsSync(join(cwd, '.jidoka'));
  let evalPct = null;
  for (const p of ['docs/evals/_baseline.json', '.jidoka/_baseline.json']) {
    try { evalPct = Math.round(JSON.parse(readFileSync(join(cwd, p), 'utf8')).pass_rate * 100); break; } catch { /* none */ }
  }
  let halt = false;
  for (const p of ['docs/audits/andon-halt.json', '.jidoka/andon-halt.json', 'docs/audits/halt-state.json']) {
    if (existsSync(join(cwd, p))) { halt = true; break; }
  }
  let branch = '';
  try { branch = execSync('git branch --show-current', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not git */ }
  return { jidoka: isJidoka, evalPct, halt, branch };
}

function selfTest() {
  const T = [
    ['100% eval → green', render({ jidoka: true, evalPct: 100, branch: 'main' }).startsWith('🟢')],
    ['<100% eval → yellow', render({ jidoka: true, evalPct: 90 }).startsWith('🟡')],
    ['halt overrides → red', render({ jidoka: true, evalPct: 100, halt: true }).includes('🔴 HALT')],
    ['no baseline → white marker', render({ jidoka: true, evalPct: null }).startsWith('⚪')],
    ['non-jidoka cwd → plain branch+model', render({ jidoka: false, branch: 'dev', model: 'Opus' }) === 'dev · Opus'],
    ['eval pct shown', render({ jidoka: true, evalPct: 100 }).includes('eval 100%')],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mstatusline-jidoka self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ statusline-jidoka: render correct\x1b[0m');
  process.exit(0);
}

// Разбор — первое, что делает строка состояния: незнакомый флаг или лишнее слово — отказ до
// чтения stdin и вызова git. settings.json → statusLine зовёт её без аргументов.
export const CLI = {
  name: 'statusline-jidoka',
  path: 'global-setup/statusline-jidoka.mjs',
  summary: 'Строка состояния Claude Code: здоровье jidoka по закешированным данным. Контекст — JSON в stdin.',
  selfTest: true,
  badCallExit: HOOK_BAD_CALL_EXIT,
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { selfTest: wantsSelfTest } = (await loadStrictCli()).runCli(CLI);
  if (wantsSelfTest) selfTest();
  let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let ctx = {}; try { ctx = JSON.parse(raw || '{}'); } catch { /* none */ }
  const cwd = ctx.workspace?.current_dir || ctx.cwd || process.cwd();
  const model = ctx.model?.display_name || '';
  process.stdout.write(render({ ...gather(cwd), model }));
}
