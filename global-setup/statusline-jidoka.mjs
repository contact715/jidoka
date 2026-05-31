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

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let ctx = {}; try { ctx = JSON.parse(raw || '{}'); } catch { /* none */ }
  const cwd = ctx.workspace?.current_dir || ctx.cwd || process.cwd();
  const model = ctx.model?.display_name || '';
  process.stdout.write(render({ ...gather(cwd), model }));
}
