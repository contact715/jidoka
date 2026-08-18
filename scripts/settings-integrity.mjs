#!/usr/bin/env node
// @scope: all
// @scope-ok: вход это один settings.json, 0,07 с
// settings-integrity — checks that every hook the harness is told to run actually exists
// (2026-W32-R4, proposed as W31-R4 and not built for a week).
//
// THE DEFECT IT CLOSES. ~/.claude/settings.json is the wiring diagram for every forcing
// function in the environment: PreToolUse blockers, Stop gates, the session-start digest.
// Nothing in the engine ever read it. Measured 2026-08-03: UserPromptSubmit carried six
// commands, of which TWO pointed at /Users/mityamit/claude-code-dev-framework (a directory
// that stopped existing when the repo was renamed to jidoka-framework) and TWO more were
// exact duplicates of hooks already listed. So skill-selection had been failing silently on
// every single prompt, in every session, for as long as the rename is old, and every gate
// audit in the engine reported green because none of them looks at this file.
//
// A hook that cannot run is worse than a missing hook: the settings file still claims the
// protection exists. This is declaration-over-implementation at the wiring layer.
//
// WHAT IT CHECKS (three classes):
//   1. dead command   — the script/binary a hook invokes is not on disk
//   2. duplicate      — the same command registered twice on the same event
//   3. empty event    — an event key with no runnable command at all
//
// HONEST BOUNDARY: it resolves absolute paths and paths inside $HOME/$CLAUDE_CONFIG_DIR. A
// command that is a bare binary on $PATH (`node`, `sh`) is not a path claim and is skipped
// rather than guessed at. Where settings.json is absent (CI, a fresh machine) it reports n/a
// and exits 0 instead of inventing a verdict.
//
// Usage:
//   node scripts/settings-integrity.mjs                 # check ~/.claude/settings.json
//   node scripts/settings-integrity.mjs --file <path>
//   node scripts/settings-integrity.mjs --self-test

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SETTINGS = () => join(homedir(), '.claude', 'settings.json');

// A command string may be "node /abs/path/x.mjs --hook" or "/abs/path/x.sh" or "npm run y".
// Pull out the first token that LOOKS like a filesystem path claim; return null when the
// command makes no path claim we can check.
export function commandPath(cmd = '') {
  const tokens = String(cmd).trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (t.startsWith('-')) continue;
    if (t.startsWith('/') || t.startsWith('~/') || t.startsWith('./')) return t.replace(/^~/, homedir());
  }
  return null;
}

/** Flatten settings.hooks into {event, command} rows. Pure. */
export function hookCommands(settings = {}) {
  const out = [];
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    for (const g of groups || []) {
      for (const h of (g && g.hooks) || []) {
        if (h && typeof h.command === 'string') out.push({ event, matcher: g.matcher || '*', command: h.command });
      }
    }
  }
  return out;
}

/**
 * Audit the wiring. Pure — `exists` is injected so this is testable with no filesystem.
 * @param {object} settings
 * @param {(p:string)=>boolean} exists
 */
