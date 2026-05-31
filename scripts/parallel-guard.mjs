#!/usr/bin/env node
// parallel-guard — before the orchestrator dispatches build agents IN PARALLEL, check that their
// write_scopes do not overlap. Two agents writing the same files concurrently is a lost-update /
// merge-conflict waiting to happen. This computes the safe plan:
//   • non-overlapping scopes  → dispatch in parallel, no isolation needed.
//   • overlapping scopes      → isolate (run each in its own git worktree, Agent isolation:'worktree')
//                               OR serialize. The guard names the conflicting pair so the
//                               orchestrator picks deliberately, instead of racing blindly.
//
// HONEST SPLIT: the scope-overlap analysis = FULL (here, self-tested). The actual worktree isolation
// is a Claude Code Agent-tool feature (isolation:'worktree') the orchestrator invokes per the
// dev-pipeline note; this guard tells it WHEN that's required.
//
// FULL & self-tested. Usage:
//   node scripts/parallel-guard.mjs --self-test
//   node scripts/parallel-guard.mjs --agents '[{"slug":"backend","write_scope":"app/api/**"},{"slug":"frontend","write_scope":"components/**"}]'

// base path of a glob = everything before the first wildcard
const base = (g) => String(g).split(/[*?]/)[0].replace(/\/+$/, '');

// do two single globs cover any common path?
export function globsOverlap(a, b) {
  const x = base(a), y = base(b);
  if (x === '' || y === '') return true;                       // a bare ** covers everything
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/');
}

// do two write_scopes (comma-separated glob lists) overlap on any pair?
export function scopesOverlap(scopeA, scopeB) {
  const A = String(scopeA || '').split(',').map(s => s.trim()).filter(Boolean);
  const B = String(scopeB || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const a of A) for (const b of B) if (globsOverlap(a, b)) return true;
  return false;
}

// conflicting pairs among agents about to run in parallel
export function conflicts(agents) {
  const out = [];
  for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) {
    if (scopesOverlap(agents[i].write_scope, agents[j].write_scope)) out.push([agents[i].slug, agents[j].slug]);
  }
  return out;
}

function selfTest() {
  const T = [
    ['disjoint scopes do NOT overlap', scopesOverlap('app/**', 'components/**') === false],
    ['nested scope overlaps parent', scopesOverlap('app/**', 'app/foo/**') === true],
    ['identical scope overlaps', scopesOverlap('docs/**', 'docs/**') === true],
    ['bare ** overlaps everything', scopesOverlap('**', 'lib/x/**') === true],
    ['comma list: one shared glob → overlap', scopesOverlap('app/**, lib/**', 'docs/**, lib/util/**') === true],
    ['safe parallel build → no conflicts', conflicts([{ slug: 'be', write_scope: 'app/api/**' }, { slug: 'fe', write_scope: 'components/**' }]).length === 0],
    ['overlapping build → flagged pair', JSON.stringify(conflicts([{ slug: 'a', write_scope: 'app/**' }, { slug: 'b', write_scope: 'app/x/**' }])) === '[["a","b"]]'],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31mparallel-guard self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ parallel-guard: scope-overlap analysis correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
  const agents = JSON.parse(arg('--agents') || '[]');
  if (!agents.length) { console.error('usage: --agents \'[{"slug":"x","write_scope":"app/**"},...]\''); process.exit(2); }
  const c = conflicts(agents);
  console.log(`parallel-guard: ${agents.length} agents queued for parallel dispatch\n`);
  if (!c.length) { console.log('  🟢 no write_scope overlap — safe to run all in parallel, no isolation needed.'); process.exit(0); }
  console.error(`  🔴 ${c.length} overlapping pair(s) — racing concurrently risks lost updates:`);
  for (const [a, b] of c) console.error(`     ${a} ✕ ${b}`);
  console.error('\n  Fix: run the conflicting agents in git worktrees (Agent isolation:"worktree") or serialize them. Non-conflicting ones can still go parallel.');
  process.exit(1);
}
