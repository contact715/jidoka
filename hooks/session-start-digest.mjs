#!/usr/bin/env node
// session-start-digest — SessionStart hook: rebuilds the consolidated lessons digest and emits a
// COMPACT context block (jidoka health + active lessons) so every session starts informed.
// SessionStart stdout is intentionally injected into the model context — that is the point here.
// Always exits 0; on any error emits nothing.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

try {
  const jidoka = join(homedir(), '.claude', 'jidoka');

  // 1) rebuild the digest (measured: ~40ms)
  try { execSync(`node ${join(jidoka, 'scripts', 'memory-consolidate.mjs')}`, { stdio: 'ignore', timeout: 5000 }); } catch { /* keep old digest */ }

  // 2) jidoka health (same cached signals as the statusline)
  let health = '⚪ нет baseline';
  for (const p of ['docs/audits/andon-halt.json', 'docs/audits/halt-state.json']) {
    if (existsSync(join(jidoka, p))) { health = '🔴 HALT — открой docs/audits/'; break; }
  }
  if (!health.startsWith('🔴')) {
    try {
      const pct = Math.round(JSON.parse(readFileSync(join(jidoka, 'docs/evals/_baseline.json'), 'utf8')).pass_rate * 100);
      health = pct === 100 ? `🟢 eval ${pct}%` : `🟡 eval ${pct}%`;
    } catch { /* keep default */ }
  }

  // 3) active lessons — names + gating only, not the full bodies
  const md = readFileSync(join(jidoka, 'memory-consolidated.md'), 'utf8');
  const active = md.split('## 🟡')[0];
  const lessons = [...active.matchAll(/^### ([^\n·]+)·[^\n]*$/gm)].map(m => m[1].trim());
  const ungated = [...active.matchAll(/^### ([^\n·]+)·[^\n]*\n(?!✓ gated)/gm)].map(m => m[1].trim());

  const out = [
    '[session-start digest]',
    `jidoka: ${health}`,
    lessons.length ? `активные уроки (🔴): ${lessons.join(', ')}` : 'активных уроков нет',
    ungated.length ? `БЕЗ гейта (живой риск): ${ungated.join(', ')}` : '',
    'полный дайджест: ~/.claude/jidoka/memory-consolidated.md',
  ].filter(Boolean).join('\n');
  process.stdout.write(out);
} catch { /* silent */ }
process.exit(0);
