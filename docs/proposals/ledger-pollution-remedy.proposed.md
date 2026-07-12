# Proposal: register `ledger-pollution` in the gate registry (owner-only apply)

Date: 2026-07-12. Status: **awaiting explicit owner approval**.

`scripts/meta-remedies.mjs` is ALWAYS_PROTECTED (an agent must not register its own gate), so
this entry is applied by the owner, same flow as the 2026-07-12 registration (recorded in
`l0-write-audit.jsonl`).

## Why

meta-audit flags `ledger-pollution` as a RECURRING class with no registered gate
(2 incidents 2026-06-06: wave-judge-debias telemetry rows `{ts,wave,run1,run2}` landed in
`meta-mistakes.jsonl` masquerading as mistakes; recurrence the same day; both caught only
downstream by meta-honesty).

## What is now built and proven (this wave, 2026-07-12)

The remedy moved from detect-after to **reject-at-write** — three layers off one shared
validator (`validateLedgerEntry` in `scripts/meta-lib.mjs`; required fields
`date/class/claimed/real/caught_by`, all non-empty, ISO date):

1. `scripts/meta-log.mjs` — the legit append path validates BEFORE appending; a garbage row
   exits 2 and never touches the ledger.
2. `scripts/ledger-schema-gate.mjs` — NEW hard gate over the whole ledger file (catches
   direct-append side channels that bypass meta-log). Wired: `.githooks/pre-commit` (blocking),
   CI `ci.yml` (`npm run gate:ledger-schema`, hard), installer product hooks, gate-audit
   registry. 13 self-test assertions + 5 eval-suite golden cases.
3. `scripts/meta-honesty.mjs` — unchanged, stays as defence-in-depth on signal QUALITY of
   valid rows.

This supersedes the weaker draft in `docs/audits/PENDING_REMEDIES_REGISTRATION.md` (which
proposed registering meta-honesty as the mechanism — detect-after, not reject-at-write).

## The registry entry — paste into `scripts/meta-remedies.mjs` before the closing `};`

```js
  'ledger-pollution': {
    // 2026-06-06 ×2 (wave-judge-debias telemetry rows in the mistake ledger; recurrence same
    // day; root-caused 2026-07-04). Remedy moved from detect-after (meta-honesty) to
    // reject-at-write on 2026-07-12: meta-log validates before append, ledger-schema-gate
    // hard-blocks commit/CI on any row missing the mistake schema.
    since: '2026-07-12',
    mechanism: 'scripts/ledger-schema-gate.mjs',
    family: ['telemetry-in-ledger', 'garbage-in-ledger', 'schema-missing-fields', 'self-confirming-row'],
    premortem: {
      risk: /\b(append|log|write|emit)\b.*\b(meta-mistakes|ledger|run1|run2|telemetry)\b/i,
      clears: /\b(claimed|real|caught_by|ledger-schema-gate|validateLedgerEntry|meta-honesty|sidecar|separate stream|telemetry file)\b/i,
      advise: 'the mistake ledger takes only real incidents (date/class/claimed/real/caught_by); telemetry goes to its own sidecar stream — meta-log rejects garbage at write, ledger-schema-gate blocks it at commit',
    },
    gate:
      'Every row in meta-mistakes.jsonl must be valid JSON carrying date/class/claimed/real/caught_by ' +
      '(all non-empty; shared validator validateLedgerEntry in meta-lib). Enforced at WRITE (meta-log ' +
      'rejects, exit 2) and at COMMIT/CI (ledger-schema-gate hard-blocks, wired in .githooks/pre-commit ' +
      'and ci.yml since 2026-07-12); meta-honesty remains defence-in-depth on signal quality.',
  },
```

## Apply + verify (owner)

```bash
# paste the entry, then:
node scripts/meta-audit.mjs        # ledger-pollution reads "GATED — holding", exit reflects remaining debt
node scripts/eval-suite.mjs        # green, incl. the 5 new ledger-schema cases
node scripts/gate-audit.mjs        # ledger-schema-gate: CI/hard, verified present in workflows
```

Then mirror the registry change into the installed copy (`~/.claude/jidoka/scripts/meta-remedies.mjs`,
absolute mechanism path per the install convention) and record the apply in `l0-write-audit.jsonl`.
