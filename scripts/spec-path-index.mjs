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
