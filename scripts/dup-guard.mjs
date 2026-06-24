#!/usr/bin/env node
/**
 * dup-guard — survey-before-scaffold as an enforced gate, not a discipline.
 *
 * Closes research gap #10 (docs/research/2026-06-24_github-enrichment-research.md)
 * and the recurrent "redundant-install / addition-is-not-free" lesson: the rule
 * "does this already exist? reuse before you add" lived only in CLAUDE.md and the
 * cartographer's judgement. This makes it mechanical.
 *
 * Deterministic core (no LLM judge → no calibration dependency): when a commit ADDS
 * a new .mjs module, it parses its exported symbols (reusing code-map's parseModule —
 * not reimplemented) and flags any symbol that is ALREADY exported by another module.
 * A re-declared capability is the signal that the new file may be duplicating one that
 * exists. WARN by default (shadow trial, like clarify-gate); --block exits 1.
 *
 * Honest limit: this catches name-level capability collisions, the cheap high-signal
 * case. It is not whole-corpus semantic AST diff (that is the optional LLM tier, gated
 * behind judge calibration). Forcing function, not proof.
 *
 * Usage:
 *   node scripts/dup-guard.mjs --staged            # gate a commit (WARN)
 *   node scripts/dup-guard.mjs --staged --block    # exit 1 on a collision
 *   node scripts/dup-guard.mjs --self-test
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseModule } from './code-map.mjs';

// Symbols so generic that two modules sharing them is not evidence of duplication.
const GENERIC = new Set(['main', 'default', 'run', 'init', 'config', 'handler']);

/** Map exported symbol → [files that export it], across a set of {path, content}. */
export function buildExportIndex(files) {
  const idx = new Map();
  for (const f of files) {
    let exp = [];
    try { exp = parseModule(f.content).exports || []; } catch { exp = []; }
    for (const s of exp) {
      if (GENERIC.has(s)) continue;
      if (!idx.has(s)) idx.set(s, []);
      idx.get(s).push(f.path);
    }
  }
  return idx;
}

/** Collisions for a newly-added file against the index of all OTHER modules. */
export function findCollisions(addedPath, addedContent, index) {
  let exp = [];
  try { exp = parseModule(addedContent).exports || []; } catch { exp = []; }
  const hits = [];
  for (const s of exp) {
    if (GENERIC.has(s)) continue;
    const owners = (index.get(s) || []).filter((p) => p !== addedPath);
    if (owners.length) hits.push({ symbol: s, existingIn: owners });
  }
  return hits;
}

function listScripts(dir = 'scripts') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => join(dir, f));
}

function stagedAdded() {
  try {
    return execSync('git diff --cached --name-only --diff-filter=A', { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter((f) => f.endsWith('.mjs'));
  } catch { return []; }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const staged = args.includes('--staged');
  const block = args.includes('--block');
  if (!staged) { console.log('dup-guard: pass --staged to gate a commit. (dry mode, no-op)'); process.exit(0); }

  const added = stagedAdded();
  if (added.length === 0) { console.log('dup-guard: no new .mjs modules staged — gate N/A.'); process.exit(0); }

  // Index every existing module on disk (the corpus the new file might duplicate).
  const corpus = listScripts('scripts').map((p) => { try { return { path: p, content: readFileSync(p, 'utf8') }; } catch { return null; } }).filter(Boolean);
  const index = buildExportIndex(corpus);

  const findings = [];
  for (const path of added) {
    let content = ''; try { content = readFileSync(path, 'utf8'); } catch { continue; }
    const hits = findCollisions(path, content, index);
    if (hits.length) findings.push({ path, hits });
  }

  if (findings.length === 0) { console.log(`dup-guard: PASS — ${added.length} new module(s), no duplicate exports.`); process.exit(0); }

  const msg = ['dup-guard: SURVEY-BEFORE-SCAFFOLD',
    ...findings.flatMap((f) => [`  ✗ ${f.path} re-declares existing exports:`,
      ...f.hits.map((h) => `      "${h.symbol}" already in ${h.existingIn.join(', ')}`)]),
    '  Reuse or extend the existing module, or rename if it is genuinely distinct (addition is not free).'].join('\n');

  if (block) { console.error(msg); process.exit(1); }
  console.warn(msg);
  process.exit(0);
}

function selfTest() {
  let fail = 0;
  const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); fail++; } };
  console.log('dup-guard --self-test');

  const corpus = [
    { path: 'scripts/a.mjs', content: 'export function loadThing(){}\nexport const X = 1;' },
    { path: 'scripts/b.mjs', content: 'export function other(){}' },
  ];
  const index = buildExportIndex(corpus);
  ok(index.get('loadThing').length === 1, 'index records the owner of a symbol');
  ok(!index.has('main'), 'generic symbols are ignored');

  const dup = findCollisions('scripts/c.mjs', 'export function loadThing(){}', index);
  ok(dup.length === 1 && dup[0].symbol === 'loadThing', 'a re-declared export is flagged as a collision');
  ok(dup[0].existingIn.includes('scripts/a.mjs'), 'collision names the existing owner');

  const clean = findCollisions('scripts/d.mjs', 'export function brandNew(){}', index);
  ok(clean.length === 0, 'a genuinely new export is not flagged');

  const selfDup = findCollisions('scripts/a.mjs', 'export function loadThing(){}', index);
  ok(selfDup.length === 0, 'a file does not collide with itself');

  const generic = findCollisions('scripts/e.mjs', 'export function main(){}', buildExportIndex([{ path: 'scripts/f.mjs', content: 'export function main(){}' }]));
  ok(generic.length === 0, 'generic-named exports never collide');

  console.log(fail === 0 ? '\ndup-guard: all self-tests passed' : `\ndup-guard: ${fail} self-test(s) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
