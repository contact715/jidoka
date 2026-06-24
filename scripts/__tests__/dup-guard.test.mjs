import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportIndex, findCollisions, extractExports } from '../dup-guard.mjs';

const corpus = [
  { path: 'scripts/a.mjs', content: 'export function loadThing(){}\nexport const X = 1;' },
  { path: 'scripts/b.mjs', content: 'export function other(){}' },
];

test('buildExportIndex maps symbols to owners, ignores generic names', () => {
  const index = buildExportIndex([...corpus, { path: 'scripts/g.mjs', content: 'export function main(){}' }]);
  assert.equal(index.get('loadThing').length, 1);
  assert.ok(!index.has('main'));
});

test('findCollisions flags a re-declared export and names the owner', () => {
  const index = buildExportIndex(corpus);
  const hits = findCollisions('scripts/c.mjs', 'export function loadThing(){}', index);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].symbol, 'loadThing');
  assert.ok(hits[0].existingIn.includes('scripts/a.mjs'));
});

test('a genuinely new export is not flagged', () => {
  const index = buildExportIndex(corpus);
  assert.equal(findCollisions('scripts/d.mjs', 'export function brandNew(){}', index).length, 0);
});

test('a file never collides with itself', () => {
  const index = buildExportIndex(corpus);
  assert.equal(findCollisions('scripts/a.mjs', 'export function loadThing(){}', index).length, 0);
});

test('generic-named exports never collide', () => {
  const index = buildExportIndex([{ path: 'scripts/f.mjs', content: 'export function run(){}' }]);
  assert.equal(findCollisions('scripts/e.mjs', 'export function run(){}', index).length, 0);
});

test('export-like tokens inside string literals are ignored (no false collisions)', () => {
  const fixturey = "const demo = { content: 'export function loadThing(){}' };\nexport const realOne = 1;";
  assert.deepEqual(extractExports(fixturey), ['realOne']);
  const index = buildExportIndex([{ path: 'scripts/a.mjs', content: 'export function loadThing(){}' }]);
  assert.equal(findCollisions('scripts/g.mjs', fixturey, index).length, 0);
});

test('export { a, b as c } named exports are extracted', () => {
  assert.deepEqual(extractExports('export { foo, bar as baz };'), ['foo', 'bar']);
});
