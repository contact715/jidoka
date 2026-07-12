# Pending: register 4 gates in the L0 remedy registry (human-only edit)

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

## Added 2026-06-05 (spec-tree-overhaul) — two more classes meta-audit now flags

Both mechanisms are already **built and proven**:
- `gate-bypass` → `scripts/policy-enforce-hook.mjs` (REUSE, hardened this session). Blocks Write/Edit AND Bash side-channels (`>`, `>>`, `tee`, `sed -i`, `node fs.writeFileSync`, `cp/mv`) to L0/secret paths, case-insensitively; owner-grant for L0 docs is audited and never covers secrets/.git/registries. 25 self-tests including the exact red-team finds (bash side-channel, case-variant). **UPDATED 2026-07-12**: the hook is now also ROUTED for Bash in `~/.claude/settings.json` (until then only Write|Edit|MultiEdit|NotebookEdit received traffic — the side-channel logic existed but nothing called it), and `gate-audit.mjs verifyPreToolUse()` fails the audit on built-but-unrouted PreToolUse gates. Use the refreshed entry in `docs/proposals/meta-remedies.proposed.mjs` (since: 2026-07-12), not the snippet below.
- `ledger-pollution` → **SUPERSEDED 2026-07-12**: the mechanism is now `scripts/ledger-schema-gate.mjs` (reject-at-write + commit/CI hard-block), not meta-honesty (detect-after). Use the newer entry in `docs/proposals/ledger-pollution-remedy.proposed.md` instead of the snippet below.

```js
  'gate-bypass': {
    since: '2026-06-05',
    mechanism: 'scripts/policy-enforce-hook.mjs',
    family: ['l0-write-sidechannel', 'case-variant-bypass', 'protected-path-write'],
    premortem: {
      risk: /\b(write|edit|append|sed -i|tee|cp|mv|writeFileSync)\b.*\b(CONSTITUTION|MISSION|NORTH_STAR|\.secrets|\.env|meta-remedies|baseline)\b/i,
      clears: /\b(policy-enforce|owner-grant|blocked|self-test|PreToolUse)\b/i,
      advise: 'L0/secret writes go through policy-enforce-hook; agents never write meta-remedies/baselines/secrets, and L0 docs only under an audited owner grant',
    },
    gate:
      'A write to an L0/secret path (Write/Edit OR a Bash side-channel) must be blocked by policy-enforce-hook unless an audited owner grant covers an L0 DOC (never a secret/registry/.git). 25 self-tests cover the side-channel and case-variant red-team finds.',
  },
  'ledger-pollution': {
    since: '2026-06-05',
    mechanism: 'scripts/meta-honesty.mjs',
    family: ['self-confirming-row', 'telemetry-in-ledger', 'garbage-in-ledger'],
    premortem: {
      risk: /\b(append|log|write|emit)\b.*\b(meta-mistakes|ledger|run1|run2)\b/i,
      clears: /\b(claimed|real|caught_by|meta-honesty|separate stream|telemetry file)\b/i,
      advise: 'the mistake ledger takes only real incidents (class/claimed/real/caught_by); test telemetry goes to its own stream, not meta-mistakes.jsonl',
    },
    gate:
      'A row in meta-mistakes.jsonl must carry claimed/real/caught_by (a real incident), not run1/run2 test telemetry. meta-honesty flags self-confirming/garbage rows and BLOCKS commit until they are removed or rewritten.',
  },
```

## After pasting, verify the loop closed:
```bash
node scripts/meta-audit.mjs   # all four classes should read "🟢 GATED — holding"; exit 0
```
