import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, buildIdf, scoreItem, retrieve } from '../memory-retrieve.mjs';

const tf = (toks) => { const m = new Map(); for (const t of toks) m.set(t, (m.get(t) || 0) + 1); return m; };

test('tokenize lowercases, strips punctuation and stopwords (RU+EN)', () => {
  assert.deepEqual(tokenize('Fix the Git history secret leak!'), ['fix', 'git', 'history', 'secret', 'leak']);
  assert.equal(tokenize('the and for это что как').length, 0);
});

test('idf gives rarer terms more weight', () => {
  const idf = buildIdf([tf(['git', 'secret']), tf(['git', 'react']), tf(['git', 'css'])]);
  assert.ok(idf.get('secret') > idf.get('git'));
});

test('scoreItem rewards query-term overlap, length-normalised', () => {
  const idf = buildIdf([tf(['secret', 'git']), tf(['react', 'hooks'])]);
  const hit = scoreItem(['secret'], tf(['secret', 'git', 'history']), idf);
  const miss = scoreItem(['secret'], tf(['react', 'hooks']), idf);
  assert.ok(hit > 0 && miss === 0);
});

const items = [
  { id: 'a', kind: 'lesson', title: 'secret-leak', text: 'git history still leaked private tokens and secrets before publish', recency: 0.2 },
  { id: 'b', kind: 'lesson', title: 'react-hooks', text: 'too many useEffect cascading renders in a component', recency: 2.0 },
  { id: 'c', kind: 'doc', title: 'docs/specs/x.md', text: 'unrelated content about layout grids', recency: 0 },
];

test('relevance beats recency when the task overlaps a lesson', () => {
  const { results, relevanceDriven } = retrieve(items, 'secret leaked in git history', 2);
  assert.equal(relevanceDriven, true);
  assert.equal(results[0].title, 'secret-leak'); // not the higher-recency react-hooks
});

test('falls back to recency when the task overlaps nothing', () => {
  const { results, relevanceDriven } = retrieve(items, 'orthogonal quantum zebra', 3);
  assert.equal(relevanceDriven, false);
  assert.equal(results[0].title, 'react-hooks');
});

test('dedupes to one representative per theme', () => {
  const dup = [...items, { id: 'a2', kind: 'lesson', title: 'secret-leak', text: 'dup', recency: 0.1 }];
  const { results } = retrieve(dup, 'secret', 5);
  assert.equal(results.filter((x) => x.title === 'secret-leak').length, 1);
});

test('respects k', () => {
  const { results } = retrieve(items, 'secret react layout', 2);
  assert.equal(results.length, 2);
});
