#!/usr/bin/env node
// session-start-digest — SessionStart hook: rebuilds the consolidated lessons digest and emits a
// COMPACT context block (jidoka health + active lessons) so every session starts informed.
// SessionStart stdout is intentionally injected into the model context — that is the point here.
// Always exits 0; on any error emits nothing.
// Also warns about FRESH wave-id claims in the current project's docs/specs/_CLAIMED_WAVES.jsonl
// (written by claim-wave-id.mjs): a fresh claim at session start is by definition someone else's —
// this session has not claimed yet, so the number is taken. Born from the projectx triple
// wave-id collision (2026-06-10). Self-test: --self-test.

import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const REGISTRY_REL = 'docs/specs/_CLAIMED_WAVES.jsonl';
const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// Свежие (моложе ttlHours) клеймы wave-id проекта: union локального реестра и его версии на
// упстрим-ветке (git show @{u}: — обновляется и fetch'ем, и успешным push'ем параллельной
// сессии), дедуп по wave. Любая ошибка → пустой список, дайджест не ломается.
export function freshClaims(root, ttlHours = 24, now = Date.now()) {
  const texts = [];
  try { texts.push(readFileSync(join(root, REGISTRY_REL), 'utf8')); } catch { /* нет локального файла */ }
  try {
    const up = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}', root);
    texts.push(sh(`git show ${up}:${REGISTRY_REL}`, root));
  } catch { /* нет апстрима или файла на нём */ }
  const out = [];
  const seen = new Set();
  for (const line of texts.join('\n').split('\n')) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line);
      const age = now - Date.parse(c.ts);
      if (!(age >= 0 && age < ttlHours * 3600e3) || seen.has(c.wave)) continue;
      seen.add(c.wave);
      out.push(`${c.wave} (${String(c.session || '?').slice(0, 12)}, ${Math.max(1, Math.round(age / 3600e3))}ч)`);
    } catch { /* битая строка */ }
  }
  return out;
}

function selfTest() {
  const fails = [];
  const ok = (name, cond) => {
    if (!cond) fails.push(name);
    console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  };
  const tmp = mkdtempSync(join(tmpdir(), 'digest-claims-'));
  try {
    const now = Date.now();
    const rec = (wave, hoursAgo, session) =>
      JSON.stringify({ wave, n: Number(wave.split('-')[1]), session, ts: new Date(now - hoursAgo * 3600e3).toISOString() });

    // локальный реестр: свежий + протухший клейм
    const A = join(tmp, 'A');
    mkdirSync(join(A, 'docs/specs'), { recursive: true });
    sh('git init -q -b main', A);
    sh('git config user.name t', A);
    sh('git config user.email t@l', A);
    writeFileSync(join(A, REGISTRY_REL), [rec('wave-207', 2, 'sessOther'), rec('wave-100', 30, 'sessOld')].join('\n') + '\n');
    const c1 = freshClaims(A, 24, now);
    ok('свежий клейм (2ч) виден, протухший (30ч) отфильтрован',
      c1.length === 1 && c1[0].includes('wave-207') && c1[0].includes('sessOther'));

    // union с апстримом: локальный файл расходится с origin; дедуп общего клейма
    const bare = join(tmp, 'origin.git');
    sh(`git init -q --bare -b main "${bare}"`, tmp);
    sh(`git remote add origin "${bare}"`, A);
    sh(`git add ${REGISTRY_REL}`, A);
    sh('git commit -q -m reg', A);
    sh('git push -q -u origin main', A);
    writeFileSync(join(A, REGISTRY_REL),
      [rec('wave-207', 2, 'sessOther'), rec('wave-208', 1, 'sessLocal')].join('\n') + '\n');
    const c2 = freshClaims(A, 24, now);
    ok('union локального файла и @{u} с дедупом (207 один раз + 208)',
      c2.length === 2 && c2.some(s => s.includes('wave-207')) && c2.some(s => s.includes('wave-208')));

    // не-git каталог / пустой проект → молча пусто
    const empty = join(tmp, 'empty');
    mkdirSync(empty);
    ok('вне git/без реестра — пусто и без ошибок', freshClaims(empty, 24, now).length === 0);
  } catch (e) {
    fails.push(`crash: ${e.message}`);
    console.log(`  \x1b[31m✗ self-test crashed: ${e.message}\x1b[0m`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (fails.length) {
    console.log(`\n\x1b[31msession-start-digest self-test FAILED (${fails.length})\x1b[0m`);
    process.exit(1);
  }
  console.log('\n\x1b[32m✓ session-start-digest self-test: предупреждение о чужих клеймах работает\x1b[0m');
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

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

  // 4) чужие свежие клеймы wave-id в проекте этой сессии (cwd хука = корень проекта)
  let claims = [];
  try { claims = freshClaims(sh('git rev-parse --show-toplevel', process.cwd())); } catch { /* не git-репо */ }

  const out = [
    '[session-start digest]',
    `jidoka: ${health}`,
    lessons.length ? `активные уроки (🔴): ${lessons.join(', ')}` : 'активных уроков нет',
    ungated.length ? `БЕЗ гейта (живой риск): ${ungated.join(', ')}` : '',
    claims.length ? `⚠️ занятые wave-id (клеймы <24ч): ${claims.join(', ')} — свой номер бери через claim-wave-id.mjs` : '',
    'полный дайджест: ~/.claude/jidoka/memory-consolidated.md',
  ].filter(Boolean).join('\n');
  process.stdout.write(out);
} catch { /* silent */ }
process.exit(0);
