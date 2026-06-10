#!/usr/bin/env node
// cost-crosscheck — surface the AUTHORITATIVE dollar spend from ccusage (ryoppippi/ccusage), the
// widely-used external tool that prices Claude Code's local usage logs at real model rates.
//
// WHY: our digest shows TOKENS (cc-stats), not money, and compute-cost.mjs is a per-WAVE estimator,
// not actual transcript spend — so we have no honest dollar figure of our own. ccusage is the de-facto
// authority. v1 simply surfaces its number in the morning digest; a later step can cross-check it
// against an our-side transcript-dollar figure once we compute one.
//
// HONEST BOUNDARY (offline sandbox): ccusage must be installed (needs network once). When it is
// absent this DEGRADES GRACEFULLY — prints "unavailable", exits 0, never errors a digest. The live
// ccusage round-trip + exact JSON shape could NOT be exercised in the offline build sandbox; the
// extractor is defensive (deep-searches for the cost field) and self-tested on representative shapes,
// but ONE real run on a networked machine should confirm the parse. Marked, not hidden.
//
// FULL (extractor + degradation) & self-tested:  node scripts/cost-crosscheck.mjs --self-test
//   node scripts/cost-crosscheck.mjs            # best-effort: run ccusage, print real $ spend

import { execFileSync } from 'node:child_process';

// pure: deep-search a parsed ccusage JSON for the most plausible TOTAL cost in USD.
// ccusage shapes vary across versions (totals.totalCost, totalCost, cost, daily[].totalCost…),
// so we walk the object and take the max numeric value found under a cost-ish key — defensive by
// design rather than pinned to one shape we could not verify offline.
export function extractCostUsd(obj) {
  let best = null;
  const COSTKEY = /(^|_|\.)?(total)?cost(usd)?$|costusd$|total_cost$/i;
  const walk = (node, key = '') => {
    if (node == null) return;
    if (typeof node === 'number') { if (COSTKEY.test(key) && Number.isFinite(node)) best = Math.max(best ?? 0, node); return; }
    if (Array.isArray(node)) { for (const v of node) walk(v, key); return; }
    if (typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k);
  };
  walk(obj);
  return best;
}

// best-effort runner: prefer an installed `ccusage`, then bun's cache; NEVER auto-download in a hook.
function runCcusage() {
  for (const [cmd, args] of [['ccusage', ['--json']], ['bunx', ['ccusage', '--json']]]) {
    try {
      const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
      const json = JSON.parse(out);
      return { json, via: cmd };
    } catch { /* try next */ }
  }
  return null;
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };
  ok('extract: totals.totalCost', extractCostUsd({ totals: { totalCost: 12.34, totalTokens: 999 } }) === 12.34);
  ok('extract: flat totalCost', extractCostUsd({ totalCost: 5 }) === 5);
  ok('extract: daily array → max total', extractCostUsd({ daily: [{ date: 'a', totalCost: 1.5 }, { date: 'b', totalCost: 4.0 }], totals: { totalCost: 5.5 } }) === 5.5);
  ok('extract: ignores non-cost numbers', extractCostUsd({ totalTokens: 999999, inputTokens: 12345 }) === null);
  ok('extract: empty → null', extractCostUsd({}) === null);
  if (fails.length) { console.log(`\n\x1b[31mcost-crosscheck self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ cost-crosscheck: cost extraction correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const res = runCcusage();
  if (!res) {
    console.log('💲 реальные траты: ccusage недоступен (офлайн или не установлен). Установите один раз: `npx ccusage` / `bun add -g ccusage`.');
    process.exit(0); // graceful — never break a digest
  }
  const usd = extractCostUsd(res.json);
  if (usd == null) { console.log(`💲 ccusage отработал (${res.via}), но в его JSON не нашлось поля стоимости — проверьте версию ccusage.`); process.exit(0); }
  console.log(`💲 реальные траты Claude Code (ccusage, ${res.via}): ~$${usd.toFixed(2)} итог по логам · разбивка: \`ccusage daily\` / \`ccusage monthly\``);
  process.exit(0);
}
