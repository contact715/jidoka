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

// ── dag-leaf-path-gate / scope-escape (2026-W28-R2) ─────────────────────────
// Until now this file only compared agents to EACH OTHER: "do two declared scopes overlap?" Nobody
// ever compared an agent to ITSELF — to the files it actually wrote. So `write_scope` was a promise
// with no check behind it, and gate-audit has listed parallel-guard as a `hard` runtime gate since
// W28 while nothing called it to enforce anything. An agent could declare `components/**` and write
// `scripts/meta-remedies.mjs`, and the only thing standing in the way was the global policy hook,
// which guards a handful of protected paths rather than the agent's own boundary.
//
// The leaves of the dispatch DAG are where this matters: leaf agents are the ones that actually
// write, and they run in parallel, so an escape there is also the lost-update the pairwise check
// was built to prevent.

/** Does `p` fall inside a single glob? Prefix-based, matching globsOverlap's own base() semantics. */
export function pathInGlob(p, glob) {
  const b = base(glob);
  if (b === '') return true;                                   // a bare ** covers everything
  const path = String(p).replace(/^\.\//, '');
  return path === b || path.startsWith(b.endsWith('/') ? b : b + '/');
}

/**
 * Paths the agent wrote that lie OUTSIDE its declared write_scope. Pure.
 * An EMPTY scope returns every path: "declared nothing" must not read as "allowed everything",
 * which is the direction this whole class of defect always fails in.
 */
export function scopeEscapes(writeScope, writtenPaths = []) {
  const globs = String(writeScope || '').split(',').map((s) => s.trim()).filter(Boolean);
  const paths = writtenPaths.map((p) => String(p).trim()).filter(Boolean);
  if (!globs.length) return [...paths];
  return paths.filter((p) => !globs.some((g) => pathInGlob(p, g)));
}

/** Verdict for one leaf agent. `ok:false` blocks — a declared boundary that is not enforced is decoration. */
export function leafGateVerdict(agent = {}, writtenPaths = []) {
  const escapes = scopeEscapes(agent.write_scope, writtenPaths);
  return {
    slug: agent.slug ?? '(unnamed)',
    scope: agent.write_scope ?? '',
    written: writtenPaths.length,
    escapes,
    ok: escapes.length === 0,
    reason: escapes.length
      ? `вышел за объявленную область: ${escapes.slice(0, 8).join(', ')}${escapes.length > 8 ? ` и ещё ${escapes.length - 8}` : ''}`
      : 'все записи внутри объявленной области',
  };
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

    // ── scope-escape on DAG leaves (2026-W28-R2) ────────────────────────────
    ['a write inside the declared scope is fine', scopeEscapes('app/**', ['app/a.ts']).length === 0],
    ['a write OUTSIDE the declared scope is an escape',
      scopeEscapes('app/**', ['scripts/meta-remedies.mjs']).join() === 'scripts/meta-remedies.mjs'],
    ['a comma list allows any of its globs', scopeEscapes('app/**, lib/**', ['lib/x.ts', 'app/y.ts']).length === 0],
    ['only the offending paths are named, not the whole batch',
      scopeEscapes('app/**', ['app/ok.ts', 'docs/bad.md', 'app/also-ok.ts']).join() === 'docs/bad.md'],
    // the direction this class always fails in: silence read as permission
    ['an EMPTY scope forbids everything rather than allowing everything',
      scopeEscapes('', ['anything.ts']).length === 1],
    ['a bare ** really does allow everything', scopeEscapes('**', ['a/b/c.ts', 'x.md']).length === 0],
    ['a nested glob does not leak to its parent', scopeEscapes('app/x/**', ['app/y.ts']).join() === 'app/y.ts'],
    ['a leading ./ does not fool the check', scopeEscapes('app/**', ['./app/a.ts']).length === 0],
    ['leafGateVerdict blocks on an escape and says which path', (() => {
      const v = leafGateVerdict({ slug: 'fe', write_scope: 'components/**' }, ['components/a.tsx', 'scripts/x.mjs']);
      return v.ok === false && /scripts\/x\.mjs/.test(v.reason);
    })()],
    ['leafGateVerdict passes a clean leaf',
      leafGateVerdict({ slug: 'fe', write_scope: 'components/**' }, ['components/a.tsx']).ok === true],
    ['an agent that wrote NOTHING cannot escape',
      leafGateVerdict({ slug: 'fe', write_scope: 'components/**' }, []).ok === true],
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

  // the leaf gate: compare what a leaf agent DECLARED against what it actually wrote (W28-R2)
  if (process.argv.includes('--check-escape')) {
    const slug = arg('--slug') || '(unnamed)';
    const scope = arg('--scope');
    if (scope === null) {
      console.error('✗ --check-escape требует --scope. Отсутствие области это не «можно всё»: без объявленной области гейт не может ничего разрешить.');
      process.exit(2);
    }
    let written = (arg('--written') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (process.argv.includes('--git')) {
      const { execSync } = await import('node:child_process');
      // what this agent actually touched, straight from git rather than from its own report
      const out = execSync('git diff --name-only HEAD', { encoding: 'utf8', timeout: 20_000 });
      written = out.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    const v = leafGateVerdict({ slug, write_scope: scope }, written);
    console.log(`parallel-guard — граница листа "${v.slug}"\n`);
    console.log(`  объявлено: ${v.scope || '(пусто)'}\n  записано файлов: ${v.written}`);
    if (v.ok) { console.log(`\n  \x1b[32m✓ ${v.reason}\x1b[0m`); process.exit(0); }
    console.error(`\n  \x1b[31m✗ ${v.reason}\x1b[0m`);
    console.error('  Объявленная область, которую никто не проверяет, это украшение. Либо расширь write_scope осознанно, либо верни лишние правки.');
    process.exit(1);
  }

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
