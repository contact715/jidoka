#!/usr/bin/env node
// spec-tldr — a deterministic, structural TL;DR of a spec: pull the goal + objectives + acceptance
// criteria into a compact bullet list, so a human can approve the GIST without reading the whole spec.
// Borrow from a practitioner who has the spec-writer ALSO summarise the spec in plain language — he
// approves the summary, not the 600-line document. This is the deterministic extraction half; the
// chief-architect adds the plain-language semantic gloss (an agent-prompt instruction).
//
// HONEST boundary: structural extraction (headers + list items), not semantic rewriting. It surfaces
// what the spec SAYS in its objective/AC sections; it does not interpret intent.
//
// FULL & self-tested. Usage:
//   node scripts/spec-tldr.mjs --self-test
//   node scripts/spec-tldr.mjs --spec docs/specs/wave-x.md

import { readFileSync, existsSync } from 'node:fs';

function sectionBullets(lines, sectionRe, limit = 12) {
  let inSec = false; const items = [];
  for (const l of lines) {
    if (/^#{1,4}\s/.test(l)) inSec = sectionRe.test(l);
    else if (inSec) { const m = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/); if (m && items.length < limit) items.push(m[1].trim()); }
  }
  return items;
}

export function tldr(md = '') {
  const lines = md.split('\n');
  const goalMatch = md.match(/^#+\s*(?:goal|north star|objective|summary|overview)[^\n]*\n+\s*([^\n#][^\n]*)/im);
  const goal = goalMatch ? goalMatch[1].trim() : (lines.find((l) => l.trim() && !l.startsWith('#')) || '').trim();
  return {
    goal,
    objectives: sectionBullets(lines, /objective|goal/i, 7),
    acceptanceCriteria: sectionBullets(lines, /acceptance|criteria/i, 10),
    lines: lines.length,
  };
}

export function render(t) {
  const out = [`📋 Spec TL;DR (${t.lines} lines)`];
  if (t.goal) out.push(`\nGoal: ${t.goal}`);
  if (t.objectives.length) out.push(`\nObjectives (${t.objectives.length}):`, ...t.objectives.map((o) => `  • ${o}`));
  if (t.acceptanceCriteria.length) out.push(`\nAcceptance (${t.acceptanceCriteria.length}):`, ...t.acceptanceCriteria.map((a) => `  ✓ ${a}`));
  return out.join('\n');
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const md = `# Auth wave\n## Goal\nLet users sign in with Google and stay signed in.\n## Objectives\n- OAuth login\n- session persistence\n- logout\n## Acceptance Criteria\n- AC-1 a user can sign in\n- AC-2 the session survives a refresh\n## Notes\n- nothing`;
  const t = tldr(md);
  ok('extracts the goal line', /sign in with Google/.test(t.goal));
  ok('extracts 3 objectives', t.objectives.length === 3 && t.objectives.includes('OAuth login'));
  ok('extracts 2 acceptance criteria', t.acceptanceCriteria.length === 2 && /survives a refresh/.test(t.acceptanceCriteria[1]));
  ok('does NOT pull the Notes section into objectives/AC', !t.objectives.includes('nothing') && !t.acceptanceCriteria.includes('nothing'));
  ok('objectives are capped (limit 7)', tldr(`## Objectives\n${'- x\n'.repeat(20)}`).objectives.length === 7);
  ok('render produces a compact human summary', /Spec TL;DR/.test(render(t)) && /Goal:/.test(render(t)));
  ok('empty spec → empty-ish TL;DR, no crash', tldr('').objectives.length === 0);

  if (fails.length) { console.log(`\n\x1b[31mspec-tldr self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ spec-tldr: structural spec summary correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const sp = arg('--spec');
  if (!sp || !existsSync(sp)) { console.error('usage: --spec <file.md>  (or --self-test)'); process.exit(2); }
  console.log(render(tldr(readFileSync(sp, 'utf8'))));
  process.exit(0);
}
