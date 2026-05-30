#!/usr/bin/env node
/**
 * Wave-108 — Module INDEX generator.
 *
 * Globs all docs/specs/modules/**\/*.md, extracts YAML frontmatter fields,
 * and writes docs/specs/modules/_MODULE_INDEX.md with a summary table.
 *
 * Excluded files:
 *   - _MODULE_TEMPLATE.md
 *   - Any file whose basename starts with _EXAMPLE
 *   - README.md files (category overviews, not module specs)
 *   - _MODULE_INDEX.md itself
 *
 * Sort order: agents → funnels → surfaces → infrastructure (by module_type field)
 *
 * Usage:
 *   node scripts/regenerate-modules-index.mjs        # write docs/specs/modules/_MODULE_INDEX.md
 *   node scripts/regenerate-modules-index.mjs --dry  # print table, do not write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'docs/specs/modules');
const OUT = path.join(MODULES_DIR, '_MODULE_INDEX.md');
const isDry = process.argv.includes('--dry');

// Files to exclude from the index (by basename)
const EXCLUDE_BASENAMES = new Set([
  '_MODULE_TEMPLATE.md',
  '_MODULE_INDEX.md',
  'README.md',
]);

// Sort order for module_type
const TYPE_ORDER = ['agent', 'funnel', 'surface', 'infrastructure'];

// ── Recursive glob ─────────────────────────────────────────────────────
function globMd(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    process.stderr.write(`[warn] cannot read directory: ${dir}\n`);
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...globMd(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Exclude by basename
      if (EXCLUDE_BASENAMES.has(entry.name)) continue;
      // Exclude files whose basename starts with _EXAMPLE
      if (entry.name.startsWith('_EXAMPLE')) continue;
      results.push(fullPath);
    }
  }
  return results;
}

// ── YAML frontmatter extraction ────────────────────────────────────────
// Parses the YAML block between the first pair of `---` delimiters.
// Line-by-line regex — no yaml npm dependency.
function extractFrontmatter(content) {
  const lines = content.split('\n');
  let inBlock = false;
  let blockStart = false;
  const fields = {};
  let linkedWavesCount = 0;
  let codeRefsCount = 0;
  let inLinkedWaves = false;
  let inCodeRefs = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '---') {
      if (!blockStart) {
        blockStart = true;
        inBlock = true;
        continue;
      } else {
        // End of frontmatter
        break;
      }
    }

    if (!inBlock) continue;

    // Skip comment lines inside frontmatter
    if (line.trim().startsWith('#')) continue;

    // Detect list entries for arrays (linked_waves, code_references)
    const listItemMatch = line.match(/^  - (.+)$/);
    if (listItemMatch) {
      if (inLinkedWaves) {
        linkedWavesCount++;
        continue;
      }
      if (inCodeRefs) {
        codeRefsCount++;
        continue;
      }
      continue;
    }

    // Reset array-tracking when we hit a new non-list line
    if (!line.startsWith('  ') && line.trim() !== '') {
      inLinkedWaves = false;
      inCodeRefs = false;
    }

    // Key: value pairs
    const kvMatch = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = kvMatch[2].trim();

      if (key === 'linked_waves') {
        inLinkedWaves = true;
        inCodeRefs = false;
        // Inline value (unlikely for arrays but handle it)
        if (val && val !== '[]' && val !== '') {
          linkedWavesCount++;
        }
        continue;
      }
      if (key === 'code_references') {
        inCodeRefs = true;
        inLinkedWaves = false;
        if (val && val !== '[]' && val !== '') {
          codeRefsCount++;
        }
        continue;
      }

      // Other scalar fields
      if (val && val !== '[]') {
        fields[key] = val.replace(/^["']|["']$/g, '');
      }
    }
  }

  fields._linkedWavesCount = linkedWavesCount;
  fields._codeRefsCount = codeRefsCount;
  return fields;
}

// ── Extract module name from H1 heading ───────────────────────────────
function extractModuleName(content) {
  const m = content.match(/^#\s+Module:\s*(.+)$/m);
  if (m) return m[1].trim();
  // Fallback: any H1
  const h1 = content.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : null;
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(MODULES_DIR)) {
    process.stderr.write('[warn] docs/specs/modules/ not found — nothing to index\n');
    process.exit(0);
  }

  const files = globMd(MODULES_DIR);

  const rows = [];
  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      process.stderr.write(`[warn] cannot read file: ${filePath} — ${err.message}\n`);
      continue;
    }

    const fm = extractFrontmatter(content);
    const moduleName = extractModuleName(content) ?? path.basename(filePath, '.md');
    const relPath = path.relative(ROOT, filePath);

    rows.push({
      name: moduleName.length > 50 ? moduleName.slice(0, 47) + '...' : moduleName,
      type: fm.module_type ?? '?',
      status: fm.status ?? 'Draft',
      version: fm.version ?? '?',
      ownerRole: fm.owner_role ?? '?',
      linkedWaves: fm._linkedWavesCount,
      codeRefs: fm._codeRefsCount,
      relPath,
    });
  }

  // Sort by TYPE_ORDER, then by name within each type
  rows.sort((a, b) => {
    const aIdx = TYPE_ORDER.indexOf(a.type);
    const bIdx = TYPE_ORDER.indexOf(b.type);
    const typeSort = (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    if (typeSort !== 0) return typeSort;
    return a.name.localeCompare(b.name);
  });

  // ── Build markdown table ───────────────────────────────────────────
  const header = '| Module name | Type | Status | Version | Owner role | Linked waves | Code refs |';
  const sep    = '|---|---|---|---|---|---|---|';
  const dataRows = rows.map((r) =>
    `| ${r.name} | ${r.type} | ${r.status} | ${r.version} | ${r.ownerRole} | ${r.linkedWaves} | ${r.codeRefs} |`
  );

  const timestamp = new Date().toISOString();
  const output = `# Module Spec INDEX

> Auto-generated by \`scripts/regenerate-modules-index.mjs\` — do not edit manually. Last update: ${timestamp}
>
> Excludes: \`_MODULE_TEMPLATE.md\`, \`_EXAMPLE.md\` seed files, \`README.md\` files.
> Run \`node scripts/regenerate-modules-index.mjs --dry\` to preview without writing.

${[header, sep, ...dataRows].join('\n')}

---

_Total: ${rows.length} module specs indexed._
`;

  if (isDry) {
    process.stdout.write(output);
    process.exit(0);
  }

  fs.writeFileSync(OUT, output);
  process.stdout.write(`[modules-index] wrote ${rows.length} rows → docs/specs/modules/_MODULE_INDEX.md\n`);
}

main();
