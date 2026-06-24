import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureFromSpec, extractACs, buildStory } from '../shard-story-bundle.mjs';

test('featureFromSpec derives a clean slug from a master-spec path', () => {
  assert.equal(featureFromSpec('docs/specs/wave-foo_MASTER_SPEC.md'), 'wave-foo');
  assert.equal(featureFromSpec('docs/specs/My_Thing_MASTER_SPEC.md'), 'my-thing');
});

test('extractACs finds AC-id lines and bullets under an Acceptance heading', () => {
  const text = ['# T', '## Acceptance Criteria', '- loads under 1s', '- shows empty hint', 'prose', 'AC-3: error toast'].join('\n');
  const acs = extractACs(text);
  assert.ok(acs.includes('loads under 1s'));
  assert.ok(acs.some((a) => /AC-3/.test(a)));
});

test('extractACs returns nothing for plain prose', () => {
  assert.equal(extractACs('# Title\nsome description with no criteria').length, 0);
});

test('extractACs dedupes repeated criteria', () => {
  const text = '## Acceptance\n- same\n- same';
  assert.equal(extractACs(text).length, 1);
});

test('buildStory inlines controlling spec AND ancestry bodies, not pointers', () => {
  const story = buildStory({
    wave: 'wave-foo', task: 'build',
    matched: { path: 'docs/specs/wave-foo_MASTER_SPEC.md', title: 'Wave Foo', level: 'L3', text: 'CONTROLLING-BODY' },
    ancestry: [{ path: 'docs/MISSION.md', title: 'Mission', level: 'L0', text: 'ANCESTOR-BODY' }],
    acs: ['loads under 1s'],
  });
  assert.ok(story.includes('CONTROLLING-BODY'));
  assert.ok(story.includes('ANCESTOR-BODY'));
  assert.ok(story.includes('- [ ] loads under 1s'));
  assert.ok(/Self-contained/.test(story));
});

test('buildStory tolerates no ancestry and no ACs', () => {
  const story = buildStory({ wave: 'w', task: 't', matched: { path: 'p', title: 'T', text: 'B' } });
  assert.ok(story.includes('B'));
  assert.ok(!story.includes('Acceptance criteria (must all hold)'));
});
