#!/usr/bin/env node
// Proof-gate — the remedy for declaration-over-implementation, now TYPE-AWARE.
//
// A claim of "done / implemented / wired / fixed" must come with an EXECUTABLE proof. This gate
// (1) checks the proof is the RIGHT KIND for the claim — a UI / render / console claim cannot be
// proven by a unit test, and a "removed / cleaned from data / history" claim cannot be proven by
// scanning only the working tree — then (2) runs the proof. A wrong-TYPE proof is rejected before
// it even runs. Matches the journal: "React warning declared fixed" (a unit test would not have
// caught it; only a browser run shows the console) and "history cleaned" (the working tree was
// clean while git history still leaked).
//
// PRECISION over recall (lesson: precision-guard was 95% false-positive on real code): only CLEAR
// mismatches are rejected; an ambiguous claim classifies as 'generic' and accepts any passing proof.
//
// Usage:
//   node scripts/proof-gate.mjs "<claim>" "<proof shell command>"
//   node scripts/proof-gate.mjs --self-test
//   e.g. node scripts/proof-gate.mjs "list renders with no console warning" "npm run e2e -- list.spec"

import { execSync } from 'node:child_process';
import { recordTrip } from './meta-lib.mjs';

// pure: classify a claim into a proof-TYPE that constrains acceptable proofs. Conservative —
// returns 'generic' unless the claim CLEARLY needs a browser run or a full-history scan.
export function classifyClaim(claim = '') {
  const c = claim.toLowerCase();
  const removal = /\b(removed?|remove|cleaned?|clean|deleted?|delete|purged?|purge|scrubbed?|redact\w*)\b|вычищ|удал|стёр|стер|очищ/.test(c);
  const dataScope = /\b(history|git|data|pii|secret|credential|token|leak)\b|истори|данны|секрет|утечк/.test(c);
  if (removal && dataScope) return 'data-removal';
  const ui = /\b(renders?|rendered|rendering|console|warning|browser|screen|ui|paints?|displays?|clicks?|hover|viewport|css|layout)\b|консол|экран|рендер/.test(c);
  if (ui) return 'ui';
  return 'generic';
}

// pure: does the proof command match the claim type? null = ok; else { need, why }.
export function proofTypeMismatch(claimType, proof = '') {
  const p = proof.toLowerCase();
  if (claimType === 'ui') {
    const browser = /playwright|puppeteer|cypress|webdriver|browser_|screenshot|\be2e\b|--headed|computer-use|integration-tester|visual-qa|execution-gate[^|]*--run/.test(p);
    if (!browser) return { need: 'a live browser / E2E run', why: 'a UI / render / console claim cannot be proven by a unit test — run the app and observe (Playwright console + screenshot, or execution-gate --run)' };
  }
  if (claimType === 'data-removal') {
    const history = /pre-publish-guard|git\s+log|rev-list|--all\b|log\s+-p|filter-branch|filter-repo|history/.test(p);
    if (!history) return { need: 'a full-history scan', why: 'a "removed / cleaned from data" claim cannot be proven by scanning the working tree only — scan the whole git history (pre-publish-guard / git log -p --all)' };
  }
  return null;
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('classify: UI claim → ui', classifyClaim('the list renders without a console warning') === 'ui');
  ok('classify: data-removal claim → data-removal', classifyClaim('removed the leaked secret from git history') === 'data-removal');
  ok('classify: ambiguous claim → generic (no false constraint)', classifyClaim('the parser handles empty input') === 'generic');
  ok('UI claim + unit-test proof → MISMATCH', proofTypeMismatch('ui', 'node --test parser.test.mjs') !== null);
  ok('UI claim + playwright proof → ok', proofTypeMismatch('ui', 'npm run e2e -- list.spec.ts') === null);
  ok('UI claim + execution-gate --run → ok', proofTypeMismatch('ui', 'node scripts/execution-gate.mjs --run') === null);
  ok('data-removal + tree grep → MISMATCH', proofTypeMismatch('data-removal', 'grep -r secret src/') !== null);
  ok('data-removal + pre-publish-guard → ok', proofTypeMismatch('data-removal', 'node scripts/pre-publish-guard.mjs') === null);
  ok('data-removal + git log -p --all → ok', proofTypeMismatch('data-removal', 'git log -p --all | grep secret') === null);
  ok('generic claim is never constrained', proofTypeMismatch('generic', 'echo whatever') === null);
  if (fails.length) { console.log(`\n\x1b[31mproof-gate self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ proof-gate: claim typing + proof-type match correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const [, , claim, proof] = process.argv;
  if (!claim || !proof) {
    console.error('usage: proof-gate.mjs "<claim>" "<proof shell command>"  |  --self-test');
    console.error('A claim without a runnable proof is, by definition, not done.');
    process.exit(2);
  }

  console.log(`claim: ${claim}`);
  const claimType = classifyClaim(claim);
  console.log(`type:  ${claimType}`);
  console.log(`proof: ${proof}\n`);

  // TYPE GATE (precise): a wrong-KIND proof is meaningless — reject it before it even runs.
  const mism = proofTypeMismatch(claimType, proof);
  if (mism) {
    recordTrip('declaration-over-implementation', 'scripts/proof-gate.mjs');
    console.error(`\x1b[31m✗ WRONG PROOF TYPE — need ${mism.need}.\x1b[0m`);
    console.error(`  ${mism.why}`);
    process.exit(1);
  }

  try {
    const out = execSync(proof, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (out) process.stdout.write(out.endsWith('\n') ? out : out + '\n');
    console.log('\x1b[32m✓ PROVEN — claim accepted as done\x1b[0m');
    process.exit(0);
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    recordTrip('declaration-over-implementation', 'scripts/proof-gate.mjs'); // gate fired: a claim was rejected
    console.error('\n\x1b[31m✗ PROOF FAILED — claim REJECTED, status is NOT done\x1b[0m');
    process.exit(1);
  }
}
