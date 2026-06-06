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

import { readFileSync, appendFileSync } from 'node:fs';

// case-INSENSITIVE: a red-team probe found that on a case-insensitive filesystem (macOS/Windows)
// "docs/constitution.md" is the SAME file as "docs/CONSTITUTION.md" but a case-sensitive regex let
// it through. /i closes the regex-vs-filesystem casing gap.
//
// Two tiers:
//   ALWAYS_PROTECTED — secrets, .git, registries, baselines, gate machinery. NEVER writable by
//                      agents, no exceptions, no grants.
//   L0_DOCS          — constitution / mission / north-star documents. Blocked by default
//                      ("human edits directly"), but writable under an explicit OWNER GRANT
//                      (see getGrant below) with a full audit trail.
export const ALWAYS_PROTECTED = [
  /(^|\/)\.secrets/i, /(^|\/)\.credentials/i, /\.env(\.|$)/i, /(^|\/)\.git\//i,
  /agent-access-registry\.json$/i, /_baseline\.json$/i, /meta-remedies\.mjs$/i,
];
export const L0_DOCS = [
  /CONSTITUTION\.md$/i, /MISSION\.md$/i, /NORTH_STAR\.md$/i,
];
export const PROTECTED = [...ALWAYS_PROTECTED, ...L0_DOCS];
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

// ── Owner grant for L0 docs ──────────────────────────────────────────────────
// File: ~/.claude/hooks/l0-write-grant.json → { grantedBy, reason, expiresAt (epoch ms) }.
// Every write allowed under a grant is appended to ~/.claude/hooks/l0-write-audit.jsonl.
//
// HONEST BOUNDARY: the grant is owner DELEGATION with an audit trail, not a hard security
// boundary — a process that can write files could also write the grant file. It exists because
// the owner explicitly chose autonomous L0 edits over per-edit manual approval (2026-06-05),
// and the audit log keeps every use visible. Default (no grant / expired grant) remains: block.
// Secrets / .git / registries (ALWAYS_PROTECTED) are NOT grantable under any circumstances.
const GRANT_PATH = () => `${process.env.HOME || ''}/.claude/hooks/l0-write-grant.json`;
const AUDIT_PATH = () => `${process.env.HOME || ''}/.claude/hooks/l0-write-audit.jsonl`;

export function getGrant(now = Date.now(), readGrant = () => readFileSync(GRANT_PATH(), 'utf8')) {
  try {
    const g = JSON.parse(readGrant());
    if (g && g.grantedBy && typeof g.expiresAt === 'number' && now < g.expiresAt) return g;
  } catch { /* no grant file / malformed → no grant */ }
  return null;
}

// pure: may this set of offending targets pass under a grant? Only if EVERY target is an L0 doc
// and NONE touches an always-protected path (e.g. ".git/MISSION.md" stays blocked).
export function grantCovers(targets, grant) {
  if (!grant || !targets.length) return false;
  return targets.every(t => L0_DOCS.some(re => re.test(t)) && !ALWAYS_PROTECTED.some(re => re.test(t)));
}

