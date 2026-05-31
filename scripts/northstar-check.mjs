#!/usr/bin/env node
// northstar-check — structural gate for a product's North Star (docs/NORTH_STAR.md).
//
// The North Star is the compass every feature and business process is derived from (CPO owns it,
// dev-pipeline step 0 runs it). This script enforces the HONEST, checkable part: the document
// exists, is filled (not the raw template, no leftover <placeholders>, every section has a body).
//
// HONEST SPLIT: the semantic judgement — does THIS feature help / stay neutral / conflict with the
// North Star — is an LLM call the CPO agent makes; it is NOT automatable here and is left to the
// agent (DORMANT for a script). What IS automatable, and what this enforces, is: you cannot run a
// wave against a North Star that does not exist or was never filled in. Optionally checks that a
// wave spec is bound to the North Star (mentions it), so the alignment verdict can't be skipped.
//
// FULL & self-tested. Usage:
//   node scripts/northstar-check.mjs --self-test
//   node scripts/northstar-check.mjs --doc <path>/docs/NORTH_STAR.md [--spec <path>/wave_SPEC.md]

import { readFileSync, existsSync } from 'node:fs';

const SECTIONS = 7; // template sections 1..7

// pure: validate the North Star document content
export function checkDoc(content) {
  const issues = [];
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm && /status:\s*Template/i.test(fm[1])) issues.push('document is still the TEMPLATE (status: Template) — fill it per product');

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

// pure: is a wave spec bound to the North Star (so the alignment verdict can't be silently skipped)?
export function checkBinding(specContent) {
  return /north[\s_-]?star/i.test(specContent);
}

function selfTest() {
  const GOOD = `---
status: Active
---
# North Star — Demo
## 1. North Star
Service businesses never miss a lead, 24/7, with humans always in control of decisions.
## 2. Why it exists
Owners lose up to 30% of inbound leads because people cannot physically answer at night.
## 3. Goal
Every inbound answered under 60 seconds; the owner sees true daily revenue without asking anyone.
## 4. Principles
Honest over impressive. Speak the customer's language. The human makes the calls.
## 5. Invariants
A human approves before anything irreversible reaches a customer. "Sent" means the tool succeeded.
## 6. What we do NOT do
Not a generic chatbot. Not a CRM replacement. We do not act without a human in the loop.
## 7. How we check alignment
Every feature is run helps / neutral / conflicts before build; conflicts trigger andon.`;

  const withPlaceholder = GOOD.replace('Honest over impressive. Speak the customer\'s language. The human makes the calls.', '<your principles here>');
  const missing5 = GOOD.replace(/## 5\. Invariants[\s\S]*?(?=## 6\.)/, '');
  const template = GOOD.replace('status: Active', 'status: Template');
  const thin3 = GOOD.replace('Every inbound answered under 60 seconds; the owner sees true daily revenue without asking anyone.', 'x');

  const T = [
    ['a complete doc passes', checkDoc(GOOD).filled === true],
    ['a leftover <placeholder> fails', checkDoc(withPlaceholder).issues.some(i => i.includes('placeholder'))],
    ['a missing section fails', checkDoc(missing5).issues.some(i => i.includes('missing section 5'))],
    ['the raw template fails', checkDoc(template).issues.some(i => i.includes('TEMPLATE'))],
    ['an empty/thin section fails', checkDoc(thin3).issues.some(i => i.includes('too thin'))],
    ['a spec that mentions the North Star is bound', checkBinding('This wave aligns with the North Star: helps.') === true],
    ['a spec that ignores it is not bound', checkBinding('Just some endpoints and tables.') === false],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mnorthstar-check self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ northstar-check passes — structural North Star validation correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
if (process.argv.includes('--self-test')) selfTest();

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const docPath = arg('--doc') || 'docs/NORTH_STAR.md';
const specPath = arg('--spec');

if (!existsSync(docPath)) {
  console.error(`\x1b[31m✗ no North Star at ${docPath}\x1b[0m — create it from docs/NORTH_STAR_TEMPLATE.md (the CPO owns this). A wave cannot run without the product's compass.`);
  process.exit(2);
}
const { filled, issues } = checkDoc(readFileSync(docPath, 'utf8'));
if (!filled) {
  console.error(`\x1b[31m✗ North Star at ${docPath} is not complete:\x1b[0m`);
  for (const i of issues) console.error(`    - ${i}`);
  process.exit(1);
}
if (specPath && existsSync(specPath) && !checkBinding(readFileSync(specPath, 'utf8'))) {
  console.error(`\x1b[31m✗ spec ${specPath} is not bound to the North Star\x1b[0m — the alignment verdict (helps/neutral/conflicts) must be stated. The CPO makes that call.`);
  process.exit(1);
}
console.log(`\x1b[32m✓ North Star at ${docPath} exists and is complete${specPath ? ', and the spec is bound to it' : ''}.\x1b[0m`);
console.log(`  \x1b[2mhelps/neutral/conflicts is the CPO's semantic call (not automatable here) — this gate guarantees the compass exists to make it against.\x1b[0m`);
process.exit(0);
}
