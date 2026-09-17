#!/usr/bin/env node
// @ts-check
/**
 * Wave-158 — Common launcher for background & jobs
 *
 * Single enforcement point for all background script invocations.
 * Checks .sdd-halt-state.json before executing any wrapped script.
 * If pipeline is halted (and andonCord.enabled: true), logs to stderr and exits 0
 * without running the target script.
 *
 * Usage:
 *   node scripts/common-launcher.mjs <script-path> [-- args...]
 *
 * Example (from .githooks/post-commit):
 *   node scripts/common-launcher.mjs scripts/run-quality-gates.mjs -- --skip-e2e
 *   node scripts/common-launcher.mjs scripts/surface-concerns.mjs
 *
 * Флаги цели идут после `--` (2026-09-16, строгий разбор): без разделителя флаг считается
 * флагом самого запускателя, и незнакомый — отказ с кодом 2 до запуска цели. Слова без
 * дефиса можно передавать и без разделителя.
 *
 * Exit codes:
 *   0  — script ran successfully OR pipeline halted (skip logged)
 *   1  — target script not found or launch error
 *   2  — неверный вызов запускателя (нет пути к скрипту, незнакомый флаг): ничего не запущено
 *   N  — propagated exit code from the wrapped script
 *
 * Latency: single fs.existsSync call in non-halted path — < 5ms overhead.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runCli } from './lib/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HALT_STATE_PATH = path.join(ROOT, '.sdd-halt-state.json');
const SDD_CONFIG_PATH = path.join(ROOT, '.sdd-config.json');

// ── Parse args ───────────────────────────────────────────────────────────────
// Первое слово — путь к скрипту, остальное уходит цели как есть. Флаги цели — после `--`,
// их строго разберёт уже сама цель.
export const CLI = {
  name: 'common-launcher',
  summary: 'Запустить скрипт движка, если конвейер не остановлен шнуром андон (.sdd-halt-state.json).',
  options: {},
  positionals: { min: 1, max: Infinity, name: 'script-path', label: '<script-path> [-- args...]' },
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const { positionals } = runCli(CLI);
  const [scriptArg, ...passArgs] = positionals;

  // Resolve the script path — accept both absolute and relative (to scripts/ dir)
  let resolvedScript = path.isAbsolute(scriptArg)
    ? scriptArg
    : fs.existsSync(path.resolve(ROOT, scriptArg))
      ? path.resolve(ROOT, scriptArg)
      : path.resolve(__dirname, scriptArg); // relative to scripts/

  if (!fs.existsSync(resolvedScript)) {
    process.stderr.write(`[common-launcher] ERROR: script not found: ${scriptArg} (resolved: ${resolvedScript})\n`);
    process.exit(1);
  }

  // ── Halt-state check (fast path: single existsSync before any config read) ──
  if (fs.existsSync(HALT_STATE_PATH)) {
    let andonEnabled = false;
    let haltState = null;

    try {
      const cfg = JSON.parse(fs.readFileSync(SDD_CONFIG_PATH, 'utf8'));
      andonEnabled = Boolean(cfg?.andonCord?.enabled);
    } catch { /* config unreadable — default to soft mode */ }

    try {
      haltState = JSON.parse(fs.readFileSync(HALT_STATE_PATH, 'utf8'));
    } catch { /* unreadable halt state — skip gate */ }

    if (andonEnabled && haltState?.active) {
      const { wave, agent } = haltState.active;
      process.stderr.write(
        `[common-launcher] skipped — pipeline halted (wave: ${wave ?? 'unknown'}, agent: ${agent ?? 'unknown'})\n` +
        `  script: ${scriptArg}\n` +
        `  resume: node scripts/andon-resume.mjs --wave ${wave ?? 'unknown'} --approver <name> --reason <text> --root-cause <annotation>\n`
      );
      process.exit(0);
    } else if (!andonEnabled && haltState?.active) {
      process.stderr.write(
        `[common-launcher] WARN — halt state present but andonCord.enabled: false (soft mode). Script will run.\n` +
        `  script: ${scriptArg}\n`
      );
    }
  }

  // ── Launch the target script ─────────────────────────────────────────────────
  const child = spawn(process.execPath, [resolvedScript, ...passArgs], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });

  child.on('error', (err) => {
    process.stderr.write(`[common-launcher] ERROR launching ${scriptArg}: ${err.message}\n`);
    process.exit(1);
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}
