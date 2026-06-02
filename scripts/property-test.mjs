#!/usr/bin/env node
// property-test — zero-dep property-based testing (GSD borrow #1, complements mutation testing D).
//
// Mutation testing asks "do the tests catch a change to the code?". Property testing asks the dual:
// "does an INVARIANT hold for many random inputs?". Together they bracket the engine: mutation hardens
// the assertions, property finds the input the hand-written cases never tried. gsd-core ships Stryker
// (we did D) AND property-based testing (this).
//
// Deterministic by design: a seeded RNG (mulberry32), so a failing property reproduces exactly and the
// self-test is stable in CI (no Math.random flakiness). On failure it reports the first counterexample.
//
// HONEST boundary: curated generators (int/bool/array/pick/string) and first-counterexample reporting
// (no shrinking to a minimal case yet). It checks invariants you give it; it does not invent them.
//
// FULL & self-tested. Usage:
//   node scripts/property-test.mjs --self-test
//   (library) import { forAll, gens } from './property-test.mjs'

// deterministic PRNG — same seed → same sequence (reproducible counterexamples, stable CI)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const gens = {
  int: (min, max) => (rng) => min + Math.floor(rng() * (max - min + 1)),
  bool: () => (rng) => rng() < 0.5,
  pick: (arr) => (rng) => arr[Math.floor(rng() * arr.length)],
  array: (elemGen, maxLen = 8) => (rng) => Array.from({ length: Math.floor(rng() * (maxLen + 1)) }, () => elemGen(rng)),
  string: (maxLen = 10) => (rng) => Array.from({ length: Math.floor(rng() * (maxLen + 1)) }, () => String.fromCharCode(97 + Math.floor(rng() * 26))).join(''),
};

// run `prop(input)` for `runs` random inputs; return the first input that fails (or throws)
export function forAll(gen, prop, { runs = 100, seed = 12345 } = {}) {
  const rng = mulberry32(seed);
  for (let i = 0; i < runs; i++) {
    const input = gen(rng);
    let ok;
    try { ok = prop(input); }
    catch (e) { return { ok: false, counterexample: input, runs: i + 1, error: e.message }; }
    if (!ok) return { ok: false, counterexample: input, runs: i + 1 };
  }
  return { ok: true, runs };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  // a true property holds across all runs
  ok('true property (x+0 === x) holds', forAll(gens.int(-1000, 1000), (x) => x + 0 === x, { runs: 200 }).ok === true);
  // a false property is caught with a counterexample
  const bad = forAll(gens.int(1, 100), (x) => x < 50, { runs: 500 });
  ok('false property (x<50) is refuted with a counterexample', bad.ok === false && bad.counterexample >= 50);
  // a planted bug in a real-style function is found: abs() that mishandles a value
  const buggyAbs = (x) => (x === -7 ? -7 : Math.abs(x)); // bug at -7
  const absRes = forAll(gens.int(-10, 10), (x) => buggyAbs(x) >= 0, { runs: 1000 });
  ok('planted bug (abs wrong at -7) is found', absRes.ok === false && absRes.counterexample === -7);
  // a property that THROWS is captured, not crashed
  const thrown = forAll(gens.int(0, 5), (x) => { if (x === 3) throw new Error('boom'); return true; }, { runs: 100 });
  ok('a throwing property is captured as failure (not a crash)', thrown.ok === false && /boom/.test(thrown.error));
  // determinism: same seed → same counterexample
  const r1 = forAll(gens.int(1, 100), (x) => x < 50, { seed: 7, runs: 500 });
  const r2 = forAll(gens.int(1, 100), (x) => x < 50, { seed: 7, runs: 500 });
  ok('deterministic: same seed → same counterexample', r1.counterexample === r2.counterexample);
  // generators produce in-range / well-typed values
  const rng = mulberry32(1);
  ok('int generator stays in range', Array.from({ length: 200 }, () => gens.int(5, 9)(rng)).every((v) => v >= 5 && v <= 9));
  ok('array generator respects maxLen', Array.from({ length: 100 }, () => gens.array(gens.bool(), 4)(rng)).every((a) => a.length <= 4));
  // an invariant on a correct function holds (reverse twice = identity)
  const rev = (a) => [...a].reverse();
  ok('invariant: reverse(reverse(a)) === a', forAll(gens.array(gens.int(0, 9)), (a) => JSON.stringify(rev(rev(a))) === JSON.stringify(a), { runs: 300 }).ok === true);

  // mutation-hardening: pin the < 0.5 threshold in gens.bool with a controlled rng (so < cannot flip to >=)
  ok('gens.bool pins the <0.5 threshold (rng<0.5 → true, rng≥0.5 → false)', gens.bool()(() => 0.3) === true && gens.bool()(() => 0.7) === false);

  if (fails.length) { console.log(`\n\x1b[31mproperty-test self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ property-test: forAll + generators + deterministic counterexamples correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  console.log('property-test is a library. Usage:');
  console.log("  import { forAll, gens } from './property-test.mjs'");
  console.log("  forAll(gens.int(0,100), (x) => myFn(x) >= 0, { runs: 200 })  // → {ok, counterexample?, runs}");
  console.log('  node scripts/property-test.mjs --self-test');
  process.exit(0);
}