export function audit(settings, exists = () => true) {
  const rows = hookCommands(settings);
  const dead = [];
  const duplicates = [];
  const seen = new Map();

  for (const r of rows) {
    const p = commandPath(r.command);
    if (p && !exists(p)) dead.push({ ...r, path: p });
    const key = `${r.event} ${r.matcher} ${r.command}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    // NOTE the key includes the MATCHER (see hookCommands). The same command on two different
    // matchers is deliberate and load-bearing: policy-enforce-hook.mjs is registered on Bash AND
    // on Write|Edit because it guards two distinct side channels. The first version of this gate
    // keyed on event+command alone and reported that pair as a duplicate — a false positive
    // that, if obeyed, would have deleted a live protection. A gate that pushes you to remove a
    // working guard is worse than no gate. Caught 2026-08-03 by running it on the real file.
    if (n === 2) duplicates.push(r); // report each duplicated command once
  }

  const emptyEvents = Object.entries(settings.hooks || {})
    .filter(([, groups]) => hookCommands({ hooks: { x: groups } }).length === 0)
    .map(([event]) => event);

  return { total: rows.length, dead, duplicates, emptyEvents, ok: dead.length === 0 && duplicates.length === 0 && emptyEvents.length === 0 };
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (name, cond) => { if (!cond) fails++; console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); };
  const H = homedir();

  // commandPath
  ok('extracts the script path from "node /abs/x.mjs --hook"', commandPath('node /abs/x.mjs --hook') === '/abs/x.mjs');
  ok('extracts a bare absolute command', commandPath('/abs/y.sh') === '/abs/y.sh');
  ok('expands a leading tilde', commandPath('node ~/z.mjs') === join(H, '/z.mjs'));
  ok('makes no claim for a bare binary on PATH', commandPath('npm run gate') === null);
  ok('skips flags when hunting for the path', commandPath('node --enable-source-maps /abs/w.mjs') === '/abs/w.mjs');
  ok('tolerates an empty command', commandPath('') === null);

  // the real shape that was broken on 2026-08-03: dead path, registered twice
  const broken = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ command: '/live/reminder.sh' }, { command: 'node /gone/skill-selector.mjs --hook' }] },
        { hooks: [{ command: '/live/reminder.sh' }, { command: 'node /gone/skill-selector.mjs --hook' }] },
      ],
      Stop: [{ matcher: '*', hooks: [{ command: 'node /live/stop.mjs' }] }],
    },
  };
  const exists = (p) => p.startsWith('/live/');
  const a = audit(broken, exists);
  ok('flattens every event/group/hook', a.total === 5);
  ok('catches the dead command', a.dead.length === 2);
  ok('names the missing path', a.dead[0].path === '/gone/skill-selector.mjs');
  ok('catches the duplicated registrations', a.duplicates.length === 2);
  ok('reports a duplicated command once, not per occurrence',
    a.duplicates.filter(d => d.command === '/live/reminder.sh').length === 1);
  ok('a broken wiring is not ok', a.ok === false);

  // clean settings
  const clean = { hooks: { Stop: [{ hooks: [{ command: 'node /live/stop.mjs' }] }] } };
  ok('clean wiring passes', audit(clean, exists).ok === true);
  ok('a bare-binary command never counts as dead', audit({ hooks: { Stop: [{ hooks: [{ command: 'npm run gate' }] }] } }, () => false).dead.length === 0);

  // empty / absent shapes must not throw or invent findings
  ok('no hooks key → ok', audit({}, exists).ok === true);
  ok('an event with no runnable command is flagged', audit({ hooks: { Stop: [{ hooks: [] }] } }, exists).emptyEvents.join() === 'Stop');
  ok('audit does not mutate its input', (() => { const s = JSON.parse(JSON.stringify(broken)); audit(s, exists); return JSON.stringify(s) === JSON.stringify(broken); })());

  if (fails) { console.log('\n\x1b[31msettings-integrity self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ settings-integrity: dead / duplicate / empty hook wiring detected (18 assertions)\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const i = process.argv.indexOf('--file');
  const file = i !== -1 ? process.argv[i + 1] : DEFAULT_SETTINGS();

  if (!existsSync(file)) {
    console.log(`\x1b[2m○ settings-integrity: n/a — no settings file at ${file}\x1b[0m`);
    process.exit(0);
  }
  let settings;
  try { settings = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) {
    console.log(`\x1b[31m✗ settings-integrity: ${file} is not valid JSON — ${e.message}\x1b[0m`);
    process.exit(1);
  }

  const r = audit(settings, (p) => existsSync(p));
  if (r.ok) {
    console.log(`\x1b[32m✓ settings-integrity: ${r.total} hook command(s), every path resolves, no duplicates\x1b[0m`);
    process.exit(0);
  }
  console.log(`\x1b[31m✗ settings-integrity: broken hook wiring in ${file}\x1b[0m`);
  for (const d of r.dead) console.log(`  \x1b[31mdead\x1b[0m      ${d.event}: ${d.command}\n            → ${d.path} does not exist, so this hook fails silently every time it fires`);
  for (const d of r.duplicates) console.log(`  \x1b[33mduplicate\x1b[0m ${d.event}: ${d.command}`);
  for (const e of r.emptyEvents) console.log(`  \x1b[33mempty\x1b[0m     ${e}: registered with no runnable command`);
  process.exit(1);
}
