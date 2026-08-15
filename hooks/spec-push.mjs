#!/usr/bin/env node
// spec-push — PostToolUse on Write|Edit. When a governed file is edited, the spec that governs it
// is pushed into context instead of waiting to be pulled.
//
// spec-pushed-at-edit-time (2026-W31-R15)
//
// Spec context used to be pull-only: you got the ancestry chain if you knew to ask and knew the
// feature name. At the moment it matters — a file being edited — nothing said "this is governed
// by that spec". So the spec got read when someone remembered, and skipped when the edit looked
// small, which is exactly when specs get violated.
//
// This is informational, never blocking: it adds a line of context after the edit has already
// happened. Fail-open in every branch — a missing index, an unreadable file or any error at all
// exits 0 silently. A hook that interferes with editing would be traded away within a week.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATE_ROOTS = [
  join(homedir(), 'jidoka-framework'),
  join(homedir(), '.claude', 'jidoka'),
];

/** Path relative to whichever known root contains it, or null. Pure. */
export function relativeToRoot(abs, roots) {
  for (const r of roots) {
    if (abs === r) continue;
    if (abs.startsWith(`${r}/`)) return abs.slice(r.length + 1);
  }
  return null;
}

function selfTest() {
  let fails = 0;
  const ok = (n, c) => { if (!c) fails++; console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  const roots = ['/a/repo', '/b/other'];
  ok('путь внутри корня становится относительным', relativeToRoot('/a/repo/scripts/x.mjs', roots) === 'scripts/x.mjs');
  ok('второй корень тоже работает', relativeToRoot('/b/other/hooks/y.mjs', roots) === 'hooks/y.mjs');
  ok('путь вне корней даёт null', relativeToRoot('/c/elsewhere/z.mjs', roots) === null);
  ok('сам корень не считается файлом в нём', relativeToRoot('/a/repo', roots) === null);
  ok('похожий по префиксу, но другой каталог не ловится', relativeToRoot('/a/repo-other/x.mjs', roots) === null);
  if (fails) { console.log(`\n\x1b[31mspec-push self-test FAILED (${fails})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ spec-push: путь сопоставляется корню верно\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw || '{}');
      const file = (input.tool_input && input.tool_input.file_path) || (input.tool_response && input.tool_response.filePath) || '';
      if (!file) process.exit(0);
      const rel = relativeToRoot(file, CANDIDATE_ROOTS);
      if (!rel) process.exit(0);

      const idxPath = CANDIDATE_ROOTS.map((r) => join(r, 'docs/audits/spec-path-index.json')).find(existsSync);
      if (!idxPath) process.exit(0);
      const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
      const hits = idx[rel];
      if (!hits || !hits.length) process.exit(0);

      const top = hits[0];
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `Файл ${rel} регулируется спекой ${top.spec} (назван в ней ${top.mentions} раз). Если правка меняет ПОВЕДЕНИЕ, сверься с её требованиями, прежде чем считать работу сделанной.`,
        },
      }));
    } catch { /* fail-open: never interfere with an edit */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}