// Bash is not a write-tool by NAME, but it can WRITE to a protected path through a side channel:
// `echo x > file`, `>> append`, `tee`, `sed -i`, `cp/mv dest`, `node -e fs.writeFileSync(...)`. A
// red-team read of this hook found that gap (Write/Edit were blocked, but a bash file-write to the same
// L0 path sailed through). Extract the WRITE TARGETS of a bash command; a mere READ (cat/grep/<) names
// the path but produces no write target, so it is not blocked. Conservative for in-place editors.
export function bashWriteTargets(cmd = '') {
  const t = [];
  for (const m of cmd.matchAll(/>>?\s*([^\s;|&>]+)/g)) t.push(m[1]);                                          // > file / >> file
  for (const m of cmd.matchAll(/\btee\s+(?:-\S+\s+)*([^\s;|&]+)/g)) t.push(m[1]);                              // tee [flags] file
  for (const m of cmd.matchAll(/(?:writeFileSync|appendFileSync|writeFile|createWriteStream)\s*\(\s*['"`]([^'"`]+)/g)) t.push(m[1]); // fs writers
  // in-place editors write to their path args — be conservative and scan every token
  if (/\b(?:sed|perl)\s+-i/.test(cmd) || /\bdd\b[^\n]*\bof=/.test(cmd)) {
    for (const tok of cmd.split(/[\s;|&'"]+/)) t.push(tok.replace(/^of=/, ''));
  }
  const cpmv = cmd.match(/\b(?:cp|mv|install)\b[^\n;|&]*\s(\S+)/);                                            // cp/mv destination
  if (cpmv) t.push(cpmv[1]);
  return t;
}

// pure: should this tool call be blocked (before considering any grant)?
export function isBlocked(tool, file, protectedList = PROTECTED, command = '') {
  if (tool === 'Bash') return bashWriteTargets(command).some(t => protectedList.some(re => re.test(t)));
  if (!WRITE_TOOLS.test(tool || '')) return false;
  if (!file) return false;
  return protectedList.some(re => re.test(file));
}

// pure: the offending targets of a call (for grant evaluation + the block message)
export function offendingTargets(tool, file, command = '', protectedList = PROTECTED) {
  if (tool === 'Bash') return bashWriteTargets(command).filter(t => protectedList.some(re => re.test(t)));
  return file ? [file] : [];
}

function selfTest() {
  const grant = { grantedBy: 'owner', reason: 'test', expiresAt: Date.now() + 60_000 };
  const expired = { grantedBy: 'owner', reason: 'test', expiresAt: Date.now() - 1 };
  const T = [
    ['blocks Write to a secrets file', isBlocked('Write', '/proj/.secrets.json') === true],
    ['blocks Edit to CONSTITUTION.md', isBlocked('Edit', 'docs/CONSTITUTION.md') === true],
    ['blocks Write to the agent-access registry', isBlocked('Write', 'docs/governance/agent-access-registry.json') === true],
    ['blocks Write to an eval baseline', isBlocked('Write', 'docs/evals/_baseline.json') === true],
    ['blocks writes inside .git', isBlocked('Edit', '/proj/.git/config') === true],
    ['allows a normal source write', isBlocked('Write', 'src/app/foo.ts') === false],
    ['does NOT block Read of a protected path', isBlocked('Read', 'docs/MISSION.md') === false],
    ['blocks a case-variant of a protected path (red-team find)', isBlocked('Write', 'docs/constitution.md') === true && isBlocked('Edit', '.SECRETS.json') === true],
    ['allows writing a normal doc', isBlocked('Write', 'docs/specs/wave-x.md') === false],
    // Bash side-channel (red-team find): a bash WRITE to an L0 path is blocked; a bash READ is not.
    ['blocks Bash "> " redirect to CONSTITUTION', isBlocked('Bash', '', PROTECTED, 'echo x > docs/CONSTITUTION.md') === true],
    ['blocks Bash ">>" append to the gate registry', isBlocked('Bash', '', PROTECTED, 'echo y >> scripts/meta-remedies.mjs') === true],
    ['blocks Bash node fs.writeFileSync to the gate registry', isBlocked('Bash', '', PROTECTED, `node -e "fs.writeFileSync('scripts/meta-remedies.mjs', x)"`) === true],
    ['blocks Bash "sed -i" on the gate registry', isBlocked('Bash', '', PROTECTED, `sed -i '' 's/a/b/' scripts/meta-remedies.mjs`) === true],
    ['does NOT block Bash READ (grep) of a protected path', isBlocked('Bash', '', PROTECTED, 'grep foo scripts/meta-remedies.mjs') === false],
    ['does NOT block Bash that reads protected but writes elsewhere', isBlocked('Bash', '', PROTECTED, 'cat docs/CONSTITUTION.md > /tmp/out') === false],
    ['does NOT block an ordinary Bash command', isBlocked('Bash', '', PROTECTED, 'npm run eval') === false],
    // Owner grant for L0 docs: allows constitution/mission/north-star, NEVER secrets/.git/registries.
    ['grant covers an L0 doc write', grantCovers(['docs/CONSTITUTION.md'], grant) === true],
    ['grant covers a bash cp to NORTH_STAR.md', grantCovers(offendingTargets('Bash', '', 'cp /tmp/x docs/NORTH_STAR.md'), grant) === true],
    ['grant does NOT cover a secrets write', grantCovers(['.secrets.json'], grant) === false],
    ['grant does NOT cover a .git-internal L0 path', grantCovers(['.git/MISSION.md'], grant) === false],
    ['grant does NOT cover a mixed batch (L0 doc + registry)', grantCovers(['docs/MISSION.md', 'docs/governance/agent-access-registry.json'], grant) === false],
    ['expired grant is not returned', getGrant(Date.now(), () => JSON.stringify(expired)) === null],
    ['valid grant is returned', getGrant(Date.now(), () => JSON.stringify(grant))?.grantedBy === 'owner'],
    ['missing grant file → null', getGrant(Date.now(), () => { throw new Error('ENOENT'); }) === null],
    ['no grant → grantCovers false', grantCovers(['docs/MISSION.md'], null) === false],
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
  const command = data.tool_input?.command || '';
  if (isBlocked(tool, file, PROTECTED, command)) {
    const targets = offendingTargets(tool, file, command);
    const grant = getGrant();
    if (grantCovers(targets, grant)) {
      // Owner-granted L0 write: allow, but leave a permanent audit record.
      try {
        appendFileSync(AUDIT_PATH(), JSON.stringify({
          ts: new Date().toISOString(), tool, targets,
          grantedBy: grant.grantedBy, reason: grant.reason, expiresAt: grant.expiresAt,
        }) + '\n');
      } catch { /* audit write failure must not silently widen the gate */ }
      console.error(`policy-enforce: ALLOWED L0 write under owner grant (${grant.grantedBy}: "${grant.reason}") — audited in l0-write-audit.jsonl`);
      process.exit(0);
    }
    const target = targets[0] || '(protected path)';
    console.error(`policy-enforce: BLOCKED ${tool} write to protected path "${target}" — L0/security file, human edit only. (override: a human edits it directly, or an owner grant in ~/.claude/hooks/l0-write-grant.json)`);
    process.exit(2); // non-zero → PreToolUse blocks the call
  }
  process.exit(0);
}
