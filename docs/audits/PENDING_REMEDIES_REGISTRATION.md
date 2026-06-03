# Pending: register 2 gates in the L0 remedy registry (human-only edit)

`scripts/meta-remedies.mjs` is an L0 gate-registry. `policy-enforce-hook` blocks agent edits **by
design** — an agent must not be able to register its own gate (that is the reward-hacking surface the
registry exists to prevent). So a human pastes the two entries below.

Both mechanisms are already **built and proven**:
- `self-test-blindspot` → `scripts/selftest-reality.mjs` (self-test 7/7; full scan 61 scripts, 0 blindspots). NEW.
- `reward-hacking` → `scripts/meta-honesty.mjs` (DONE_SYNONYMS / synonym-pile fix, with a self-test for the exact ledger incident). REUSE.

## Paste these two entries into `scripts/meta-remedies.mjs`, just before the closing `};`

```js
  'self-test-blindspot': {
    since: '2026-06-02',
    mechanism: 'scripts/selftest-reality.mjs',
    family: ['green-but-never-ran', 'ismain-guard-broken', 'synthetic-fixture-only'],
    premortem: {
      risk: /\b(self-?test|--self-test|fixtures?|passes|green|all (tests )?pass|exit 0)\b/i,
      clears: /\b(asserts?|assertion|real (data|code|files)|actually ran|realpath|\d+\/\d+)\b/i,
      advise: 'prove the self-test actually ASSERTED (scripts/selftest-reality.mjs), and ran on realistic input — not just that it exited 0',
    },
    gate:
      'A self-test that exits 0 without asserting anything proves nothing (the never-ran / broken-isMain bug). ' +
      'scripts/selftest-reality.mjs runs every --self-test and BLOCKS on any that exit 0 with zero assertion output.',
  },
  'reward-hacking': {
    since: '2026-05-31',
    mechanism: 'scripts/meta-honesty.mjs',
    family: ['synonym-pile', 'tautology-as-contradiction', 'metric-gamed'],
    premortem: {
      risk: /\b(trustworthy|all (tests )?pass|verified confirmed|successfully|100%|score (up|improved))\b/i,
      clears: /\b(contradicts|novel (content|information)|external(ly)? (caught|checked)|real failure|distinct cause)\b/i,
      advise: 'the honesty audit must score real contra-evidence, not a synonym-pile restating the claim (meta-honesty DONE_SYNONYMS)',
    },
    gate:
      'A retro/claim must introduce real contra-information, not restate the claim via done/pass synonyms to score TRUSTWORTHY. ' +
      'scripts/meta-honesty.mjs contradicts() neutralises synonym-piles (DONE_SYNONYMS), so a tautology cannot pass as a real mistake.',
  },
```

## After pasting, verify the loop closed:
```bash
node scripts/meta-audit.mjs   # both classes should move from "⚠ ungated" to "🟢 GATED — holding"; exit 0
```
