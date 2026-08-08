#!/usr/bin/env node
// spec-path-index — which spec governs this file?
//
// path-to-spec-index (2026-W31-R15)
//
// THE GAP. Spec context is PULL-only: `get-spec-context.mjs --feature <x>` gives you the ancestry
// chain, but only if you already knew to ask and already knew the feature name. At the moment it
// actually matters — the moment a file is being edited — nothing says "this file is governed by
// that spec, and here is what it requires". So the spec is read when someone remembers, which is
// exactly when it is least needed, and skipped when the edit is small, which is when specs get
// violated.
//
// The index is DERIVED, not declared. No spec in this repo has a `paths:` field and inventing one
// would mean 67 files to retrofit and a convention nobody follows. But specs name the code they
// govern, repeatedly and unambiguously: run-state.mjs is named 26 times by its spec. Frequency IS
// the evidence, so the index is built from mentions and ranked by them.
//
// Zero dependencies. Usage:
//   node scripts/spec-path-index.mjs --self-test
//   node scripts/spec-path-index.mjs --build
//   node scripts/spec-path-index.mjs --lookup scripts/run-state.mjs

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'docs/audits/spec-path-index.json');
// No leading \b: a word boundary cannot match before a dot, so \b\.githooks never fired and that
// whole directory was silently absent from the index. Caught by the self-test, not by reading.
// Githook files have no extension (pre-commit, pre-push), so the extension is optional there.
const PATH_RE = /(?:^|[\s(`\["'])((?:scripts|hooks)\/[A-Za-z0-9_.-]+\.(?:mjs|js|sh)|\.githooks\/[A-Za-z0-9_.-]+)/g;

// ── pure core ────────────────────────────────────────────────────────────────

/** Code paths a spec names, with how often. Pure. */
export function pathsMentioned(specText = '') {
  const counts = new Map();
  for (const m of String(specText).matchAll(PATH_RE)) {
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return counts;
}

/**
 * Build path → [{spec, mentions}] from {specPath: text}. Ranked, strongest first. Pure.
 * A single passing mention is noise, so a spec must name a path at least `min` times to claim it.
 */
export function buildIndex(specs = {}, min = 2) {
  const idx = {};
  for (const [specPath, text] of Object.entries(specs)) {
    for (const [codePath, n] of pathsMentioned(text)) {
      if (n < min) continue;
      (idx[codePath] ??= []).push({ spec: specPath, mentions: n });
    }
  }
  for (const list of Object.values(idx)) list.sort((a, b) => b.mentions - a.mentions || a.spec.localeCompare(b.spec));
  return idx;
}

/** The spec that governs a file, or null. Pure. */
export function lookup(idx = {}, codePath = '') {
  const hits = idx[codePath];
  return hits && hits.length ? hits[0] : null;
}

// reverse-drift-unrequested (2026-W31-R16) — the drift daemon only ever walks spec → code:
// "is everything the spec asked for present?" The other direction is never asked: "is anything
// here that nobody asked for?" Code with no governing spec is maintained forever, tested
// forever, and reasoned about forever, on nobody's authority.
//
// THE PRECONDITION WAS ONLY PARTLY MET, so this reports and never blocks. The judge gated this
// on requirement ids existing. They now do — ac-coverage extracts 32 criteria after the W31-R5b
// fix — but only from 2 specs of 67, and the path index covers 46 of 236 engine scripts. Most of
// the uncovered 190 predate the spec tree entirely. Calling all of them "unrequested" would be a
// false alarm at scale, which is how a detector teaches people to ignore it.
//
// So the signal is narrowed to where it MEANS something: code written recently, with no spec
// naming it. Old unspecced code is history; new unspecced code is a decision nobody recorded.

/**
 * Files with no governing spec, newest first. Pure — takes the index and a {path: ageDays} map.
 * `recentDays` is the window where absence of a spec is a real signal rather than archaeology.
 */
export function unrequested(idx = {}, ages = {}, recentDays = 30) {
  const out = [];
  for (const [file, ageDays] of Object.entries(ages)) {
    if (idx[file] && idx[file].length) continue;
    out.push({ file, ageDays, recent: typeof ageDays === 'number' && ageDays <= recentDays });
  }
  out.sort((a, b) => (a.ageDays ?? 1e9) - (b.ageDays ?? 1e9));
  return { all: out, recent: out.filter((r) => r.recent) };
}

/** One short line for a hook to inject. Pure — returns '' when there is nothing to say. */
export function injectionLine(idx = {}, codePath = '') {
  const hit = lookup(idx, codePath);
  if (!hit) return '';
  return `Этот файл регулируется спекой ${hit.spec} (упомянут в ней ${hit.mentions} раз). Прочитай её требования, прежде чем менять поведение.`;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('путь к скрипту распознаётся', pathsMentioned('см. scripts/run-state.mjs').get('scripts/run-state.mjs') === 1);
  ok('повторы считаются', pathsMentioned('scripts/a.mjs и снова scripts/a.mjs').get('scripts/a.mjs') === 2);
  ok('хуки тоже индексируются', pathsMentioned('hooks/x-gate.mjs').has('hooks/x-gate.mjs'));
  ok('shell-скрипты тоже', pathsMentioned('.githooks/pre-commit.sh').has('.githooks/pre-commit.sh'));
  ok('посторонний путь не ловится', pathsMentioned('app/page.tsx').size === 0);
  ok('пустой текст даёт пусто', pathsMentioned('').size === 0);

  const specs = {
    'docs/specs/A.md': 'scripts/run-state.mjs scripts/run-state.mjs scripts/run-state.mjs и scripts/x.mjs',
    'docs/specs/B.md': 'scripts/run-state.mjs scripts/run-state.mjs',
    'docs/specs/C.md': 'мимоходом scripts/run-state.mjs один раз',
  };
  const idx = buildIndex(specs);
  ok('одиночное упоминание не даёт права на файл', !idx['scripts/run-state.mjs'].some((h) => h.spec.endsWith('C.md')));
  ok('спека с бОльшим числом упоминаний идёт первой', idx['scripts/run-state.mjs'][0].spec.endsWith('A.md'));
  ok('вторая спека тоже сохраняется', idx['scripts/run-state.mjs'].length === 2);
  ok('файл, упомянутый один раз, в индекс не попадает', !idx['scripts/x.mjs']);
  ok('порог настраивается', buildIndex(specs, 1)['scripts/x.mjs'].length === 1);

  ok('поиск возвращает сильнейшую спеку', lookup(idx, 'scripts/run-state.mjs').spec.endsWith('A.md'));
  ok('неизвестный файл возвращает null', lookup(idx, 'scripts/ghost.mjs') === null);
  ok('строка для вставки называет спеку', /A\.md/.test(injectionLine(idx, 'scripts/run-state.mjs')));
  ok('для неизвестного файла вставлять нечего', injectionLine(idx, 'scripts/ghost.mjs') === '');
  ok('строка молчит на пустом индексе', injectionLine({}, 'scripts/a.mjs') === '');

  // reverse axis (2026-W31-R16)
  const ages = { 'scripts/run-state.mjs': 100, 'scripts/brand-new.mjs': 2, 'scripts/old-orphan.mjs': 400 };
  const rev = unrequested(idx, ages, 30);
  ok('файл под спекой не считается непрошеным', !rev.all.some((r) => r.file === 'scripts/run-state.mjs'));
  ok('файл без спеки попадает в список', rev.all.some((r) => r.file === 'scripts/brand-new.mjs'));
  ok('свежий без спеки помечен как свежий', rev.recent.length === 1 && rev.recent[0].file === 'scripts/brand-new.mjs');
  ok('старый без спеки в списке есть, но не в свежих', rev.all.some((r) => r.file === 'scripts/old-orphan.mjs') && !rev.recent.some((r) => r.file === 'scripts/old-orphan.mjs'));
  ok('сортировка от самого свежего', rev.all[0].file === 'scripts/brand-new.mjs');
  ok('окно настраивается', unrequested(idx, ages, 500).recent.length === 2);
  ok('пустой возраст не роняет', unrequested(idx, {}, 30).all.length === 0);

  if (fails) { console.log(`\n\x1b[31mspec-path-index self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ spec-path-index: индекс выводится из упоминаний, одиночное упоминание не считается\x1b[0m');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('spec-path-index.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();

  if (argv.includes('--build')) {
    const specs = {};
    (function walk(d) {
      let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!e.name.startsWith('.') && !e.name.startsWith('_')) walk(p); continue; }
        if (!e.name.endsWith('.md')) continue;
        try { specs[path.relative(ROOT, p)] = readFileSync(p, 'utf8'); } catch { /* skip */ }
      }
    })(path.join(ROOT, 'docs/specs'));
    const idx = buildIndex(specs);
    mkdirSync(path.dirname(INDEX), { recursive: true });
    writeFileSync(INDEX, `${JSON.stringify(idx, null, 2)}\n`);
    const files = Object.keys(idx).length;
    console.log(`spec-path-index: ${Object.keys(specs).length} спек → ${files} файл(ов) под спекой → ${path.relative(ROOT, INDEX)}`);
    process.exit(0);
  }

  if (argv.includes('--reverse')) {
    if (!existsSync(INDEX)) { console.error('индекс не построен: --build'); process.exit(2); }
    const idx = JSON.parse(readFileSync(INDEX, 'utf8'));
    const { execFileSync } = await import('node:child_process');
    const ages = {};
    for (const dir of ['scripts', 'hooks']) {
      let names = [];
      try { names = readdirSync(path.join(ROOT, dir)); } catch { continue; }
      for (const n of names) {
        if (!/\.(mjs|js|sh)$/.test(n)) continue;
        const rel = `${dir}/${n}`;
        let days = null;
        try {
          const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', rel], { cwd: ROOT, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          if (iso) days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
        } catch { /* untracked or no git: leave null */ }
        ages[rel] = days;
      }
    }
    const winIdx = argv.indexOf('--days');
    const win = winIdx !== -1 ? Number(argv[winIdx + 1]) : 30;
    const rev = unrequested(idx, ages, win);
    console.log('обратная ось: код, который ни одна спека не называет');
    console.log('');
    console.log('  всего файлов движка: ' + Object.keys(ages).length + ', под спекой: ' + Object.keys(idx).length + ', без спеки: ' + rev.all.length);
    console.log('  из них написаны за последние ' + win + ' дней: ' + rev.recent.length);
    if (rev.recent.length) {
      console.log('');
      for (const r of rev.recent.slice(0, 20)) {
        console.log('    ' + String(r.ageDays).padStart(3) + 'д  ' + r.file);
      }
    }
    console.log('');
    console.log('  Это отчёт, а не приговор. Старый код без спеки это история движка;');
    console.log('  свежий код без спеки это решение, которое никто не записал.');
    process.exit(0);
  }

  const i = argv.indexOf('--lookup');
  if (i !== -1) {
    if (!existsSync(INDEX)) { console.error('индекс не построен: --build'); process.exit(2); }
    const idx = JSON.parse(readFileSync(INDEX, 'utf8'));
    const line = injectionLine(idx, argv[i + 1] || '');
    console.log(line || '(этот файл не под спекой)');
    process.exit(0);
  }

  console.log('usage: spec-path-index.mjs --build | --lookup <path>  |  --self-test');
}
