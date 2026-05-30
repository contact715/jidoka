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

## generate-vertical-images.mjs

One-off generator for vertical asset images. See file header for usage.
