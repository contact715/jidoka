# scripts/

Project automation scripts. Run via npm script wrappers when available.

## create-tool

Scaffolds a new tool: route stub, component skeleton, and registers the tool
in the matching per-category catalog file under
`components/tools-hub/data/catalog/<category>.ts`.

Usage:

```bash
npm run create-tool -- --id=foo --name="Foo Tool" --category=growth --description="Does foo things"
```

Options:

- `--id` (required): kebab-case identifier (e.g. `foo-bar`)
- `--name` (required): display name
- `--category` (required): one of `lead-capture`, `communication`, `scheduling`, `reputation`, `growth`, `sales`, `ops`, `builders`
- `--description`: short description (default: `...`)
- `--status`: `live` | `beta` | `coming-soon` (default: `coming-soon`)
- `--icon`: lucide icon name to use in the tools hub card (default: `Sparkles`). The icon import is auto-added to the catalog file if missing.
- `--agent-id`: link to an existing agent (optional)
- `--dry-run`: print what would be created, don't write any files

The tool entry is appended to the end of the `<CATEGORY>_TOOLS` array in
`catalog/<category>.ts`. Duplicate `id` is detected across all catalogs.

## bundle-size-check.mjs

Bundle size baseline tracker. Reads `.next` build manifests after `npm run build`,
computes per-route bundle sizes, and compares against `scripts/.bundle-baseline.json`.

Usage:

```bash
node scripts/bundle-size-check.mjs            # check
node scripts/bundle-size-check.mjs --update   # accept current as new baseline
```

Or via npm script: `npm run check:bundle`.

## check-security-patterns.sh

Bash gate that fails on common security anti-patterns (raw `javascript:` URLs in
`href`, fake-provisioning `setTimeout` patterns) and warns on
`dangerouslySetInnerHTML` without sanitization and high `window.location.href`
counts.

Usage:

```bash
bash scripts/check-security-patterns.sh
```

Or via npm script: `npm run check:security`.

## Meta-Mistake Engine (`meta-*`)

A self-improving system that turns recurring PROCESS mistakes into enforced gates,
then checks whether those gates actually hold over time. The premise: a repeated
miss is not bad luck, it is a missing mechanism.

| Script | Role |
|---|---|
| `meta-log.mjs <class> <claimed> <real> [caught_by]` | append a mistake to the ledger |
| `meta-audit.mjs` | closed-loop detector: holding / regression / ungated / broken-gate (exit 1 on regression or ungated recurrence) |
| `meta-trend.mjs` | learning curve over time: gate coverage, time-to-gate, regression rate, verdict |
| `meta-honesty.mjs` | adversarial audit of the signal: self-confirming entries, booster language, self-reported misses (exit 1 on garbage-in) |
| `meta-premortem.mjs "<planned action>"` | preventive check of an action against known classes before you act (exit 1 on unaddressed risk) |
| `meta-generalize.mjs [class]` | family map; reuse an existing gate for a variant class instead of building a new one |
| `meta-decay.mjs` | age out gates that no longer earn hard status, without removing a working one |
| `meta-lib.mjs`, `meta-remedies.mjs` | shared core: ledger/trip loaders, date math, and the single-source-of-truth gate registry |

The registry (`meta-remedies.mjs`) is the single source of truth: each class maps to
its gate, the date it went live (`since`), the enforcing mechanism, the `family` of
adjacent classes it also covers, and the `premortem` risk signature.

Every engine accepts env overrides so it is testable without touching production data:
`META_LEDGER`, `META_TRIP_LOG`, `META_TODAY`.

```bash
node scripts/meta-audit.mjs        # is any gate leaking, or any class ungated?
node scripts/meta-trend.mjs        # are we getting better over time?
node scripts/meta-honesty.mjs      # can we trust the ledger we learn from?
node scripts/meta-premortem.mjs "fixed the bug, ready to publish"
node scripts/meta-generalize.mjs   # what does each lesson already cover?
node scripts/meta-decay.mjs        # which gates can relax, which must stay hard?
```
