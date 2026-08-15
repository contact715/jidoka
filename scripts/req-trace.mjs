#!/usr/bin/env node
// req-trace — verify that every requirement flows through the full chain:
//   requirement → spec-objective → acceptance-criteria → test → code → deploy-artifact
// Nothing should fall off silently. Extends map-ac-coverage (which checks AC→test) into a
// full bidirectional traceability register.
//
// unwanted-and-orphaned (2026-W32-R11) — two changes, both about things the old version could
// not see.
//
// 1. THE VACUUM GREEN. The old `trace([])` returned `{ ok: true, coveragePct: 100 }`: an empty
//    register was reported as perfect traceability. That is the worst possible failure for a
//    gate, because "no requirements are registered" and "every requirement is traced" printed
//    the same green. A checker that cannot fail is not a checker. An empty register is now
//    UNVERIFIABLE and fails, naming the reason.
//
// 2. THE MISSING DIRECTION. The chain only ever looked forward, requirement → code. Two whole
//    classes of drift live in the other direction, and openfasttrace (itsallcode, 157 stars)
//    names them:
//      unwanted  — code exists that no requirement ever asked for. Nobody notices, because the
//                  forward check is perfectly green: every requirement IS covered. The extra
//                  code just sits there, maintained forever, tested forever, wanted by nobody.
//      orphaned  — a requirement whose parent no longer exists. The requirement still looks
//                  covered, but the thing that justified it is gone, so the coverage is proof
//                  of nothing.
//
// Zero dependencies. Usage:
//   node scripts/req-trace.mjs --self-test
//   node scripts/req-trace.mjs --register docs/req-register.json [--code docs/code-inventory.json]

// requirement→task coverage (2026-W30-R3) — `task` sits between the acceptance criterion and the
// test: it is the unit of work a wave actually dispatches. Without it the chain could show a
// requirement fully traced to code while NO task ever carried it, which is how a requirement gets
// satisfied by accident and nobody can say which wave owns it.
//
// This was proposed as a separate scripts/requirement-task-coverage.mjs. It is built HERE instead:
// a second traceability instrument would be a second answer to "is this requirement covered?", and
// two instruments answering one question with different bars is the defect this engine keeps
// closing (see docs/METRICS_GLOSSARY.md). One register, one verdict, one more axis on it.
const STAGES = ['spec', 'ac', 'task', 'test', 'code', 'deployed'];

/**
 * Requirement → task matrix: which wave-task carries each requirement, and which tasks carry none.
 * Pure. `taskInventory` (optional) enables the reverse axis: a dispatched task nobody asked for.
 */
export function taskCoverage(register = [], taskInventory = null) {
  const rows = register.map((r) => ({ id: r.id, task: r.task || null, covered: Boolean(r.task) }));
  const uncovered = rows.filter((r) => !r.covered).map((r) => r.id);
  const claimed = new Set(register.map((r) => r.task).filter(Boolean));
  const unrequested = Array.isArray(taskInventory) ? taskInventory.filter((t) => !claimed.has(t)) : [];
  return {
    rows,
    uncovered,
    unrequested,
    // an empty register is "не проверено", never 100% — the same vacuum-green rule as trace()
    coveragePct: register.length ? Math.round((rows.filter((r) => r.covered).length / register.length) * 100) : null,
    ok: register.length > 0 && uncovered.length === 0 && unrequested.length === 0,
  };
}

/**
 * Full traceability verdict. Pure.
 * @param {Array} register       [{ id, spec, ac, test, code, deployed, parent }]
 * @param {object} [opts]
 * @param {string[]} [opts.codeInventory]  every code artifact that exists, for the reverse axis
 * @param {string[]} [opts.knownParents]   parent ids that still exist, for orphan detection
 */
