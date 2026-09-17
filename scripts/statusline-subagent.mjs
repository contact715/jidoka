#!/usr/bin/env node
// subagent statusline — one compact colored row per running subagent.
// Wired via settings.json "subagentStatusLine". Receives the same JSON context as the main
// statusline plus agent info on stdin; every field is optional, so it never crashes the row.
//
// Usage:  echo '{"agent":{"name":"backend-agent"},"model":{"display_name":"Sonnet 4.6"}}' | node statusline-subagent.mjs

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Строгий разбор аргументов (2026-09-16). Строку зовёт Claude Code, как и хуки, поэтому договор
// тот же: неверный вызов — код 1 (видимая ошибка без блокировки), stdin не читается.
const HOOK_BAD_CALL_EXIT = 1;

// Помощник грузится при запуске, не при импорте, через загрузчик хуков: в установке
// (~/.claude/statusline-subagent.mjs) — ./hooks/lib/load-cli.mjs, в каноне (scripts/) —
// ../hooks/lib/load-cli.mjs. Статический импорт ./lib/cli.mjs упал бы в установке.
async function loadStrictCli() {
  // общий загрузчик хуков (hooks/lib/load-cli.mjs) узнаёт наш помощник по тексту до импорта
  const here = dirname(fileURLToPath(import.meta.url));
  const loader = /[\\/]\.claude$/.test(here) ? './hooks/lib/load-cli.mjs' : '../hooks/lib/load-cli.mjs';
  const { loadCli } = await import(new URL(loader, import.meta.url).href);
  return loadCli(import.meta.url);
}

const C = {
  mint:  s => `\x1b[38;5;49m${s}\x1b[0m`,
  cyan:  s => `\x1b[38;5;80m${s}\x1b[0m`,
  yellow:s => `\x1b[38;5;220m${s}\x1b[0m`,
  orange:s => `\x1b[38;5;208m${s}\x1b[0m`,
  violet:s => `\x1b[38;5;141m${s}\x1b[0m`,
  dim:   s => `\x1b[38;5;245m${s}\x1b[0m`,
};

export function render(ctx) {
  const name = ctx.agent?.name || 'agent';
  const model = ctx.model?.display_name || '';
  const pct = ctx.context_window?.used_percentage;
  const cost = ctx.cost?.total_cost_usd;

  const parts = [C.violet(`◆ ${name}`)];
  if (model) parts.push(C.mint(model));
  if (pct != null) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const filled = Math.round(p / 20); // 5-segment mini-bar
    const paint = p >= 85 ? C.orange : p >= 60 ? C.yellow : C.cyan;
    parts.push(paint('▰'.repeat(filled)) + C.dim('▱'.repeat(5 - filled)) + paint(` ${p}%`));
  }
  if (cost != null) parts.push(C.dim(`$${cost.toFixed(2)}`));
  return parts.join(C.dim(' · '));
}

// settings.json → subagentStatusLine зовёт строку без аргументов; флагов у неё нет.
export const CLI = {
  name: 'statusline-subagent',
  summary: 'Строка состояния субагента для Claude Code (subagentStatusLine). Контекст — JSON в stdin.',
  badCallExit: HOOK_BAD_CALL_EXIT,
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  (await loadStrictCli()).runCli(CLI);
  // чтение stdin — работа: при импорте оно подвешивало модуль
  let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let ctx = {}; try { ctx = JSON.parse(raw || '{}'); } catch { /* none */ }
  process.stdout.write(render(ctx));
}
