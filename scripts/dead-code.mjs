#!/usr/bin/env node
// dead-code — find engine scripts that nothing references (orphans). A script is LIVE if it is
// imported by another script, OR mentioned in any reference source: package.json npm-scripts, the eval
// suite (docs/evals/_cases.jsonl), the jidoka CLI dispatch (jidoka.mjs), the CI workflows, the skills,
// or the agent roster. A script referenced by NONE of those is a candidate orphan — dead weight that
// inflates the surface and rots. (One of the GSD-vs-jidoka findings was jidoka's heavy surface; this
// keeps it honest.)
//
// HONEST boundary: a basename-mention check across 6 reference sources, not a full call-graph. A script
// that is only ever run ad-hoc by a human (never wired anywhere) will show as an orphan — REVIEW before
// deleting, don't auto-remove. Self-references (a script naming itself in its own usage comment) are
// excluded so they don't mask a real orphan.
//
// FULL & self-tested. Usage:
//   node scripts/dead-code.mjs --self-test
//   node scripts/dead-code.mjs            (report orphans in scripts/; exit 1 if any)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// pure: a script is an orphan if no OTHER file's text and no external reference text mentions it
export function orphans(scripts, fileTexts, externalText = '') {
  return scripts.filter((s) => {
    if (externalText.includes(s)) return false;
    return !scripts.some((o) => o !== s && (fileTexts[o] || '').includes(s));
  });
}

function gather(root) {
  const dir = join(root, 'scripts');
  const scripts = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  const fileTexts = Object.fromEntries(scripts.map((s) => [s, readFileSync(join(dir, s), 'utf8')]));
  // explicit reference sources: npm scripts, the eval suite, the CLI, the runtime config, and the
  // top-level + scripts READMEs (a script documented or configured here is wired, not dead).
  const sources = ['package.json', '.sdd-config.json', 'README.md', 'CLAUDE.md',
    'docs/evals/_cases.jsonl', 'scripts/README.md', 'scripts/jidoka.mjs'];
  let externalText = sources.map((p) => join(root, p)).filter(existsSync).map((p) => readFileSync(p, 'utf8')).join('\n');
  // walked dirs: workflows, skills, agents, docs, AND git hooks (.husky — extensionless hook files).
  for (const sub of [['.github', 'workflows'], ['.claude', 'skills'], ['.claude', 'agents'], ['docs'], ['.husky']]) {
    const d = join(root, ...sub);
    if (!existsSync(d)) continue;
    const husky = sub[0] === '.husky';
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (husky || /\.(ya?ml|md|json|sh|cjs)$/.test(e.name)) externalText += '\n' + readFileSync(p, 'utf8');
    });
    try { walk(d); } catch { /* ignore */ }
  }
  // shell helpers/hooks in scripts/ can invoke a .mjs too
  for (const f of readdirSync(dir)) if (f.endsWith('.sh')) externalText += '\n' + readFileSync(join(dir, f), 'utf8');
  return { scripts, fileTexts, externalText };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const fileTexts = {
    // NB: a references b by NAME only (the dead-code logic needs a mere mention), not via a real import
    // statement — an import-like string in a fixture would otherwise trip the broken-import scan.
    'a.mjs': '// a calls into b.mjs for its helper\n// usage: node scripts/a.mjs',
    'b.mjs': '// b does the work',
    'c.mjs': '// orphan — nobody imports or runs me',
    'd.mjs': '// only referenced by an npm script',
  };
  const list = ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'];
  const ext = 'package.json: "start": "node scripts/a.mjs", "lint": "node scripts/d.mjs"';
  const o = orphans(list, fileTexts, ext);

  ok('imported script is live (b imported by a)', !o.includes('b.mjs'));
  ok('npm-referenced script is live (d in externalText)', !o.includes('d.mjs'));
  ok('externally-referenced entry is live (a in npm scripts)', !o.includes('a.mjs'));
  ok('truly orphaned script is flagged (c)', o.includes('c.mjs'));
  ok('a self-mention in its OWN file does not save an orphan', orphans(['x.mjs'], { 'x.mjs': '// run node scripts/x.mjs' }, '').includes('x.mjs'));
  ok('an importer that nothing references is still live if it is mentioned externally', !orphans(['a.mjs'], { 'a.mjs': 'x' }, 'node scripts/a.mjs').includes('a.mjs'));
  ok('orphans returns only orphans', JSON.stringify(o) === JSON.stringify(['c.mjs']));

  if (fails.length) { console.log(`\n\x1b[31mdead-code self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ dead-code: orphan detection correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const { scripts, fileTexts, externalText } = gather(process.cwd());
  const dead = orphans(scripts, fileTexts, externalText);
  console.log(`dead-code — ${scripts.length} engine scripts scanned across 6 reference sources\n`);
  if (!dead.length) { console.log('  \x1b[32m✓ no orphaned scripts — every script is imported or wired somewhere.\x1b[0m'); process.exit(0); }
  console.log(`  \x1b[33m${dead.length} candidate orphan(s) (referenced nowhere — review before deleting):\x1b[0m`);
  for (const d of dead) console.log(`    • scripts/${d}`);
  console.log('\n  (HONEST: basename-mention across imports + npm + eval + jidoka CLI + workflows + skills/agents/docs. An ad-hoc-only script shows here — review, do not auto-delete.)');
  process.exit(1);
}
