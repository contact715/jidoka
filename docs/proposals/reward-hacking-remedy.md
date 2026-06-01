# Proposal: register the `reward-hacking` remedy (human edit — L0)

## Why this is a proposal, not a commit
`scripts/meta-remedies.mjs` is the L0 gate registry. The `policy-enforce-hook` (PreToolUse) blocks
agent edits to it by design ("human edit only") — a registry change is a governance act. The hook did
its job and refused my edit. So this is handed to a human to apply.

## The honest state (important)
The gate against `reward-hacking` **already exists and is proven**:
- `scripts/meta-honesty.mjs` catches the actual reward-hacking moves — synonym-pile (restating a claim
  with done/pass synonyms), booster-word inflation, and self-confirming retros (it grades the
  external-catch ratio). Its eval case `meta-honesty/synonym-pile` is green.
- `scripts/red-team.mjs` continuously attacks this class (the `reward-hacking / synonym-pile` find of
  2026-05-31 is a dated, defended attack in its catalog).

`meta-audit` flags `reward-hacking` as "ungated recurring" only because the **registry** has no entry,
not because the gate is missing. This proposal closes the registry gap.

## The patch
In `scripts/meta-remedies.mjs`, insert this block immediately before `  'scope-narrowed-silently': {`:

```js
  'reward-hacking': {
    since: '2026-05-31',
    mechanism: 'scripts/meta-honesty.mjs',
    family: ['synonym-pile', 'booster-words', 'self-confirming-retro', 'eval-gaming'],
    premortem: {
      risk: /\b(flawless|perfect(ly)?|bulletproof|comprehensive|robust|seamless|world[- ]class|state[- ]of[- ]the[- ]art|100%|all \w+ (pass(ed|ing)?|verified|confirmed|successful))\b/i,
      clears: /\b(external|red[- ]?team|falsif|counterexample|caught_by|independent (check|review|judge)|adversarial)\b/i,
      advise: 'get an EXTERNAL/adversarial check that could falsify the claim; more pass-synonyms is lexical novelty, not semantic evidence',
    },
    gate:
      'A retro/claim must not GAME the reward signal. Done/pass-synonym restatements, booster-word piles, ' +
      'and self-confirming entries are caught by meta-honesty (synonym-pile + booster detection + external-catch ' +
      'ratio); red-team continuously attacks this class. Lexical novelty is not semantic novelty.',
  },
```

## After applying
```
node scripts/meta-audit.mjs     # reward-hacking should now read "gated & holding", not "ungated recurring"
node scripts/eval-suite.mjs     # expect 61/61 (no regression)
node scripts/meta-honesty.mjs   # unchanged — still audits signal honesty
```
`since: '2026-05-31'` makes the two 2026-05-31 incidents the CAUSE of the gate (not regressions), so it
reads as holding-under-watch, which is the truthful state.
