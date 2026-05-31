#!/usr/bin/env node
// snapshot-global — capture the live global ~/.claude setup into global-setup/ for
// versioning. Inverse of global-setup/install-global.sh. Run before committing changes
// to the global setup, so the repo snapshot stays in sync with what's actually on disk.
//
// Machine paths (/Users/<you>) are rewritten to $HOME so the snapshot is portable and
// passes pre-publish-guard. Usage: npm run snapshot:global

import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const SRC = join(HOME, '.claude');
const DEST = 'global-setup';
mkdirSync(join(DEST, 'hooks'), { recursive: true });
mkdirSync(join(DEST, 'skills', 'dev-pipeline'), { recursive: true });

const FILES = [
  'CLAUDE.md',
  'hooks/jidoka-guard.sh',
  'hooks/jidoka-feature-reminder.sh',
  'hooks/policy-enforce-hook.mjs',
  'skills/dev-pipeline/SKILL.md',
];

let n = 0;
for (const rel of FILES) {
  const sp = join(SRC, rel);
  if (!existsSync(sp)) { console.error(`  ⚠ missing on disk, skipped: ${rel}`); continue; }
  const content = readFileSync(sp, 'utf8').split(HOME).join('$HOME'); // de-machine paths
  writeFileSync(join(DEST, rel), content);
  n++;
}

// settings hooks fragment (hooks only — never the whole settings with permissions)
if (existsSync(join(SRC, 'settings.json'))) {
  const s = JSON.parse(readFileSync(join(SRC, 'settings.json'), 'utf8'));
  const frag = JSON.stringify({ hooks: s.hooks || {} }, null, 2).split(HOME).join('$HOME');
  writeFileSync(join(DEST, 'settings-hooks-fragment.json'), frag + '\n');
}

console.log(`snapshot-global: captured ${n} file(s) + settings hooks → ${DEST}/ (paths de-machined to $HOME)`);
console.log('Next: git add global-setup && git commit -m "chore: re-snapshot global setup" && git push');
