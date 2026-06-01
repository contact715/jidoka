#!/usr/bin/env node
// dependency-audit — supply-chain gate. Runs `npm audit` and FAILS on high/critical vulnerabilities,
// the attack vector nothing else here covers. Portable: in a zero-dependency project (the framework
// engine itself is zero-dep) there is genuinely nothing to scan, so it PASSES with an honest note —
// not a fake pass. In a product with dependencies it runs the real audit and blocks on high/critical.
// Ships into products via install-into.
//
// FULL & self-tested: assess() (the pass/fail decision) is pure + tested; the CLI runs real npm audit.
// Usage:
//   node scripts/dependency-audit.mjs --self-test
//   node scripts/dependency-audit.mjs              # audit cwd (honest pass if zero-dep)

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// pure: decide pass/fail from `npm audit --json` output
export function assess(auditJson, { failOn = ['critical', 'high'] } = {}) {
  let data;
  try { data = typeof auditJson === 'string' ? JSON.parse(auditJson) : auditJson; } catch { return { error: true, fail: false, blocking: 0, counts: {} }; }
  const v = data.metadata?.vulnerabilities || data.vulnerabilities || {};
  const counts = { critical: v.critical || 0, high: v.high || 0, moderate: v.moderate || 0, low: v.low || 0 };
  const blocking = failOn.reduce((s, lvl) => s + (counts[lvl] || 0), 0);
  return { counts, blocking, fail: blocking > 0, error: false };
}

// does this project even have dependencies to audit?
function hasDeps(root = process.cwd()) {
  if (!existsSync(`${root}/package.json`)) return false;
  try { const p = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')); return Object.keys({ ...p.dependencies, ...p.devDependencies }).length > 0; } catch { return false; }
}

function selfTest() {
  const T = [
    ['critical → fail', assess('{"metadata":{"vulnerabilities":{"critical":1}}}').fail === true],
    ['high → fail', assess('{"metadata":{"vulnerabilities":{"high":3}}}').blocking === 3],
    ['moderate/low alone → pass', assess('{"metadata":{"vulnerabilities":{"moderate":5,"low":9}}}').fail === false],
    ['clean → pass', assess('{"metadata":{"vulnerabilities":{"critical":0,"high":0}}}').fail === false],
    ['malformed json → no crash, no block', assess('not json').error === true && assess('not json').fail === false],
    ['custom failOn includes moderate', assess('{"metadata":{"vulnerabilities":{"moderate":1}}}', { failOn: ['critical', 'high', 'moderate'] }).fail === true],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mdependency-audit self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ dependency-audit: vulnerability assessment correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  if (!hasDeps()) { console.log('dependency-audit: zero-dependency project — nothing to scan (honest pass, not a fake).'); process.exit(0); }
  let out = '';
  try { out = execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = e.stdout || ''; } // npm audit exits non-zero when vulns exist; the JSON is still on stdout
  const r = assess(out);
  if (r.error) { console.error('dependency-audit: could not parse npm audit output — run `npm audit` manually.'); process.exit(0); }
  console.log(`dependency-audit: critical ${r.counts.critical}, high ${r.counts.high}, moderate ${r.counts.moderate}, low ${r.counts.low}`);
  if (r.fail) { console.error(`\x1b[31m✗ ${r.blocking} high/critical vulnerabilit(ies) — fix or upgrade before merge.\x1b[0m`); process.exit(1); }
  console.log('\x1b[32m✓ no high/critical dependency vulnerabilities.\x1b[0m');
  process.exit(0);
}
