#!/usr/bin/env node
// Delegates to bundle-size-check.mjs — do not add logic here.
// [REUSE: scripts/bundle-size-check.mjs:1-161]
// Usage: node scripts/bundle-delta.mjs [--update]

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/cli.mjs';
import { CLI as TARGET_CLI } from './bundle-size-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, 'bundle-size-check.mjs');

// Разбор строгий (2026-09-16): флаги те же, что у bundle-size-check (спецификация берётся у
// него, а не переписывается), поэтому опечатка отказывает здесь, до запуска проверки.
// Раньше хвост склеивался в строку оболочки как есть.
export const CLI = {
  ...TARGET_CLI,
  name: 'bundle-delta',
  summary: 'Обёртка над bundle-size-check.mjs: те же флаги, тот же код выхода.',
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  runCli(CLI);
  try {
    // хвост уже прошёл ту же спецификацию, что у цели; передаётся списком, без оболочки
    execFileSync('node', [target, ...process.argv.slice(2)], { stdio: 'inherit' });
  } catch (err) {
    process.exit(err.status ?? 1);
  }
}
