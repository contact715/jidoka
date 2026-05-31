#!/usr/bin/env node
// policy-enforce-hook — a PreToolUse hook that BLOCKS writes to protected L0/security paths in
// real time (not after the fact). This is the honest enforcement step beyond policy-sandbox (which
// only reports): here a Write/Edit to a constitution, mission, the agent-access registry, an eval
// baseline, a secrets file, or inside .git is stopped before it happens, requiring a human.
//
// HONEST BOUNDARY: this is path-level enforcement at the hook layer. It is NOT a per-agent OS
// sandbox (a PreToolUse hook does not know which subagent is acting, and cannot isolate the
// process/filesystem). It is the real-time intermediate step toward that — labelled, not oversold.
//
// PreToolUse protocol: reads the tool-call JSON on stdin; exit non-zero blocks the tool call.
//
// FULL & self-tested. Usage:
//   node scripts/policy-enforce-hook.mjs --self-test
//   (as a hook) echo '{"tool_name":"Write","tool_input":{"file_path":"..."}}' | node scripts/policy-enforce-hook.mjs

import { readFileSync } from 'node:fs';

export const PROTECTED = [
  /(^|\/)\.secrets/, /(^|\/)\.credentials/, /\.env(\.|$)/, /(^|\/)\.git\//,
  /CONSTITUTION\.md$/, /MISSION\.md$/, /NORTH_STAR\.md$/,
  /agent-access-registry\.json$/, /_baseline\.json$/, /meta-remedies\.mjs$/,
];
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

// pure: should this tool call be blocked?
export function isBlocked(tool, file, protectedList = PROTECTED) {
  if (!WRITE_TOOLS.test(tool || '')) return false;
  if (!file) return false;
  return protectedList.some(re => re.test(file));
}

function selfTest() {
  const T = [
    ['blocks Write to a secrets file', isBlocked('Write', '/proj/.secrets.json') === true],
    ['blocks Edit to CONSTITUTION.md', isBlocked('Edit', 'docs/CONSTITUTION.md') === true],
    ['blocks Write to the agent-access registry', isBlocked('Write', 'docs/governance/agent-access-registry.json') === true],
    ['blocks Write to an eval baseline', isBlocked('Write', 'docs/evals/_baseline.json') === true],
    ['blocks writes inside .git', isBlocked('Edit', '/proj/.git/config') === true],
    ['allows a normal source write', isBlocked('Write', 'src/app/foo.ts') === false],
    ['does NOT block Read of a protected path', isBlocked('Read', 'docs/MISSION.md') === false],
    ['allows writing a normal doc', isBlocked('Write', 'docs/specs/wave-x.md') === false],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mpolicy-enforce-hook self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ policy-enforce-hook: protected-path enforcement correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  let data = {};
  try { data = JSON.parse(raw || '{}'); } catch { process.exit(0); } // malformed → don't block
  const tool = data.tool_name || data.tool || '';
  const file = data.tool_input?.file_path || data.tool_input?.path || data.file_path || '';
  if (isBlocked(tool, file)) {
    console.error(`policy-enforce: BLOCKED ${tool} to protected path "${file}" — L0/security file, human edit only. (override: a human edits it directly)`);
    process.exit(2); // non-zero → PreToolUse blocks the call
  }
  process.exit(0);
}
