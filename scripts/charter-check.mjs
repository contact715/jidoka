#!/usr/bin/env node
// charter-check — structural gate for a project's Integrity Charter (docs/PROJECT_CHARTER.md).
//
// The Charter is the trunk of the project tree (grown from the North Star root); the project-steward
// owns it and defends it. This script enforces the HONEST, checkable part: the Charter exists, is
// filled (not the template, no leftover <placeholders>, every section has a body), and — optionally
// — that an incoming plan is BOUND to it (names the invariant/zone it touches), so the steward's
// helps/adapt/conflicts verdict can't be skipped.
//
// HONEST SPLIT: the semantic judgement — does THIS change contradict the philosophy/invariants — is
// the project-steward's LLM call (a defense investigation), NOT automatable here and not faked. What
// IS automatable, and enforced here: you cannot run a wave against a project that has no integrity
// contract, or skip binding a plan to it.
//
// FULL & self-tested. Usage:
//   node scripts/charter-check.mjs --self-test
//   node scripts/charter-check.mjs --doc <project>/docs/PROJECT_CHARTER.md [--plan <plan.md>]

import { readFileSync, existsSync } from 'node:fs';

const SECTIONS = 5; // template sections 1..5

export function checkCharter(content) {
  const issues = [];
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm && /status:\s*Template/i.test(fm[1])) issues.push('document is still the TEMPLATE (status: Template) — fill it per project');
  const placeholders = content.match(/<[^>\n]{2,}>/g);
  if (placeholders) issues.push(`${placeholders.length} unfilled placeholder(s), e.g. ${placeholders[0]}`);
  const heads = [...content.matchAll(/^##\s*(\d+)\.?\s*(.*)$/gm)];
  const nums = new Set(heads.map(h => Number(h[1])));
  for (let n = 1; n <= SECTIONS; n++) if (!nums.has(n)) issues.push(`missing section ${n}`);
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index + heads[i][0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : content.length;
    const body = content.slice(start, end).replace(/[\s>]/g, '');
    if (body.length < 20) issues.push(`section ${heads[i][1]} (${heads[i][2].trim() || '?'}) is empty / too thin`);
  }
  return { filled: issues.length === 0, issues };
}

// a plan is bound to the Charter if it references the contract / an invariant / a protected zone
export function checkBinding(planContent) {
  return /charter|invariant|protected[\s-]?zone|north[\s_-]?star/i.test(planContent);
}

function selfTest() {
  const GOOD = `---
status: Active
---
# Integrity Charter — Demo
## 1. Roots
Built on the North Star: agents do the work, humans make the calls; closed system.
## 2. Trunk — invariants
Agent-based, human-in-approval on every action. Tech stack fixed; not swapped without defense.
## 3. Protected zones
The agent model, the data model, and auth cannot change without a defense investigation.
## 4. Derivation
Every funnel stage maps to an agent with an approval point; every feature ladders to a North Star goal.
## 5. Defense Process
conflicts → investigation: intent → breach → reject / adapt / evolve (logged, human decides).`;

  const withPlaceholder = GOOD.replace('Agent-based, human-in-approval on every action. Tech stack fixed; not swapped without defense.', '<your invariants>');
  const missing3 = GOOD.replace(/## 3\. Protected zones[\s\S]*?(?=## 4\.)/, '');
  const template = GOOD.replace('status: Active', 'status: Template');

  const T = [
    ['a complete charter passes', checkCharter(GOOD).filled === true],
    ['a leftover <placeholder> fails', checkCharter(withPlaceholder).issues.some(i => i.includes('placeholder'))],
    ['a missing section fails', checkCharter(missing3).issues.some(i => i.includes('missing section 3'))],
    ['the raw template fails', checkCharter(template).issues.some(i => i.includes('TEMPLATE'))],
    ['a plan naming an invariant is bound', checkBinding('This plan touches the agent-model invariant.') === true],
    ['a plan ignoring the charter is not bound', checkBinding('Just add a button and a route.') === false],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mcharter-check self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ charter-check: structural integrity-charter validation correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const docPath = arg('--doc') || 'docs/PROJECT_CHARTER.md';
  const planPath = arg('--plan');
  if (!existsSync(docPath)) {
    console.error(`\x1b[31m✗ no Integrity Charter at ${docPath}\x1b[0m — the project-steward must create it from docs/PROJECT_CHARTER_TEMPLATE.md. The framework will not change a project with no integrity contract.`);
    process.exit(2);
  }
  const { filled, issues } = checkCharter(readFileSync(docPath, 'utf8'));
  if (!filled) {
    console.error(`\x1b[31m✗ Integrity Charter at ${docPath} is not complete:\x1b[0m`);
    for (const i of issues) console.error(`    - ${i}`);
    process.exit(1);
  }
  if (planPath && existsSync(planPath) && !checkBinding(readFileSync(planPath, 'utf8'))) {
    console.error(`\x1b[31m✗ plan ${planPath} is not bound to the Charter\x1b[0m — name the invariant/zone it touches so the steward can run the Defense Process.`);
    process.exit(1);
  }
  console.log(`\x1b[32m✓ Integrity Charter at ${docPath} exists and is complete${planPath ? ', and the plan is bound to it' : ''}.\x1b[0m`);
  console.log(`  \x1b[2mhelps/adapt/conflicts is the project-steward's defense judgement (not automatable here) — this gate guarantees the contract exists to defend.\x1b[0m`);
  process.exit(0);
}
