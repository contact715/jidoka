#!/usr/bin/env node
// session-start-digest — SessionStart hook: rebuilds the consolidated lessons digest and emits a
// COMPACT context block (jidoka health + active lessons) so every session starts informed.
// SessionStart stdout is intentionally injected into the model context — that is the point here.
// Always exits 0; on any error emits nothing.
// Also warns about FRESH wave-id claims in the current project's docs/specs/_CLAIMED_WAVES.jsonl
// (written by claim-wave-id.mjs): a fresh claim at session start is by definition someone else's —
// this session has not claimed yet, so the number is taken. Born from the projectx triple
// wave-id collision (2026-06-10). Self-test: --self-test.

import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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

// ungated-and-ci-verdict (2026-W32-R3) ──────────────────────────────────────
// The digest used to read ONLY the "🔴 Active" section of memory-consolidated.md. But the
// ACTIVE threshold in memory-consolidate.mjs is score >= 1.5, and a fresh single incident
// scores exactly 1.0 (weight halves every 30 days), so a class must recur at least twice
// within a month before it can reach that tier. Measured 2026-08-03: the file carried
// sixteen classes marked "ungated — still a live risk", four of them younger than three
// days, and the digest printed "активных уроков нет". The instrument built to prevent
// repetition only spoke AFTER the repetition.
//
// So: read every tier except the demoted 🟪 one, and surface the ungated classes whatever
// their score. Newest/highest-scoring first, capped so the block stays a digest.
export function ungatedFrom(md = '', cap = 6) {
  const live = md.split('## 🟪')[0]; // drop the decayed/demoted tail, keep 🔴 and 🟡
  const out = [];
  for (const m of live.matchAll(/^### ([^\n·]+)·[^\n]*\n([^\n]*)/gm)) {
    if (/✓ gated/.test(m[2])) continue;
    out.push(m[1].trim());
  }
  return { shown: out.slice(0, cap), total: out.length };
}

export function hotFrom(md = '') {
  const hot = md.split('## 🟡')[0];
  return [...hot.matchAll(/^### ([^\n·]+)·[^\n]*$/gm)].map(m => m[1].trim());
}

// CI truth. The engine's own main branch sat red for five days in a row (2026-07-29 →
// 2026-08-03) with four commits landing on top, and nothing in the environment read the
// result: grep for `gh run` / `workflow_run` across scripts/ and hooks/ returned zero.
// Cached with a TTL so a session start never pays for the network twice in half an hour,
// and every failure path is silent.
export function ciLine(run) {
  if (!run || !run.conclusion) return '';
  if (run.conclusion === 'success') return '';           // green needs no words
  const when = String(run.createdAt || '').slice(0, 10);
  return `🔴 CI на main: ${run.conclusion}${when ? ` (${when})` : ''}. Почини прежде чем класть новое сверху`;
}

export function cacheFresh(cache, now = Date.now(), ttlMs = 30 * 60e3) {
  return !!cache && typeof cache.at === 'number' && now - cache.at < ttlMs;
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

    // ── ungated lessons across tiers (2026-W32-R3) ────────────────────────
    // The exact shape of memory-consolidated.md, including the case that broke it:
    // no 🔴 section at all, so everything lived under 🟡 and the old parser saw nothing.
    const MD = [
      '# Consolidated memory',
      '',
      '## 🟡 Watch — recurring but lower-pressure',
      '',
      '### declaration-over-implementation  ·  score 1.2  ·  seen 5×',
      '✓ gated by `hooks/proof-of-work-gate.mjs`',
      '  - detail line',
      '',
      '### stopped-mid-queue-reported-instead  ·  score 1  ·  seen 1×',
      '⚠ **ungated — still a live risk**',
      '',
      '### toggle-loses-to-default-specificity  ·  score 0.9  ·  seen 1×',
      '⚠ **ungated — still a live risk**',
      '',
      '## 🟪 Decayed — demoted (old / one-off)',
      '',
      '### ancient-one-off  ·  score 0.1  ·  seen 1×',
      '⚠ **ungated — still a live risk**',
    ].join('\n');

    const u = ungatedFrom(MD);
    ok('ungated найдены и вне 🔴-секции (это и был дефект)', u.total === 2);
    ok('ungated перечислены поимённо', u.shown.join() === 'stopped-mid-queue-reported-instead,toggle-loses-to-default-specificity');
    ok('gated класс не попадает в живые риски', !u.shown.includes('declaration-over-implementation'));
    ok('демотированная 🟪-секция исключена', !u.shown.includes('ancient-one-off'));
    ok('список подрезается до cap, но total считает всё', ungatedFrom(MD, 1).shown.length === 1 && ungatedFrom(MD, 1).total === 2);
    ok('файл без 🔴-секции больше не даёт пустоту', ungatedFrom(MD).shown.length > 0);
    ok('старый разбор 🔴 остаётся рабочим', hotFrom('## 🔴 Active\n\n### x  ·  score 2\n✓ gated by `y`\n\n## 🟡 Watch\n\n### z  ·  score 1\n').join() === 'x');
    ok('пустой документ не роняет разбор', ungatedFrom('').total === 0 && hotFrom('').length === 0);

    // ── CI verdict line ───────────────────────────────────────────────────
    ok('красный CI объявляется', /🔴 CI на main: failure \(2026-08-01\)/.test(ciLine({ conclusion: 'failure', createdAt: '2026-08-01T05:40:33Z' })));
    ok('зелёный CI молчит', ciLine({ conclusion: 'success', createdAt: '2026-08-01' }) === '');
    ok('нет данных о CI — молчит, а не врёт', ciLine(null) === '' && ciLine({}) === '');
    ok('кеш моложе TTL считается свежим', cacheFresh({ at: 1000 }, 1000 + 60e3) === true);
    ok('кеш старше TTL считается протухшим', cacheFresh({ at: 1000 }, 1000 + 31 * 60e3) === false);
    ok('отсутствующий кеш не свежий', cacheFresh(null) === false);
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


const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  try {
    const jidoka = join(homedir(), '.claude', 'jidoka');

    // 1) rebuild the digest (measured: ~40ms) + refresh the memory-curator utility priors
    try { execSync(`node ${join(jidoka, 'scripts', 'memory-consolidate.mjs')}`, { stdio: 'ignore', timeout: 5000 }); } catch { /* keep old digest */ }
    try { execSync(`node ${join(jidoka, 'scripts', 'memory-curator.mjs')} --build`, { stdio: 'ignore', timeout: 5000 }); } catch { /* keep old priors */ }

    // 2) jidoka health (same cached signals as the statusline)
    let health = '⚪ нет baseline';
    for (const p of ['docs/audits/andon-halt.json', 'docs/audits/halt-state.json']) {
      if (existsSync(join(jidoka, p))) { health = '🔴 HALT — открой docs/audits/'; break; }
    }
    if (!health.startsWith('🔴')) {
      try {
        // the installed copy does not carry docs/evals/_baseline.json, so this line said
        // 'нет baseline' in every session while the number existed in the canon repo one
        // directory away. Look there too before admitting ignorance.
        const baselinePaths = [join(jidoka, 'docs/evals/_baseline.json'), join(homedir(), 'jidoka-framework/docs/evals/_baseline.json')];
        const found = baselinePaths.find((p) => existsSync(p));
        if (!found) throw new Error('no baseline anywhere');
        const pct = Math.round(JSON.parse(readFileSync(found, 'utf8')).pass_rate * 100);
        health = pct === 100 ? `🟢 eval ${pct}%` : `🟡 eval ${pct}%`;
      } catch { /* keep default */ }
    }

    // 2b) age of the signals (2026-W31-R2). The CI line above already exists and stays silent when
    // green, by design. What was missing is whether the DATA is still fresh: a ledger that stopped
    // receiving entries and an honest-state doc nobody touched both read as authority while stale.
    // --ages does no network call, so session start pays nothing extra.
    let ages = '';
    try {
      ages = execSync(`node ${join(jidoka, 'scripts', 'system-truth.mjs')} --ages`, { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* fail-open: no line rather than a hung session */ }
    // 3) lessons — hot ones by name, and EVERY ungated class regardless of tier (2026-W32-R3)
    const md = readFileSync(join(jidoka, 'memory-consolidated.md'), 'utf8');
    const lessons = hotFrom(md);
    const live = ungatedFrom(md);

    // 3b) гейты, которые РАБОТАЮТ, но реестру классов неизвестны (2026-W33-K1).
    // Пока их не зарегистрировал человек, строка «БЕЗ гейта» выше завышена: 2026-08-10 из
    // пятнадцати «живых рисков» пять были закрыты работающим механизмом. Считаем дёшево и
    // молча падаем в пустую строку, чтобы не задерживать старт сессии.
    let pendingLine = '';
    try {
      const [ga, { REMEDIES }] = await Promise.all([
        import(pathToFileURL(join(jidoka, 'scripts', 'gate-audit.mjs')).href),
        import(pathToFileURL(join(jidoka, 'scripts', 'meta-remedies.mjs')).href),
      ]);
      // same helpers the auditor uses, so the two never disagree about what "wired" means
      // the live hooks sit in ~/.claude/hooks; only some are mirrored into the install, so both are scanned
      const files = ga.collectMechanisms(jidoka, { extraDirs: [join(homedir(), '.claude', 'hooks')] });
      let settingsRaw = '';
      try { settingsRaw = readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'); } catch { /* none */ }
      const wired = ga.wiredSetFrom(files, ga.callerTexts(jidoka, settingsRaw));
      const rev = ga.reverseRemedyAudit({ tags: ga.closesClassTags(files), remedies: REMEDIES, wired });
      if (rev.pending.length) {
        pendingLine = `ждут регистрации в реестре классов: ${rev.pending.length} (${rev.pending.map((p) => p.cls).join(', ')}) — гейт работает, метрики его не видят; node scripts/gate-audit.mjs даст блок для вставки`;
      }
    } catch { /* fail-open: нет строки лучше, чем задержанный старт */ }

    // 4) чужие свежие клеймы wave-id в проекте этой сессии (cwd хука = корень проекта)
    let claims = [];
    try { claims = freshClaims(sh('git rev-parse --show-toplevel', process.cwd())); } catch { /* не git-репо */ }

    // 5) serial task-queue — remind to work it one at a time (autonomous default)
    let queueLine = '';
    try {
      const qp = join(homedir(), '.jidoka', 'task-queue', 'queue.jsonl');
      if (existsSync(qp)) {
        const items = readFileSync(qp, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
        const waiting = items.filter(t => t.status === 'queued').length;
        const activeTask = items.find(t => t.status === 'in_progress');
        if (waiting || activeTask) {
          queueLine = `очередь задач: ${waiting} ждут${activeTask ? ` · в работе: ${activeTask.title}` : ''} — веди по одной (task-queue.mjs next → сделал → safe-commit → done)`;
        }
      }
    } catch { /* no queue */ }

    // 6) real CI verdict for the engine's own main branch, cached 30 min, silent on any failure
    let ci = '';
    try {
      const cachePath = join(jidoka, '.ci-verdict-cache.json');
      let cache = null;
      try { cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch { /* no cache yet */ }
      if (!cacheFresh(cache)) {
        const repoDir = join(homedir(), 'jidoka-framework');
        const slug = existsSync(repoDir)
          ? (sh('git remote get-url origin', repoDir).match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/) || [])[1]
          : null;
        if (slug) {
          const raw = sh(`gh run list -R ${slug} --workflow=ci.yml --branch=main --limit 1 --json conclusion,createdAt`, repoDir);
          cache = { at: Date.now(), run: JSON.parse(raw)[0] || null };
          try { writeFileSync(cachePath, JSON.stringify(cache)); } catch { /* cache is best-effort */ }
        }
      }
      ci = ciLine(cache && cache.run);
    } catch { /* no gh / no network / no repo → say nothing rather than guess */ }

    const out = [
      '[session-start digest]',
      `jidoka: ${health}`,
      ci,
      ages,
      queueLine,
      lessons.length ? `активные уроки (🔴): ${lessons.join(', ')}` : '',
      live.total ? `БЕЗ гейта (живой риск, ${live.total}): ${live.shown.join(', ')}${live.total > live.shown.length ? ` и ещё ${live.total - live.shown.length}` : ''}` : '',
      pendingLine,
      claims.length ? `⚠️ занятые wave-id (клеймы <24ч): ${claims.join(', ')} — свой номер бери через claim-wave-id.mjs` : '',
      'полный дайджест: ~/.claude/jidoka/memory-consolidated.md',
    ].filter(Boolean).join('\n');
    process.stdout.write(out);
  } catch { /* silent */ }
  process.exit(0);
}
