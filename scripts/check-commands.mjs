#!/usr/bin/env node
// check-commands — anti-ghost for the slash-command surface (GSD borrow B: drive-commands).
//
// GSD's strength jidoka lacked: a user-drivable command surface with real ergonomics
// (description + argument-hint + allowed-tools) instead of bare description-only commands. This gate
// proves every .claude/commands/jidoka-*.md is well-formed AND that the scripts it tells the
// orchestrator to run actually exist on disk — so a drive-command can't become a ghost (instruct a
// run of a script that isn't there).
//
// Checks per command: has `description`; has `allowed-tools` (least-privilege, the borrowed ergonomic);
// if the body uses $ARGUMENTS/$1 it must declare `argument-hint`; every `scripts/<x>.mjs` it references
// exists in the repo.
//
// FULL & self-tested. Usage: node scripts/check-commands.mjs [--self-test]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm, body: m[2] };
}

export function checkCommand(text, scriptExists = () => true) {
  const { fm, body } = parseFrontmatter(text);
  const errors = [];
  if (!fm.description) errors.push('missing frontmatter: description');
  if (!fm['allowed-tools']) errors.push('missing frontmatter: allowed-tools');
  const usesArgs = /\$ARGUMENTS|\$[1-9]/.test(body);
  if (usesArgs && !fm['argument-hint']) errors.push('uses $ARGUMENTS/$N but declares no argument-hint');
  const refs = [...new Set([...body.matchAll(/scripts\/([a-z0-9-]+\.mjs)/g)].map((mm) => mm[1]))];
  for (const r of refs) if (!scriptExists(r)) errors.push(`references scripts/${r} which is not on disk (ghost)`);
  return { ok: errors.length === 0, errors, usesArgs, refs };
}

function selfTest() {
  const fails = [];
  const ok = (name, cond) => { if (!cond) fails.push(name); console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const good = '---\ndescription: x\nargument-hint: <id>\nallowed-tools: Read, Bash\n---\nDo `node scripts/run-state.mjs --resume $1`.';

  ok('well-formed command passes', checkCommand(good, () => true).ok);
  ok('missing allowed-tools caught', checkCommand('---\ndescription: x\n---\nbody', () => true).errors.some(e => /allowed-tools/.test(e)));
  ok('missing description caught', checkCommand('---\nallowed-tools: Bash\n---\nbody', () => true).errors.some(e => /description/.test(e)));
  ok('args without argument-hint caught', checkCommand('---\ndescription: x\nallowed-tools: Bash\n---\nuse $ARGUMENTS now', () => true).errors.some(e => /argument-hint/.test(e)));
  ok('ghost script reference caught', checkCommand(good, () => false).errors.some(e => /ghost/.test(e)));
  ok('extracts script refs', checkCommand(good, () => true).refs.includes('run-state.mjs'));
  ok('parses description from frontmatter', parseFrontmatter(good).fm.description === 'x');
  ok('no-arg command needs no hint', checkCommand('---\ndescription: x\nallowed-tools: Bash\n---\nno args here').ok);

  if (fails.length) { console.log(`\n\x1b[31mcheck-commands self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ check-commands: frontmatter + arg-hint + script-ref validation correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const ROOT = process.cwd();
  const dir = join(ROOT, '.claude', 'commands');
  if (!existsSync(dir)) { console.error('no .claude/commands directory'); process.exit(1); }
  const files = readdirSync(dir).filter(f => f.startsWith('jidoka-') && f.endsWith('.md'));
  const scriptExists = (r) => existsSync(join(ROOT, 'scripts', r)) || existsSync(join(ROOT, '.jidoka', 'scripts', r));
  let fails = 0;
  console.log(`check-commands — ${files.length} jidoka slash-command(s)\n`);
  for (const f of files) {
    const res = checkCommand(readFileSync(join(dir, f), 'utf8'), scriptExists);
    if (res.ok) console.log(`  \x1b[32m✓\x1b[0m ${f}  (${res.refs.length} script ref(s)${res.usesArgs ? ', args+hint' : ''})`);
    else { fails++; console.log(`  \x1b[31m✗\x1b[0m ${f}: ${res.errors.join('; ')}`); }
  }
  if (fails) { console.error(`\n\x1b[31m✗ ${fails} command(s) malformed\x1b[0m`); process.exit(1); }
  console.log(`\n\x1b[32m✓ all ${files.length} jidoka commands well-formed (description + allowed-tools + arg-hints + real script refs)\x1b[0m`);
  process.exit(0);
}
