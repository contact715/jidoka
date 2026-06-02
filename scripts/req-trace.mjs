#!/usr/bin/env node
// req-trace — verify that every requirement flows through the full chain:
//   requirement → spec-objective → acceptance-criteria → test → code → deploy-artifact
// Nothing should fall off silently. Extends map-ac-coverage (which checks AC→test) into a
// full bidirectional traceability register.
//
// A register entry: { id, spec, ac, test, code, deployed }
// Each field is truthy when that stage has a reference to this requirement.
//
// Usage:
//   node scripts/req-trace.mjs --self-test
//   node scripts/req-trace.mjs --register docs/req-register.json

export function trace(register = []) {
  const STAGES = ['spec', 'ac', 'test', 'code', 'deployed'];
  const gaps = [];
  for (const req of register) {
    const missing = STAGES.filter((s) => !req[s]);
    if (missing.length) gaps.push({ id: req.id, missing });
  }
  const complete = register.length - gaps.length;
  return {
    total: register.length,
    complete,
    gaps,
    ok: gaps.length === 0,
    coveragePct: register.length ? Math.round((100 * complete) / register.length) : 100,
  };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const full = [{ id: 'REQ-1', spec: 'wave-1', ac: 'AC-1', test: 'auth.test.ts', code: 'auth.ts', deployed: true }];
  ok('fully traced requirement → ok', trace(full).ok === true && trace(full).coveragePct === 100);

  const partial = [
    { id: 'REQ-1', spec: 'wave-1', ac: 'AC-1', test: 'auth.test.ts', code: 'auth.ts', deployed: true },
    { id: 'REQ-2', spec: 'wave-1', ac: 'AC-2', test: null, code: null, deployed: false },
  ];
  const r = trace(partial);
  ok('partially traced → not ok', r.ok === false);
  ok('gap identified correctly (REQ-2 missing test/code/deployed)', r.gaps[0]?.id === 'REQ-2' && r.gaps[0].missing.includes('test'));
  ok('coverage pct = 50 (1 of 2 complete)', r.coveragePct === 50);

  ok('empty register → ok (nothing to trace)', trace([]).ok === true && trace([]).coveragePct === 100);

  const missingSpec = [{ id: 'REQ-3', spec: null, ac: 'AC-3', test: 't.ts', code: 'f.ts', deployed: true }];
  ok('requirement with no spec → gap at spec stage', trace(missingSpec).gaps[0]?.missing.includes('spec'));

  if (fails.length) { console.log(`\n\x1b[31mreq-trace self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ req-trace: requirement traceability chain correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const { readFileSync, existsSync } = await import('node:fs');
  const rp = arg('--register');
  if (!rp || !existsSync(rp)) { console.error('usage: --register <file.json>  (or --self-test)'); process.exit(2); }
  const reg = JSON.parse(readFileSync(rp, 'utf8'));
  const r = trace(reg);
  console.log(`req-trace: ${r.complete}/${r.total} requirements fully traced (${r.coveragePct}%)`);
  if (!r.ok) {
    console.error(`\x1b[31m✗ ${r.gaps.length} requirement(s) with gaps:\x1b[0m`);
    r.gaps.forEach((g) => console.error(`  ${g.id}: missing [${g.missing.join(', ')}]`));
    process.exit(1);
  }
  console.log('\x1b[32m✓ all requirements fully traced to deploy\x1b[0m');
  process.exit(0);
}
