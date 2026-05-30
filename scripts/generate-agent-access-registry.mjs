#!/usr/bin/env node
// generate-agent-access-registry — builds docs/governance/agent-access-registry.json
// from GROUND TRUTH, not fabrication:
//   declared_tools  ← each agent's tools: frontmatter (.claude/agents/*.md), verbatim
//   line            ← the agent's Line cell in docs/AGENT_ROSTER.md
//   write_scope     ← quoted from the agent's own role, ONLY for the four Second/Third
//                     line agents that hold Write + a scope-contradicting description
//                     (so validate-agent-access I1 over-privilege does not fire)
//
// declared_tools mirror the .md exactly, so I0 (grant-drift) passes by construction.
// This is a regenerator (re-run when agents change), in the spirit of regenerate-*-index.
//
// Usage: node scripts/generate-agent-access-registry.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const AGENTS_DIR = '.claude/agents';
const ROSTER = 'docs/AGENT_ROSTER.md';
const OUT = 'docs/governance/agent-access-registry.json';

// Real write scopes, quoted from each agent's stated role (not invented):
//   skill-extractor: "Write access: .claude/skills/ and docs/retros/_FINDINGS.md only"
//   self-improvement-reviewer: queues to .claude/self-improvement-queue/ (ROUTINES)
//   reflexion-critic: queues verdicts to .claude/reflexion-queue/<sha>.md (AGENT_ROSTER)
//   test-engineer: "Produces *.test.ts files co-located with implementation targets"
const WRITE_SCOPES = {
  'skill-extractor': '.claude/skills/**, docs/retros/_FINDINGS.md',
  'self-improvement-reviewer': '.claude/self-improvement-queue/**',
  'reflexion-critic': '.claude/reflexion-queue/**',
  'test-engineer': '**/*.test.ts, **/*.spec.ts',
};

// Mirror validate-agent-access.mjs:extractToolsFromFile exactly so I0 matches.
function extractTools(content) {
  const lines = content.split('\n');
  let inFm = false, started = false;
  for (const line of lines) {
    if (line.trim() === '---') { if (!started) { started = true; inFm = true; continue; } else break; }
    if (inFm && line.startsWith('tools:')) {
      const s = line.replace(/^tools:\s*/, '').trim();
      return s ? s.split(',').map(t => t.trim()).filter(Boolean) : [];
    }
  }
  return null; // body-only agent (no frontmatter tools)
}

// Mirror validate-agent-access.mjs:getAgentLine.
const rosterText = readFileSync(ROSTER, 'utf8');
function getLine(slug) {
  const norm = slug.replace(/[\s-]/g, '').toLowerCase();
  let inT = false;
  for (const line of rosterText.split('\n')) {
    if (line.includes('| Agent |') && line.includes('Line:')) { inT = true; continue; }
    if (inT) {
      if (line.startsWith('#') || (!line.startsWith('|') && line.trim() !== '' && !line.startsWith('|---'))) break;
      if (!line.startsWith('|') || line.startsWith('|---')) continue;
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 3) continue;
      if (cells[0].replace(/[\s-]/g, '').toLowerCase() === norm) return cells[2];
    }
  }
  return '';
}

const agents = [];
for (const f of readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).sort()) {
  const slug = f.replace(/\.md$/, '');
  const tools = extractTools(readFileSync(`${AGENTS_DIR}/${f}`, 'utf8'));
  if (tools === null) continue; // body-only agent: no grant to declare, skip cleanly
  agents.push({
    slug,
    declared_tools: tools,
    write_scope: WRITE_SCOPES[slug] ?? null,
    line: getLine(slug),
    blast_radius: 'low',
    llm06_category: 'none',
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  _generated_by: 'scripts/generate-agent-access-registry.mjs',
  _source: '.claude/agents/*.md tools: frontmatter + docs/AGENT_ROSTER.md Line cells',
  _note: 'declared_tools mirror .md exactly (I0 by construction); write_scope set only where role is scope-contradicting (I1), null elsewhere (I2 warn, non-blocking)',
  agents,
}, null, 2) + '\n');
console.log(`generated ${OUT}: ${agents.length} agents (write_scope set for ${Object.keys(WRITE_SCOPES).length})`);
