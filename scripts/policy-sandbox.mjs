#!/usr/bin/env node
// Policy sandbox — blast-radius limit at the POLICY level.
//
// HONEST BOUNDARY (AC-4.3): this is NOT an OS sandbox. It does not isolate processes, the
// filesystem, or the network. It enforces the DECLARED contract from agent-access-registry:
// an agent may only write inside its write_scope, and may only use its declared_tools. That
// catches the common failure (an agent touches a file it had no business touching, or reaches
// for a tool it wasn't granted) at review/CI time. For true OS isolation per sub-agent, the
// real path is Claude Code Sandboxing (directory+network allowlist) when wired — see
// https://code.claude.com/docs/en/sandboxing . This is the policy PROXY until then.
//
// FULL & self-tested. Usage:
//   node scripts/policy-sandbox.mjs --self-test
//   node scripts/policy-sandbox.mjs --agent skill-extractor --files ".claude/skills/x.md,src/app.ts"
//   node scripts/policy-sandbox.mjs --agent reflexion-critic --tools "Read,Write,Bash"

import { readFileSync, existsSync } from 'node:fs';
const REGISTRY = 'docs/governance/agent-access-registry.json';

// glob match: "x/**" = prefix x/, "**/*.test.ts" via split-on-**, exact otherwise. No deps.
export function inScope(file, scopeStr) {
  if (!scopeStr) return null; // null write_scope = unscoped (registry flags this as I2 warn separately)
  return scopeStr.split(',').map(s => s.trim()).filter(Boolean).some(s => {
    if (s.endsWith('/**')) return file.startsWith(s.slice(0, -3) + '/') || file === s.slice(0, -3);
    if (s.endsWith('**') && !s.slice(0, -2).includes('*')) return file.startsWith(s.slice(0, -2));
    if (s.includes('*')) {
      // split on ** → ".*", escape each part's regex specials, single * → one path segment
      const esc = t => t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      const re = new RegExp('^' + s.split('**').map(esc).join('.*') + '$');
      return re.test(file);
    }
    return file === s;
  });
}

export function checkWrites(agent, files, registry) {
  const entry = (registry.agents || []).find(a => a.slug === agent);
  if (!entry) return { ok: false, reason: `agent "${agent}" not in registry`, violations: [] };
  if (!entry.write_scope) return { ok: true, unscoped: true, violations: [] }; // unscoped — not blocked here
  const violations = files.filter(f => inScope(f, entry.write_scope) === false);
  return { ok: violations.length === 0, scope: entry.write_scope, violations };
}

export function checkTools(agent, tools, registry) {
  const entry = (registry.agents || []).find(a => a.slug === agent);
  if (!entry) return { ok: false, reason: `agent "${agent}" not in registry`, violations: [] };
  const granted = new Set((entry.declared_tools || []).map(t => t.trim()));
  const violations = tools.filter(t => !granted.has(t.trim()));
  return { ok: violations.length === 0, granted: [...granted], violations };
}

if (process.argv.includes('--self-test')) {
  const reg = { agents: [
    { slug: 'skill-extractor', write_scope: '.claude/skills/**, docs/retros/_FINDINGS.md', declared_tools: ['Read', 'Grep', 'Write'] },
    { slug: 'test-engineer', write_scope: '**/*.test.ts, **/*.spec.ts', declared_tools: ['Read', 'Write', 'Edit'] },
    { slug: 'reflexion-critic', write_scope: '.claude/reflexion-queue/**', declared_tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write'] },
  ] };
  const T = [
    ['write in-scope (skill)', () => checkWrites('skill-extractor', ['.claude/skills/foo.md'], reg).ok === true],
    ['write in-scope (exact file)', () => checkWrites('skill-extractor', ['docs/retros/_FINDINGS.md'], reg).ok === true],
    ['write OUT-of-scope (src)', () => checkWrites('skill-extractor', ['src/app.ts'], reg).ok === false],
    ['test-engineer .test.ts in', () => checkWrites('test-engineer', ['src/a.test.ts'], reg).ok === true],
    ['test-engineer .ts OUT', () => checkWrites('test-engineer', ['src/a.ts'], reg).ok === false],
    ['tool granted', () => checkTools('reflexion-critic', ['Read', 'Bash'], reg).ok === true],
    ['tool NOT granted', () => checkTools('reflexion-critic', ['Edit'], reg).ok === false],
    ['unknown agent', () => checkWrites('ghost', ['x'], reg).ok === false],
  ];
  let fails = 0;
  for (const [name, fn] of T) { const ok = fn(); if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mpolicy-sandbox self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ policy-sandbox enforcement correct (policy-level, not OS — see header)\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const agent = arg('--agent');
if (!agent) { console.error('usage: --agent <slug> [--files a,b] [--tools X,Y] | --self-test'); process.exit(2); }
const registry = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : { agents: [] };
let bad = false;
if (arg('--files')) {
  const r = checkWrites(agent, arg('--files').split(','), registry);
  if (r.unscoped) console.log(`○ ${agent}: no write_scope declared (unscoped — registry I2 warn)`);
  else if (r.ok) console.log(`\x1b[32m✓ ${agent}: all writes within scope\x1b[0m (${r.scope})`);
  else { bad = true; console.error(`\x1b[31m✗ ${agent}: out-of-scope writes:\x1b[0m ${r.violations.join(', ')}  (allowed: ${r.scope})`); }
}
if (arg('--tools')) {
  const r = checkTools(agent, arg('--tools').split(','), registry);
  if (r.ok) console.log(`\x1b[32m✓ ${agent}: all tools granted\x1b[0m`);
  else { bad = true; console.error(`\x1b[31m✗ ${agent}: ungranted tools:\x1b[0m ${r.violations.join(', ')}  (granted: ${r.granted.join(', ')})`); }
}
process.exit(bad ? 1 : 0);
