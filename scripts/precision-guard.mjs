#!/usr/bin/env node
// precision-guard — flag float arithmetic on money/quantity identifiers before it ships.
// Real risk: JS floating-point is inexact (0.1+0.2 !== 0.3); on financial amounts or
// inventory quantities this silently corrupts data over millions of operations.
// The fix: use integer cents, BigInt, or a decimal library. This gate flags the pattern
// so the developer makes an explicit choice before merging.
//
// HONEST boundary: identifier-name heuristic (not type inference). A var named "total"
// won't be flagged; "totalPrice" will. Tune MONEY_IDS and QUANTITY_IDS if needed.
//
// Usage:
//   node scripts/precision-guard.mjs --self-test
//   node scripts/precision-guard.mjs --code <file>

// identifiers that almost certainly carry monetary values
const MONEY_IDS = /\b(price|cost|amount|total|fee|tax|discount|balance|charge|rate|revenue|payment|salary|wage|fare|subtotal|grandTotal|invoiceTotal)\b/i;
// identifiers that carry quantities where precision matters
const QUANTITY_IDS = /\b(quantity|qty|count|weight|volume|percent|ratio|share|portion)\b/i;

// float arithmetic operators in an expression context
const FLOAT_OPS = /[+\-*\/]\s*[\d.]+[eE]?[\d]*\b|[\d]+\.\d+\s*[+\-*\/]/;

// safe patterns: integer cents, BigInt, or explicit decimal lib usage
// safe patterns: integer cents, BigInt, a decimal lib, or NON-money float math (percentages, time,
// clamps). Expanded after the Mosco product wave flagged correct cents code + percentage/time calcs.
const SAFE = /BigInt|toFixed\(\d+\)|Math\.(round|min|max|floor|ceil|abs)|parseInt|parseFloat.*100|Decimal|Dinero|currency|toCents|fromCents|Cents\b|formatMoney|formatCurrency|getTime|\*\s*100\b|\/\s*100\b|percent|\bpct\b/i;

export function scan(code = '') {
  const lines = code.split('\n');
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // skip comment lines: a usage example like "--limit-cents 2000" is documentation, not float math
    // (caught by the cost-ledger validation wave — a comment was flagged as money arithmetic).
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    // real-code hardening (Mosco product wave: 205 false-positives → strip string/template/regex
    // literals first, so money words in UI text, marketing copy ("Earn 25-40%"), comparison tables,
    // className strings ("text-5xl"), and regex literals are not mistaken for money ARITHMETIC.
    const codeOnly = line.replace(/'[^']*'|"[^"]*"|`[^`]*`|\/[^/\n]+\/[a-z]*/g, '').replace(/\/\/.*$/, '');
    const hasMoney = MONEY_IDS.test(codeOnly);
    const hasQuantity = QUANTITY_IDS.test(codeOnly);
    if (!(hasMoney || hasQuantity)) continue;
    if (!FLOAT_OPS.test(codeOnly)) continue;
    // money-float must live in an assignment or a call — not prose / JSX text / mock-data literals
    // ("Most trades see 12-15%", "99% to 99.9% credit", { delta: -3 }). The final real-code cut.
    if (!/[=(]/.test(codeOnly)) continue; // no float arithmetic on this line
    if (SAFE.test(line)) continue;       // already using a safe pattern
    findings.push({
      line: i + 1,
      kind: hasMoney ? 'money' : 'quantity',
      severity: hasMoney ? 'HIGH' : 'MEDIUM',
      message: `float arithmetic on a ${hasMoney ? 'money' : 'quantity'} identifier — use integer cents, BigInt, or a Decimal library`,
      snippet: line.trim(),
    });
  }
  return { findings, ok: findings.length === 0 };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('price + 0.1 → HIGH finding', scan('const total = price + 0.1;').findings[0]?.severity === 'HIGH');
  ok('amount * 1.2 → flagged', scan('const fee = amount * 1.2;').findings.length > 0);
  ok('quantity / 3.0 → MEDIUM finding', scan('const share = quantity / 3.0;').findings[0]?.severity === 'MEDIUM');
  ok('BigInt safe → no finding', scan('const total = BigInt(price) + BigInt(fee);').findings.length === 0);
  ok('Math.round safe → no finding', scan('const cents = Math.round(price * 100);').findings.length === 0);
  ok('Decimal safe → no finding', scan('const total = new Decimal(price).plus(fee);').findings.length === 0);
  ok('plain string with "price" but no arithmetic → no finding', scan('const label = `Price: ${price}`;').findings.length === 0);
  ok('non-money identifier (foo) not flagged', scan('const result = foo * 1.5;').findings.length === 0);
  ok('comment with money words is NOT flagged (cost-ledger validation-wave regression)', scan('//   node x.mjs --limit-cents 2000 --date 2026-06-02').findings.length === 0);
  ok('JSX/marketing prose with money words is NOT flagged (Mosco product wave)', scan('Most trades see 12-15% more revenue per month').findings.length === 0);
  ok('mock-data object (delta in a literal) is NOT flagged (Mosco product wave)', scan('{ id: "t6", count: 9, delta: -8 }').findings.length === 0);
  ok('correct integer-cents code is NOT flagged', scan('const c = formatMoney(program.totalEarnedCents);').findings.length === 0);

  if (fails.length) { console.log(`\n\x1b[31mprecision-guard self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ precision-guard: float-on-money/quantity detection correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const { readFileSync } = await import('node:fs');
  const file = arg('--code');
  if (!file) { console.error('usage: --code <file> | --self-test'); process.exit(2); }
  const r = scan(readFileSync(file, 'utf8'));
  if (!r.ok) {
    console.error(`\x1b[31m✗ precision-guard: ${r.findings.length} finding(s)\x1b[0m`);
    r.findings.forEach((f) => console.error(`  line ${f.line} [${f.severity}] ${f.message}\n    → ${f.snippet}`));
    process.exit(1);
  }
  console.log('\x1b[32m✓ precision-guard: no float-on-money patterns detected\x1b[0m');
  process.exit(0);
}