export function trace(register = [], opts = {}) {
  const codeInventory = Array.isArray(opts.codeInventory) ? opts.codeInventory : null;
  const knownParents = Array.isArray(opts.knownParents) ? opts.knownParents : null;

  // An empty register cannot be green. Nothing to trace is not the same as everything traced.
  if (!register.length) {
    return {
      total: 0,
      complete: 0,
      gaps: [],
      unwanted: [],
      orphaned: [],
      ok: false,
      unverifiable: true,
      reason: 'реестр требований пуст: проверять нечего, поэтому это НЕ зелёный, а «не проверено»',
      coveragePct: null,
    };
  }

  const gaps = [];
  for (const req of register) {
    const missing = STAGES.filter((s) => !req[s]);
    if (missing.length) gaps.push({ id: req.id, missing });
  }

  // reverse axis: code that no requirement claims
  const claimed = new Set(register.map((r) => r.code).filter(Boolean));
  const unwanted = codeInventory ? codeInventory.filter((c) => !claimed.has(c)) : [];

  // upward axis: a requirement whose parent is gone
  const orphaned = knownParents
    ? register.filter((r) => r.parent && !knownParents.includes(r.parent)).map((r) => ({ id: r.id, parent: r.parent }))
    : [];

  const complete = register.length - gaps.length;
  return {
    total: register.length,
    complete,
    gaps,
    unwanted,
    orphaned,
    ok: gaps.length === 0 && unwanted.length === 0 && orphaned.length === 0,
    unverifiable: false,
    reason: null,
    coveragePct: Math.round((100 * complete) / register.length),
  };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  // `task` joined STAGES in W30-R3, so every fixture that claims FULL tracing must now name the
  // task that carried the requirement. The old fixtures going red was the change announcing itself.
  const full = [{ id: 'REQ-1', spec: 'wave-1', ac: 'AC-1', task: 'T-1', test: 'auth.test.ts', code: 'auth.ts', deployed: true }];
  ok('fully traced requirement → ok', trace(full).ok === true && trace(full).coveragePct === 100);

  const partial = [
    { id: 'REQ-1', spec: 'wave-1', ac: 'AC-1', task: 'T-1', test: 'auth.test.ts', code: 'auth.ts', deployed: true },
    { id: 'REQ-2', spec: 'wave-1', ac: 'AC-2', task: null, test: null, code: null, deployed: false },
  ];
  const r = trace(partial);
  ok('partially traced → not ok', r.ok === false);
  ok('gap identified correctly (REQ-2 missing test/code/deployed)', r.gaps[0]?.id === 'REQ-2' && r.gaps[0].missing.includes('test'));
  ok('coverage pct = 50 (1 of 2 complete)', r.coveragePct === 50);

  const missingSpec = [{ id: 'REQ-3', spec: null, ac: 'AC-3', test: 't.ts', code: 'f.ts', deployed: true }];
  ok('requirement with no spec → gap at spec stage', trace(missingSpec).gaps[0]?.missing.includes('spec'));

  // ── the vacuum green, killed (2026-W32-R11) ──────────────────────────────
  const empty = trace([]);
  ok('empty register is NOT ok anymore', empty.ok === false);
  ok('empty register is marked unverifiable, not failed-with-gaps', empty.unverifiable === true && empty.gaps.length === 0);

  // ── requirement → task coverage (2026-W30-R3) ───────────────────────────
  ok('a requirement with no task is a gap at the TASK stage',
    trace([{ id: 'REQ-9', spec: 's', ac: 'a', task: null, test: 't', code: 'c', deployed: true }]).gaps[0].missing.includes('task'));
  ok('every requirement carried by a task → covered',
    taskCoverage([{ id: 'REQ-1', task: 'T-1' }, { id: 'REQ-2', task: 'T-2' }]).ok === true);
  ok('a requirement no task carries is named',
    taskCoverage([{ id: 'REQ-1', task: 'T-1' }, { id: 'REQ-2', task: null }]).uncovered.join() === 'REQ-2');
  ok('coverage percentage counts only the carried ones',
    taskCoverage([{ id: 'a', task: 'T' }, { id: 'b', task: null }]).coveragePct === 50);
  ok('a dispatched task no requirement asked for is surfaced (reverse axis)',
    taskCoverage([{ id: 'REQ-1', task: 'T-1' }], ['T-1', 'T-99']).unrequested.join() === 'T-99');
  ok('an unrequested task alone makes the verdict not ok',
    taskCoverage([{ id: 'REQ-1', task: 'T-1' }], ['T-1', 'T-99']).ok === false);
  // same vacuum-green rule as trace(): nothing to check is never 100%
  ok('an empty register is NOT 100% task coverage',
    taskCoverage([]).coveragePct === null && taskCoverage([]).ok === false);
  ok('empty register says WHY in plain words', /пуст/.test(empty.reason));
  ok('empty register has no coverage number at all, not 100', empty.coveragePct === null);

  // ── unwanted: code nobody asked for ──────────────────────────────────────
  const inv = ['auth.ts', 'legacy-export.ts'];
  const u = trace(full, { codeInventory: inv });
  ok('code with no requirement is reported as unwanted', u.unwanted.length === 1 && u.unwanted[0] === 'legacy-export.ts');
  ok('unwanted code makes the verdict fail even though every requirement is covered',
    u.ok === false && u.gaps.length === 0);
  ok('a fully claimed inventory produces no unwanted', trace(full, { codeInventory: ['auth.ts'] }).unwanted.length === 0);
  ok('without an inventory the reverse axis stays silent', trace(full).unwanted.length === 0);

  // ── orphaned: the parent is gone ─────────────────────────────────────────
  const withParent = [{ ...full[0], parent: 'EPIC-9' }];
  const o = trace(withParent, { knownParents: ['EPIC-1'] });
  ok('a requirement whose parent vanished is orphaned', o.orphaned.length === 1 && o.orphaned[0].parent === 'EPIC-9');
  ok('an orphan fails the verdict even when fully covered', o.ok === false);
  ok('a live parent is not an orphan', trace(withParent, { knownParents: ['EPIC-9'] }).orphaned.length === 0);
  ok('a requirement with no parent is not an orphan', trace(full, { knownParents: [] }).orphaned.length === 0);
  ok('without a parent list the upward axis stays silent', trace(withParent).orphaned.length === 0);

  // all three axes at once
  const all = trace([{ id: 'R', spec: 's', ac: 'a', test: null, code: 'c.ts', deployed: true, parent: 'GONE' }],
    { codeInventory: ['c.ts', 'extra.ts'], knownParents: ['ALIVE'] });
  ok('forward gap, unwanted code and orphan are reported together',
    all.gaps.length === 1 && all.unwanted.length === 1 && all.orphaned.length === 1);

  if (fails.length) { console.log(`\n\x1b[31mreq-trace self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ req-trace: forward chain, unwanted code, orphaned requirements; an empty register cannot be green\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const { readFileSync, existsSync } = await import('node:fs');
  const rp = arg('--register');
  if (!rp || !existsSync(rp)) { console.error('usage: --register <file.json> [--code <inventory.json>] [--parents <parents.json>]  (or --self-test)'); process.exit(2); }
  const reg = JSON.parse(readFileSync(rp, 'utf8'));
  const cp = arg('--code');
  const pp = arg('--parents');
  const opts = {};
  if (cp && existsSync(cp)) opts.codeInventory = JSON.parse(readFileSync(cp, 'utf8'));
  if (pp && existsSync(pp)) opts.knownParents = JSON.parse(readFileSync(pp, 'utf8'));

  const r = trace(reg, opts);
  if (r.unverifiable) {
    console.error(`\x1b[31m✗ req-trace: ${r.reason}\x1b[0m`);
    console.error('  Пустой реестр это НЕ «всё прослежено». Заполни реестр или убери гейт.');
    process.exit(1);
  }
  console.log(`req-trace: ${r.complete}/${r.total} requirements fully traced (${r.coveragePct}%)`);
  let bad = false;
  if (r.gaps.length) {
    bad = true;
    console.error(`\x1b[31m✗ ${r.gaps.length} requirement(s) with gaps:\x1b[0m`);
    r.gaps.forEach((g) => console.error(`  ${g.id}: missing [${g.missing.join(', ')}]`));
  }
  if (r.unwanted.length) {
    bad = true;
    console.error(`\x1b[31m✗ ${r.unwanted.length} code artifact(s) no requirement asked for:\x1b[0m`);
    r.unwanted.forEach((c) => console.error(`  ${c}`));
  }
  if (r.orphaned.length) {
    bad = true;
    console.error(`\x1b[31m✗ ${r.orphaned.length} orphaned requirement(s) — the parent is gone:\x1b[0m`);
    r.orphaned.forEach((o) => console.error(`  ${o.id} → ${o.parent}`));
  }
  if (bad) process.exit(1);
  console.log('\x1b[32m✓ all requirements traced to deploy; no unwanted code, no orphans\x1b[0m');
  process.exit(0);
}
