#!/usr/bin/env node
// resource-guard — catch runaway/unbounded resource use BEFORE it hits production.
// Real incident: writes to a DB every second inside a setInterval → terabytes overnight.
// Static heuristic: flag write/network/growth ops inside a tight loop or interval without
// an accompanying throttle/batch/limit/break guard. Also validates an optional runtime
// budget declaration (max writes/sec, max allocations) so the architect is FORCED to think
// about the ceiling before the build starts.
//
// HONEST boundary: keyword-based static scan (no AST). It flags patterns — it is possible to
// fool with unusual naming. Complement with code-review and the runtime budget declaration.
//
// FULL & self-tested. Usage:
//   node scripts/resource-guard.mjs --self-test
//   node scripts/resource-guard.mjs --code <file>
//   node scripts/resource-guard.mjs --budget '{"writesPerSec":100}' (validate a declaration)

// patterns that indicate a loop/interval context
const LOOP_CTX = [
  /setInterval\s*\(/,
  /setTimeout\s*\(.*,\s*[0-9]+\)/,  // repeated setTimeout (scheduling)
  /while\s*\(/,
  /for\s*\(/,
  /\.forEach\s*\(/,
  // NOTE: .map/.reduce/.filter are bounded value-transforms over an existing array, not runaway loops —
  // including them over-flagged a fold (dailySpendCents) in the cost-ledger validation wave. Dropped.
];

// patterns that indicate a resource-heavy operation
const RESOURCE_OPS = [
  // db/storage verbs only — NOT .push/.append/.set (those are array/Map/collection ops on local memory,
  // not storage; .push to a local accumulator was false-flagged in the cost-ledger validation wave).
  { re: /\.(save|insert|create|update|upsert|delete|remove|writeRecord)\s*\(|\bINSERT\b|\bUPDATE\b|\bDELETE\b/, kind: 'db/storage write' },
  { re: /fetch\s*\(|axios\.|http\.request|https\.request/, kind: 'network call' },
  { re: /fs\.(write|append|createWriteStream)/, kind: 'file write' },
  { re: /\.emit\s*\(|\.publish\s*\(|\.send\s*\(/, kind: 'event/message dispatch' },
];

// guard phrases that indicate the developer thought about throttling
const GUARDS = [
  /throttle|debounce|batch|limit|maxPer|rateLimit|queue|semaphore|break|clearInterval|return\s+if/i,
];

export function scan(code = '') {
  const lines = code.split('\n');
  const findings = [];
  let inLoopDepth = 0;
  let loopLineStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // track loop/interval entry
    if (LOOP_CTX.some((re) => re.test(line))) {
      inLoopDepth++;
      if (inLoopDepth === 1) loopLineStart = i + 1;
    }

    // scan for resource ops while inside a loop-like context
    if (inLoopDepth > 0) {
      for (const op of RESOURCE_OPS) {
        if (op.re.test(line)) {
          // check the surrounding 10-line window for a guard
          const window = lines.slice(Math.max(0, i - 5), i + 5).join('\n');
          const guarded = GUARDS.some((g) => g.test(window));
          if (!guarded) {
            findings.push({
              line: i + 1,
              kind: op.kind,
              severity: 'HIGH',
              message: `${op.kind} inside a loop/interval (started ~line ${loopLineStart}) with no throttle/batch/limit guard — potential runaway resource use (Yura's incident: 1 DB write/sec → terabytes overnight)`,
              snippet: line.trim(),
            });
          }
        }
      }
    }

    // rough close-brace tracking (imprecise but catches most cases)
    if (/{/.test(line)) inLoopDepth = Math.max(0, inLoopDepth);
    if (/}/.test(line) && inLoopDepth > 0) inLoopDepth--;
  }

  return { findings, ok: findings.length === 0 };
}

// validate a runtime-budget declaration — the architect MUST declare ceilings
export function validateBudget(budget = {}) {
  const required = ['writesPerSec'];
  const missing = required.filter((k) => !(k in budget));
  const unlimited = Object.entries(budget).filter(([, v]) => v === null || v === Infinity || v === -1).map(([k]) => k);
  return {
    ok: missing.length === 0 && unlimited.length === 0,
    missing,
    unlimited,
    message: missing.length
      ? `runtime budget missing required fields: ${missing.join(', ')}`
      : unlimited.length
      ? `these budget fields are explicitly unlimited — declare an actual ceiling: ${unlimited.join(', ')}`
      : 'runtime budget is declared and bounded',
  };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  // THE real incident: setInterval with a DB write, no throttle
  const incident = `setInterval(async () => {\n  await db.save(record);\n}, 1000);`;
  ok('real incident: setInterval + db.save → HIGH finding', scan(incident).findings.length > 0 && scan(incident).findings[0].severity === 'HIGH');

  // guarded version should pass
  const guarded = `setInterval(async () => {\n  if (queue.length > batchLimit) return;\n  await db.save(record);\n}, 1000);`;
  ok('guarded version (limit check) → no finding', scan(guarded).findings.length === 0);

  // while loop with network call
  const runaway = `while (running) {\n  await fetch('/api/status');\n}`;
  ok('while loop + fetch → flagged', scan(runaway).findings.length > 0);

  // safe code (no loop context)
  const safe = `async function save(record) {\n  await db.save(record);\n}`;
  ok('single save outside a loop → no finding', scan(safe).findings.length === 0);

  // forEach with write but with a throttle guard nearby
  const safeForEach = `items.forEach(item => {\n  throttle(() => item.emit('update'));\n});`;
  ok('forEach with throttle guard → no finding', scan(safeForEach).findings.length === 0);

  // budget validation
  ok('valid budget passes', validateBudget({ writesPerSec: 100 }).ok === true);
  ok('missing writesPerSec → not ok', validateBudget({}).ok === false);
  ok('Infinity budget → not ok (unlimited is not a ceiling)', validateBudget({ writesPerSec: Infinity }).ok === false);
  ok('null budget → not ok', validateBudget({ writesPerSec: null }).ok === false);
  ok('array .push to a local accumulator is NOT a db write (cost-ledger validation-wave regression)', scan('const out = []; items.forEach(x => out.push(x));').ok === true);

  if (fails.length) { console.log(`\n\x1b[31mresource-guard self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ resource-guard: runaway-resource detection + budget validation correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();

  if (arg('--budget')) {
    const r = validateBudget(JSON.parse(arg('--budget')));
    console.log(r.ok ? `\x1b[32m✓ ${r.message}\x1b[0m` : `\x1b[31m✗ ${r.message}\x1b[0m`);
    process.exit(r.ok ? 0 : 1);
  }

  const { readFileSync } = await import('node:fs');
  const file = arg('--code');
  if (!file) { console.error('usage: --code <file> | --budget <json> | --self-test'); process.exit(2); }
  const code = readFileSync(file, 'utf8');
  const r = scan(code);
  if (r.findings.length) {
    console.error(`\x1b[31m✗ resource-guard: ${r.findings.length} finding(s)\x1b[0m`);
    for (const f of r.findings) console.error(`  line ${f.line} [${f.severity}] ${f.message}\n    → ${f.snippet}`);
    process.exit(1);
  }
  console.log('\x1b[32m✓ resource-guard: no runaway-resource patterns detected\x1b[0m');
  process.exit(0);
}
